import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";
import { readdirSync } from "fs";

async function main() {
  const dbRows = await db.execute(sql`SELECT doc_id FROM disclosure_filings`);
  const inDb = new Set(dbRows.rows.map((r: any) => r.doc_id));

  const dir = "/Users/home/Desktop/dev/active/delegation-decoded/data/house-ptrs/pdfs/2026";
  const files = readdirSync(dir).filter((f) => f.endsWith(".pdf"));
  const onDisk = files.map((f) => f.replace(".pdf", ""));

  const missing = onDisk.filter((id) => !inDb.has(id));
  console.log(`PDFs on disk: ${onDisk.length}`);
  console.log(`Filings in DB: ${inDb.size}`);
  console.log(`Missing from DB (${missing.length}):`);
  for (const m of missing) console.log("  " + m);

  process.exit(0);
}
main();
