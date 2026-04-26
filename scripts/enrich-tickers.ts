/**
 * Ticker enrichment pass — for rows whose source PDF used a column-layout
 * ticker (not a parenthetical) the vision parser reliably captures the asset
 * description but leaves ticker null. Resolve those tickers by sending the
 * unique descriptions to Claude in batches and bulk-update.
 *
 * Conservative: only update rows whose resolved ticker is high-confidence
 * (Claude returns null for any uncertain or non-public name). Bumps confidence
 * from <80 to 85 (mid-band) on resolved rows so they leave the review queue.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { stockTransactions } from "../lib/schema";
import { sql, eq, and, isNull } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  timeout: 120_000,
  maxRetries: 3,
});

const RESOLVE_PROMPT = `You are a financial-data resolver. For each asset description below, return the U.S. exchange ticker symbol IF AND ONLY IF you are highly confident.

Rules:
- Return null if the company is private, unknown, ambiguous, a generic fund without an obvious ticker, or you have any doubt.
- Common stock descriptions: "MICROSOFT CORPORATION CMN" → "MSFT", "INTUIT INC" → "INTU".
- Bonds, CDs, money-market funds, mortgages, real-estate, partnerships → null (no equity ticker).
- ADRs: "SAP ADR" → "SAP", "Sony Group Corp ADR" → "SONY".
- Class B / Class A: prefer the most common ticker (e.g. "BERKSHIRE HATHAWAY INC. CLASS B" → "BRK.B").
- Output STRICT JSON: an array of {"description": "...", "ticker": "AAPL" | null}. No commentary, no markdown fences.

Descriptions:
`;

interface Resolution {
  description: string;
  ticker: string | null;
}

async function resolveBatch(descriptions: string[]): Promise<Resolution[]> {
  const numbered = descriptions
    .map((d, i) => `${i + 1}. ${d}`)
    .join("\n");
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    messages: [{ role: "user", content: RESOLVE_PROMPT + numbered }],
  });
  const text = resp.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
  if (!text) throw new Error("no text in response");
  let raw = text.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  const parsed = JSON.parse(raw) as Resolution[];
  if (!Array.isArray(parsed)) throw new Error("not array");
  return parsed;
}

async function main() {
  const rows = await db.execute(sql`
    SELECT DISTINCT asset_description
    FROM stock_transactions
    WHERE ticker IS NULL
    ORDER BY asset_description
  `);
  const descriptions = rows.rows.map((r: any) => r.asset_description as string);
  console.log(`${descriptions.length} unique null-ticker descriptions`);

  const BATCH = 50;
  const resolutions = new Map<string, string>();
  let unknown = 0;
  for (let i = 0; i < descriptions.length; i += BATCH) {
    const slice = descriptions.slice(i, i + BATCH);
    process.stdout.write(`  batch ${i}-${i + slice.length}…`);
    try {
      const result = await resolveBatch(slice);
      let mapped = 0;
      for (const r of result) {
        if (r.ticker && /^[A-Z][A-Z0-9.\-]{0,7}$/.test(r.ticker)) {
          resolutions.set(r.description, r.ticker);
          mapped++;
        } else {
          unknown++;
        }
      }
      console.log(` ${mapped}/${slice.length} resolved`);
    } catch (err: any) {
      console.log(` FAIL: ${err?.message?.slice(0, 100)}`);
    }
  }
  console.log(`\nResolved: ${resolutions.size}, unknown: ${unknown}`);

  // Apply updates. Bump confidence on resolved rows from <80 → 85.
  let updatedRows = 0;
  let updatedFlags = 0;
  for (const [desc, ticker] of resolutions) {
    const r = await db.execute(sql`
      UPDATE stock_transactions
      SET ticker = ${ticker},
          confidence = GREATEST(confidence, 85),
          needs_review = CASE WHEN confidence < 80 THEN false ELSE needs_review END
      WHERE asset_description = ${desc} AND ticker IS NULL
    `);
    updatedRows += (r as any).rowCount ?? 0;
  }
  console.log(`Updated ${updatedRows} rows`);

  // Recompute filing-level parse_confidence as avg of tx confidence.
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
  console.log("Recomputed filing-level confidence.");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
