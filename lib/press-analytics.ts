// Keyword extraction from press release titles — no AI, just frequency analysis

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "that", "this", "was", "are",
  "be", "has", "had", "have", "will", "would", "could", "should", "may",
  "can", "do", "does", "did", "been", "being", "its", "his", "her", "he",
  "she", "they", "them", "their", "our", "we", "us", "you", "your", "my",
  "as", "if", "not", "no", "so", "up", "out", "about", "into", "over",
  "after", "before", "between", "through", "during", "under", "above",
  "all", "each", "every", "both", "few", "more", "most", "other", "some",
  "such", "than", "too", "very", "just", "also", "now", "new", "one",
  "two", "first", "who", "which", "what", "when", "where", "how", "why",
  "rep", "sen", "senator", "representative", "congressman", "congresswoman",
  "statement", "announces", "announced", "press", "release", "says",
  "said", "joins", "introduces", "introduced", "supports", "support",
  "votes", "vote", "bill", "act", "legislation", "office", "today",
  "bipartisan", "calls", "urges", "applauds", "response",
]);

// Common 2-word phrases worth tracking
const PHRASE_PATTERNS = [
  "border security", "national security", "climate change", "gun violence",
  "health care", "healthcare", "mental health", "small business",
  "law enforcement", "public safety", "social security", "student loan",
  "tax cut", "tax relief", "minimum wage", "drug prices",
  "prescription drug", "child care", "childcare", "foreign aid",
  "national defense", "veterans affairs", "infrastructure bill",
  "supreme court", "federal funding", "government shutdown",
  "debt ceiling", "immigration reform", "election integrity",
  "voting rights", "civil rights", "human rights", "clean energy",
  "renewable energy", "fossil fuel", "water resources",
  "affordable housing", "food safety", "fentanyl", "opioid",
];

export interface KeywordResult {
  term: string;
  count: number;
  isPhrase: boolean;
}

export function extractKeywords(
  titles: string[],
  topN = 20
): KeywordResult[] {
  const phraseCount = new Map<string, number>();
  const wordCount = new Map<string, number>();

  for (const title of titles) {
    const lower = title.toLowerCase();

    // Check for known phrases
    for (const phrase of PHRASE_PATTERNS) {
      if (lower.includes(phrase)) {
        phraseCount.set(phrase, (phraseCount.get(phrase) || 0) + 1);
      }
    }

    // Count individual words
    const words = lower
      .replace(/[^a-z\s'-]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

    for (const word of words) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    }
  }

  // Combine phrases and words, phrases get priority
  const results: KeywordResult[] = [];

  for (const [term, count] of phraseCount) {
    if (count >= 1) {
      results.push({ term, count, isPhrase: true });
    }
  }

  for (const [term, count] of wordCount) {
    if (count >= 2) {
      // Don't include words that are part of already-counted phrases
      const inPhrase = results.some((r) => r.isPhrase && r.term.includes(term));
      if (!inPhrase) {
        results.push({ term, count, isPhrase: false });
      }
    }
  }

  return results
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export interface ActivityItem {
  date: string;
  type: "press" | "bill" | "vote";
  title: string;
  detail?: string;
  position?: string; // for votes: yea/nay
  relatedUrl?: string;
}

export function buildActivityTimeline(
  pressReleases: { title: string; publishedAt: Date | null; url: string }[],
  bills: {
    title: string;
    introducedDate: string | null;
    billType: string;
    billNumber: number;
    role: string;
  }[],
  votes: {
    voteDate: string;
    description: string | null;
    question: string | null;
    position: string;
    result: string | null;
  }[]
): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const pr of pressReleases) {
    if (!pr.publishedAt) continue;
    items.push({
      date: pr.publishedAt.toISOString().split("T")[0],
      type: "press",
      title: pr.title,
      relatedUrl: pr.url,
    });
  }

  for (const b of bills) {
    if (!b.introducedDate) continue;
    items.push({
      date: b.introducedDate,
      type: "bill",
      title: `${b.billType.toUpperCase()} ${b.billNumber}: ${b.title}`,
      detail: b.role,
    });
  }

  for (const v of votes) {
    items.push({
      date: v.voteDate,
      type: "vote",
      title: v.description || v.question || "Vote",
      position: v.position,
      detail: v.result || undefined,
    });
  }

  return items.sort((a, b) => b.date.localeCompare(a.date));
}
