export function TradesWipNotice() {
  return (
    <div
      role="note"
      className="mb-6 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span className="font-medium">Work in progress.</span> This STOCK Act
      index is an active project — coverage can lag the official filings and the
      PDF parsing is automated. Verify any figure against the linked source
      filing before citing it.
    </div>
  );
}
