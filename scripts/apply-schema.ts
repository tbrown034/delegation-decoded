/**
 * Applies scripts/schema.sql to the database.
 * All statements use IF NOT EXISTS, so this is idempotent.
 *
 * Run: npx tsx scripts/apply-schema.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFile } from "fs/promises";
import path from "path";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    console.error("DATABASE_URL not set in .env.local");
    process.exit(1);
  }

  const sql = neon(url);
  const ddl = await readFile(
    path.join(process.cwd(), "scripts", "schema.sql"),
    "utf-8"
  );

  // Split on semicolons that end a statement (newline after).
  // Strips block comments and whitespace-only chunks.
  const statements = ddl
    .split(/;\s*\n/)
    .map((s) => s.replace(/--[^\n]*\n/g, "\n").trim())
    .filter((s) => s.length > 0);

  console.log(`Applying ${statements.length} SQL statements...`);

  let applied = 0;
  for (const stmt of statements) {
    try {
      await sql.query(stmt);
      applied++;
      const label = stmt.match(/^\s*(CREATE\s+(?:TABLE|INDEX|TYPE)|ALTER|INSERT)[^\n(]*/i)?.[0]?.trim() || stmt.slice(0, 60);
      console.log(`  OK  ${label}`);
    } catch (err) {
      console.error(`  FAIL ${stmt.slice(0, 80)}...`);
      console.error(`       ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }

  console.log(`\nApplied ${applied} statements.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
