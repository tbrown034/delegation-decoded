// FEC names arrive as "ANDREWS, ANNIE" / "SMITH, JOHN A JR". Flip around the
// first comma and title-case for display, preserving Mc/Mac/O' prefixes,
// hyphenated names, and suffixes. The FEC candidate_id always links back to
// the raw source record.
const KEEP_UPPER = new Set(["II", "III", "IV", "JR", "SR", "MD", "DDS"]);

function titleWord(w: string): string {
  if (KEEP_UPPER.has(w.toUpperCase())) {
    const u = w.toUpperCase();
    return u === "JR" ? "Jr." : u === "SR" ? "Sr." : u;
  }
  return w
    .toLowerCase()
    .split(/([-'])/)
    .map((part) =>
      part === "-" || part === "'"
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join("")
    .replace(/^Mc(\w)/, (_, c: string) => `Mc${c.toUpperCase()}`);
}

const DROP_TITLES = new Set([
  "DR", "MR", "MRS", "MS", "REV", "HON", "MISS",
  // Legislative and honorific titles some filers put in their own name
  // ("MARKEY, EDWARD SEN.", "INHOFE, JAMES M. SEN.").
  "SEN", "SENATOR", "REP", "CONGRESSMAN", "CONGRESSWOMAN", "GOV", "MAYOR", "SIR",
]);
const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "MD", "DDS"]);

// FEC stores "HINOJOSA, ALFREDO JR." — the suffix belongs after the surname,
// not between the given name and the surname ("Alfredo Jr. Hinojosa").
export function normalizeCandidateName(raw: string): string {
  const commaAt = raw.indexOf(",");
  const surnameRaw = commaAt === -1 ? "" : raw.slice(0, commaAt).trim();
  const givenRaw = commaAt === -1 ? raw.trim() : raw.slice(commaAt + 1).trim();
  const clean = (part: string) =>
    part
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/,+$/, ""))
      .filter((w) => !DROP_TITLES.has(w.toUpperCase().replace(/\./g, "")));
  const givenWords = clean(givenRaw);
  const surnameWords = clean(surnameRaw);
  const isSuffix = (w: string) => SUFFIXES.has(w.toUpperCase().replace(/\./g, ""));
  const suffixes = [...givenWords, ...surnameWords].filter(isSuffix);
  const given = givenWords.filter((w) => !isSuffix(w));
  const surname = surnameWords.filter((w) => !isSuffix(w));
  return [...given, ...surname, ...suffixes].map(titleWord).join(" ");
}
