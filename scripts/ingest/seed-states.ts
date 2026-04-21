import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { states } from "../../lib/schema";
import { STATES } from "../../lib/states";
import { sql } from "drizzle-orm";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  console.log(`Seeding ${STATES.length} states...`);

  for (const state of STATES) {
    await db
      .insert(states)
      .values({
        code: state.code,
        name: state.name,
        fipsCode: state.fipsCode,
        numDistricts: state.numDistricts,
      })
      .onConflictDoUpdate({
        target: states.code,
        set: {
          name: sql`excluded.name`,
          fipsCode: sql`excluded.fips_code`,
          numDistricts: sql`excluded.num_districts`,
        },
      });
  }

  console.log("States seeded successfully.");
}

main().catch((err) => {
  console.error("Failed to seed states:", err);
  process.exit(1);
});
