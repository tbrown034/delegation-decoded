const BASE =
  "https://raw.githubusercontent.com/unitedstates/congress-legislators/gh-pages";

export interface USLegislator {
  id: {
    bioguide: string;
    thomas?: string;
    lis?: string;
    govtrack?: number;
    opensecrets?: string;
    fec?: string[];
    wikipedia?: string;
  };
  name: {
    first: string;
    last: string;
    official_full?: string;
    middle?: string;
    suffix?: string;
    nickname?: string;
  };
  bio: {
    birthday?: string;
    gender?: string;
  };
  terms: {
    type: "sen" | "rep";
    start: string;
    end: string;
    state: string;
    district?: number;
    party: string;
    url?: string;
    contact_form?: string;
    phone?: string;
  }[];
}

export interface USCommittee {
  type: "senate" | "house" | "joint";
  name: string;
  thomas_id: string;
  senate_committee_id?: string;
  house_committee_id?: string;
  url?: string;
  subcommittees?: {
    name: string;
    thomas_id: string;
  }[];
}

export interface USCommitteeMembership {
  [committeeId: string]: {
    name: string;
    bioguide: string;
    rank?: number;
    title?: string;
    party?: string;
  }[];
}

export interface USSocialMedia {
  id: {
    bioguide: string;
  };
  social: {
    twitter?: string;
    facebook?: string;
    youtube?: string;
    youtube_id?: string;
    instagram?: string;
  };
}

export async function fetchCurrentLegislators(): Promise<USLegislator[]> {
  const res = await fetch(`${BASE}/legislators-current.json`);
  if (!res.ok) throw new Error(`Failed to fetch legislators: ${res.status}`);
  return res.json();
}

export async function fetchCommittees(): Promise<USCommittee[]> {
  const res = await fetch(`${BASE}/committees-current.json`);
  if (!res.ok) throw new Error(`Failed to fetch committees: ${res.status}`);
  return res.json();
}

export async function fetchCommitteeMembership(): Promise<USCommitteeMembership> {
  const res = await fetch(`${BASE}/committee-membership-current.json`);
  if (!res.ok)
    throw new Error(`Failed to fetch committee membership: ${res.status}`);
  return res.json();
}

export async function fetchSocialMedia(): Promise<USSocialMedia[]> {
  const res = await fetch(`${BASE}/legislators-social-media.json`);
  if (!res.ok)
    throw new Error(`Failed to fetch social media: ${res.status}`);
  return res.json();
}

export function normalizeParty(party: string): string {
  const map: Record<string, string> = {
    Democrat: "Democrat",
    Republican: "Republican",
    Independent: "Independent",
    Libertarian: "Independent",
  };
  return map[party] || party;
}

export function chamberFromType(type: "sen" | "rep"): "senate" | "house" {
  return type === "sen" ? "senate" : "house";
}

export function photoUrl(bioguideId: string): string {
  // Use our own proxy route which tries @unitedstates then Congress.gov
  return `/api/photo/${bioguideId}`;
}
