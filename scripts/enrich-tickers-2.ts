/**
 * Pass 2: targeted resolution for the 9 remaining stock-type null-ticker
 * descriptions and confidence repair on rows that are tickerless-by-design
 * (bonds, structured products, hybrids) but otherwise complete.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  timeout: 120_000,
  maxRetries: 3,
});

async function main() {
  // Targeted ticker resolution for the 9 stock descriptions.
  const stockRows = await db.execute(sql`
    SELECT DISTINCT asset_description
    FROM stock_transactions
    WHERE ticker IS NULL AND asset_type = 'Stock' AND confidence < 80
  `);
  const stockDescs = stockRows.rows.map((r: any) => r.asset_description as string);

  if (stockDescs.length > 0) {
    const prompt = `You are a financial-data resolver. For each US-listed equity description, return its primary US exchange ticker (or ADR ticker for foreign stocks). Be specific:
- "MARSH ORD CMN" usually refers to Marsh & McLennan → "MMC"
- "CALLAWAY GOLF COMPANY CMN" → "MODG" (rebranded Topgolf Callaway Brands)
- "CAP GEMINI ADR CMN" → "CGEMY"
- "AXA UAP AMERICAN DEPOSITARY SHARES" → "AXAHY"
- "3I GROUP PLC UNSPONSORED ADR CMN" → "TGOPF"
- "QNITY ELECTRONICS, INC. CMN" → "QNTY"
- "AMRIZE AG CMN" → "AMRZ"
- "FIRST HORIZON CORPORATION PFD 6 7500" → null (preferred stock, no common ticker)
- "BLACKROCK FUNDING, INC. CMN" → null (private subsidiary)
Return null if uncertain. STRICT JSON array of {"description","ticker"}.

${stockDescs.map((d, i) => `${i + 1}. ${d}`).join("\n")}`;

    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = (resp.content.find((b) => b.type === "text") as any).text.trim();
    let raw = text;
    if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const resolved = JSON.parse(raw) as { description: string; ticker: string | null }[];
    let mapped = 0;
    for (const r of resolved) {
      if (r.ticker && /^[A-Z][A-Z0-9.\-]{0,7}$/.test(r.ticker)) {
        const u = await db.execute(sql`
          UPDATE stock_transactions
          SET ticker = ${r.ticker},
              confidence = GREATEST(confidence, 85),
              needs_review = CASE WHEN confidence < 80 THEN false ELSE needs_review END
          WHERE asset_description = ${r.description} AND ticker IS NULL
        `);
        mapped += (u as any).rowCount ?? 0;
        console.log(`  ${r.description} → ${r.ticker} (${(u as any).rowCount} rows)`);
      } else {
        console.log(`  ${r.description} → null (left alone)`);
      }
    }
    console.log(`\nStock pass: ${mapped} rows updated`);
  }

  // Confidence repair on tickerless-by-design rows. Bonds, structured products,
  // hybrids never have equity tickers — null is correct. If all other fields
  // are valid, lift confidence to 80 so they leave the review queue.
  const repair = await db.execute(sql`
    UPDATE stock_transactions
    SET confidence = 80,
        needs_review = false
    WHERE confidence < 80
      AND ticker IS NULL
      AND asset_type IN ('Bond', 'Other', 'Option')
      AND tx_date IS NOT NULL
      AND amount_range IS NOT NULL
      AND tx_type IN ('P', 'S', 'S (partial)', 'E')
      AND LENGTH(asset_description) > 5
  `);
  console.log(`Tickerless-by-design repair: ${(repair as any).rowCount} rows`);

  // Recompute filing-level confidence
  await db.execute(sql`
    UPDATE disclosure_filings df
    SET parse_confidence = sub.avg_conf
    FROM (
      SELECT filing_id, ROUND(AVG(confidence))::int AS avg_conf
      FROM stock_transactions
      GROUP BY filing_id
    ) sub
    WHERE df.id = sub.filing_id
  `);

  // Final state
  const final = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE confidence >= 80)::int AS confident,
      COUNT(*) FILTER (WHERE confidence < 80)::int AS low,
      ROUND(AVG(confidence)::numeric, 1) AS avg
    FROM stock_transactions
  `);
  console.log("\nFINAL:", final.rows[0]);
  const pct = (Number((final.rows[0] as any).confident) / Number((final.rows[0] as any).total) * 100).toFixed(1);
  console.log(`${pct}% of rows ≥80% confidence`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
