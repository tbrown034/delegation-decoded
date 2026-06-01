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
