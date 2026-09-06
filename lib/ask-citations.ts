// Claim-level citations for /ask. The engine annotates every record it hands
// the model with a short ref ("v1", "f2"...). The model appends those refs in
// square brackets after the claims they support. The server then validates
// each marker against the registry — markers it never issued are stripped,
// surviving ones are renumbered [1]..[n] — so a citation can exist only for a
// record that was actually retrieved this run. No second model call.

import type { ToolTraceEntry } from "./ask-tools";

export interface Citation {
  n: number;
  ref: string;
  tool: string;
  label: string;
  href: string | null;
}

interface EvidenceRecord {
  ref: string;
  tool: string;
  label: string;
  href: string | null;
}

// Ref prefixes: v votes, b bills, f finance cycles, e employer contributors,
// p finance committees (PACs), m assignments, t terms, r race candidates,
// c campaign biography, q campaign stated positions, s prior service,
// o official member biography,
// d current-roster entries (get_delegation / find_members).
const MARKER_RE = /\s*\[([a-z]?\d+)\]/gi;

export class EvidenceRegistry {
  private records = new Map<string, EvidenceRecord>();
  private counters = new Map<string, number>();

  register(prefix: string, tool: string, label: string, href: string | null): string {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    const ref = `${prefix}${next}`;
    this.records.set(ref, { ref, tool, label, href });
    return ref;
  }

  fork(): EvidenceRegistry {
    const copy = new EvidenceRegistry();
    copy.records = new Map(this.records);
    copy.counters = new Map(this.counters);
    return copy;
  }

  adopt(other: EvidenceRegistry): void {
    this.records = new Map(other.records);
    this.counters = new Map(other.counters);
  }

  get(ref: string): EvidenceRecord | undefined {
    return this.records.get(ref);
  }
}

const BIOGUIDE_RE = /^[A-Z][0-9]{6}$/;
const STATE_RE = /^[A-Z]{2}$/;
const BILL_ID_RE = /^[a-z]+-\d+-\d+$/;
const CONTEST_ID_RE = /^20\d{2}-[A-Z]{2}-(?:H\d+|S[123])(?:-special)?$/;

type Rec = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

// Quote-bearing records cite a verbatim passage, which is far longer than the
// identifier-style labels the other tools produce. Trim to keep the source
// list scannable; the href still lands the reader on the full passage.
function snippet(value: unknown, len = 80): string {
  const text = asString(value).replace(/\s+/g, " ").trim();
  return text.length > len ? `${text.slice(0, len).trimEnd()}...` : text;
}

// Walks a successful tool result and injects a ref into each record the model
// might cite. Mutation is deliberate: the annotated object is what gets
// serialized into the tool payload, so the model sees the refs.
export function annotateToolResult(
  tool: string,
  input: Rec,
  result: unknown,
  registry: EvidenceRegistry
): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const r = result as Rec;
  if ("error" in r) return result;

  const bioguide =
    typeof input.bioguide_id === "string" ? input.bioguide_id.trim().toUpperCase() : "";
  const memberHref = BIOGUIDE_RE.test(bioguide) ? `/member/${bioguide}` : null;
  // Citations land on the member-page section that holds the record, so the
  // link is meaningful even when the reader is already on that member's page.
  const memberSection = (fragment: string) =>
    memberHref ? `${memberHref}#${fragment}` : null;
  const state =
    typeof input.state_code === "string" ? input.state_code.trim().toUpperCase() : "";
  const stateHref = STATE_RE.test(state) ? `/state/${state}` : null;

  const annotate = (key: string, make: (rec: Rec) => { prefix: string; label: string; href: string | null }) => {
    if (!Array.isArray(r[key])) return;
    r[key] = (r[key] as unknown[]).map((item) => {
      if (!item || typeof item !== "object") return item;
      const rec = item as Rec;
      const { prefix, label, href } = make(rec);
      const ref = registry.register(prefix, tool, label, href);
      return { ...rec, ref };
    });
  };

  const annotateRaceRecords = (container: Rec) => {
    if (!Array.isArray(container.records)) return;
    const contestId = asString(container.contest_id);
    const href = CONTEST_ID_RE.test(contestId)
      ? `/race/${contestId}`
      : stateHref;
    container.records = (container.records as unknown[]).map((item) => {
      if (!item || typeof item !== "object") return item;
      const rec = item as Rec;
      const name = asString(rec.name);
      const candidateRef = registry.register(
        "r",
        tool,
        `${name}, ${asString(rec.status)} (${asString(container.source)})`,
        href
      );
      // Every quote the model receives needs a ref, or the prompt's
      // "use only refs that appear in tool results" rule leaves the claim
      // uncitable. These key names must track raceToolPayload exactly.
      const annotateQuotes = (
        value: unknown,
        prefix: string,
        describe: (record: Rec) => string
      ) =>
        Array.isArray(value)
          ? (value as unknown[]).map((item) => {
              if (!item || typeof item !== "object") return item;
              const record = item as Rec;
              const ref = registry.register(prefix, tool, describe(record), href);
              return { ...record, ref };
            })
          : value;

      const campaignBiography = annotateQuotes(
        rec.campaign_biography,
        "c",
        () => `${name} campaign-site biography statement`
      );
      const campaignPositions = annotateQuotes(
        rec.campaign_stated_positions,
        "q",
        (record) =>
          `${name} campaign-site stated position: "${snippet(record.quote)}"`
      );
      const priorService = annotateQuotes(
        rec.prior_service_stated_by_campaign,
        "s",
        (record) =>
          `${name} prior service stated by campaign: ${asString(record.office)}`
      );
      return {
        ...rec,
        ref: candidateRef,
        campaign_biography: campaignBiography,
        campaign_stated_positions: campaignPositions,
        prior_service_stated_by_campaign: priorService,
      };
    });
  };

  switch (tool) {
    case "get_member_votes":
      annotate("records", (rec) => ({
        prefix: "v",
        label: `Roll call ${asString(rec.roll)} (${asString(rec.chamber)}), ${asString(rec.date)}`,
        href: memberSection("votes"),
      }));
      break;
    case "get_member_bills":
      annotate("records", (rec) => ({
        prefix: "b",
        label: `${asString(rec.label)}, introduced ${asString(rec.introduced)}`,
        href:
          typeof rec.bill_id === "string" && BILL_ID_RE.test(rec.bill_id)
            ? `/bill/${rec.bill_id}`
            : memberSection("legislation"),
      }));
      break;
    case "get_member_finance":
      annotate("by_cycle", (rec) => ({
        prefix: "f",
        label: `FEC totals, ${asString(rec.cycle)} cycle`,
        href: memberSection("finance"),
      }));
      annotate("top_contributors", (rec) => ({
        prefix: "e",
        label: `Contributions via ${asString(rec.organization)}, ${asString(rec.cycle)} cycle (FEC Schedule A, by donor employer)`,
        href: memberSection("contributors"),
      }));
      annotate("committees", (rec) => ({
        prefix: "p",
        label: `${asString(rec.name)} (${asString(rec.kind)}), FEC filings`,
        href: memberSection("finance"),
      }));
      break;
    case "get_member_committees":
      annotate("records", (rec) => ({
        prefix: "m",
        label: `${asString(rec.name)} assignment (${asString(rec.role)})`,
        href: memberSection("committees"),
      }));
      break;
    case "get_member_terms":
      annotate("records", (rec) => ({
        prefix: "t",
        label: `Term record, ${asString(rec.start)} to ${asString(rec.end) || "present"}`,
        href: memberSection("terms"),
      }));
      break;
    case "get_member_biography":
      // The record carries fact_type + quote (the tool stopped emitting a
      // `fact` field when biographies moved to verbatim passages); reading the
      // old key rendered every one of these citations as an empty label.
      annotate("records", (rec) => ({
        prefix: "o",
        label: `Official-site biography (${asString(rec.fact_type) || "other"}): "${snippet(rec.quote)}"`,
        href: memberSection("biography"),
      }));
      break;
    case "get_delegation":
    case "find_members":
      // Without refs on roster records the model improvises bracket labels
      // like "[current member roster]" (the sweep surfaced this). Real refs
      // give roster answers validated citations like every other record.
      annotate("records", (rec) => ({
        prefix: "d",
        label: `${asString(rec.name)}, current member roster`,
        href:
          typeof rec.bioguide_id === "string" && BIOGUIDE_RE.test(rec.bioguide_id)
            ? `/member/${rec.bioguide_id}`
            : stateHref,
      }));
      break;
    case "get_race_candidates":
      annotateRaceRecords(r);
      if (Array.isArray(r.contests)) {
        for (const contest of r.contests as unknown[]) {
          if (contest && typeof contest === "object") {
            annotateRaceRecords(contest as Rec);
          }
        }
      }
      break;
  }
  return r;
}

// Keep complete JSON records within the tool budget. Only commit citation
// references for the payload actually sent to the model, never discarded rows.
export function prepareToolPayload(
  tool: string,
  input: Rec,
  result: unknown,
  registry: EvidenceRegistry,
  maxChars: number
): string {
  const candidate = JSON.parse(JSON.stringify(result)) as unknown;
  for (;;) {
    const trial = registry.fork();
    const annotated = annotateToolResult(tool, input, structuredClone(candidate), trial);
    const payload = JSON.stringify(annotated);
    if (payload.length <= maxChars) {
      registry.adopt(trial);
      return payload;
    }
    // Drop whole trailing records from the largest array, then re-annotate.
    // Counts of all matches remain intact; showing follows retained records.
    const arrays: unknown[][] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        if (value.length > 0) arrays.push(value);
        for (const child of value) visit(child);
      } else if (value && typeof value === "object") {
        for (const child of Object.values(value)) visit(child);
      }
    };
    visit(candidate);
    arrays.sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length);
    if (!arrays[0]) {
      return JSON.stringify({ error: "The record exceeded the lookup size limit. Do not infer an answer from it." });
    }
    arrays[0].pop();
    const updateCounts = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const rec = value as Rec;
      if (Array.isArray(rec.records) && "showing" in rec) rec.showing = rec.records.length;
      for (const child of Object.values(value)) updateCounts(child);
    };
    updateCounts(candidate);
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      (candidate as Rec).truncation_note = "Some records were omitted to fit the lookup limit. This is a partial result.";
    }
  }
}

// Resolves markers and reports unknown references to the engine. The engine
// rejects unknown references and answered responses without a valid citation.
export function resolveCitations(
  answer: string,
  registry: EvidenceRegistry
): { answer: string; citations: Citation[]; unknownRefs: string[] } {
  const citations: Citation[] = [];
  const unknownRefs = new Set<string>();
  const numbered = new Map<string, number>();
  // Normalize lists/ranges before numbering, validating every expanded ref.
  // Citation-looking labels that cannot be parsed remain an explicit error.
  const expanded = answer.replace(/\[([^\]\n]+)\](?!\()/g, (whole, group: string) => {
    if (!/^(?:[a-z]?\d|ref\s|source\s*:)/i.test(group.trim())) return whole;
    const refs: string[] = [];
    const parts = group.trim().replace(/^ref\s+/i, "").split(/[\s,;]+/);
    for (const part of parts) {
      const range = /^([a-z])(\d+)[-–]([a-z]?)(\d+)$/i.exec(part);
      if (range) {
        const [, prefix, start, endPrefix, end] = range;
        if ((endPrefix && prefix.toLowerCase() !== endPrefix.toLowerCase()) || Number(end) < Number(start) || Number(end) - Number(start) > 100) {
          unknownRefs.add(group);
          return "";
        }
        for (let n = Number(start); n <= Number(end); n++) refs.push(`${prefix}${n}`);
      } else if (/^[a-z]?\d+$/i.test(part)) {
        refs.push(part);
      } else {
        unknownRefs.add(group);
        return "";
      }
    }
    return refs.map(ref => `[${ref}]`).join("");
  });
  const resolved = expanded.replace(MARKER_RE, (whole, ref: string) => {
    const normalizedRef = ref.toLowerCase();
    const record = registry.get(normalizedRef);
    if (!record) {
      unknownRefs.add(normalizedRef);
      return "";
    }
    let n = numbered.get(normalizedRef);
    if (n == null) {
      n = citations.length + 1;
      numbered.set(normalizedRef, n);
      citations.push({ n, ref, tool: record.tool, label: record.label, href: record.href });
    }
    const spacer = whole.startsWith(" ") ? " " : "";
    return `${spacer}[${n}]`;
  });
  return {
    answer: resolved.replace(/ ([.,;:])/g, "$1").replace(/ {2,}/g, " "),
    citations,
    unknownRefs: [...unknownRefs],
  };
}

// Share of answer sentences that carry a resolved citation marker ([1]..[n],
// already validated against the registry). A grounding health signal, not a
// gate: boundary answers ("that's outside this page's scope") legitimately
// carry none, so coverage is logged and monitored rather than enforced.
export function citationCoverage(answer: string): number | null {
  // A run of adjacent markers ("[1] [2]") supports one claim, so count runs.
  const markerRuns = (answer.match(/(?:\s*\[\d{1,3}\])+/g) ?? []).length;
  const sentences = answer
    .replace(/\s*\[\d{1,3}\]/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
  if (sentences.length === 0) return null;
  return Math.min(1, Math.round((markerRuns / sentences.length) * 100) / 100);
}

// The "Checked:" footer's link targets, shared with the client so the server
// (citations) and client (footer) agree on where a tool's data lives.
export function traceEntryHref(entry: ToolTraceEntry): string | null {
  const id =
    typeof entry.input.bioguide_id === "string" ? entry.input.bioguide_id : null;
  const st =
    typeof entry.input.state_code === "string"
      ? entry.input.state_code.toUpperCase()
      : null;
  switch (entry.tool) {
    case "get_delegation":
    case "get_race_candidates":
      return st && STATE_RE.test(st) ? `/state/${st}` : null;
    case "get_member_votes":
    case "get_member_finance":
    case "get_member_bills":
    case "get_member_terms":
    case "get_member_biography":
    case "get_member_committees": {
      if (!id || !BIOGUIDE_RE.test(id)) return null;
      const section: Record<string, string> = {
        get_member_votes: "votes",
        get_member_finance: "finance",
        get_member_bills: "legislation",
        get_member_terms: "terms",
        get_member_biography: "biography",
        get_member_committees: "committees",
      };
      return `/member/${id}#${section[entry.tool]}`;
    }
    default:
      return null;
  }
}
