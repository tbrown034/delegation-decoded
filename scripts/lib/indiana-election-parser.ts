import { normalizeCandidateName } from "../../lib/elections/ids";
import { parseFirstXlsxWorksheet } from "./xlsx-rows";

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
  return parseIndianaGeneralRows(
    await parseFirstXlsxWorksheet(buffer, {
      label: "Indiana workbook",
      maxBytes: 10_000_000,
    })
  );
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
