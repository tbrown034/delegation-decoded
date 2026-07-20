import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { members, states } from "@/lib/schema";
import { and, eq, or } from "drizzle-orm";

export const metadata: Metadata = {
  title: "Find your delegation, Delegation Decoded",
  description:
    "Enter your address to see your two senators and your representative.",
};

import { geocodeAddress, type GeocodeResult } from "@/lib/geocode";

async function lookupDelegation(stateCode: string, district: number | null) {
  // For at-large states (district=0), Census may return "1" or "0", try both.
  const [stateRows, senators, repCandidates] = await Promise.all([
    db.select({ name: states.name }).from(states).where(eq(states.code, stateCode)),
    db
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
      .orderBy(members.lastName),
    district == null
      ? Promise.resolve([])
      : db
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
          ),
  ]);

  // Prefer the exact district match; fall back to at-large (district=0).
  const rep =
    repCandidates.find((m) => m.district === district) ??
    repCandidates.find((m) => m.district === 0) ??
    null;

  return {
    stateName: stateRows[0]?.name ?? stateCode,
    senators,
    rep,
  };
}

const partyColor = (party: string) =>
  party === "Democrat"
    ? "text-blue-700"
    : party === "Republican"
      ? "text-red-700"
      : "text-neutral-700";

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
    result = await geocodeAddress(address);
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
          Enter a US street address. We&apos;ll match it to a congressional district
          via the US Census Geocoder and show your two senators plus your
          representative.
        </p>
      </div>

      <form action="/find" method="get" className="mb-8 flex gap-2">
        <input
          type="search"
          name="address"
          defaultValue={address ?? ""}
          placeholder="1600 Pennsylvania Ave, Washington, DC 20500"
          aria-label="Street address"
          autoComplete="street-address"
          spellCheck={false}
          enterKeyHint="search"
          className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
          required
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Look up
        </button>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {error}
        </div>
      )}

      {result && delegation && (
        <div>
          <div className="mb-6 border-b border-neutral-100 pb-4">
            <p className="text-xs uppercase tracking-wide text-neutral-400">
              Matched address
            </p>
            <p className="mt-1 font-mono text-sm text-neutral-700">
              {result.matchedAddress}
            </p>
            <p className="mt-2 text-sm">
              <Link
                href={`/state/${result.stateCode}`}
                className="font-medium text-neutral-900 hover:underline"
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
                  We couldn&apos;t find a representative on file for {result.stateCode}
                  {result.district != null ? `-${result.district}` : ""}.
                </p>
              )}
            </section>
          </div>
        </div>
      )}

      {!result && !error && (
        <p className="mt-2 text-xs text-neutral-400">
          Address never leaves the request, geocoded directly against the
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
        className="flex items-center gap-3 rounded border border-neutral-200 bg-white p-3 no-underline transition-colors hover:bg-neutral-50"
      >
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-full bg-neutral-100 object-cover"
          />
        ) : (
          <div className="size-12 shrink-0 rounded-full bg-neutral-100" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-900">
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
