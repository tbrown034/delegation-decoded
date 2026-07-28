/**
 * Pure mapping rules for FEC candidate data.
 *
 * These three functions each cover a bug that reached production silently,
 * because every one of them fails by producing a plausible-looking value
 * rather than by throwing: a stale candidate ID, a zero, or a placeholder
 * employer outranking real donors. They live here so they can be asserted
 * without booting an ingest script.
 */

import type { FECCandidateFinance } from "./fec-api";

/**
 * Pick the candidate ID for the seat a member holds now.
 *
 * `id.fec` is ordered oldest-first, so `[0]` is a member's earliest campaign.
 * For anyone who switched chambers that committee stopped filing years ago and
 * every FEC lookup against it returns empty. The office letter encodes the
 * chamber, so prefer the newest ID that matches.
 */
export function currentFecId(
  fecIds: string[] | undefined | null,
  chamber: "senate" | "house"
): string | null {
  if (!fecIds?.length) return null;
  const wanted = chamber === "senate" ? "S" : "H";
  const forChamber = fecIds.filter((id) => id.startsWith(wanted));
  // Falling back to the newest overall keeps a usable ID for the rare filer
  // whose office letter never matches (appointed senators, ID reissues).
  return forChamber.at(-1) ?? fecIds.at(-1) ?? null;
}

/**
 * Employer strings that are FEC reporting categories rather than organizations.
 * Keeping them makes "Retired" — or the literal string "NULL", which is the
 * aggregation bucket for donors with no employer on file — the top contributor
 * for most members.
 */
const NON_EMPLOYERS = new Set([
  "RETIRED",
  "NOT EMPLOYED",
  "UNEMPLOYED",
  "SELF-EMPLOYED",
  "SELF EMPLOYED",
  "SELF",
  "NONE",
  "N/A",
  "NA",
  "INFORMATION REQUESTED",
  "INFORMATION REQUESTED PER BEST EFFORTS",
  "REQUESTED",
  "HOMEMAKER",
  "NULL",
]);

/** True when an employer value names an actual organization we can publish. */
export function isReportableEmployer(
  employer: string | null | undefined
): boolean {
  if (!employer) return false;
  const trimmed = employer.trim();
  // No letters at all means a bare filer ID or punctuation placeholder.
  if (!/[A-Za-z]/.test(trimmed)) return false;
  return !NON_EMPLOYERS.has(trimmed.toUpperCase());
}

export type MappedCandidateFinance = {
  totalReceipts: number;
  totalDisbursements: number;
  cashOnHand: number;
  totalIndividual: number;
  totalPac: number;
  smallIndividual: number;
};

/**
 * Map one /candidate/{id}/totals row onto our column values.
 *
 * Every key read here must exist on the endpoint verbatim. Four of them once
 * carried a `total_` prefix the FEC does not use; each read came back
 * undefined, `|| 0` turned it into a zero, and all 2,811 rows in
 * campaign_finance were zero for months without a single error being logged.
 */
export function mapCandidateFinance(
  row: Partial<FECCandidateFinance>
): MappedCandidateFinance {
  return {
    totalReceipts: Math.round(row.receipts || 0),
    totalDisbursements: Math.round(row.disbursements || 0),
    cashOnHand: Math.round(row.last_cash_on_hand_end_period || 0),
    totalIndividual: Math.round(row.individual_contributions || 0),
    totalPac: Math.round(row.other_political_committee_contributions || 0),
    smallIndividual: Math.round(row.individual_unitemized_contributions || 0),
  };
}
