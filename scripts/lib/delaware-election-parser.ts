import { normalizeCandidateName } from "../../lib/elections/ids";
import { parseFirstXlsxWorksheet } from "./xlsx-rows";

export type DelawareCandidate = {
  name: string;
  normalizedName: string;
  party: "Democratic" | "Republican";
  office: "H" | "S";
  stage: "primary" | "general";
  filingDate: string | null;
  withdrawalDate: string | null;
  status: "qualified" | "provisional" | "withdrawn";
};

function parseDate(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!match) throw new Error(`Delaware candidate date is invalid: ${trimmed}`);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Delaware candidate date is invalid: ${trimmed}`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function federalOffice(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z]/g, "") ?? "";
  if (normalized === "ussenator" || normalized === "unitedstatessenator") return "S" as const;
  if (
    normalized === "representativeincongress" ||
    normalized === "usrepresentative" ||
    normalized === "unitedstatesrepresentative"
  ) {
    return "H" as const;
  }
  return null;
}

function recognizedParty(value: string | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("democrat")) return "Democratic" as const;
  if (normalized.startsWith("republican")) return "Republican" as const;
  return null;
}

function recognizedStatus(value: string | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "qualified") return "qualified" as const;
  if (normalized === "provisional") return "provisional" as const;
  if (normalized === "withdrawn") return "withdrawn" as const;
  return null;
}

export function parseDelawareCandidateRows(
  rows: Array<Record<string, string>>,
  stage: "primary" | "general"
) {
  const headerIndex = rows.findIndex(
    (row) =>
      row.B?.trim() === "Office" &&
      row.D?.trim() === "BallotName" &&
      row.E?.trim() === "Party" &&
      row.T?.trim() === "DisplayedStatus"
  );
  if (headerIndex < 0) throw new Error(`Delaware ${stage} workbook header was not found`);

  const candidates = new Map<string, DelawareCandidate>();
  for (const row of rows.slice(headerIndex + 1)) {
    const office = federalOffice(row.B);
    if (!office) continue;
    const name = row.D?.trim();
    const party = recognizedParty(row.E);
    const status = recognizedStatus(row.T);
    if (!name || !party || !status) {
      throw new Error(`Delaware ${stage} federal candidate record failed validation`);
    }
    const normalizedName = normalizeCandidateName(name);
    const candidate: DelawareCandidate = {
      name,
      normalizedName,
      party,
      office,
      stage,
      filingDate: parseDate(row.J),
      withdrawalDate: parseDate(row.C),
      status,
    };
    candidates.set(`${office}|${normalizedName}|${party}`, candidate);
  }

  const parsed = Array.from(candidates.values());
  if (parsed.length === 0) {
    throw new Error(`Delaware ${stage} list did not contain federal candidate records`);
  }
  return parsed;
}

export async function parseDelawareCandidateWorkbook(
  buffer: Buffer,
  stage: "primary" | "general"
) {
  return parseDelawareCandidateRows(
    await parseFirstXlsxWorksheet(buffer, {
      label: `Delaware ${stage} workbook`,
      maxBytes: 5_000_000,
    }),
    stage
  );
}
