const BASE_URL = "https://api.open.fec.gov/v1";

function getApiKey(): string {
  const key = process.env.FEC_API_KEY;
  if (!key) throw new Error("FEC_API_KEY is not set");
  return key;
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  async function attempt(i: number): Promise<Response> {
    const res = await fetch(url);
    if (res.ok) return res;
    if (res.status === 429) {
      if (i >= retries - 1) {
        throw new Error(`FEC API error: ${res.status} ${res.statusText} for ${url}`);
      }
      const wait = Math.pow(2, i + 1) * 1000;
      console.log(`  Rate limited, waiting ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      return attempt(i + 1);
    }
    if (i === retries - 1) {
      throw new Error(`FEC API error: ${res.status} ${res.statusText} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
    return attempt(i + 1);
  }
  return attempt(0);
}

export interface FECCandidateFinance {
  candidate_id: string;
  candidate_name: string;
  total_receipts: number;
  total_disbursements: number;
  cash_on_hand_end_period: number;
  total_individual_contributions: number;
  other_political_committee_contributions: number; // PAC money
  individual_unitemized_contributions: number; // small dollar (under $200)
  coverage_end_date: string;
  cycle: number;
}

export interface FECCommitteeContributor {
  committee_name: string;
  total: number;
  committee_id: string;
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
  let url = `${BASE_URL}/candidate/${candidateId}/totals?per_page=20&sort_null_only=false&api_key=${getApiKey()}`;
  if (cycle) url += `&cycle=${cycle}`;

  const res = await fetchWithRetry(url);
  const data = await res.json();
  return data.results || [];
}
