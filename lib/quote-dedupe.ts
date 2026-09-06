// Repeat crawls quote overlapping spans of the same sentence: one run grabs
// "improving the welfare and quality of life for our veterans", the next grabs
// "committed to improving the welfare and quality of life for our veterans and
// their families". Exact-match dedupe keeps both. Containment dedupe keeps the
// longer passage, which carries the shorter one's meaning plus its context.

export function normalizeQuote(quote: string) {
  return quote
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9'"\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Two crawls often quote the same clause with different lead-ins: "Erin was a
// small business owner operating a communications firm" against "a small
// business owner operating a communications firm focused on ...". Neither
// contains the other, so plain containment keeps both. Dropping the subject
// and its auxiliary verb exposes the shared clause underneath.
const LEAD_IN = /^(?:[a-z.'-]+\s+){0,3}?\b(?:was|is|were|are|has|have|had|serves?|served|works?|worked)\b\s+/;

function quoteCore(normalized: string) {
  const stripped = normalized.replace(LEAD_IN, "");
  return stripped.length >= 12 ? stripped : normalized;
}

// Containment still misses restatements that differ by an interior word:
// "previously represented the 47th District" against "represented the 47th
// District". When nearly every word of the shorter quote already appears in a
// longer kept one, it is the same fact said twice.
const NEAR_DUPLICATE_RATIO = 0.9;
const MIN_TOKENS_FOR_RATIO = 6;

function isNearDuplicate(candidate: string, kept: string) {
  const candidateTokens = candidate.split(" ").filter(Boolean);
  if (candidateTokens.length < MIN_TOKENS_FOR_RATIO) return false;
  if (kept.split(" ").length < candidateTokens.length) return false;
  const keptTokens = new Set(kept.split(" "));
  const shared = candidateTokens.filter((token) => keptTokens.has(token)).length;
  return shared / candidateTokens.length >= NEAR_DUPLICATE_RATIO;
}

export function dedupeByQuote<T>(
  items: T[],
  getQuote: (item: T) => string,
  getGroup: (item: T) => string = () => ""
): T[] {
  const keptIndexes = new Set<number>();
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    const group = getGroup(item);
    const list = groups.get(group) ?? [];
    list.push(index);
    groups.set(group, list);
  });

  for (const indexes of groups.values()) {
    const ranked = [...indexes].sort(
      (a, b) => getQuote(items[b]).length - getQuote(items[a]).length
    );
    const keptNormalized: string[] = [];
    for (const index of ranked) {
      const normalized = normalizeQuote(getQuote(items[index]));
      // A bare fragment carries no attributable meaning on its own.
      if (normalized.length < 12) continue;
      const core = quoteCore(normalized);
      if (
        keptNormalized.some(
          (kept) =>
            kept.includes(normalized) ||
            kept.includes(core) ||
            isNearDuplicate(normalized, kept)
        )
      ) {
        continue;
      }
      keptNormalized.push(normalized);
      keptIndexes.add(index);
    }
  }

  // Restore the caller's original ordering so display stays stable.
  return items.filter((_, index) => keptIndexes.has(index));
}

// Loose containment: case-insensitive, punctuation and whitespace folded.
// "Public servant" is found in "As a public servant, ..."; "Made in America
// Office (MIAO)" is not found in "serving in government".
export function wordsAppearIn(needle: string, haystack: string) {
  const fold = (value: string) =>
    ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const n = fold(needle);
  return n.trim().length > 0 && fold(haystack).includes(n);
}
