import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { members, terms, syncLog } from "../../lib/schema";
import { sql } from "drizzle-orm";
import {
  fetchCurrentLegislators,
  fetchSocialMedia,
  normalizeParty,
  chamberFromType,
  photoUrl,
  type USSocialMedia,
} from "../lib/unitedstates";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  // Log sync start
  const [syncEntry] = await db
    .insert(syncLog)
    .values({
      source: "unitedstates",
      entityType: "members",
      status: "running",
    })
    .returning();

  try {
    console.log("Fetching current legislators from @unitedstates...");
    const legislators = await fetchCurrentLegislators();

    console.log("Fetching social media data...");
    const socialData = await fetchSocialMedia();
    const socialByBioguide = new Map<string, USSocialMedia["social"]>();
    for (const entry of socialData) {
      socialByBioguide.set(entry.id.bioguide, entry.social);
    }

    console.log(`Processing ${legislators.length} legislators...`);

    let count = 0;
    for (const leg of legislators) {
      const currentTerm = leg.terms[leg.terms.length - 1];
      if (!currentTerm) continue;

      const social = socialByBioguide.get(leg.id.bioguide);
      const chamber = chamberFromType(currentTerm.type);
      const party = normalizeParty(currentTerm.party);
      const fullName =
        leg.name.official_full ||
        `${leg.name.first} ${leg.name.last}`;

      // Upsert member
      await db
        .insert(members)
        .values({
          bioguideId: leg.id.bioguide,
          firstName: leg.name.first,
          lastName: leg.name.last,
          fullName,
          party,
          stateCode: currentTerm.state,
          chamber,
          district: currentTerm.district ?? null,
          inOffice: true,
          birthDate: leg.bio.birthday || null,
          gender: leg.bio.gender || null,
          websiteUrl: currentTerm.url || null,
          contactForm: currentTerm.contact_form || null,
          phone: currentTerm.phone || null,
          photoUrl: photoUrl(leg.id.bioguide),
          twitter: social?.twitter || null,
          facebook: social?.facebook || null,
          youtube: social?.youtube || null,
          fecCandidateId: leg.id.fec?.[0] || null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: members.bioguideId,
          set: {
            firstName: sql`excluded.first_name`,
            lastName: sql`excluded.last_name`,
            fullName: sql`excluded.full_name`,
            party: sql`excluded.party`,
            stateCode: sql`excluded.state_code`,
            chamber: sql`excluded.chamber`,
            district: sql`excluded.district`,
            inOffice: sql`excluded.in_office`,
            birthDate: sql`excluded.birth_date`,
            gender: sql`excluded.gender`,
            websiteUrl: sql`excluded.website_url`,
            contactForm: sql`excluded.contact_form`,
            phone: sql`excluded.phone`,
            photoUrl: sql`excluded.photo_url`,
            twitter: sql`excluded.twitter`,
            facebook: sql`excluded.facebook`,
            youtube: sql`excluded.youtube`,
            fecCandidateId: sql`excluded.fec_candidate_id`,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      // Upsert all terms for this member
      for (const t of leg.terms) {
        const termChamber = chamberFromType(t.type);
        const termParty = normalizeParty(t.party);
        const isCurrent = t === currentTerm;

        await db
          .insert(terms)
          .values({
            bioguideId: leg.id.bioguide,
            chamber: termChamber,
            stateCode: t.state,
            district: t.district ?? null,
            party: termParty,
            startDate: t.start,
            endDate: t.end || null,
            isCurrent,
          })
          .onConflictDoNothing();
      }

      count++;
      if (count % 50 === 0) {
        console.log(`  Processed ${count}/${legislators.length}`);
      }
    }

    // Update sync log
    await db
      .update(syncLog)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsCount: count,
      })
      .where(sql`id = ${syncEntry.id}`);

    console.log(
      `Done. Ingested ${count} members with their term histories.`
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
  console.error("Failed to ingest members:", err);
  process.exit(1);
});
