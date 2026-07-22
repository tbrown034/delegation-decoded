import { createHash } from "node:crypto";

const NON_ALNUM = /[^a-z0-9]+/g;

export function normalizeCandidateName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, "")
    .replace(NON_ALNUM, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const FIRST_NAME_EQUIVALENTS: Record<string, string> = {
  brad: "bradley",
  chris: "christopher",
  jeff: "jeffrey",
  jim: "james",
  jimmy: "james",
  jd: "james",
};

function comparableFirstName(value: string) {
  return FIRST_NAME_EQUIVALENTS[value] ?? value;
}

/**
 * Conservative FEC-to-ballot name comparison. Middle names and initials may
 * differ across authorities, but first and last names must agree. A one-letter
 * first-name initial is allowed; callers must still reject ambiguous matches.
 */
export function candidateNamesLikelySame(left: string, right: string) {
  const leftTokens = normalizeCandidateName(left).split(" ").filter(Boolean);
  const rightTokens = normalizeCandidateName(right).split(" ").filter(Boolean);
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;
  const leftFirst = comparableFirstName(leftTokens[0]);
  const rightFirst = comparableFirstName(rightTokens[0]);
  const firstMatches =
    leftFirst === rightFirst ||
    (leftFirst.length === 1 && rightFirst.startsWith(leftFirst)) ||
    (rightFirst.length === 1 && leftFirst.startsWith(rightFirst));
  return firstMatches && leftTokens.at(-1) === rightTokens.at(-1);
}

export function stableElectionId(prefix: string, ...parts: Array<string | number | null>) {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u001f"))
    .digest("hex")
    .slice(0, 20);
  return `${prefix}-${digest}`;
}

export function candidateIdentity(
  contestId: string,
  normalizedName: string,
  party: string | null,
  fecCandidateId: string | null = null
) {
  const personId = stableElectionId("person", contestId, normalizedName, party);
  return {
    personId,
    candidacyId: stableElectionId("candidacy", contestId, personId),
    fecCandidateId,
  };
}

export function houseContestId(stateCode: string, district: number, cycle = 2026) {
  return `${cycle}-${stateCode.toUpperCase()}-H${district}`;
}

export function senateContestId(
  stateCode: string,
  senateClass: 1 | 2 | 3,
  electionType: "regular" | "special" = "regular",
  cycle = 2026
) {
  return `${cycle}-${stateCode.toUpperCase()}-S${senateClass}${
    electionType === "special" ? "-special" : ""
  }`;
}

export function parseContestId(value: string) {
  const house = /^(\d{4})-([A-Z]{2})-H(\d{1,2})$/.exec(value);
  if (house) {
    return {
      cycle: Number(house[1]),
      stateCode: house[2],
      office: "H" as const,
      district: Number(house[3]),
      senateClass: null,
      electionType: "regular" as const,
    };
  }
  const senate = /^(\d{4})-([A-Z]{2})-S([1-3])(-special)?$/.exec(value);
  if (!senate) return null;
  return {
    cycle: Number(senate[1]),
    stateCode: senate[2],
    office: "S" as const,
    district: null,
    senateClass: Number(senate[3]) as 1 | 2 | 3,
    electionType: senate[4] ? ("special" as const) : ("regular" as const),
  };
}
