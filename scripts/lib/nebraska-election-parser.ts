import { parse, type DefaultTreeAdapterMap } from "parse5";
import { normalizeCandidateName } from "../../lib/elections/ids";
import { parseFirstXlsxWorksheet } from "./xlsx-rows";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];
type HtmlRoot = HtmlNode | DefaultTreeAdapterMap["document"];

const EXPECTED_WORKBOOK_HEADERS: Readonly<Record<string, string>> = {
  A: "Office",
  B: "District Name (if applicable)",
  C: "Term",
  D: "Vote For",
  E: "Party (if applicable)",
  F: "Candidate Name",
  G: "City of Residence",
  H: "Incumbency Status",
  I: "Mailing Address",
  J: "Phone/Email",
};

const PARTY_BY_RESULT_CODE = {
  REP: "Republican",
  DEM: "Democratic",
  LIB: "Libertarian",
  LMN: "Legal Marijuana NOW",
} as const;

export type NebraskaParty =
  | "Republican"
  | "Democratic"
  | "Libertarian"
  | "Legal Marijuana NOW"
  | "By Petition";

export type NebraskaCurrentCandidate = {
  name: string;
  normalizedName: string;
  party: NebraskaParty;
  office: "H" | "S";
  district: number | null;
  isIncumbent: boolean;
};

export type NebraskaPrimaryCandidate = {
  name: string;
  normalizedName: string;
  party: Exclude<NebraskaParty, "By Petition">;
  office: "H" | "S";
  district: number | null;
  totalVotes: number;
  isWinner: boolean;
};

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isElement(node: HtmlRoot): node is HtmlElement {
  return "tagName" in node;
}

function attr(node: HtmlElement, name: string) {
  return node.attrs.find((attribute) => attribute.name.toLowerCase() === name)?.value ?? null;
}

function textContent(node: HtmlRoot): string {
  if ("value" in node) return node.value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(textContent).join(" ");
}

function hasClass(node: HtmlElement, className: string) {
  return (attr(node, "class") ?? "").split(/\s+/).includes(className);
}

function walk(node: HtmlRoot, visit: (element: HtmlElement) => void) {
  if (isElement(node)) visit(node);
  if (!("childNodes" in node)) return;
  for (const child of node.childNodes) walk(child, visit);
}

function descendants(
  node: HtmlRoot,
  predicate: (element: HtmlElement) => boolean
) {
  const found: HtmlElement[] = [];
  walk(node, (element) => {
    if (predicate(element)) found.push(element);
  });
  return found;
}

function firstDescendant(
  node: HtmlRoot,
  predicate: (element: HtmlElement) => boolean
) {
  return descendants(node, predicate)[0] ?? null;
}

function parseOffice(value: string | undefined, districtValue: string | undefined) {
  if (value === "For United States Senator") {
    if (districtValue?.trim()) {
      throw new Error("Nebraska Senate candidate had an unexpected district");
    }
    return { office: "S" as const, district: null };
  }
  if (value !== "For Representative in Congress") return null;
  const match = /^District 0([1-3])\s*$/.exec(districtValue ?? "");
  if (!match) throw new Error("Nebraska House candidate had an invalid district");
  return { office: "H" as const, district: Number(match[1]) };
}

function parseParty(value: string | undefined): NebraskaParty | null {
  if (
    value === "Republican" ||
    value === "Democratic" ||
    value === "Libertarian" ||
    value === "Legal Marijuana NOW" ||
    value === "By Petition"
  ) {
    return value;
  }
  return null;
}

export function parseNebraskaCurrentCandidateRows(rows: Array<Record<string, string>>) {
  const header = rows[0];
  if (
    !header ||
    Object.entries(EXPECTED_WORKBOOK_HEADERS).some(
      ([column, value]) => header[column] !== value
    ) ||
    Object.keys(header).length !== Object.keys(EXPECTED_WORKBOOK_HEADERS).length
  ) {
    throw new Error("Nebraska candidate workbook header changed");
  }

  const candidates = new Map<string, NebraskaCurrentCandidate>();
  for (const row of rows.slice(1)) {
    const seat = parseOffice(row.A, row.B);
    if (!seat) continue;
    const party = parseParty(row.E);
    const name = row.F?.trim();
    const expectedTerm = seat.office === "S" ? "6" : "2";
    if (
      !name ||
      !party ||
      row.C !== expectedTerm ||
      row.D !== "1" ||
      (row.H !== "Incumbent" && row.H !== "Nonincumbent")
    ) {
      throw new Error("Nebraska federal candidate record failed validation");
    }
    const normalizedName = normalizeCandidateName(name);
    const key = `${seat.office}|${seat.district ?? "statewide"}|${normalizedName}|${party}`;
    if (candidates.has(key)) {
      throw new Error("Nebraska workbook contained a duplicate federal candidacy");
    }
    candidates.set(key, {
      name,
      normalizedName,
      party,
      office: seat.office,
      district: seat.district,
      isIncumbent: row.H === "Incumbent",
    });
  }

  const parsed = Array.from(candidates.values());
  const contests = new Set(
    parsed.map((candidate) => `${candidate.office}|${candidate.district ?? "statewide"}`)
  );
  if (
    !contests.has("S|statewide") ||
    !contests.has("H|1") ||
    !contests.has("H|2") ||
    !contests.has("H|3")
  ) {
    throw new Error("Nebraska workbook did not cover every federal contest");
  }
  return parsed;
}

export async function parseNebraskaCurrentCandidateWorkbook(buffer: Buffer) {
  return parseNebraskaCurrentCandidateRows(
    await parseFirstXlsxWorksheet(buffer, {
      label: "Nebraska candidate workbook",
      maxBytes: 1_000_000,
      maxInflatedBytes: 10_000_000,
    })
  );
}

function parseResultSeat(title: string) {
  if (/^For United States Senator - 6\s+Year Term$/.test(title)) {
    return { office: "S" as const, district: null };
  }
  const house = /^For Representative in Congress - 2\s+Year Term - District 0([1-3])$/.exec(
    title
  );
  return house
    ? { office: "H" as const, district: Number(house[1]) }
    : null;
}

function parseVotes(value: string) {
  if (!/^\d{1,3}(?:,\d{3})*$/.test(value)) {
    throw new Error("Nebraska result contained an invalid vote total");
  }
  const votes = Number(value.replaceAll(",", ""));
  if (!Number.isSafeInteger(votes) || votes < 0) {
    throw new Error("Nebraska result contained an invalid vote total");
  }
  return votes;
}

export function parseNebraskaPrimaryResultsHtml(html: string) {
  const document = parse(html);
  const pageText = normalizeSpace(document.childNodes.map(textContent).join(" "));
  if (
    !pageText.includes("Unofficial Results Primary Election May 12, 2026") ||
    !pageText.includes("Precincts Fully Reported")
  ) {
    throw new Error("Nebraska primary result page identity changed");
  }

  const wrappers = descendants(
    document,
    (element) => hasClass(element, "wrapper-inside") && hasClass(element, "wrapper-border")
  );
  const groups = new Map<
    string,
    {
      office: "H" | "S";
      district: number | null;
      party: Exclude<NebraskaParty, "By Petition">;
      candidates: Omit<NebraskaPrimaryCandidate, "isWinner">[];
    }
  >();

  for (const wrapper of wrappers) {
    const titleContainer = firstDescendant(wrapper, (element) =>
      hasClass(element, "display-results-box-a")
    );
    const titleNode = titleContainer
      ? firstDescendant(titleContainer, (element) => element.tagName === "h1")
      : null;
    const seat = parseResultSeat(normalizeSpace(titleNode ? textContent(titleNode) : ""));
    if (!seat) continue;

    const exportInput = firstDescendant(
      wrapper,
      (element) => element.tagName === "input" && hasClass(element, "export-button")
    );
    const partyCode = exportInput ? attr(exportInput, "party") : null;
    const party = partyCode
      ? PARTY_BY_RESULT_CODE[partyCode as keyof typeof PARTY_BY_RESULT_CODE]
      : null;
    if (!party) throw new Error("Nebraska federal result had an unknown party code");

    const key = `${seat.office}|${seat.district ?? "statewide"}|${party}`;
    if (groups.has(key)) throw new Error("Nebraska result duplicated a federal party contest");
    const candidates: Omit<NebraskaPrimaryCandidate, "isWinner">[] = [];
    for (const candidateContainer of descendants(wrapper, (element) =>
      hasClass(element, "display-results-box-d")
    )) {
      const row = candidateContainer.parentNode;
      if (!row || !isElement(row)) {
        throw new Error("Nebraska result candidate row was malformed");
      }
      const nameNode = firstDescendant(
        candidateContainer,
        (element) => element.tagName === "h1"
      );
      const partyNode = firstDescendant(
        candidateContainer,
        (element) => element.tagName === "h2"
      );
      const voteContainer = firstDescendant(row, (element) =>
        hasClass(element, "display-results-box-f")
      );
      const voteNode = voteContainer
        ? firstDescendant(voteContainer, (element) => element.tagName === "h1")
        : null;
      const name = normalizeSpace(nameNode ? textContent(nameNode) : "");
      const partyLabel = normalizeSpace(partyNode ? textContent(partyNode) : "");
      const normalizedPartyLabel =
        partyLabel === "Legal Marijuana Now" ? "Legal Marijuana NOW" : partyLabel;
      if (!name || normalizedPartyLabel !== party || !voteNode) {
        throw new Error("Nebraska federal result candidate failed validation");
      }
      candidates.push({
        name,
        normalizedName: normalizeCandidateName(name),
        party,
        office: seat.office,
        district: seat.district,
        totalVotes: parseVotes(normalizeSpace(textContent(voteNode))),
      });
    }
    if (candidates.length === 0) {
      throw new Error("Nebraska federal result party contest had no candidates");
    }
    groups.set(key, { ...seat, party, candidates });
  }

  const parsed: NebraskaPrimaryCandidate[] = [];
  for (const group of groups.values()) {
    const maxVotes = Math.max(...group.candidates.map((candidate) => candidate.totalVotes));
    if (group.candidates.filter((candidate) => candidate.totalVotes === maxVotes).length !== 1) {
      throw new Error("Nebraska federal result had a tied top vote total");
    }
    for (const candidate of group.candidates) {
      parsed.push({ ...candidate, isWinner: candidate.totalVotes === maxVotes });
    }
  }
  if (parsed.length === 0) {
    throw new Error("Nebraska result page did not contain federal candidates");
  }
  return parsed;
}

export function parseNebraskaPrimaryResultPages(htmlPages: readonly string[]) {
  const candidates = htmlPages.flatMap(parseNebraskaPrimaryResultsHtml);
  const contests = new Set(
    candidates.map(
      (candidate) => `${candidate.office}|${candidate.district ?? "statewide"}`
    )
  );
  for (const required of ["S|statewide", "H|1", "H|2", "H|3"]) {
    if (!contests.has(required)) {
      throw new Error("Nebraska results did not cover every federal contest");
    }
  }
  const keys = candidates.map(
    (candidate) =>
      `${candidate.office}|${candidate.district ?? "statewide"}|${candidate.party}|${candidate.normalizedName}`
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error("Nebraska result pages duplicated a federal candidacy");
  }
  return candidates;
}

export function validateNebraskaSourcePage(
  html: string,
  expectedTitle: string,
  requiredText: readonly string[] = []
) {
  const document = parse(html);
  const title = firstDescendant(
    document,
    (element) => element.tagName === "h1" && hasClass(element, "page-header")
  );
  const pageText = normalizeSpace(document.childNodes.map(textContent).join(" "));
  if (!title || normalizeSpace(textContent(title)) !== expectedTitle) {
    throw new Error("Nebraska official source page title changed");
  }
  for (const text of requiredText) {
    if (!pageText.includes(text)) {
      throw new Error("Nebraska official source page omitted required evidence");
    }
  }
}

export function validateNebraskaCanvassPdf(buffer: Buffer) {
  if (
    buffer.length < 100_000 ||
    !buffer.subarray(0, 5).equals(Buffer.from("%PDF-")) ||
    !buffer.includes(Buffer.from("Compiled by Nebraska Secretary of State"))
  ) {
    throw new Error("Nebraska certified canvass PDF failed validation");
  }
}
