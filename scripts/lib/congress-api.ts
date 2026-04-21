const BASE_URL = "https://api.congress.gov/v3";

function getApiKey(): string {
  const key = process.env.CONGRESS_API_KEY;
  if (!key) throw new Error("CONGRESS_API_KEY is not set");
  return key;
}

interface CongressResponse<T> {
  [key: string]: T | { next?: string; count?: number };
  pagination: { next?: string; count?: number };
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url);
    if (res.ok) return res;
    if (res.status === 429) {
      // Rate limited — back off
      const wait = Math.pow(2, i + 1) * 1000;
      console.log(`  Rate limited, waiting ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (i === retries - 1) {
      throw new Error(`Congress API error: ${res.status} ${res.statusText} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Unreachable");
}

export interface CongressBill {
  congress: number;
  number: string;
  type: string;
  title: string;
  originChamber: string;
  introducedDate?: string;
  updateDate?: string;
  latestAction?: {
    actionDate: string;
    text: string;
  };
  policyArea?: {
    name: string;
  };
  url: string;
}

export interface CongressBillDetail {
  bill: {
    congress: number;
    number: string;
    type: string;
    title: string;
    introducedDate: string;
    latestAction?: {
      actionDate: string;
      text: string;
    };
    policyArea?: {
      name: string;
    };
    sponsors: {
      bioguideId: string;
      fullName: string;
      party: string;
      state: string;
    }[];
    cosponsors?: {
      count: number;
      url: string;
    };
    legislationUrl?: string;
  };
}

export interface CongressCosponsor {
  bioguideId: string;
  fullName: string;
  party: string;
  state: string;
  sponsorshipDate?: string;
}

/**
 * Fetch a page of bills from the 119th Congress.
 */
export async function fetchBillsPage(
  congress: number,
  offset: number,
  limit: number = 250
): Promise<{ bills: CongressBill[]; nextUrl?: string; total: number }> {
  const url = `${BASE_URL}/bill/${congress}?offset=${offset}&limit=${limit}&format=json&api_key=${getApiKey()}`;
  const res = await fetchWithRetry(url);
  const data = await res.json();
  return {
    bills: data.bills || [],
    nextUrl: data.pagination?.next,
    total: data.pagination?.count || 0,
  };
}

/**
 * Fetch detail for a single bill (includes sponsors).
 */
export async function fetchBillDetail(
  congress: number,
  type: string,
  number: string
): Promise<CongressBillDetail> {
  const url = `${BASE_URL}/bill/${congress}/${type.toLowerCase()}/${number}?format=json&api_key=${getApiKey()}`;
  const res = await fetchWithRetry(url);
  return res.json();
}

/**
 * Fetch cosponsors for a bill.
 */
export async function fetchCosponsors(
  congress: number,
  type: string,
  number: string
): Promise<CongressCosponsor[]> {
  const all: CongressCosponsor[] = [];
  let url: string | null =
    `${BASE_URL}/bill/${congress}/${type.toLowerCase()}/${number}/cosponsors?limit=250&format=json&api_key=${getApiKey()}`;

  while (url) {
    const res = await fetchWithRetry(url);
    const data = await res.json();
    const cosponsors = data.cosponsors || [];
    all.push(...cosponsors);
    url = data.pagination?.next
      ? `${data.pagination.next}&api_key=${getApiKey()}`
      : null;
  }

  return all;
}

/**
 * Fetch bills sponsored by a specific member.
 */
export async function fetchMemberBills(
  bioguideId: string,
  offset = 0,
  limit = 250
): Promise<{ bills: CongressBill[]; total: number }> {
  const url = `${BASE_URL}/member/${bioguideId}/sponsored-legislation?offset=${offset}&limit=${limit}&format=json&api_key=${getApiKey()}`;
  const res = await fetchWithRetry(url);
  const data = await res.json();
  return {
    bills: data.sponsoredLegislation || [],
    total: data.pagination?.count || 0,
  };
}
