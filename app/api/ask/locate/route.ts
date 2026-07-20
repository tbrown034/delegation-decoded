import { NextRequest } from "next/server";
import { resolveLocation } from "@/lib/geocode";
import { getMembersByState } from "@/lib/queries";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > 200) {
    return Response.json(
      { error: "Enter a state or a street address." },
      { status: 400 }
    );
  }

  const location = await resolveLocation(q);
  if (!location) {
    return Response.json(
      {
        error:
          'No match. Try a state ("Indiana"), a two-letter code ("IN"), or a full street address.',
      },
      { status: 404 }
    );
  }

  const members = await getMembersByState(location.stateCode);
  return Response.json({
    ...location,
    members: members.map((m) => ({
      bioguideId: m.bioguideId,
      fullName: m.fullName,
      party: m.party,
      chamber: m.chamber,
      district: m.district,
      photoUrl: m.photoUrl,
    })),
  });
}
