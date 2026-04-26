/**
 * PTR Parser — extracts transaction data from STOCK Act Periodic Transaction Reports.
 *
 * Sends a PDF to the Claude API as a document block and returns structured
 * transactions. Works for House Clerk and Senate eFD PTRs (same statutory format).
 *
 * Run: npx tsx scripts/lib/parse-ptr.ts <path-to-pdf>
 */
import { readFile } from "fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export interface ParsedTransaction {
  rowIndex: number;
  ownerCode: "SP" | "DC" | "JT" | null;
  assetDescription: string;
  ticker: string | null;
  assetType: string | null;
  txType: "P" | "S" | "S (partial)" | "E";
  txDate: string | null;
  notifiedDate: string | null;
  amountRange: string;
  capGainsOver200: boolean;
  confidence: number;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  model: string;
  pdfPath: string;
}

type ModelChoice = "claude-sonnet-4-6" | "claude-haiku-4-5" | "claude-opus-4-7";

const MODEL_COSTS: Record<ModelChoice, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
};

const EXTRACTION_PROMPT = `You are parsing a U.S. Congressional Periodic Transaction Report (PTR) filed under the STOCK Act.

Extract every transaction in the PDF table. For each row, return a JSON object with these fields:

- rowIndex: zero-based position of this transaction in the table (0, 1, 2, ...)
- ownerCode: "SP" (spouse), "DC" (dependent child), "JT" (joint), or null if filer is the owner
- assetDescription: the full asset name as written
- ticker: the stock ticker, only if it appears in PARENTHESES inside the asset name (e.g. "Apple Inc - Common Stock (AAPL)" → "AAPL"). DO NOT extract codes in square brackets like [ST], [GS], [BD], [OP], [PS], [OL] — those are House asset-type codes (Stock, Government Security, Bond, Option, etc.), not tickers. If no parenthetical ticker, return null.
- assetType: one of "Stock", "Bond", "Option", "Fund", "Cryptocurrency", "Other", or null if unclear. If a square-bracket code is present, map it: [ST]=Stock, [GS]/[CS]=Bond, [BD]=Bond, [OP]=Option, [MF]/[ET]=Fund, [PS]=Stock, [OL]=Other
- txType: exactly "P" (Purchase), "S" (Sale), "S (partial)" (Partial Sale), or "E" (Exchange)
- txDate: transaction date in YYYY-MM-DD format, or null if missing
- notifiedDate: notification/disclosure date in YYYY-MM-DD format, or null
- amountRange: exact range string from this list:
  "$1,001 - $15,000"
  "$15,001 - $50,000"
  "$50,001 - $100,000"
  "$100,001 - $250,000"
  "$250,001 - $500,000"
  "$500,001 - $1,000,000"
  "$1,000,001 - $5,000,000"
  "$5,000,001 - $25,000,000"
  "$25,000,001 - $50,000,000"
  "Over $50,000,000"
- capGainsOver200: true if the "Cap. Gains > $200" column is checked, else false
- confidence: 0.0 to 1.0. Use below 0.8 if scan quality is poor, amount is ambiguous, or fields are partially obscured

Rules:
- Extract ALL rows, including those that span pages
- DO NOT extract example/template rows from the form. The blank House PTR form contains an instructional row labeled "Example Mega Corp Common Stock" with a date like 8/14/12 — this is part of the form template, NOT a real transaction. Skip it.
- If the filing says "Nothing to report for [month]" (with no other transactions listed), return an EMPTY array [].
- If amount is "Value Not Readily Ascertainable", use "$1,001 - $15,000" and confidence 0.5
- Tickers come in PARENTHESES inside the asset name. Square-bracket codes are asset-type codes — never treat them as tickers.
- Owner code may be a single column with codes (SP/DC/JT) or empty (self)
- txType must be EXACTLY one of: P, S, S (partial), E

Return ONLY a JSON array. No markdown fences, no commentary.`;

export async function parsePtr(
  pdfPath: string,
  modelOverride?: ModelChoice
): Promise<ParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY must be set in .env.local");
  }

  const client = new Anthropic({ apiKey, timeout: 600_000, maxRetries: 3 });
  const pdfBuffer = await readFile(pdfPath);
  const pdfBase64 = pdfBuffer.toString("base64");

  const model = modelOverride || "claude-sonnet-4-6";
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  const textBlock = response.content.find(
    (b: { type: string }) => b.type === "text"
  );
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude API");
  }

  let rawText = textBlock.text.trim();
  if (rawText.startsWith("```")) {
    rawText = rawText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: ParsedTransaction[];
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(
      `JSON parse failed: ${err instanceof Error ? err.message : String(err)}\nFirst 500 chars: ${rawText.slice(0, 500)}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Response is not a JSON array");
  }

  // Drop "Nothing to report" placeholder rows that some PTR amendments emit.
  // Real transactions have a valid txType; placeholders come back with null/empty.
  const VALID_TX = new Set(["P", "S", "S (partial)", "E"]);
  parsed = parsed.filter((tx) => VALID_TX.has(tx.txType));

  // Programmatic ticker fallback — pull from PARENS only, then nullify if the
  // candidate also appears as a square-bracket asset-type code in the same
  // description without the parenthetical form. Boeing (BA) [ST] keeps "BA";
  // "usdc [CT]" extracted as "CT" gets nullified. Common false-positives like
  // "WALT DISNEY COMPANY (THE) CMN" → "THE" and "(NEW)", "(FRANCE)", "(DELAWARE)"
  // disambiguators are blacklisted so we keep ticker null and let the post-ingest
  // resolver fill it in by name lookup instead.
  const BOGUS_TICKERS = new Set([
    "THE", "NEW", "OLD", "FRANCE", "USA", "USD", "INC", "CORP", "CO", "LTD",
    "LLC", "AND", "OF", "FUND", "TRUST", "PFD", "ADR", "ETF", "REIT", "GROUP",
    "MGMT", "CLASS", "SERIES", "DELAWARE", "NEVADA", "TEXAS",
  ]);
  for (const tx of parsed) {
    if (!tx.ticker) {
      const match = tx.assetDescription.match(/\(([A-Z]{1,6})\)/);
      if (match && !BOGUS_TICKERS.has(match[1])) tx.ticker = match[1];
    }
    if (tx.ticker) {
      if (BOGUS_TICKERS.has(tx.ticker)) {
        tx.ticker = null;
      } else {
        const inBrackets = new RegExp(`\\[${tx.ticker}\\]`).test(tx.assetDescription);
        const inParens = new RegExp(`\\(${tx.ticker}\\)`).test(tx.assetDescription);
        if (inBrackets && !inParens) tx.ticker = null;
      }
    }
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const pricing = MODEL_COSTS[model] || MODEL_COSTS["claude-sonnet-4-6"];
  const costUsd =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;

  return {
    transactions: parsed,
    tokenUsage: {
      inputTokens,
      outputTokens,
      estimatedCostUsd: Math.round(costUsd * 10000) / 10000,
    },
    model,
    pdfPath,
  };
}

// ── VALIDATION ──

const VALID_TYPES = ["P", "S", "S (partial)", "E"];

const VALID_AMOUNTS = [
  "$1,001 - $15,000",
  "$15,001 - $50,000",
  "$50,001 - $100,000",
  "$100,001 - $250,000",
  "$250,001 - $500,000",
  "$500,001 - $1,000,000",
  "$1,000,001 - $5,000,000",
  "$5,000,001 - $25,000,000",
  "$25,000,001 - $50,000,000",
  "Over $50,000,000",
];

export function quickValidate(tx: ParsedTransaction, index: number): string[] {
  const errors: string[] = [];
  if (!VALID_TYPES.includes(tx.txType)) {
    errors.push(`Row ${index}: invalid txType "${tx.txType}"`);
  }
  if (!VALID_AMOUNTS.includes(tx.amountRange)) {
    errors.push(`Row ${index}: invalid amountRange "${tx.amountRange}"`);
  }
  if (tx.txDate && !/^\d{4}-\d{2}-\d{2}$/.test(tx.txDate)) {
    errors.push(`Row ${index}: malformed txDate "${tx.txDate}"`);
  }
  if (!tx.assetDescription || tx.assetDescription.trim().length < 2) {
    errors.push(`Row ${index}: missing assetDescription`);
  }
  return errors;
}

// Maps the OGE/STOCK Act range string to inclusive [min, max] in dollars.
// Used at insert time to populate amount_min / amount_max for sortable aggregations.
export function rangeToBounds(range: string): {
  min: number | null;
  max: number | null;
} {
  const map: Record<string, [number, number | null]> = {
    "$1,001 - $15,000": [1001, 15000],
    "$15,001 - $50,000": [15001, 50000],
    "$50,001 - $100,000": [50001, 100000],
    "$100,001 - $250,000": [100001, 250000],
    "$250,001 - $500,000": [250001, 500000],
    "$500,001 - $1,000,000": [500001, 1000000],
    "$1,000,001 - $5,000,000": [1000001, 5000000],
    "$5,000,001 - $25,000,000": [5000001, 25000000],
    "$25,000,001 - $50,000,000": [25000001, 50000000],
    "Over $50,000,000": [50000001, null],
  };
  const bounds = map[range];
  if (!bounds) return { min: null, max: null };
  return { min: bounds[0], max: bounds[1] };
}

// ── CLI ──

if (require.main === module) {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: npx tsx scripts/lib/parse-ptr.ts <path-to-pdf>");
    process.exit(1);
  }
  parsePtr(pdfPath).then(
    (result) => {
      console.log(JSON.stringify(result, null, 2));
      const errors = result.transactions.flatMap((tx, i) =>
        quickValidate(tx, i)
      );
      if (errors.length) {
        console.error(`\nValidation errors (${errors.length}):`);
        errors.forEach((e) => console.error("  " + e));
      }
      console.error(
        `\n${result.transactions.length} transactions parsed | ${result.tokenUsage.inputTokens} in / ${result.tokenUsage.outputTokens} out | $${result.tokenUsage.estimatedCostUsd}`
      );
    },
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
