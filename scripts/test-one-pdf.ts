import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { parsePtr } from "./lib/parse-ptr";

async function main() {
  const docId = process.argv[2] || "8221326";
  const pdfPath = `/Users/home/Desktop/dev/active/delegation-decoded/data/house-ptrs/pdfs/2026/${docId}.pdf`;
  console.log(`Testing single PDF: ${docId}`);
  const t0 = Date.now();
  try {
    const result = await parsePtr(pdfPath);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`OK in ${dt}s — ${result.transactions.length} tx, $${result.tokenUsage.estimatedCostUsd}`);
    console.log("First tx:", JSON.stringify(result.transactions[0], null, 2));
  } catch (err: any) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`FAIL in ${dt}s — ${err?.constructor?.name}: ${err?.message}`);
    if (err?.cause) console.error("Cause:", err.cause);
    if (err?.code) console.error("Code:", err.code);
    if (err?.errno) console.error("Errno:", err.errno);
  }
  process.exit(0);
}
main();
