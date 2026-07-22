import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function decodeXml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function textNodes(xml: string) {
  return Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (match) =>
    decodeXml(match[1])
  ).join("");
}

function parseSharedStrings(xml: string) {
  return Array.from(xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g), (match) =>
    textNodes(match[1])
  );
}

function cellColumn(reference: string) {
  return reference.replace(/\d+$/, "");
}

export function parseXlsxRows(sheetXml: string, shared: string[] = []) {
  return Array.from(sheetXml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g), (row) => {
    const values: Record<string, string> = {};
    for (const cell of row[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const reference = /\br="([A-Z]+\d+)"/.exec(cell[1])?.[1];
      if (!reference) continue;

      const cellType = /\bt="([^"]+)"/.exec(cell[1])?.[1];
      const content = cell[2] ?? "";
      const raw = /<v>([\s\S]*?)<\/v>/.exec(content)?.[1];
      const value =
        cellType === "inlineStr"
          ? textNodes(content)
          : cellType === "s" && raw != null
            ? shared[Number(raw)] ?? ""
            : raw == null
              ? ""
              : decodeXml(raw);
      if (value) values[cellColumn(reference)] = value;
    }
    return values;
  });
}

export async function parseFirstXlsxWorksheet(
  buffer: Buffer,
  options: { label: string; maxBytes: number }
) {
  if (buffer.length > options.maxBytes) {
    throw new Error(`${options.label} exceeds the size limit`);
  }

  const tempDirectory = await mkdtemp(path.join(tmpdir(), "dd-election-"));
  const workbookPath = path.join(tempDirectory, "source.xlsx");
  try {
    await writeFile(workbookPath, buffer, { flag: "wx" });
    const [listing, sheet] = await Promise.all([
      execFileAsync("unzip", ["-Z1", workbookPath], { maxBuffer: 1_000_000 }),
      execFileAsync("unzip", ["-p", workbookPath, "xl/worksheets/sheet1.xml"], {
        maxBuffer: options.maxBytes * 2,
      }),
    ]);
    const hasSharedStrings = listing.stdout
      .split("\n")
      .some((entry) => entry.trim() === "xl/sharedStrings.xml");
    const shared = hasSharedStrings
      ? parseSharedStrings(
          (
            await execFileAsync("unzip", ["-p", workbookPath, "xl/sharedStrings.xml"], {
              maxBuffer: options.maxBytes * 2,
            })
          ).stdout
        )
      : [];
    return parseXlsxRows(sheet.stdout, shared);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
