import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { members, states } from "@/lib/schema";
import { and, eq, or } from "drizzle-orm";

export const metadata: Metadata = {
  title: "Find your delegation — Delegation Decoded",
  description:
    "Enter your address to see your two senators and your representative.",
};

interface GeocodeResult {
  matchedAddress: string;
  stateCode: string;
  district: number | null;
}

async function geocode(address: string): Promise<GeocodeResult | null> {
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

async function lookupDelegation(stateCode: string, district: number | null) {
  const [stateRow] = await db
    .select({ name: states.name })
    .from(states)
    .where(eq(states.code, stateCode));

  const senators = await db
    .select({
      bioguideId: members.bioguideId,
      fullName: members.fullName,
      party: members.party,
      photoUrl: members.photoUrl,
    })
    .from(members)
    .where(
      and(
        eq(members.stateCode, stateCode),
        eq(members.chamber, "senate"),
        eq(members.inOffice, true)
      )
    )
    .orderBy(members.lastName);

  // For at-large states (district=0), Census may return "1" or "0" — try both.
  const repCandidates =
    district == null
      ? []
      : await db
          .select({
            bioguideId: members.bioguideId,
            fullName: members.fullName,
            party: members.party,
            district: members.district,
            photoUrl: members.photoUrl,
          })
          .from(members)
          .where(
            and(
              eq(members.stateCode, stateCode),
              eq(members.chamber, "house"),
              eq(members.inOffice, true),
              or(eq(members.district, district), eq(members.district, 0))
            )
          );

  // Prefer the exact district match; fall back to at-large (district=0).
  const rep =
    repCandidates.find((m) => m.district === district) ??
    repCandidates.find((m) => m.district === 0) ??
    null;

  return {
    stateName: stateRow?.name ?? stateCode,
    senators,
    rep,
  };
}

const partyColor = (party: string) =>
  party === "Democrat"
    ? "text-blue-700 dark:text-blue-400"
    : party === "Republican"
      ? "text-red-700 dark:text-red-400"
      : "text-neutral-700 dark:text-neutral-300";

interface Props {
  searchParams: Promise<{ address?: string }>;
}

export default async function FindPage({ searchParams }: Props) {
  const params = await searchParams;
  const address = params.address?.trim();

  let result: GeocodeResult | null = null;
  let delegation: Awaited<ReturnType<typeof lookupDelegation>> | null = null;
  let error: string | null = null;

  if (address) {
    result = await geocode(address);
    if (!result) {
      error =
        "We couldn't match that address. Try a complete street address like \"1600 Pennsylvania Ave, Washington, DC 20500\".";
    } else {
      delegation = await lookupDelegation(result.stateCode, result.district);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          Find your delegation
        </h1>
        <p className="mt-2 max-w-xl text-sm text-neutral-500">
          Enter a US street address. We'll match it to a congressional district
          via the US Census Geocoder and show your two senators plus your
          representative.
        </p>
      </div>

      <form action="/find" method="get" className="mb-8 flex gap-2">
        <input
          type="text"
          name="address"
          defaultValue={address ?? ""}
          placeholder="1600 Pennsylvania Ave, Washington, DC 20500"
          className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          autoFocus
          required
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Look up
        </button>
      </form>

      {error && (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      )}

      {result && delegation && (
        <div>
          <div className="mb-6 border-b border-neutral-100 pb-4 dark:border-neutral-800">
            <p className="text-xs uppercase tracking-wide text-neutral-400">
              Matched address
            </p>
            <p className="mt-1 font-mono text-sm text-neutral-700 dark:text-neutral-300">
              {result.matchedAddress}
            </p>
            <p className="mt-2 text-sm">
              <Link
                href={`/state/${result.stateCode}`}
                className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
              >
                {delegation.stateName}
              </Link>
              {result.district != null && delegation.rep && (
                <span className="ml-2 text-neutral-500">
                  · Congressional District {result.district}
                </span>
              )}
            </p>
          </div>

          <div className="space-y-6">
            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                Senators
              </h2>
              {delegation.senators.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  No senators on file for {delegation.stateName}.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {delegation.senators.map((s) => (
                    <DelegateCard
                      key={s.bioguideId}
                      bioguideId={s.bioguideId}
                      fullName={s.fullName}
                      party={s.party}
                      role={`Senator · ${result.stateCode}`}
                      photoUrl={s.photoUrl}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                Representative
              </h2>
              {delegation.rep ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  <DelegateCard
                    bioguideId={delegation.rep.bioguideId}
                    fullName={delegation.rep.fullName}
                    party={delegation.rep.party}
                    role={
                      delegation.rep.district === 0
                        ? `At-large · ${result.stateCode}`
                        : `${result.stateCode}-${delegation.rep.district}`
                    }
                    photoUrl={delegation.rep.photoUrl}
                  />
                </ul>
              ) : (
                <p className="text-sm text-neutral-500">
                  We couldn't find a representative on file for {result.stateCode}
                  {result.district != null ? `-${result.district}` : ""}.
                </p>
              )}
            </section>
          </div>
        </div>
      )}

      {!result && !error && (
        <p className="mt-2 text-xs text-neutral-400">
          Address never leaves the request — geocoded directly against the
          public Census API. Nothing is stored.
        </p>
      )}
    </div>
  );
}

function DelegateCard({
  bioguideId,
  fullName,
  party,
  role,
  photoUrl,
}: {
  bioguideId: string;
  fullName: string;
  party: string;
  role: string;
  photoUrl: string | null;
}) {
  return (
    <li>
      <Link
        href={`/member/${bioguideId}`}
        className="flex items-center gap-3 rounded border border-neutral-200 bg-white p-3 no-underline transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900"
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full bg-neutral-100 object-cover"
          />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {fullName}
          </p>
          <p className={`text-xs ${partyColor(party)}`}>
            {party} · {role}
          </p>
        </div>
      </Link>
    </li>
  );
}
