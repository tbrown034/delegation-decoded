import type Anthropic from "@anthropic-ai/sdk";
import {
  getMembersByState,
  getMemberRecentVotes,
  getMemberVoteSummary,
  getMemberFinance,
  getMemberTopContributors,
  getMemberBills,
  getMemberCommittees,
  getMemberTerms,
  findMembersByName,
} from "./queries";

// Tool surface for /api/ask. Every tool wraps a read query from lib/queries.ts
// so the model can only see data we already publish. Descriptions state WHEN
// to call each tool — recent Opus models under-trigger tools without that.

export const askTools: Anthropic.Tool[] = [
  {
    name: "find_member",
    description:
      "Call this to resolve ANY current member of Congress by name to their bioguide_id, state, party, chamber, and district — especially members outside the reader's delegation. Works on full names, last names, and partial fragments. Expand nicknames to real names before searching (AOC = Ocasio-Cortez, Bernie = Sanders). If a search returns nothing, retry once with a shorter fragment of the last name before concluding the member is not in the current Congress.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Member name or fragment, e.g. 'Ocasio-Cortez', 'Sanders', 'Pelosi'",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_delegation",
    description:
      "Call this when you need the roster of a state's congressional delegation: every current senator and representative with party, chamber, district, and bioguide_id. Use find_member instead when you have a person's name but not their state.",
    input_schema: {
      type: "object",
      properties: {
        state_code: {
          type: "string",
          description: "Two-letter state code, e.g. IN",
        },
      },
      required: ["state_code"],
    },
  },
  {
    name: "get_member_votes",
    description:
      "Call this when the question involves how a member voted: recent roll-call votes with the member's position (yea/nay), plus yea/nay/missed totals for the votes this site has ingested (the current 119th Congress, not the member's whole career). Source: House Clerk and Senate roll-call XML.",
    input_schema: {
      type: "object",
      properties: {
        bioguide_id: { type: "string" },
        limit: {
          type: "integer",
          description: "How many recent votes to return, default 10, max 25",
        },
      },
      required: ["bioguide_id"],
    },
  },
  {
    name: "get_member_finance",
    description:
      "Call this when the question involves campaign money: per-cycle total raised, individual vs PAC receipts, the small-dollar (under $200) dollar total, and top contributors by organization (each tagged with its cycle). Source: FEC campaign finance filings.",
    input_schema: {
      type: "object",
      properties: {
        bioguide_id: { type: "string" },
      },
      required: ["bioguide_id"],
    },
  },
  {
    name: "get_member_bills",
    description:
      "Call this when the question involves legislation a member sponsored or cosponsored: bill IDs, titles, policy areas, and latest action. Source: Congress.gov.",
    input_schema: {
      type: "object",
      properties: {
        bioguide_id: { type: "string" },
        limit: {
          type: "integer",
          description: "How many bills to return, default 10, max 25",
        },
      },
      required: ["bioguide_id"],
    },
  },
  {
    name: "get_member_terms",
    description:
      "Call this when the question involves how long a member has served, when their current term ends, or whether their seat is up for election in a given year. Returns every term with start and end dates. A Senate seat is on the November ballot in the year before its term's January end date; every House seat is up every two years.",
    input_schema: {
      type: "object",
      properties: {
        bioguide_id: { type: "string" },
      },
      required: ["bioguide_id"],
    },
  },
  {
    name: "get_member_committees",
    description:
      "Call this when the question involves committee assignments: which committees and subcommittees a member sits on and any leadership role.",
    input_schema: {
      type: "object",
      properties: {
        bioguide_id: { type: "string" },
      },
      required: ["bioguide_id"],
    },
  },
];

const clamp = (n: unknown, def: number, max: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.min(Math.max(v, 1), max);
};

const truncate = (s: string | null, len = 200) =>
  s && s.length > len ? `${s.slice(0, len)}...` : s;

export interface ToolTraceEntry {
  tool: string;
  input: Record<string, unknown>;
}

// Bioguide IDs are one letter + six digits. Anything else from the model is
// an invented parameter; fail it fast instead of running a doomed query.
const BIOGUIDE_RE = /^[A-Z][0-9]{6}$/;

export async function executeAskTool(
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const bioguideId =
    typeof input.bioguide_id === "string" ? input.bioguide_id.trim() : "";
  if ("bioguide_id" in input && !BIOGUIDE_RE.test(bioguideId)) {
    return {
      error: `Invalid bioguide_id "${bioguideId}". Use find_member or get_delegation to get a real one.`,
    };
  }

  switch (name) {
    case "find_member": {
      const q = typeof input.name === "string" ? input.name : "";
      const rows = await findMembersByName(q);
      return rows.map((m) => ({
        bioguide_id: m.bioguide_id,
        name: m.full_name,
        party: m.party,
        state: m.state_code,
        chamber: m.chamber,
        district: m.district,
      }));
    }
    case "get_delegation": {
      const stateCode =
        typeof input.state_code === "string" ? input.state_code.toUpperCase() : "";
      const rows = await getMembersByState(stateCode);
      return rows.map((m) => ({
        bioguide_id: m.bioguideId,
        name: m.fullName,
        party: m.party,
        chamber: m.chamber,
        district: m.district,
      }));
    }
    case "get_member_votes": {
      const limit = clamp(input.limit, 10, 25);
      const [summary, recent] = await Promise.all([
        getMemberVoteSummary(bioguideId),
        getMemberRecentVotes(bioguideId, limit),
      ]);
      return {
        totals: summary,
        recent_votes: recent.map((v) => ({
          date: v.voteDate,
          chamber: v.chamber,
          roll: v.rollNumber,
          question: truncate(v.question),
          description: truncate(v.description),
          result: v.result,
          tally: `${v.yeas}-${v.nays}`,
          member_position: v.position,
        })),
      };
    }
    case "get_member_finance": {
      const [finance, contributors] = await Promise.all([
        getMemberFinance(bioguideId),
        getMemberTopContributors(bioguideId),
      ]);
      return {
        by_cycle: finance.map((f) => ({
          cycle: f.electionCycle,
          total_receipts: f.totalReceipts,
          individual: f.totalIndividual,
          pac: f.totalPac,
          small_dollar: f.smallIndividual,
        })),
        top_contributors: contributors.map((c) => ({
          organization: c.contributorName,
          total: c.totalAmount,
          cycle: c.electionCycle,
        })),
      };
    }
    case "get_member_bills": {
      const limit = clamp(input.limit, 10, 25);
      const rows = await getMemberBills(bioguideId, limit);
      return rows.map((b) => ({
        bill_id: b.billId,
        label: `${b.billType.toUpperCase()} ${b.billNumber}`,
        title: truncate(b.title, 160),
        role: b.role,
        introduced: b.introducedDate,
        policy_area: b.policyArea,
        latest_action: truncate(b.latestActionText, 160),
      }));
    }
    case "get_member_terms": {
      const rows = await getMemberTerms(bioguideId);
      return rows.map((t) => ({
        chamber: t.chamber,
        state: t.stateCode,
        party: t.party,
        start: t.startDate,
        end: t.endDate,
        is_current: t.isCurrent,
      }));
    }
    case "get_member_committees": {
      const rows = await getMemberCommittees(bioguideId);
      return rows.map((c) => ({
        committee_id: c.committeeId,
        name: c.name,
        chamber: c.chamber,
        role: c.role,
        is_subcommittee: c.parentId != null,
      }));
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
