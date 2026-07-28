/**
 * Compute effective total raised from available finance components.
 *
 * The component fallback below was originally added because receipts read as 0
 * for everyone. That was our bug, not the FEC's — the ingest was reading a
 * `total_receipts` field the API does not return. Receipts are populated now,
 * so the fallback only covers filers who genuinely report none yet.
 */
export function effectiveTotal(finance: {
  totalReceipts: number | null;
  totalIndividual: number | null;
  totalPac: number | null;
  smallIndividual: number | null;
}): number {
  const receipts = finance.totalReceipts || 0;
  if (receipts > 0) return receipts;

  // Fallback: sum available components
  const individual = finance.totalIndividual || 0;
  const pac = finance.totalPac || 0;
  const small = finance.smallIndividual || 0;

  // Use whichever is larger: reported individual total, or small donors alone
  // (since totalIndividual should include smallIndividual, but may also be 0)
  const indTotal = Math.max(individual, small);
  return indTotal + pac;
}

export function fmt(amount: number | null): string {
  if (!amount) return "$0";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}
