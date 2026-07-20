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
  getRaceCandidates,
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
    name: "get_race_candidates",
    description:
      "Call this when the question involves who is RUNNING in a 2026 congressional race: everyone who has filed FEC candidacy paperwork (Form 2) for a given seat, with party, incumbent/challenger status, and money raised. This is a FILING list from the FEC, not the ballot — state deadlines and primaries decide the ballot, and this data does not include primary results. For Senate races, first confirm the seat is even up in 2026 via get_member_terms.",
    input_schema: {
      type: "object",
      properties: {
        state_code: {
          type: "string",
          description: "Two-letter state code, e.g. SC",
        },
        office: {
          type: "string",
          enum: ["H", "S"],
          description: "H for a House district race, S for a Senate race",
        },
        district: {
          type: "integer",
          description:
            "House district number (0 for at-large). Omit for Senate races.",
        },
      },
      required: ["state_code", "office"],
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
    case "get_race_candidates": {
      const stateCode =
        typeof input.state_code === "string" ? input.state_code.toUpperCase() : "";
      const office = input.office === "S" ? "S" : "H";
      const district =
        typeof input.district === "number" && Number.isInteger(input.district)
          ? input.district
          : null;
      const [result, delegation] = await Promise.all([
        getRaceCandidates(stateCode, office, district),
        getMembersByState(stateCode),
      ]);
      if (!result.hasData) {
        return {
          error:
            "Candidate data has not been ingested yet. Do NOT say nobody is running — say this site's candidate data is not loaded and point the reader to fec.gov.",
        };
      }
      // FEC filings outlive the filer: a member who died or resigned after
      // filing still shows as the race's incumbent (Lindsey Graham, July
      // 2026). Cross-check "incumbent" filers against who actually sits in
      // the seat today, by FEC id first and first-initial + last name second
      // (initials survive Tim/Timothy nicknames).
      const sitting = delegation.filter((m) =>
        office === "S"
          ? m.chamber === "senate"
          : m.chamber === "house" &&
            (district == null || m.district === district)
      );
      const sittingFecIds = new Set(
        sitting.map((m) => m.fecCandidateId).filter(Boolean)
      );
      const sittingNameKeys = new Set(
        sitting.map(
          (m) =>
            `${m.firstName?.[0]?.toLowerCase() ?? ""}|${m.lastName?.toLowerCase() ?? ""}`
        )
      );
      const isSitting = (c: { candidate_id: string; name: string }) => {
        if (sittingFecIds.has(c.candidate_id)) return true;
        const parts = c.name.trim().split(/\s+/);
        if (parts.length < 2) return false;
        const key = `${parts[0][0].toLowerCase()}|${parts[parts.length - 1].toLowerCase()}`;
        return sittingNameKeys.has(key);
      };
      return {
        note: "FEC filings, not the ballot. Primaries may have already narrowed this list; this data has no primary results.",
        current_officeholders: sitting.map((m) => m.fullName),
        candidates: result.candidates.map((c) => ({
          name: c.name,
          party: c.party,
          status:
            c.incumbent_challenge === "I"
              ? isSitting(c)
                ? "incumbent"
                : "filed as incumbent but NO LONGER IN OFFICE (died or resigned after filing)"
              : c.incumbent_challenge === "O"
                ? "open-seat candidate"
                : "challenger",
          total_raised: c.total_receipts,
          first_filed: c.first_file_date,
          fec_candidate_id: c.candidate_id,
        })),
      };
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
