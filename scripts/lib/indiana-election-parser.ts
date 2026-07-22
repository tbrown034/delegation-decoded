import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeCandidateName } from "../../lib/elections/ids";

const execFileAsync = promisify(execFile);
const DISTRICTS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
};

export type IndianaGeneralCandidate = {
  name: string;
  normalizedName: string;
  party: string;
  district: number;
  status: "general_ballot" | "write_in";
};

export type IndianaPrimaryCandidate = {
  name: string;
  normalizedName: string;
  party: "Democratic" | "Republican";
  district: number;
  totalVotes: number;
  isWinner: boolean;
};

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

function parseSharedStrings(xml: string) {
  return Array.from(xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g), (match) =>
    Array.from(match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (text) =>
      decodeXml(text[1])
    ).join("")
  );
}

function cellColumn(reference: string) {
  return reference.replace(/\d+$/, "");
}

function parseRows(sheetXml: string, shared: string[]) {
  return Array.from(sheetXml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g), (row) => {
    const values: Record<string, string> = {};
    for (const cell of row[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = /\br="([A-Z]+\d+)"/.exec(cell[1])?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1];
      if (!reference || raw == null) continue;
      values[cellColumn(reference)] = /\bt="s"/.test(cell[1])
        ? shared[Number(raw)] ?? ""
        : decodeXml(raw);
    }
    return values;
  });
}

function parseDistrict(value: string) {
  const numeric = /\b(\d{1,2})(?:st|nd|rd|th)?\b/.exec(value)?.[1];
  if (numeric) return Number(numeric);
  const normalized = value.toLowerCase();
  for (const [word, district] of Object.entries(DISTRICTS)) {
    if (normalized.includes(`${word} district`)) return district;
  }
  return null;
}

export function parseIndianaGeneralRows(rows: Array<Record<string, string>>) {
  const headerIndex = rows.findIndex(
    (row) => row.A === "Office" && row.B === "Name" && row.C === "Party" && row.D === "District"
  );
  if (headerIndex < 0) throw new Error("Indiana workbook header was not found");

  const candidates = new Map<string, IndianaGeneralCandidate>();
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.A?.trim().toUpperCase() !== "US REPRESENTATIVE") continue;
    const name = row.B?.trim();
    const party = row.C?.trim();
    const district = parseDistrict(row.D ?? "");
    if (!name || !party || district == null || district < 1 || district > 9) continue;
    const normalizedName = normalizeCandidateName(name);
    const key = `${district}|${normalizedName}|${party.toLowerCase()}`;
    candidates.set(key, {
      name,
      normalizedName,
      party,
      district,
      status: party.toLowerCase().startsWith("write-in") ? "write_in" : "general_ballot",
    });
  }
  const parsed = Array.from(candidates.values());
  const coveredDistricts = new Set(parsed.map((candidate) => candidate.district));
  if (parsed.length === 0 || coveredDistricts.size === 0) {
    throw new Error("Indiana general list did not contain congressional records");
  }
  return parsed;
}

export async function parseIndianaGeneralWorkbook(buffer: Buffer) {
  if (buffer.length > 10_000_000) throw new Error("Indiana workbook exceeds the size limit");
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "dd-election-"));
  const workbookPath = path.join(tempDirectory, "source.xlsx");
  try {
    await writeFile(workbookPath, buffer, { flag: "wx" });
    const [shared, sheet] = await Promise.all([
      execFileAsync("unzip", ["-p", workbookPath, "xl/sharedStrings.xml"], {
        maxBuffer: 10_000_000,
      }),
      execFileAsync("unzip", ["-p", workbookPath, "xl/worksheets/sheet1.xml"], {
        maxBuffer: 10_000_000,
      }),
    ]);
    return parseIndianaGeneralRows(
      parseRows(sheet.stdout, parseSharedStrings(shared.stdout))
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  return value;
}

export function parseIndianaPrimaryResults(settingsInput: unknown, resultsInput: unknown) {
  const settingsRoot = objectValue(objectValue(settingsInput, "settings").Root, "settings.Root");
  const certifiedFlag = settingsRoot.Certified;
  if (certifiedFlag !== "T" && certifiedFlag !== "F") {
    throw new Error("Indiana settings omitted the Certified flag");
  }
  const resultStatus = certifiedFlag === "T" ? ("certified" as const) : ("unofficial" as const);
  const resultRoot = objectValue(objectValue(resultsInput, "results").Root, "results.Root");
  const summary = objectValue(resultRoot.StatewideSummary, "StatewideSummary");
  const races = arrayValue(summary.Race, "StatewideSummary.Race");
  const candidates: IndianaPrimaryCandidate[] = [];

  for (const raceInput of races) {
    const race = objectValue(raceInput, "race");
    const title = typeof race.OFFICE_TITLE === "string" ? race.OFFICE_TITLE : "";
    const district = parseDistrict(title);
    if (district == null || district < 1 || district > 9) {
      throw new Error(`Could not parse Indiana congressional district from ${title || "an empty title"}`);
    }
    const candidateContainer = objectValue(race.Candidates, "race.Candidates");
    for (const candidateInput of arrayValue(candidateContainer.Candidate, "Candidates.Candidate")) {
      const candidate = objectValue(candidateInput, "candidate");
      const name = typeof candidate.NAME_ON_BALLOT === "string" ? candidate.NAME_ON_BALLOT.trim() : "";
      const party = candidate.PARTY === "D" ? "Democratic" : candidate.PARTY === "R" ? "Republican" : null;
      const totalVotes = Number(candidate.TOTAL);
      if (!name || !party || !Number.isSafeInteger(totalVotes) || totalVotes < 0) {
        throw new Error("Indiana primary candidate record failed validation");
      }
      candidates.push({
        name,
        normalizedName: normalizeCandidateName(name),
        party,
        district,
        totalVotes,
        isWinner: candidate.isWinner === "T",
      });
    }
  }
  if (new Set(candidates.map((candidate) => candidate.district)).size !== 9) {
    throw new Error("Indiana primary results do not cover all 9 congressional districts");
  }
  return {
    resultStatus,
    electionDate:
      typeof settingsRoot.CurrentElection === "string"
        ? settingsRoot.CurrentElection
        : "2026-05-05",
    versionCode:
      typeof settingsRoot.VersionCode === "string" ? settingsRoot.VersionCode : null,
    candidates,
  };
}
