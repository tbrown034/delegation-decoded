import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { votes, votePositions, members, syncLog } from "../../lib/schema";
import { sql, eq } from "drizzle-orm";

const CONGRESS = 119;
const YEAR = 2025;
const DELAY_MS = 300;

// ─── XML parsing helpers (no dependency needed for this simple structure) ─────

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.trim() || "";
}

function extractAttr(element: string, attr: string): string {
  const match = element.match(new RegExp(`${attr}="([^"]*)"`));
  return match?.[1] || "";
}

// ─── House votes ─────────────────────────────────────────────────────────────

async function ingestHouseVotes(
  db: ReturnType<typeof drizzle>,
  memberIds: Set<string>
) {
  console.log("Ingesting House votes for " + YEAR + "...");

  // Find the latest roll call number from the index page
  const indexRes = await fetch(
    `https://clerk.house.gov/evs/${YEAR}/index.asp`
  );
  const indexHtml = await indexRes.text();
  const rollMatch = indexHtml.match(/rollnumber=(\d+)/);
  const maxRoll = rollMatch ? parseInt(rollMatch[1]) : 0;

  if (maxRoll === 0) {
    console.log("  No House votes found for " + YEAR);
    return 0;
  }

  console.log(`  Found ${maxRoll} House roll calls`);

  let votesIngested = 0;

  // Ingest all votes for the year
  const startRoll = 1;

  for (let roll = maxRoll; roll >= startRoll; roll--) {
    const rollStr = String(roll).padStart(3, "0");
    const url = `https://clerk.house.gov/evs/${YEAR}/roll${rollStr}.xml`;

    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const xml = await res.text();

      const voteId = `house-${CONGRESS}-${YEAR}-${roll}`;
      const session = parseInt(extractTag(xml, "session") || "1");
      const question = extractTag(xml, "vote-question");
      const desc = extractTag(xml, "vote-desc");
      const result = extractTag(xml, "vote-result");
      const dateStr = extractTag(xml, "action-date");
      const legisNum = extractTag(xml, "legis-num");

      // Parse date: "3-Jan-2025" → "2025-01-03"
      const dateParts = dateStr.match(/(\d+)-(\w+)-(\d+)/);
      let voteDate = YEAR + "-01-01";
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
    } catch (err) {
      // Non-fatal — skip this vote
    }
  }

  return votesIngested;
}

// ─── Senate votes ────────────────────────────────────────────────────────────

async function ingestSenateVotes(
  db: ReturnType<typeof drizzle>,
  memberLookup: Map<string, string> // last_name+state → bioguide_id
) {
  console.log("Ingesting Senate votes for " + YEAR + "...");

  let votesIngested = 0;

  // Senate votes: try up to 500 (usually ~300/year)
  for (let voteNum = 1; voteNum <= 500; voteNum++) {
    const paddedNum = String(voteNum).padStart(5, "0");
    const url = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_${paddedNum}.xml`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) break; // No more votes
        continue;
      }
      const xml = await res.text();

      const voteId = `senate-${CONGRESS}-${YEAR}-${voteNum}`;
      const question = extractTag(xml, "question");
      const voteTitle = extractTag(xml, "vote_title");
      const result = extractTag(xml, "vote_result");
      const dateStr = extractTag(xml, "vote_date");

      // Parse date: "January 9, 2025,  02:54 PM" → "2025-01-09"
      const dateMatch = dateStr.match(
        /(\w+)\s+(\d+),\s+(\d+)/
      );
      let voteDate = `${YEAR}-01-01`;
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
          session: 1,
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

    const houseCount = await ingestHouseVotes(db, memberIds);
    const senateCount = await ingestSenateVotes(db, senateLookup);

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
