import { parse, type DefaultTreeAdapterMap } from "parse5";
import { normalizeCandidateName } from "../../lib/elections/ids";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];
type HtmlRoot = HtmlNode | DefaultTreeAdapterMap["document"];

export type MichiganCandidateStage = "primary" | "general";

// The Bureau of Elections publishes the general-election list as "Unofficial"
// until the primary is canvassed, then republishes the same report as
// "Official". The label is the only signal that general-ballot access has
// been verified, so the parser reports it instead of guessing.
export type MichiganReportKind = "official" | "unofficial";

export type MichiganCandidate = {
  name: string;
  normalizedName: string;
  party:
    | "Democratic"
    | "Republican"
    | "Libertarian"
    | "Green"
    | "Working Class"
    | "No Party Affiliation"
    | "US Taxpayers"
    | "Natural Law";
  office: "H" | "S";
  district: number | null;
  stage: MichiganCandidateStage;
  status: "qualified" | "filed_unofficial" | "withdrawn" | "disqualified";
  filedOn: string;
  filingMethod: "Petitions" | "Convention";
};

type MichiganSeat = Pick<MichiganCandidate, "office" | "district">;

const PARTY_NAMES: Readonly<Record<string, MichiganCandidate["party"]>> = {
  "Democratic Party": "Democratic",
  "Republican Party": "Republican",
  "Libertarian Party": "Libertarian",
  "Green Party": "Green",
  "Working Class Party": "Working Class",
  "No Party Affiliation": "No Party Affiliation",
  "US Taxpayers Party": "US Taxpayers",
  "U.S. Taxpayers Party": "US Taxpayers",
  "Natural Law Party": "Natural Law",
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

function directCells(row: HtmlElement) {
  return row.childNodes.filter(
    (node): node is HtmlElement =>
      isElement(node) && (node.tagName === "td" || node.tagName === "th")
  );
}

function nearestAncestorRow(element: HtmlElement) {
  let parent: HtmlNode | DefaultTreeAdapterMap["document"] | null = element.parentNode;
  while (parent) {
    if (isElement(parent) && parent.tagName === "tr") return parent;
    parent = "parentNode" in parent ? parent.parentNode : null;
  }
  return null;
}

function parseFederalSeat(title: string): MichiganSeat | null {
  if (title === "U.S. Senate 6 Year Term (1) Position") {
    return { office: "S", district: null };
  }
  const house = /^(\d{1,2})(?:st|nd|rd|th) District Representative in Congress 2 Year Term \(1\) Position(?: Files In [A-Z. ]+ County)?$/.exec(
    title
  );
  if (house) {
    const district = Number(house[1]);
    if (district < 1 || district > 13) {
      throw new Error("Michigan candidate report contained an invalid congressional district");
    }
    return { office: "H", district };
  }
  if (/U\.S\. Senate|Representative in Congress/.test(title)) {
    throw new Error("Michigan federal office label changed");
  }
  return null;
}

function displayCandidateName(value: string) {
  const firstComma = value.indexOf(",");
  if (firstComma <= 0 || value.indexOf(",", firstComma + 1) !== -1) {
    throw new Error("Michigan federal candidate name format changed");
  }
  const family = normalizeSpace(value.slice(0, firstComma));
  const given = normalizeSpace(value.slice(firstComma + 1));
  if (!family || !given) {
    throw new Error("Michigan federal candidate name format changed");
  }
  return `${given} ${family}`;
}

function isoDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error("Michigan federal candidate filing date changed");
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    (year !== 2025 && year !== 2026) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Michigan federal candidate filing date was invalid");
  }
  return `${match[3]}-${match[1]}-${match[2]}`;
}

function candidateStatus(
  rawStatus: string,
  reportKind: MichiganReportKind
): MichiganCandidate["status"] {
  if (rawStatus === "") {
    return reportKind === "official" ? "qualified" : "filed_unofficial";
  }
  if (rawStatus === "WITHD") return "withdrawn";
  if (rawStatus === "DISQ") return "disqualified";
  throw new Error("Michigan federal candidate status changed");
}

function validatePageIdentity(
  text: string,
  stage: MichiganCandidateStage
): MichiganReportKind {
  const expected =
    stage === "primary"
      ? [
          "Michigan Department of State",
          "All State and Judicial Offices",
          "Primary Election",
          "Tuesday, August 4, 2026",
          "Status Party / Incumbent Candidate Name Filed On Filing Method",
        ]
      : [
          "Michigan Department of State",
          "All State and Judicial Offices",
          "General Election",
          "Tuesday, November 3, 2026",
          "Status Party / Incumbent Candidate Name Filed On Filing Method",
        ];
  if (expected.some((value) => !text.includes(value))) {
    throw new Error(`Michigan ${stage} candidate report identity changed`);
  }
  const official = text.includes("Official Candidate Listing");
  const unofficial = text.includes("Unofficial Candidate Listing");
  // "Unofficial Candidate Listing" contains the substring "official Candidate
  // Listing" but not the capitalized "Official", so the two labels are
  // distinguishable; a page carrying both or neither is a changed report.
  if (official === unofficial) {
    throw new Error(`Michigan ${stage} candidate report identity changed`);
  }
  if (stage === "primary" && !official) {
    throw new Error("Michigan primary candidate report is no longer official");
  }
  return official ? "official" : "unofficial";
}

export function parseMichiganCandidateReport(
  html: string,
  stage: MichiganCandidateStage
): { reportKind: MichiganReportKind; candidates: MichiganCandidate[] } {
  const document = parse(html);
  const pageText = normalizeSpace(document.childNodes.map(textContent).join(" "));
  const reportKind = validatePageIdentity(pageText, stage);

  const rows = descendants(document, (element) => element.tagName === "tr");
  const candidates = new Map<string, MichiganCandidate>();
  let currentSeat: MichiganSeat | null = null;

  for (const row of rows) {
    const anchor = descendants(
      row,
      (element) =>
        element.tagName === "a" &&
        attr(element, "id") != null &&
        nearestAncestorRow(element) === row
    )[0];
    if (anchor) {
      currentSeat = parseFederalSeat(normalizeSpace(textContent(row)));
      continue;
    }
    if (!currentSeat) continue;

    const values = directCells(row)
      .map((cell) => normalizeSpace(textContent(cell)))
      .filter(Boolean);
    const dateIndexes = values
      .map((value, index) => (/^\d{2}\/\d{2}\/\d{4}$/.test(value) ? index : -1))
      .filter((index) => index >= 0);
    if (dateIndexes.length === 0) continue;
    if (dateIndexes.length !== 1) {
      throw new Error("Michigan federal candidate row contained multiple filing dates");
    }
    const dateIndex = dateIndexes[0];
    if (dateIndex < 2 || dateIndex !== values.length - 2) {
      throw new Error("Michigan federal candidate row layout changed");
    }

    const rawStatusValues = values.slice(0, dateIndex - 2);
    if (rawStatusValues.length > 1) {
      throw new Error("Michigan federal candidate row status layout changed");
    }
    const rawStatus = rawStatusValues[0] ?? "";
    const rawParty = values[dateIndex - 2];
    const party = PARTY_NAMES[rawParty];
    if (!party) throw new Error("Michigan federal candidate party changed");
    if (
      stage === "primary" &&
      party !== "Democratic" &&
      party !== "Republican"
    ) {
      throw new Error("Michigan primary report contained an unexpected federal party");
    }

    const rawMethod = values[dateIndex + 1];
    if (rawMethod !== "Petitions" && rawMethod !== "Convention") {
      throw new Error("Michigan federal candidate filing method changed");
    }
    if (stage === "primary" && rawMethod !== "Petitions") {
      throw new Error("Michigan primary candidate had an unexpected filing method");
    }

    const name = displayCandidateName(values[dateIndex - 1]);
    const candidate: MichiganCandidate = {
      name,
      normalizedName: normalizeCandidateName(name),
      party,
      office: currentSeat.office,
      district: currentSeat.district,
      stage,
      status: candidateStatus(rawStatus, reportKind),
      filedOn: isoDate(values[dateIndex]),
      filingMethod: rawMethod,
    };
    const key = `${candidate.office}|${candidate.district ?? "statewide"}|${candidate.normalizedName}|${candidate.party}`;
    if (candidates.has(key)) {
      throw new Error("Michigan report contained a duplicate federal candidacy");
    }
    candidates.set(key, candidate);
  }

  const parsed = Array.from(candidates.values());
  const contests = new Set(
    parsed.map((candidate) => `${candidate.office}|${candidate.district ?? "statewide"}`)
  );
  if (stage === "primary") {
    for (const required of [
      "S|statewide",
      ...Array.from({ length: 13 }, (_, index) => `H|${index + 1}`),
    ]) {
      if (!contests.has(required)) {
        throw new Error("Michigan primary report did not cover every federal contest");
      }
    }
  } else if (!contests.has("S|statewide") || parsed.length < 5) {
    throw new Error("Michigan general filing report lost expected federal coverage");
  }
  return { reportKind, candidates: parsed };
}

export function parseMichiganCandidateReportHtml(
  html: string,
  stage: MichiganCandidateStage
) {
  return parseMichiganCandidateReport(html, stage).candidates;
}
