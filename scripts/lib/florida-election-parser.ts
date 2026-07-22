import { normalizeCandidateName } from "../../lib/elections/ids";

const EXPECTED_HEADERS = [
  "AcctNum",
  "VoterID",
  "ElectionID",
  "OfficeCode",
  "OfficeDesc",
  "Juris1num",
  "Juris2num",
  "StatusCode",
  "StatusDesc",
  "PartyCode",
  "PartyDesc",
  "NameLast",
  "NameFirst",
  "NameMiddle",
  "SuppressAddress",
  "Addr1",
  "Addr2",
  "City",
  "State",
  "Zip",
  "County",
  "Phone",
  "TrsNameLast",
  "TrsNameFirst",
  "TrsNameMiddle",
  "Email",
] as const;

const FLORIDA_2026_ELECTION_ID = "20261103-GEN";
const PARTY_FALLBACKS: Readonly<Record<string, string>> = {
  WRI: "Write-In",
};

export type FloridaCandidate = {
  stateCandidateId: string;
  name: string;
  normalizedName: string;
  party: string;
  partyCode: string;
  office: "H" | "S";
  district: number | null;
  status: "qualified" | "primary_unopposed" | "withdrawn" | "did_not_qualify";
};

function parseStatus(code: string) {
  if (code === "QUA") return "qualified" as const;
  if (code === "UNO") return "primary_unopposed" as const;
  if (code === "WIT") return "withdrawn" as const;
  if (code === "DNQ") return "did_not_qualify" as const;
  return null;
}

function parseOffice(code: string, districtValue: string) {
  if (code === "USS") {
    if (districtValue) throw new Error("Florida Senate candidate unexpectedly had a district");
    return { office: "S" as const, district: null };
  }
  if (code !== "USR" || !/^\d{3}$/.test(districtValue)) return null;
  const district = Number(districtValue);
  if (district < 1 || district > 28) return null;
  return { office: "H" as const, district };
}

export function parseFloridaCandidateTsv(input: string | Buffer) {
  const lines = input
    .toString()
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("Florida candidate export was empty");

  const headers = lines[0].split("\t");
  if (
    headers.length !== EXPECTED_HEADERS.length ||
    headers.some((header, index) => header !== EXPECTED_HEADERS[index])
  ) {
    throw new Error("Florida candidate export header changed");
  }

  const candidates = new Map<string, FloridaCandidate>();
  for (const line of lines.slice(1)) {
    const fields = line.split("\t").map((field) => field.trim());
    if (fields.length !== EXPECTED_HEADERS.length) {
      throw new Error("Florida candidate export row had an unexpected column count");
    }

    const [
      stateCandidateId,
      ,
      electionId,
      officeCode,
      ,
      districtValue,
      ,
      statusCode,
      ,
      partyCode,
      partyDescription,
      lastName,
      firstName,
      middleName,
    ] = fields;
    if (electionId !== FLORIDA_2026_ELECTION_ID) {
      throw new Error(`Florida candidate export contained election ${electionId || "missing"}`);
    }
    const seat = parseOffice(officeCode, districtValue);
    const status = parseStatus(statusCode);
    if (
      !seat ||
      !status ||
      !/^\d+$/.test(stateCandidateId) ||
      !/^[A-Z0-9]{2,4}$/.test(partyCode) ||
      !firstName ||
      !lastName
    ) {
      throw new Error("Florida federal candidate record failed validation");
    }

    const name = [firstName, middleName, lastName].filter(Boolean).join(" ");
    const normalizedName = normalizeCandidateName(name);
    const party = partyDescription || PARTY_FALLBACKS[partyCode] || partyCode;
    const key = `${seat.office}|${seat.district ?? "statewide"}|${normalizedName}|${partyCode}`;
    if (candidates.has(key)) {
      throw new Error("Florida candidate export contained a duplicate federal candidacy");
    }
    candidates.set(key, {
      stateCandidateId,
      name,
      normalizedName,
      party,
      partyCode,
      office: seat.office,
      district: seat.district,
      status,
    });
  }

  const parsed = Array.from(candidates.values());
  const houseDistricts = new Set(
    parsed.filter((candidate) => candidate.office === "H").map((candidate) => candidate.district)
  );
  if (houseDistricts.size !== 28 || !parsed.some((candidate) => candidate.office === "S")) {
    throw new Error("Florida candidate export did not cover every federal contest");
  }
  return parsed;
}
