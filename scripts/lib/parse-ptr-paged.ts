/**
 * Page-split PTR parser. Splits the PDF into single-page PDFs with `pdfseparate`,
 * parses each page through parsePtr (which is unchanged), then merges the transaction
 * arrays. Used as a fallback for PDFs that fail full-document parsing with
 * "Connection error" — small payloads have a much higher success rate.
 */
import { execFileSync } from "child_process";
import { mkdtemp, rm, readdir, stat } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { ParsedTransaction, ParseResult } from "./parse-ptr";
import { parsePtr } from "./parse-ptr";

export async function parsePtrPaged(
  pdfPath: string,
  opts: { concurrency?: number } = {}
): Promise<ParseResult> {
  const concurrency = opts.concurrency ?? 4;
  const tmp = await mkdtemp(path.join(tmpdir(), "ptr-pages-"));
  try {
    // Get page count via pdfinfo for clean sequencing.
    const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf-8" });
    const pageMatch = info.match(/Pages:\s+(\d+)/);
    if (!pageMatch) throw new Error("could not read page count");
    const pages = parseInt(pageMatch[1], 10);

    // Split into 1-page PDFs: /tmp/.../page-001.pdf etc.
    execFileSync("pdfseparate", [pdfPath, path.join(tmp, "page-%03d.pdf")]);

    const pageFiles: string[] = [];
    for (let i = 1; i <= pages; i++) {
      pageFiles.push(path.join(tmp, `page-${String(i).padStart(3, "0")}.pdf`));
    }

    // Parse pages with limited concurrency.
    const allTxs: ParsedTransaction[][] = new Array(pages).fill(null);
    let totalIn = 0, totalOut = 0, totalCost = 0;
    let model = "claude-sonnet-4-6";

    let cursor = 0;
    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= pageFiles.length) return;
        const pageFile = pageFiles[idx];
        try {
          const result = await parsePtr(pageFile);
          allTxs[idx] = result.transactions;
          totalIn += result.tokenUsage.inputTokens;
          totalOut += result.tokenUsage.outputTokens;
          totalCost += result.tokenUsage.estimatedCostUsd;
          model = result.model;
        } catch (err: any) {
          console.error(
            `  page ${idx + 1}/${pages} FAIL: ${err?.message ?? err}`
          );
          allTxs[idx] = [];
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));

    // Merge and re-index.
    const flat = allTxs.flat().filter((tx) => tx !== null);
    flat.forEach((tx, i) => {
      tx.rowIndex = i;
    });

    return {
      transactions: flat,
      tokenUsage: {
        inputTokens: totalIn,
        outputTokens: totalOut,
        estimatedCostUsd: Math.round(totalCost * 10000) / 10000,
      },
      model,
      pdfPath,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: npx tsx scripts/lib/parse-ptr-paged.ts <pdf>");
    process.exit(1);
  }
  parsePtrPaged(pdfPath).then(
    (r) => {
      console.log(JSON.stringify(r, null, 2));
      console.error(
        `\n${r.transactions.length} tx | ${r.tokenUsage.inputTokens} in / ${r.tokenUsage.outputTokens} out | $${r.tokenUsage.estimatedCostUsd}`
      );
      process.exit(0);
    },
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
}
