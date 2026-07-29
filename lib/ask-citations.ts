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
// c campaign biography, s prior service, o official member biography,
// d current-roster entries (get_delegation / find_members).
const MARKER_RE = /\s*\[([a-z]\d{1,3})\]/gi;

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
      return { ref, ...rec };
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
      const campaignBiography = Array.isArray(rec.campaign_biography)
        ? (rec.campaign_biography as unknown[]).map((fact) => {
            if (!fact || typeof fact !== "object") return fact;
            const record = fact as Rec;
            const ref = registry.register(
              "c",
              tool,
              `${name} campaign-site biography statement`,
              href
            );
            return { ref, ...record };
          })
        : rec.campaign_biography;
      const priorService = Array.isArray(rec.verified_prior_service)
        ? (rec.verified_prior_service as unknown[]).map((service) => {
            if (!service || typeof service !== "object") return service;
            const record = service as Rec;
            const ref = registry.register(
              "s",
              tool,
              `${name} prior-service record: ${asString(record.office)}`,
              href
            );
            return { ref, ...record };
          })
        : rec.verified_prior_service;
      return {
        ref: candidateRef,
        ...rec,
        campaign_biography: campaignBiography,
        verified_prior_service: priorService,
      };
    });
  };

  switch (tool) {
    case "get_member_votes":
      annotate("records", (rec) => ({
        prefix: "v",
        label: `Roll call ${asString(rec.roll)} (${asString(rec.chamber)}), ${asString(rec.date)}`,
        href: memberHref,
      }));
      break;
    case "get_member_bills":
      annotate("records", (rec) => ({
        prefix: "b",
        label: `${asString(rec.label)}, introduced ${asString(rec.introduced)}`,
        href:
          typeof rec.bill_id === "string" && BILL_ID_RE.test(rec.bill_id)
            ? `/bill/${rec.bill_id}`
            : memberHref,
      }));
      break;
    case "get_member_finance":
      annotate("by_cycle", (rec) => ({
        prefix: "f",
        label: `FEC totals, ${asString(rec.cycle)} cycle`,
        href: memberHref,
      }));
      annotate("top_contributors", (rec) => ({
        prefix: "e",
        label: `Contributions via ${asString(rec.organization)}, ${asString(rec.cycle)} cycle (FEC Schedule A, by donor employer)`,
        href: memberHref,
      }));
      annotate("committees", (rec) => ({
        prefix: "p",
        label: `${asString(rec.name)} (${asString(rec.kind)}), FEC filings`,
        href: memberHref,
      }));
      break;
    case "get_member_committees":
      annotate("records", (rec) => ({
        prefix: "m",
        label: `${asString(rec.name)} assignment (${asString(rec.role)})`,
        href: memberHref,
      }));
      break;
    case "get_member_terms":
      annotate("records", (rec) => ({
        prefix: "t",
        label: `Term record, ${asString(rec.start)} to ${asString(rec.end) || "present"}`,
        href: memberHref,
      }));
      break;
    case "get_member_biography":
      annotate("records", (rec) => ({
        prefix: "o",
        label: `Official-site biography statement: ${asString(rec.fact)}`,
        href: memberHref,
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

// Validates and renumbers markers. Unknown markers are stripped (same
// fail-soft posture as sanitizeAnswerLinks); an answer with zero surviving
// markers degrades to the tool-level footer, never to a failed request.
export function resolveCitations(
  answer: string,
  registry: EvidenceRegistry
): { answer: string; citations: Citation[] } {
  const citations: Citation[] = [];
  const numbered = new Map<string, number>();
  const resolved = answer.replace(MARKER_RE, (whole, ref: string) => {
    const normalizedRef = ref.toLowerCase();
    const record = registry.get(normalizedRef);
    if (!record) return "";
    let n = numbered.get(normalizedRef);
    if (n == null) {
      n = citations.length + 1;
      numbered.set(normalizedRef, n);
      citations.push({
        n,
        ref,
        tool: record.tool,
        label: record.label,
        href: record.href,
      });
    }
    const spacer = whole.startsWith(" ") ? " " : "";
    return `${spacer}[${n}]`;
  });
  return {
    answer: resolved.replace(/ ([.,;:])/g, "$1").replace(/ {2,}/g, " "),
    citations,
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
    case "get_member_committees":
      return id && BIOGUIDE_RE.test(id) ? `/member/${id}` : null;
    default:
      return null;
  }
}
