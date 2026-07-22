const BASE_URL = "https://api.congress.gov/v3";

function getApiKey(): string {
  const key = process.env.CONGRESS_API_KEY;
  if (!key) throw new Error("CONGRESS_API_KEY is not set");
  return key;
}

async function fetchWithRetry(url: string, retries = 4): Promise<Response> {
  async function attempt(i: number): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      // Network-level failure (socket close, DNS, TLS reset) — these
      // surface as thrown TypeErrors with UND_ERR_SOCKET causes from undici.
      // Treat them like 5xx and retry. Only the fetch itself is wrapped, so a
      // deliberate "give up" throw below propagates instead of being re-caught
      // and retried (which previously caused an exponential request cascade).
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000));
      return attempt(i + 1);
    }
    if (res.ok) return res;
    if (res.status === 429) {
      if (i >= retries - 1) {
        throw new Error(`Congress API error: ${res.status} ${res.statusText} for ${url}`);
      }
      const wait = Math.pow(2, i + 1) * 1000;
      console.log(`  Rate limited, waiting ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      return attempt(i + 1);
    }
    // Transient 5xx from upstream — retry with backoff.
    if (res.status >= 500 && res.status < 600 && i < retries - 1) {
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000));
      return attempt(i + 1);
    }
    if (i === retries - 1) {
      throw new Error(`Congress API error: ${res.status} ${res.statusText} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
    return attempt(i + 1);
  }
  return attempt(0);
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
 * If fromDateTime is provided, only returns bills updated after that date.
 * Sorted by updateDate descending so newest changes come first.
 */
export async function fetchBillsPage(
  congress: number,
  offset: number,
  limit: number = 250,
  fromDateTime?: string,
  sort: "updateDate+desc" | "updateDate+asc" = "updateDate+desc"
): Promise<{ bills: CongressBill[]; nextUrl?: string; total: number }> {
  let url = `${BASE_URL}/bill/${congress}?offset=${offset}&limit=${limit}&sort=${sort}&format=json&api_key=${getApiKey()}`;
  if (fromDateTime) {
    url += `&fromDateTime=${fromDateTime}`;
  }
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
