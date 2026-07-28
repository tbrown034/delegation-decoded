/**
 * Reader-facing name forms that official records do not use.
 *
 * @unitedstates stores legal names, so the roster holds "Charles E. Schumer"
 * and "Bernard Sanders" while readers type "Chuck Schumer" and "Bernie
 * Sanders". Without a mapping those queries return nothing and /ask reports it
 * as "no sitting member matches", which reads as a factual claim rather than a
 * lookup miss.
 *
 * Deliberately small and hand-checked. Each entry maps a nickname to the legal
 * first name actually on file for a sitting member — not a general nickname
 * dictionary, which would introduce false matches (a "Mike" alias would pull in
 * every Michael when the reader meant a specific one is fine; a wrong mapping
 * that silently redirects to another member is not).
 */
const FIRST_NAME_ALIASES: Record<string, string[]> = {
  chuck: ["charles"],
  bernie: ["bernard"],
  bob: ["robert"],
  bobby: ["robert"],
  rob: ["robert"],
  bill: ["william"],
  billy: ["william"],
  will: ["william"],
  dick: ["richard"],
  rick: ["richard"],
  jim: ["james"],
  jimmy: ["james"],
  joe: ["joseph"],
  mike: ["michael"],
  tom: ["thomas"],
  tommy: ["thomas"],
  dan: ["daniel"],
  danny: ["daniel"],
  dave: ["david"],
  steve: ["steven", "stephen"],
  ted: ["theodore", "edward"],
  tony: ["anthony"],
  chris: ["christopher"],
  nick: ["nicholas"],
  greg: ["gregory"],
  jeff: ["jeffrey"],
  ken: ["kenneth"],
  liz: ["elizabeth"],
  beth: ["elizabeth"],
  kate: ["katherine", "kathryn"],
  katie: ["katherine", "kathryn"],
  cathy: ["catherine"],
  sue: ["susan"],
  debbie: ["deborah"],
  pat: ["patrick", "patricia"],
  andy: ["andrew"],
  matt: ["matthew"],
  ben: ["benjamin"],
  sam: ["samuel"],
  ed: ["edward"],
  eddie: ["edward"],
  fred: ["frederick"],
  hal: ["harold"],
  larry: ["lawrence"],
  gus: ["augustus"],
  vern: ["vernon"],
  hank: ["henry"],
};

/** Well-known initialisms readers use in place of a name. */
const INITIALISMS: Record<string, string> = {
  aoc: "ocasio-cortez",
  mtg: "greene",
};

/**
 * Expand a first-name token into every form worth querying, original first.
 * Returns lowercase values suitable for a prefix match.
 */
export function firstNameForms(token: string): string[] {
  const key = token.trim().toLowerCase().replace(/\.$/, "");
  if (!key) return [];
  return [key, ...(FIRST_NAME_ALIASES[key] ?? [])];
}

/** Resolve a bare initialism to the surname it stands for, if known. */
export function initialismSurname(query: string): string | null {
  const key = query.trim().toLowerCase().replace(/[^a-z]/g, "");
  return INITIALISMS[key] ?? null;
}

/**
 * Short name for a breadcrumb, guaranteed consistent with the page heading.
 *
 * `full_name` comes from the office's own `official_full` and `last_name` from
 * @unitedstates `name.last`; for 18 sitting members they disagree. Most are
 * harmless suffix trims ("Angus S. King, Jr." / "King"), but two are genuine
 * mismatches — "Darline Graham" / "Graham Nordone" and "Pablo José Hernández" /
 * "Hernández Rivera" — where the crumb named someone the heading never
 * mentioned. Use the surname only when the heading actually contains it.
 */
export function breadcrumbName(fullName: string, lastName: string): string {
  const surname = lastName?.trim();
  if (!surname) return fullName;
  return fullName.toLowerCase().includes(surname.toLowerCase())
    ? surname
    : fullName;
}
