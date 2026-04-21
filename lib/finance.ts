/**
 * Compute effective total raised from available finance components.
 *
 * The FEC API sometimes returns total_receipts as 0 while component fields
 * (small_individual, total_pac, total_individual) have real data.
 * This function returns the best available total.
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
