import { parse, type DefaultTreeAdapterMap } from "parse5";
import { normalizeCandidateName } from "../../lib/elections/ids";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];
type HtmlRoot = HtmlNode | DefaultTreeAdapterMap["document"];

export type WashingtonCandidate = {
  name: string;
  normalizedName: string;
  district: number;
  partyPreference:
    | "Democratic"
    | "Republican"
    | "Independent"
    | "Cascade"
    | "No Party Preference"
    | "Trump Republican"
    | "Fifth Republic"
    | "Socialist Workers"
    | "Union";
  status: "qualified" | "withdrawn";
  filedOn: string;
  ballotOrder: number;
};

const EXPECTED_HEADERS = [
  "District Type",
  "District",
  "Race",
  "Term Type",
  "Term Length",
  "Name",
  "Mailing Address",
  "Email",
  "Phone",
  "Filing Date",
  "Party Preference",
  "Status",
  "Election Status",
  "Ballot Order",
] as const;

const PARTY_PREFERENCES: Readonly<
  Record<string, WashingtonCandidate["partyPreference"]>
> = {
  DEMOCRATIC: "Democratic",
  REPUBLICAN: "Republican",
  INDEPENDENT: "Independent",
  CASCADE: "Cascade",
  "STATES NO PARTY PREFERENCE": "No Party Preference",
  "TRUMP REPUBLICAN": "Trump Republican",
  "FIFTH REPUBLIC": "Fifth Republic",
  "SOCIALIST WORKERS": "Socialist Workers",
  UNION: "Union",
};

function normalizeSpace(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
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

function directCells(row: HtmlElement, tagName: "td" | "th") {
  return row.childNodes.filter(
    (node): node is HtmlElement => isElement(node) && node.tagName === tagName
  );
}

function parseDistrict(value: string) {
  const match = /^Congressional District(?: No\.)? (\d{1,2})$/i.exec(value);
  if (!match) throw new Error("Washington federal district label changed");
  const district = Number(match[1]);
  if (!Number.isInteger(district) || district < 1 || district > 10) {
    throw new Error("Washington federal district was invalid");
  }
  return district;
}

function parseFilingDate(value: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(2026) \d{1,2}:\d{2}:\d{2} (?:AM|PM)$/.exec(
    value
  );
  if (!match) throw new Error("Washington federal filing date changed");
  const month = Number(match[1]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(2026, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Washington federal filing date was invalid");
  }
  return `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseStatus(status: string, electionStatus: string) {
  if (status === "Active" && electionStatus === "In Primary") return "qualified";
  if (status === "Withdrawn" && electionStatus === "") return "withdrawn";
  throw new Error("Washington federal candidate status changed");
}

export function parseWashingtonPrimaryCandidateHtml(html: string) {
  const document = parse(html);
  const pageText = normalizeSpace(document.childNodes.map(textContent).join(" "));
  for (const expected of [
    "PRIMARY 2026",
    "PRIMARY 2026 (08/04/2026) (Primary)",
    "The election status column displays whether a candidate appears on the Primary ballot.",
  ]) {
    if (!pageText.includes(expected)) {
      throw new Error("Washington primary candidate page identity changed");
    }
  }

  const table = descendants(
    document,
    (element) =>
      element.tagName === "table" &&
      attr(element, "id") === "ctl00_ContentPlaceHolder1_grdCandidates_ctl00"
  )[0];
  if (!table) throw new Error("Washington primary candidate table changed");

  const rows = descendants(table, (element) => element.tagName === "tr");
  const headerMatches = rows.some((row) => {
    const headers = directCells(row, "th").map((cell) =>
      normalizeSpace(textContent(cell))
    );
    return (
      headers.length === EXPECTED_HEADERS.length &&
      headers.every((value, index) => value === EXPECTED_HEADERS[index])
    );
  });
  if (!headerMatches) throw new Error("Washington primary candidate headers changed");

  const candidates = new Map<string, WashingtonCandidate>();
  const coveredDistricts = new Set<number>();
  for (const row of rows) {
    const cells = directCells(row, "td");
    if (cells.length !== EXPECTED_HEADERS.length) continue;
    const values = cells.map((cell) => normalizeSpace(textContent(cell)));
    if (values[2] !== "U.S. Representative") continue;
    if (
      values[0] !== "Congressional" ||
      values[3] !== "Regular" ||
      values[4] !== "2"
    ) {
      throw new Error("Washington federal contest metadata changed");
    }

    const district = parseDistrict(values[1]);
    const partyPreference = PARTY_PREFERENCES[values[10]];
    if (!partyPreference) {
      throw new Error("Washington federal candidate party preference changed");
    }
    const name = values[5];
    if (!name || name.length > 200 || normalizeCandidateName(name).length === 0) {
      throw new Error("Washington federal candidate name was invalid");
    }
    const ballotOrder = Number(values[13]);
    if (!Number.isInteger(ballotOrder) || ballotOrder < 1) {
      throw new Error("Washington federal ballot order changed");
    }

    const candidate: WashingtonCandidate = {
      name,
      normalizedName: normalizeCandidateName(name),
      district,
      partyPreference,
      status: parseStatus(values[11], values[12]),
      filedOn: parseFilingDate(values[9]),
      ballotOrder,
    };
    const key = `${district}|${candidate.normalizedName}|${partyPreference}`;
    if (candidates.has(key)) {
      throw new Error("Washington page contained a duplicate federal candidacy");
    }
    candidates.set(key, candidate);
    coveredDistricts.add(district);
  }

  if (
    candidates.size < 10 ||
    coveredDistricts.size !== 10 ||
    Array.from({ length: 10 }, (_, index) => index + 1).some(
      (district) => !coveredDistricts.has(district)
    )
  ) {
    throw new Error("Washington primary page did not cover every federal contest");
  }

  return [...candidates.values()].sort(
    (a, b) => a.district - b.district || a.ballotOrder - b.ballotOrder
  );
}
