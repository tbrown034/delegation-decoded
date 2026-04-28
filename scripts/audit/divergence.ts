// Compares our most-recent transaction date for a curated set of high-volume
// traders against the public CapitolTrades politician profile for the same
// member. If CapitolTrades shows trades newer than ours, we've fallen behind
// the source data and should investigate.
//
// Designed to run nightly in GitHub Actions. Logs a row to sync_log every
// time and emits a non-zero exit code if drift exceeds the threshold so the
// workflow opens a tracking issue.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../../lib/db";
import { sql } from "drizzle-orm";

// Members are referenced by bioguide_id since CapitolTrades uses the same key.
// Curate to high-volume traders so the comparison is signal-rich.
const SAMPLE = ["K000389", "M001157", "C001123", "B001236", "M001243"] as const;

const DRIFT_DAYS_WARN = 4;
const DRIFT_DAYS_CRIT = 10;

const UA =
  "Mozilla/5.0 (compatible; delegation-decoded/divergence-audit; +https://github.com/tbrown034/delegation-decoded)";

type Drift = {
  bioguideId: string;
  ours: string | null;
  theirs: string | null;
  driftDays: number | null;
  level: "ok" | "warn" | "crit" | "skip";
  note: string;
};

async function fetchCapitolTradesLatest(bioguideId: string): Promise<string | null> {
  const url = `https://www.capitoltrades.com/politicians/${bioguideId}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const html = await res.text();

  // The page renders many YYYY-MM-DD dates server-side. The maximum non-future
  // date is the most-recent transaction date for that politician. Clamp to
  // today+2d to defend against unrelated future dates appearing in the markup
  // (e.g. an option's expiration date in the asset description).
  const dates = html.match(/\b20[2-3][0-9]-[0-1][0-9]-[0-3][0-9]\b/g);
  if (!dates) return null;
  const cutoff = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const valid = dates.filter((d) => d <= cutoff);
  return valid.sort().at(-1) ?? null;
}

async function ourLatest(bioguideId: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT to_char(MAX(tx_date), 'YYYY-MM-DD') AS d
    FROM stock_transactions
    WHERE bioguide_id = ${bioguideId}
  `);
  const row = r.rows[0] as { d: string | null };
  return row?.d ?? null;
}

function diffDays(a: string, b: string): number {
  const ta = new Date(a + "T00:00:00Z").getTime();
  const tb = new Date(b + "T00:00:00Z").getTime();
  return Math.round((tb - ta) / 86_400_000);
}

async function main() {
  const started = new Date();
  const results: Drift[] = [];

  for (const bioguideId of SAMPLE) {
    let theirs: string | null = null;
    try {
      theirs = await fetchCapitolTradesLatest(bioguideId);
    } catch (err) {
      results.push({
        bioguideId,
        ours: null,
        theirs: null,
        driftDays: null,
        level: "skip",
        note: `fetch failed: ${(err as Error).message.slice(0, 80)}`,
      });
      continue;
    }
    const ours = await ourLatest(bioguideId);

    if (!theirs || !ours) {
      results.push({
        bioguideId,
        ours,
        theirs,
        driftDays: null,
        level: "skip",
        note: !theirs ? "no dates parsed from CapitolTrades" : "no trades for member in our DB",
      });
      continue;
    }

    const drift = diffDays(ours, theirs);
    let level: Drift["level"] = "ok";
    if (drift >= DRIFT_DAYS_CRIT) level = "crit";
    else if (drift >= DRIFT_DAYS_WARN) level = "warn";

    results.push({
      bioguideId,
      ours,
      theirs,
      driftDays: drift,
      level,
      note: drift > 0 ? "they have newer trades than we do" : "we are caught up",
    });
  }

  console.log("\n=== Divergence vs CapitolTrades ===");
  console.table(results);

  const worst = results.reduce<Drift["level"]>((acc, r) => {
    if (r.level === "crit" || acc === "crit") return "crit";
    if (r.level === "warn" || acc === "warn") return "warn";
    return acc;
  }, "ok");

  const summary = results
    .map((r) => `${r.bioguideId}: ours=${r.ours} theirs=${r.theirs} drift=${r.driftDays}`)
    .join(" | ");

  await db.execute(sql`
    INSERT INTO sync_log (source, entity_type, started_at, completed_at, status, records_count, error_message)
    VALUES (
      'capitoltrades_divergence',
      'audit',
      ${started.toISOString()},
      now(),
      ${worst === "crit" ? "failed" : "success"},
      ${results.length},
      ${worst === "ok" ? null : summary}
    )
  `);

  if (worst === "crit") {
    console.error("\nCritical drift detected.");
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(2);
  });
