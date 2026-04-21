const BASE_URL = "https://api.open.fec.gov/v1";

function getApiKey(): string {
  const key = process.env.FEC_API_KEY;
  if (!key) throw new Error("FEC_API_KEY is not set");
  return key;
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url);
    if (res.ok) return res;
    if (res.status === 429) {
      const wait = Math.pow(2, i + 1) * 1000;
      console.log(`  Rate limited, waiting ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (i === retries - 1) {
      throw new Error(`FEC API error: ${res.status} ${res.statusText} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Unreachable");
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

/**
 * Search for a candidate by name and state to find their FEC ID.
 */
export async function searchCandidate(
  name: string,
  state: string
): Promise<
  {
    candidate_id: string;
    name: string;
    office: string;
    state: string;
    party: string;
    cycles: number[];
  }[]
> {
  const url = `${BASE_URL}/candidates/search?q=${encodeURIComponent(name)}&state=${state}&per_page=5&api_key=${getApiKey()}`;
  const res = await fetchWithRetry(url);
  const data = await res.json();
  return data.results || [];
}

/**
 * Fetch top committee contributors (PACs) for a candidate.
 */
export async function fetchTopContributors(
  candidateId: string,
  cycle?: number
): Promise<FECCommitteeContributor[]> {
  let url = `${BASE_URL}/schedules/schedule_a/by_contributor?candidate_id=${candidateId}&per_page=20&sort=-total&api_key=${getApiKey()}`;
  if (cycle) url += `&cycle=${cycle}`;

  try {
    const res = await fetchWithRetry(url);
    const data = await res.json();
    return (data.results || []).map(
      (r: { committee_name: string; total: number; committee_id: string }) => ({
        committee_name: r.committee_name,
        total: r.total,
        committee_id: r.committee_id,
      })
    );
  } catch {
    // This endpoint can be flaky for some candidates
    return [];
  }
}
