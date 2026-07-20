import { db } from "./db";
import { states } from "./schema";
import { sql } from "drizzle-orm";

export interface GeocodeResult {
  matchedAddress: string;
  stateCode: string;
  district: number | null;
}

export async function geocodeAddress(
  address: string
): Promise<GeocodeResult | null> {
  const url = new URL(
    "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress"
  );
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("layers", "all");
  url.searchParams.set("format", "json");

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  const json = await r.json();
  const match = json?.result?.addressMatches?.[0];
  if (!match) return null;

  const stateCode = match.addressComponents?.state ?? null;
  if (!stateCode) return null;

  const cdKey = Object.keys(match.geographies ?? {}).find((k) =>
    k.includes("Congressional Districts")
  );
  const cd = cdKey ? match.geographies[cdKey]?.[0] : null;
  const baseName = cd?.BASENAME ?? null;
  const district = baseName != null ? parseInt(baseName, 10) : null;

  return {
    matchedAddress: match.matchedAddress as string,
    stateCode,
    district: Number.isFinite(district) ? district : null,
  };
}

export interface ResolvedLocation {
  stateCode: string;
  stateName: string;
  district: number | null;
  matchedAddress: string | null;
}

// Accepts a state code ("IN"), a state name ("Indiana"), or a street address.
// State inputs resolve without leaving the server; addresses go to the Census
// geocoder.
export async function resolveLocation(
  q: string
): Promise<ResolvedLocation | null> {
  const trimmed = q.trim();
  if (!trimmed) return null;

  const stateRows = await db
    .select({ code: states.code, name: states.name })
    .from(states)
    .where(
      sql`upper(${states.code}) = upper(${trimmed}) or lower(${states.name}) = lower(${trimmed})`
    )
    .limit(1);

  if (stateRows.length > 0) {
    return {
      stateCode: stateRows[0].code,
      stateName: stateRows[0].name,
      district: null,
      matchedAddress: null,
    };
  }

  const geo = await geocodeAddress(trimmed);
  if (!geo) return null;

  const nameRows = await db
    .select({ name: states.name })
    .from(states)
    .where(sql`upper(${states.code}) = upper(${geo.stateCode})`)
    .limit(1);

  return {
    stateCode: geo.stateCode,
    stateName: nameRows[0]?.name ?? geo.stateCode,
    district: geo.district,
    matchedAddress: geo.matchedAddress,
  };
}
