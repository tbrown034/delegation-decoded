/**
 * Fix bogus tickers extracted from parenthetical disambiguators.
 * "WALT DISNEY COMPANY (THE) CMN" was being parsed with ticker "THE",
 * "TJX COMPANIES INC (NEW) CMN" with ticker "NEW", etc.
 *
 * Strategy: clear bogus tickers, then re-resolve via name lookup.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

const BOGUS_TICKERS = new Set([
  "THE", "NEW", "FRANCE", "USA", "INC", "CORP", "LTD", "LLC",
  "OLD", "AND", "OF", "FUND", "TRUST", "PFD", "ADR", "ETF",
  "REIT", "GROUP", "CO", "MGMT", "CLASS", "SERIES",
]);

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  timeout: 120_000,
  maxRetries: 3,
});

async function main() {
  const placeholders = Array.from(BOGUS_TICKERS).map((t) => `'${t}'`).join(",");
  const before = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS n FROM stock_transactions WHERE ticker IN (${placeholders})
  `));
  console.log(`Bogus tickers in DB: ${(before.rows[0] as any).n}`);

  // Clear bogus tickers.
  const cleared = await db.execute(sql.raw(`
    UPDATE stock_transactions SET ticker = NULL
    WHERE ticker IN (${placeholders})
  `));
  console.log(`Cleared ${(cleared as any).rowCount} bogus tickers`);

  // Re-resolve.
  const rows = await db.execute(sql`
    SELECT DISTINCT asset_description
    FROM stock_transactions
    WHERE ticker IS NULL AND asset_type = 'Stock'
  `);
  const descs = rows.rows.map((r: any) => r.asset_description as string);
  console.log(`Stock rows needing resolution: ${descs.length} unique descriptions`);

  if (descs.length === 0) {
    process.exit(0);
  }

  const prompt = `Return the primary US exchange ticker for each common stock or ADR. Examples:
- "WALT DISNEY COMPANY (THE) CMN" → "DIS"
- "COCA COLA COMPANY (THE) CMN" → "KO"
- "TJX COMPANIES INC (NEW) CMN" → "TJX"
- "STATE STREET CORPORATION (NEW) CMN" → "STT"
- "TRADE DESK INC (THE) CMN" → "TTD"
- "AMETEK INC (NEW) CMN" → "AME"
- "SCHNEIDER ELECTRIC SE UNSPONSORED ADR (FRANCE)" → "SBGSF"
Return null only if private/uncertain. STRICT JSON array of {"description","ticker"}.

${descs.map((d, i) => `${i + 1}. ${d}`).join("\n")}`;

  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = (resp.content.find((b) => b.type === "text") as any).text.trim();
  let raw = text;
  if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  const resolved = JSON.parse(raw) as { description: string; ticker: string | null }[];

  let totalUpdated = 0;
  for (const r of resolved) {
    if (r.ticker && /^[A-Z][A-Z0-9.\-]{0,7}$/.test(r.ticker) && !BOGUS_TICKERS.has(r.ticker)) {
      const u = await db.execute(sql`
        UPDATE stock_transactions
        SET ticker = ${r.ticker},
            confidence = GREATEST(confidence, 85),
            needs_review = CASE WHEN confidence < 80 THEN false ELSE needs_review END
        WHERE asset_description = ${r.description} AND ticker IS NULL
      `);
      const n = (u as any).rowCount ?? 0;
      totalUpdated += n;
      if (n > 0) console.log(`  ${r.description} → ${r.ticker} (${n})`);
    }
  }
  console.log(`\nResolved & updated ${totalUpdated} rows`);

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
      COUNT(*) FILTER (WHERE ticker IS NOT NULL)::int AS has_ticker,
      ROUND(AVG(confidence)::numeric, 1) AS avg
    FROM stock_transactions
  `);
  console.log("\nFINAL:", final.rows[0]);
  const pct = (Number((final.rows[0] as any).confident) / Number((final.rows[0] as any).total) * 100).toFixed(2);
  console.log(`${pct}% rows ≥80 confidence`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
