import "../lib/env";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { votes, votePositions, members, syncLog } from "../../lib/schema";
import { sql, eq } from "drizzle-orm";

const CONGRESS = 119;
// The 119th Congress runs through January 2027 — session 1 is 2025, session 2 is 2026.
// Adding 2027 here is harmless once the calendar catches up.
const SESSIONS: { year: number; session: number }[] = [
  { year: 2025, session: 1 },
  { year: 2026, session: 2 },
];
const DELAY_MS = 300;

// ─── XML parsing helpers (no dependency needed for this simple structure) ─────

function extractTag(xml: string, tag: string): string {
  // The opening pattern must require either an immediate `>` or whitespace
  // before any attributes — otherwise `<vote_result[^>]*>` happily matches
  // `<vote_result_text>` and then captures everything up to `</vote_result>`,
  // pulling in every sibling element as raw text. That bug surfaced in the
  // Senate voting descriptions on member pages as literal `</vote_result_text>`
  // and `<question>` tags bleeding into the rendered copy.
  const match = xml.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`)
  );
  return match?.[1]?.trim() || "";
}

// ─── House votes ─────────────────────────────────────────────────────────────

async function ingestHouseVotesForYear(
  db: ReturnType<typeof drizzle>,
  memberIds: Set<string>,
  year: number
) {
  console.log("Ingesting House votes for " + year + "...");

  // Find the latest roll call number from the index page
  const indexRes = await fetch(
    `https://clerk.house.gov/evs/${year}/index.asp`
  );
  const indexHtml = await indexRes.text();
  const rollMatch = indexHtml.match(/rollnumber=(\d+)/);
  const maxRoll = rollMatch ? parseInt(rollMatch[1]) : 0;

  if (maxRoll === 0) {
    console.log("  No House votes found for " + year);
    return 0;
  }

  // Skip rolls we've already ingested for this chamber+year. Without this
  // the daily run re-fetched all ~870 votes every time and hit the 75-min
  // job timeout. Roll-call numbers are append-only within a year, so a
  // single MAX query gives us the right resume point.
  const existing = await db.execute(sql`
    SELECT COALESCE(MAX(roll_number), 0) AS max_roll
    FROM votes
    WHERE chamber='house' AND congress=${CONGRESS}
      AND vote_id LIKE ${`house-${CONGRESS}-${year}-%`}
  `);
  const startRoll = Number((existing.rows[0] as { max_roll: number })?.max_roll ?? 0) + 1;
  if (startRoll > maxRoll) {
    console.log(`  Up to date — ${maxRoll} on disk, nothing new`);
    return 0;
  }

  console.log(`  Found ${maxRoll} House roll calls; ingesting ${startRoll}..${maxRoll}`);

  let votesIngested = 0;
  for (let roll = maxRoll; roll >= startRoll; roll--) {
    const rollStr = String(roll).padStart(3, "0");
    const url = `https://clerk.house.gov/evs/${year}/roll${rollStr}.xml`;

    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const xml = await res.text();

      const voteId = `house-${CONGRESS}-${year}-${roll}`;
      const session = parseInt(extractTag(xml, "session") || "1");
      const question = extractTag(xml, "vote-question");
      const desc = extractTag(xml, "vote-desc");
      const result = extractTag(xml, "vote-result");
      const dateStr = extractTag(xml, "action-date");
      const legisNum = extractTag(xml, "legis-num");

      // Parse date: "3-Jan-2025" → "2025-01-03"
      const dateParts = dateStr.match(/(\d+)-(\w+)-(\d+)/);
      let voteDate = year + "-01-01";
      if (dateParts) {
        const months: Record<string, string> = {
          Jan: "01", Feb: "02", Mar: "03", Apr: "04",
          May: "05", Jun: "06", Jul: "07", Aug: "08",
          Sep: "09", Oct: "10", Nov: "11", Dec: "12",
        };
        const m = months[dateParts[2]] || "01";
        const d = dateParts[1].padStart(2, "0");
        voteDate = `${dateParts[3]}-${m}-${d}`;
      }

      // Parse totals from totals-by-vote
      const totalsBlock = xml.match(
        /<totals-by-vote>[\s\S]*?<\/totals-by-vote>/
      );
      let yeas = 0, nays = 0, present = 0, notVoting = 0;
      if (totalsBlock) {
        yeas = parseInt(extractTag(totalsBlock[0], "yea-total") || "0");
        nays = parseInt(extractTag(totalsBlock[0], "nay-total") || "0");
        present = parseInt(extractTag(totalsBlock[0], "present-total") || "0");
        notVoting = parseInt(
          extractTag(totalsBlock[0], "not-voting-total") || "0"
        );
      }

      // Skip quorum calls and procedural votes with no yea/nay
      if (yeas === 0 && nays === 0 && question === "Call by States") continue;

      // Try to link to a bill
      let billId: string | null = null;
      const billMatch = legisNum.match(/H\s*R\s*(\d+)|S\s*(\d+)|H\s*J\s*RES\s*(\d+)/i);
      if (billMatch) {
        const num = billMatch[1] || billMatch[2] || billMatch[3];
        const type = legisNum.toLowerCase().replace(/\s+/g, "").replace(/\./g, "");
        billId = `${type.startsWith("s") ? "s" : type.startsWith("hj") ? "hjres" : "hr"}-${num}-${CONGRESS}`;
      }

      // Upsert vote
      await db
        .insert(votes)
        .values({
          voteId,
          chamber: "house",
          congress: CONGRESS,
          session,
          rollNumber: roll,
          voteDate,
          question,
          description: desc || legisNum || null,
          result,
          billId,
          yeas,
          nays,
          present,
          notVoting,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: votes.voteId,
          set: {
            result: sql`excluded.result`,
            yeas: sql`excluded.yeas`,
            nays: sql`excluded.nays`,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      // Parse individual vote positions
      const voteMatches = xml.matchAll(
        /<recorded-vote>[\s\S]*?name-id="([^"]*)"[\s\S]*?<vote>([^<]*)<\/vote>[\s\S]*?<\/recorded-vote>/g
      );

      for (const m of voteMatches) {
        const bioguideId = m[1];
        const pos = m[2].trim().toLowerCase();

        if (!memberIds.has(bioguideId)) continue;

        const position =
          pos === "yea" || pos === "aye"
            ? "yea"
            : pos === "nay" || pos === "no"
              ? "nay"
              : pos === "present"
                ? "present"
                : "not_voting";

        await db
          .insert(votePositions)
          .values({ voteId, bioguideId, position })
          .onConflictDoNothing();
      }

      votesIngested++;
      if (votesIngested % 20 === 0) {
        console.log(`  ${votesIngested} House votes processed (roll ${roll})...`);
      }

      await new Promise((r) => setTimeout(r, DELAY_MS));
    } catch {
      // Non-fatal — skip this vote
    }
  }

  return votesIngested;
}

// ─── Senate votes ────────────────────────────────────────────────────────────

async function ingestSenateVotesForSession(
  db: ReturnType<typeof drizzle>,
  memberLookup: Map<string, string>, // last_name+state → bioguide_id
  year: number,
  session: number
) {
  console.log(`Ingesting Senate votes for ${year} (session ${session})...`);

  // Resume from one past the highest existing vote number for this year so
  // we don't re-hit several hundred 200s only to upsert no-ops. The Senate
  // URL pattern is /vote119{session}/vote_119_{session}_{NNNNN}.xml, and
  // numbering restarts each session.
  const existing = await db.execute(sql`
    SELECT COALESCE(MAX(roll_number), 0) AS max_roll
    FROM votes
    WHERE chamber='senate' AND congress=${CONGRESS} AND session=${session}
  `);
  const startVote = Number((existing.rows[0] as { max_roll: number })?.max_roll ?? 0) + 1;

  let votesIngested = 0;
  let consecutive404 = 0;

  // Hard cap of 800 to avoid runaway loops if the upstream serves a wall of 5xx.
  for (let voteNum = startVote; voteNum <= 800; voteNum++) {
    const paddedNum = String(voteNum).padStart(5, "0");
    const url = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote119${session}/vote_119_${session}_${paddedNum}.xml`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          // Senate occasionally has gaps in numbering, so don't break on
          // the first 404 — only after several in a row.
          if (++consecutive404 >= 3) break;
          continue;
        }
        continue;
      }
      const xml = await res.text();

      // senate.gov serves a 200 OK HTML "page not found" landing for vote
      // numbers that don't exist yet, instead of a real 404. Treat the
      // missing roll-call envelope as a 404 for the consecutive-404
      // breakout, otherwise we ingest ghost rows up to the hard cap.
      if (!xml.includes("<roll_call_vote>")) {
        if (++consecutive404 >= 3) break;
        continue;
      }
      consecutive404 = 0;

      const voteId = `senate-${CONGRESS}-${year}-${voteNum}`;
      const question = extractTag(xml, "question");
      const voteTitle = extractTag(xml, "vote_title");
      const result = extractTag(xml, "vote_result");
      const dateStr = extractTag(xml, "vote_date");
      // Skip if the upstream is real XML but doesn't contain a date — that
      // indicates a malformed or partial record and would otherwise insert
      // a row with the YYYY-01-01 placeholder.
      if (!dateStr) {
        continue;
      }

      // Parse date: "January 9, 2025,  02:54 PM" → "2025-01-09"
      const dateMatch = dateStr.match(
        /(\w+)\s+(\d+),\s+(\d+)/
      );
      let voteDate = `${year}-01-01`;
      if (dateMatch) {
        const months: Record<string, string> = {
          January: "01", February: "02", March: "03", April: "04",
          May: "05", June: "06", July: "07", August: "08",
          September: "09", October: "10", November: "11", December: "12",
        };
        const m = months[dateMatch[1]] || "01";
        const d = dateMatch[2].padStart(2, "0");
        voteDate = `${dateMatch[3]}-${m}-${d}`;
      }

      const yeas = parseInt(extractTag(xml, "yeas") || "0");
      const nays = parseInt(extractTag(xml, "nays") || "0");

      // Try to link to bill
      const docType = extractTag(xml, "document_type").trim();
      const docNum = extractTag(xml, "document_number").trim();
      let billId: string | null = null;
      if (docType && docNum) {
        const t = docType.toLowerCase().replace(/\./g, "").replace(/\s/g, "");
        billId = `${t}-${docNum}-${CONGRESS}`;
      }

      await db
        .insert(votes)
        .values({
          voteId,
          chamber: "senate",
          congress: CONGRESS,
          session,
          rollNumber: voteNum,
          voteDate,
          question,
          description: voteTitle || null,
          result,
          billId,
          yeas,
          nays,
          present: 0,
          notVoting: 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: votes.voteId,
          set: {
            result: sql`excluded.result`,
            yeas: sql`excluded.yeas`,
            nays: sql`excluded.nays`,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      // Parse member positions
      const memberMatches = xml.matchAll(
        /<member>[\s\S]*?<last_name>([^<]*)<\/last_name>[\s\S]*?<party>([^<]*)<\/party>[\s\S]*?<state>([^<]*)<\/state>[\s\S]*?<vote_cast>([^<]*)<\/vote_cast>[\s\S]*?<\/member>/g
      );

      for (const m of memberMatches) {
        const lastName = m[1].trim();
        const state = m[3].trim();
        const voteCast = m[4].trim().toLowerCase();

        // Look up bioguide ID by last name + state
        const key = `${lastName.toLowerCase()}-${state}`;
        const bioguideId = memberLookup.get(key);
        if (!bioguideId) continue;

        const position =
          voteCast === "yea"
            ? "yea"
            : voteCast === "nay"
              ? "nay"
              : voteCast === "present"
                ? "present"
                : "not_voting";

        await db
          .insert(votePositions)
          .values({ voteId, bioguideId, position })
          .onConflictDoNothing();
      }

      votesIngested++;
      if (votesIngested % 20 === 0) {
        console.log(`  ${votesIngested} Senate votes processed...`);
      }

      await new Promise((r) => setTimeout(r, DELAY_MS));
    } catch {
      // Non-fatal
    }
  }

  return votesIngested;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");

  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  const [syncEntry] = await db
    .insert(syncLog)
    .values({ source: "house_senate_xml", entityType: "votes", status: "running" })
    .returning();

  try {
    // Build lookup tables
    const allMembers = await db
      .select({
        bioguideId: members.bioguideId,
        lastName: members.lastName,
        stateCode: members.stateCode,
        chamber: members.chamber,
      })
      .from(members)
      .where(eq(members.inOffice, true));

    const memberIds = new Set(allMembers.map((m) => m.bioguideId));

    // Senate lookup: lastName-state → bioguideId
    const senateLookup = new Map<string, string>();
    for (const m of allMembers) {
      if (m.chamber === "senate") {
        senateLookup.set(
          `${m.lastName.toLowerCase()}-${m.stateCode}`,
          m.bioguideId
        );
      }
    }

    let houseCount = 0;
    let senateCount = 0;
    for (const { year, session } of SESSIONS) {
      houseCount += await ingestHouseVotesForYear(db, memberIds, year);
      senateCount += await ingestSenateVotesForSession(db, senateLookup, year, session);
    }

    await db
      .update(syncLog)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsCount: houseCount + senateCount,
      })
      .where(sql`id = ${syncEntry.id}`);

    console.log(
      `Done. ${houseCount} House votes, ${senateCount} Senate votes.`
    );
  } catch (err) {
    await db
      .update(syncLog)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(sql`id = ${syncEntry.id}`);
    throw err;
  }
}

main().catch((err) => {
  console.error("Failed to ingest votes:", err);
  process.exit(1);
});
