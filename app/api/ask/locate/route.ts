import { NextRequest } from "next/server";
import { resolveLocation } from "@/lib/geocode";
import { getMembersByState } from "@/lib/queries";
import { getStateRaceIndex } from "@/lib/elections/queries";
import { checkIpLimit } from "@/lib/ask-limits";
import {
  clientIp,
  readLimitedJson,
  rejectCrossSite,
} from "@/lib/request-guards";

// POST, not GET: street addresses must never ride in a URL, where hosting
// and proxy logs would retain them. Responses are explicitly no-store.

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;

  const parsed = await readLimitedJson(request, 1_024);
  if (!parsed.ok) {
    return Response.json(
      {
        error:
          parsed.reason === "too_large"
            ? "Request body is too large."
            : "Invalid request.",
      },
      { status: parsed.reason === "too_large" ? 413 : 400, headers: NO_STORE }
    );
  }
  const body = parsed.body;
  const q =
    typeof (body as Record<string, unknown>)?.q === "string"
      ? ((body as Record<string, unknown>).q as string).trim()
      : "";
  if (!q || q.length > 200) {
    return Response.json(
      { error: "Enter a state or a street address." },
      { status: 400, headers: NO_STORE }
    );
  }

  const rate = await checkIpLimit(clientIp(request), "locate");
  if (!rate.allowed) {
    return Response.json(
      { error: rate.reason },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          ...(rate.retryAfterSeconds
            ? { "Retry-After": String(rate.retryAfterSeconds) }
            : {}),
        },
      }
    );
  }

  const location = await resolveLocation(q);
  if (!location) {
    return Response.json(
      {
        error:
          'No match. Try a state ("Indiana"), a two-letter code ("IN"), or a full street address.',
      },
      { status: 404, headers: NO_STORE }
    );
  }

  const [members, stateRaces] = await Promise.all([
    getMembersByState(location.stateCode),
    getStateRaceIndex(location.stateCode),
  ]);
  // The located ballot: any Senate race plus, once an address pins the
  // district, that district's House race. Statewide House lists stay behind
  // the /races link.
  const ballotRaces = stateRaces
    .filter(
      (race) =>
        race.office === "S" ||
        (location.district != null && race.district === location.district)
    )
    .sort((a, b) => a.office.localeCompare(b.office));
  return Response.json(
    {
      ...location,
      members: members.map((m) => ({
        bioguideId: m.bioguideId,
        fullName: m.fullName,
        party: m.party,
        chamber: m.chamber,
        district: m.district,
        photoUrl: m.photoUrl,
      })),
      races: ballotRaces.map((race) => ({
        contestId: race.contestId,
        title: race.title,
        coverage: race.coverage,
        activeCandidates: race.activeCandidates,
        candidates: race.candidates.slice(0, 6),
        matchup: race.matchup,
      })),
    },
    { headers: NO_STORE }
  );
}
