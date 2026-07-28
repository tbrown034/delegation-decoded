// Stands in for a headshot. Members have official photos; candidates from
// state ballot records and FEC filings have none, and inventing one is not an
// option. The party initial is drawn straight from the ballot record, so an
// unlabeled candidacy reads as a neutral dash rather than a guess.

type PartyMarkSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<PartyMarkSize, string> = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
};

type PartyStyle = { initial: string; label: string; tone: string };

// Muted to sit inside the site's neutral shell. Conventional party hues stay
// recognizable without turning a records page into a scoreboard.
const PARTY_STYLE: Record<string, PartyStyle> = {
  democratic: { initial: "D", label: "Democratic", tone: "border-blue-200 bg-blue-50 text-blue-800" },
  republican: { initial: "R", label: "Republican", tone: "border-red-200 bg-red-50 text-red-800" },
  libertarian: { initial: "L", label: "Libertarian", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  green: { initial: "G", label: "Green", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  independent: { initial: "I", label: "Independent", tone: "border-neutral-300 bg-neutral-100 text-neutral-700" },
};

// FEC reports full uppercase party names ("DEMOCRATIC PARTY"); state ballot
// records use short forms. Both normalize to the same style.
const PARTY_ALIASES: Record<string, keyof typeof PARTY_STYLE> = {
  d: "democratic",
  dem: "democratic",
  democrat: "democratic",
  "democratic party": "democratic",
  "democratic-farmer-labor": "democratic",
  "democratic-npl": "democratic",
  r: "republican",
  rep: "republican",
  gop: "republican",
  "republican party": "republican",
  l: "libertarian",
  lib: "libertarian",
  "libertarian party": "libertarian",
  g: "green",
  "green party": "green",
  i: "independent",
  ind: "independent",
  independence: "independent",
  "independent party": "independent",
  unaffiliated: "independent",
  "no party affiliation": "independent",
  nonpartisan: "independent",
};

// FEC's shouted party names read badly in running text.
export function partyDisplayName(party: string | null | undefined) {
  const raw = (party ?? "").trim();
  if (!raw) return "No party listed";
  if (raw !== raw.toUpperCase()) return raw;
  return raw
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

// State affiliates and FEC records spell the party out in many ways:
// "Republican Party of Florida", "DEMOCRATIC PARTY", "No Party Affiliation
// (Partisan)". Matching on the party word anywhere in the string handles all
// of them without enumerating every affiliate.
const PARTY_KEYWORDS: Array<[RegExp, keyof typeof PARTY_STYLE]> = [
  [/\b(no party affiliation|unaffiliated|nonpartisan|non-partisan|independent)\b/, "independent"],
  [/\bdemocratic|\bdemocrat\b/, "democratic"],
  [/\brepublican\b/, "republican"],
  [/\blibertarian\b/, "libertarian"],
  [/\bgreen party\b/, "green"],
];

export function partyStyleFor(party: string | null | undefined): PartyStyle {
  let raw = (party ?? "").trim().toLowerCase();
  for (const [pattern, key] of PARTY_KEYWORDS) {
    if (pattern.test(raw)) return PARTY_STYLE[key];
  }
  // Ballot records qualify the party rather than replacing it — "Write-In
  // (Independent)" is an independent, not a party whose initial is W.
  const qualified = raw.match(/\(([^)]+)\)/);
  if (qualified) raw = qualified[1].trim();
  raw = raw.replace(/^(write[- ]?in|qualified write[- ]?in)\b[\s,:-]*/, "").trim();
  if (!raw || raw === "other" || raw === "none" || raw === "n/a") {
    return { initial: "—", label: "No party listed", tone: "border-neutral-200 bg-neutral-50 text-neutral-400" };
  }
  const key = PARTY_ALIASES[raw] ?? (raw in PARTY_STYLE ? (raw as keyof typeof PARTY_STYLE) : null);
  if (key) return PARTY_STYLE[key];
  // An unrecognized minor party still gets its own initial rather than being
  // flattened into "independent", which would misstate the ballot line.
  return {
    initial: raw[0].toUpperCase(),
    label: party as string,
    tone: "border-neutral-300 bg-neutral-100 text-neutral-700",
  };
}

export function PartyMark({
  party,
  size = "md",
}: {
  party: string | null | undefined;
  size?: PartyMarkSize;
}) {
  const style = partyStyleFor(party);
  return (
    <span
      title={style.label}
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-mono font-semibold ${SIZE_CLASS[size]} ${style.tone}`}
    >
      {style.initial}
    </span>
  );
}
