import { normalizeCandidateName } from "../../lib/elections/ids";
import { parseFirstXlsxWorksheet } from "./xlsx-rows";

const EXPECTED_HEADERS: Readonly<Record<string, string>> = {
  A: "LAST NAME",
  B: "FIRST NAME",
  C: "MIDDLE NAME",
  D: "SUFFIX",
  E: "VOTER ID",
  F: "ELECTION DATE - NAME",
  G: "STREET NUMBER",
  H: "SUF-A",
  I: "SUF-B",
  J: "STREET NAME",
  K: "STREET NAME 2",
  L: "UNIT",
  M: "POSTAL CITY",
  N: "ZIP CODE",
  O: "ZIP4",
  P: "ESS",
  Q: "PHONE#",
  R: "EMAIL",
  S: "PARTY",
  T: "OFFICE",
  U: "DIST#",
  V: "DECLARATION",
  W: "END",
  X: "P.C.",
  Y: "NEED N.P.",
  Z: "QBP",
  AA: "ON P.B",
  AB: "B.P.N",
  AC: "W.P",
  AD: "ON E.B",
  AE: "B.P.E",
  AF: "W.E",
  AG: "C/T FOR L.O",
  AH: "TOWN CODE",
  AI: "REQ",
};

const PRIMARY_ELECTION = "09/09/2026 - STATEWIDE PRIMARY";
const GENERAL_ELECTION = "11/03/2026 - STATEWIDE GENERAL ELECTION";

export type RhodeIslandCandidate = {
  name: string;
  normalizedName: string;
  party: "Democratic" | "Republican" | "Independent";
  office: "H" | "S";
  district: number | null;
  stage: "primary" | "general";
  status:
    | "qualified"
    | "did_not_qualify"
    | "primary_winner"
    | "lost_primary"
    | "elected"
    | "lost_general";
  onPrimaryBallot: boolean;
  onElectionBallot: boolean;
};

function yesNo(value: string | undefined, field: string) {
  if (value === "Yes") return true;
  if (value === "No" || value == null || value === "") return false;
  throw new Error(`Rhode Island federal candidate had an unknown ${field} value`);
}

function resultValue(value: string | undefined, field: string) {
  if (value === "Yes") return true;
  if (value === "No") return false;
  if (value == null || value === "") return null;
  throw new Error(`Rhode Island federal candidate had an unknown ${field} value`);
}

function parseOffice(office: string | undefined, districtValue: string | undefined) {
  if (office === "SENATOR IN CONGRESS") {
    if (districtValue !== "1,2") {
      throw new Error("Rhode Island Senate candidate had an unexpected district");
    }
    return { office: "S" as const, district: null };
  }
  const match = /^REPRESENTATIVE IN CONGRESS DISTRICT ([12])$/.exec(office ?? "");
  if (!match) return null;
  const district = Number(match[1]);
  if (districtValue !== String(district)) {
    throw new Error("Rhode Island House candidate district did not match the office");
  }
  return { office: "H" as const, district };
}

function parseParty(value: string | undefined) {
  if (value === "Democrat") return "Democratic" as const;
  if (value === "Republican") return "Republican" as const;
  if (value === "Independent") return "Independent" as const;
  return null;
}

function parseStage(value: string | undefined) {
  if (value === PRIMARY_ELECTION) return "primary" as const;
  if (value === GENERAL_ELECTION) return "general" as const;
  return null;
}

function candidateStatus(
  qualified: boolean,
  stage: "primary" | "general",
  wonPrimary: boolean | null,
  wonElection: boolean | null
): RhodeIslandCandidate["status"] {
  if (!qualified) return "did_not_qualify";
  if (stage === "primary") {
    if (wonPrimary === true) return "primary_winner";
    if (wonPrimary === false) return "lost_primary";
    return "qualified";
  }
  if (wonElection === true) return "elected";
  if (wonElection === false) return "lost_general";
  return "qualified";
}

export function parseRhodeIslandCandidateRows(rows: Array<Record<string, string>>) {
  const header = rows[0];
  if (
    !header ||
    Object.entries(EXPECTED_HEADERS).some(([column, value]) => header[column] !== value) ||
    Object.keys(header).length !== Object.keys(EXPECTED_HEADERS).length
  ) {
    throw new Error("Rhode Island candidate workbook header changed");
  }

  const candidates = new Map<string, RhodeIslandCandidate>();
  for (const row of rows.slice(1)) {
    const seat = parseOffice(row.T, row.U);
    if (!seat) continue;

    const party = parseParty(row.S);
    const stage = parseStage(row.F);
    const name = [row.B, row.C, row.A, row.D].filter(Boolean).join(" ").trim();
    const qualified = yesNo(row.Z, "ballot qualification");
    const onPrimaryBallot = yesNo(row.AA, "primary-ballot");
    const wonPrimary = resultValue(row.AC, "primary-result");
    const onElectionBallot = yesNo(row.AD, "general-ballot");
    const wonElection = resultValue(row.AF, "general-result");

    if (
      !name ||
      !party ||
      !stage ||
      row.V !== "Valid" ||
      row.Y !== "Yes" ||
      (stage === "primary" && party === "Independent") ||
      (stage === "general" && party !== "Independent") ||
      (onPrimaryBallot && stage !== "primary") ||
      (onElectionBallot && stage !== "general" && wonPrimary !== true) ||
      (!qualified &&
        (onPrimaryBallot || onElectionBallot || wonPrimary != null || wonElection != null)) ||
      (wonPrimary != null && stage !== "primary") ||
      (wonElection != null && stage !== "general")
    ) {
      throw new Error("Rhode Island federal candidate record failed validation");
    }

    const normalizedName = normalizeCandidateName(name);
    const key = `${seat.office}|${seat.district ?? "statewide"}|${normalizedName}|${party}`;
    if (candidates.has(key)) {
      throw new Error("Rhode Island workbook contained a duplicate federal candidacy");
    }
    candidates.set(key, {
      name,
      normalizedName,
      party,
      office: seat.office,
      district: seat.district,
      stage,
      status: candidateStatus(qualified, stage, wonPrimary, wonElection),
      onPrimaryBallot,
      onElectionBallot,
    });
  }

  const parsed = Array.from(candidates.values());
  const contests = new Set(
    parsed.map((candidate) => `${candidate.office}|${candidate.district ?? "statewide"}`)
  );
  if (!contests.has("S|statewide") || !contests.has("H|1") || !contests.has("H|2")) {
    throw new Error("Rhode Island workbook did not cover every federal contest");
  }
  return parsed;
}

export async function parseRhodeIslandCandidateWorkbook(buffer: Buffer) {
  return parseRhodeIslandCandidateRows(
    await parseFirstXlsxWorksheet(buffer, {
      label: "Rhode Island candidate workbook",
      maxBytes: 1_000_000,
      maxInflatedBytes: 10_000_000,
    })
  );
}
