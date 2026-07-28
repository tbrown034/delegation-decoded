const BASE_URL = "https://api.open.fec.gov/v1";

function getApiKey(): string {
  const key = process.env.FEC_API_KEY;
  if (!key) throw new Error("FEC_API_KEY is not set");
  return key;
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  const safeUrl = (() => {
    const parsed = new URL(url);
    if (parsed.searchParams.has("api_key")) parsed.searchParams.set("api_key", "REDACTED");
    return parsed.toString();
  })();
  async function attempt(i: number): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { "User-Agent": "DelegationDecodedFECIngest/1.0" },
      });
    } catch (error) {
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, i) * 1000));
        return attempt(i + 1);
      }
      throw new Error(`FEC API request failed for ${safeUrl}`, { cause: error });
    }
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      if (i >= retries - 1) {
        throw new Error(`FEC API error: ${res.status} ${res.statusText} for ${safeUrl}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : Math.pow(2, i + 1) * 1000;
      console.log(`  FEC API ${res.status}; retrying in ${wait}ms...`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      return attempt(i + 1);
    }
    throw new Error(`FEC API error: ${res.status} ${res.statusText} for ${safeUrl}`);
  }
  return attempt(0);
}

// Field names here must match /candidate/{id}/totals exactly. Four of them
// previously carried a `total_` prefix the endpoint does not use, so every read
// was undefined and the `|| 0` in finance.ts wrote a zero — the whole
// campaign_finance table came out zeroed. Verify against a live response before
// renaming any of these.
export interface FECCandidateFinance {
  candidate_id: string;
  candidate_name: string;
  receipts: number;
  disbursements: number;
  last_cash_on_hand_end_period: number;
  individual_contributions: number;
  other_political_committee_contributions: number; // PAC money
  individual_unitemized_contributions: number; // small dollar (under $200)
  coverage_end_date: string;
  cycle: number;
}

export interface FECCommittee {
  committee_id: string;
  name: string;
  designation: string | null; // P principal, A authorized, D leadership PAC, J joint
  committee_type: string | null;
  cycles: number[] | null;
  website: string | null;
}

export interface FECCommitteeTotals {
  cycle: number;
  receipts: number | null;
  disbursements: number | null;
  last_cash_on_hand_end_period: number | null;
}

export interface FECEmployerTotal {
  employer: string | null;
  total: number | null;
}

export interface FECCandidate {
  candidate_id: string;
  name: string;
  party: string | null;
  party_full: string | null;
  office: string;
  state: string;
  district: string | null;
  incumbent_challenge: string | null;
  candidate_status: string | null;
  has_raised_funds: boolean | null;
  first_file_date: string | null;
  last_file_date: string | null;
  load_date: string | null;
}

async function fetchAllPages<T>(baseUrl: string): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  let pages = 1;
  do {
    const res = await fetchWithRetry(`${baseUrl}&page=${page}`);
    const data = await res.json();
    out.push(...(data.results || []));
    pages = data.pagination?.pages ?? 1;
    page += 1;
    if (page <= pages) await new Promise((r) => setTimeout(r, 300));
  } while (page <= pages);
  return out;
}

/**
 * Fetch statutory candidates (Form 2 filers past the $5k threshold who have
 * actually raised funds) for one office and election year. This is the
 * standard newsroom cut; paper filers and rolled-forward prior-cycle records
 * are excluded by candidate_status=C + has_raised_funds=true.
 */
export async function fetchCandidates(
  electionYear: number,
  office: "H" | "S"
): Promise<FECCandidate[]> {
  const url =
    `${BASE_URL}/candidates/?election_year=${electionYear}&office=${office}` +
    `&candidate_status=C&has_raised_funds=true&per_page=100&sort=name&api_key=${getApiKey()}`;
  return fetchAllPages<FECCandidate>(url);
}

/**
 * Fetch per-candidate financial totals for one office and election year, for
 * joining receipts onto the candidate list without a request per candidate.
 */
export async function fetchCandidateTotals(
  electionYear: number,
  office: "H" | "S"
): Promise<Map<string, number>> {
  const url =
    `${BASE_URL}/candidates/totals/?election_year=${electionYear}&office=${office}` +
    `&is_active_candidate=true&per_page=100&api_key=${getApiKey()}`;
  const rows = await fetchAllPages<{ candidate_id: string; receipts: number | null }>(url);
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.candidate_id && typeof r.receipts === "number") {
      map.set(r.candidate_id, Math.round(r.receipts));
    }
  }
  return map;
}

/**
 * Fetch candidate financial totals by FEC candidate ID.
 */
export async function fetchCandidateFinancials(
  candidateId: string,
  cycle?: number
): Promise<FECCandidateFinance[]> {
  // Must paginate. The response mixes null-cycle aggregate rows in with the
  // per-cycle ones, so a long-serving member overflows one page — David Scott
  // returns 26 rows across 2 pages, and reading only page 1 silently dropped
  // every cycle at or before 2012.
  let url = `${BASE_URL}/candidate/${candidateId}/totals?per_page=100&sort_null_only=false&api_key=${getApiKey()}`;
  if (cycle) url += `&cycle=${cycle}`;

  return fetchAllPages<FECCandidateFinance>(url);
}

/**
 * Fetch every committee linked to a candidacy: principal campaign committee,
 * other authorized committees, leadership PACs, joint fundraising committees.
 */
export async function fetchCandidateCommittees(
  candidateId: string
): Promise<FECCommittee[]> {
  const url = `${BASE_URL}/candidate/${candidateId}/committees/?per_page=100&api_key=${getApiKey()}`;
  return fetchAllPages<FECCommittee>(url);
}

/**
 * Fetch per-cycle financial totals for one committee.
 */
export async function fetchCommitteeTotals(
  committeeId: string
): Promise<FECCommitteeTotals[]> {
  const url = `${BASE_URL}/committee/${committeeId}/totals/?per_page=100&api_key=${getApiKey()}`;
  return fetchAllPages<FECCommitteeTotals>(url);
}

/**
 * Fetch a committee's individual contributions aggregated by donor employer
 * for one cycle — the standard "top contributors" cut for Schedule A data.
 */
export async function fetchTopContributorsByEmployer(
  committeeId: string,
  cycle: number,
  perPage = 20
): Promise<FECEmployerTotal[]> {
  const url =
    `${BASE_URL}/schedules/schedule_a/by_employer/?committee_id=${committeeId}` +
    `&cycle=${cycle}&sort=-total&per_page=${perPage}&api_key=${getApiKey()}`;
  const res = await fetchWithRetry(url);
  const data = await res.json();
  return data.results || [];
}
