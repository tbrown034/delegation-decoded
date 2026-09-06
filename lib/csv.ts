// CSV utilities for the public data exports under /api/data.

const CRLF = "\r\n";

function escape(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  const raw = typeof cell === "string" ? cell : String(cell);
  // Public-source text is untrusted. Neutralize spreadsheet formulas without
  // changing numeric values that callers pass as numbers.
  const s = typeof cell === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
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
    // Exports change once a day at most; an hour at the CDN plus a day of
    // stale-while-revalidate keeps repeat downloads off the database.
    "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  });
}

// Demand-driven keyset export. Each pull() fetches one batch, so a slow reader
// pauses the database walk instead of letting queued output pile up, and a
// disconnected reader (cancel / aborted signal) stops the walk outright. A
// batch shorter than batchSize is the last one.
export function keysetCsvStream(options: {
  header: readonly string[];
  batchSize: number;
  nextBatch: () => Promise<readonly (readonly unknown[])[]>;
  signal?: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let headerSent = false;
  let done = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(encoder.encode(csvRow(options.header)));
        return;
      }
      if (done || options.signal?.aborted) {
        done = true;
        controller.close();
        return;
      }
      let batch: readonly (readonly unknown[])[];
      try {
        batch = await options.nextBatch();
      } catch (error) {
        done = true;
        controller.error(error);
        return;
      }
      for (const row of batch) {
        controller.enqueue(encoder.encode(csvRow(row)));
      }
      if (batch.length < options.batchSize) {
        done = true;
        controller.close();
      }
    },
    cancel() {
      done = true;
    },
  });
}
