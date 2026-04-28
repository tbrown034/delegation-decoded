// CSV utilities for the public data exports under /api/data.

const CRLF = "\r\n";

function escape(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  const s = typeof cell === "string" ? cell : String(cell);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(escape).join(",") + CRLF;
}

export function csvHeaders(filename: string) {
  return new Headers({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "public, max-age=300, s-maxage=300",
  });
}
