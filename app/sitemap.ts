import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { bills, committees, members, states } from "@/lib/schema";
import { getRaceIndex } from "@/lib/elections/queries";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://delegationdecoded.org";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [stateRows, memberRows, billRows, committeeRows, raceRows, candidateRows] = await Promise.all([
    db.select({ code: states.code }).from(states),
    db
      .select({ bioguideId: members.bioguideId, updatedAt: members.updatedAt })
      .from(members)
      .where(eq(members.inOffice, true)),
    db.select({ billId: bills.billId }).from(bills),
    db.select({ committeeId: committees.committeeId }).from(committees),
    getRaceIndex(),
    // State-authority candidates only; FEC-only filers use synthetic fec-*
    // ids that duplicate these pages and stay discoverable via race pages.
    db.execute(sql`SELECT DISTINCT ca.person_id FROM candidacies ca`) as unknown as Promise<{
      rows: { person_id: string }[];
    }>,
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${BASE_URL}/ask`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE_URL}/find`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/compare`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE_URL}/races`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE_URL}/for-journalists`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  return [
    ...staticRoutes,
    ...stateRows.map((state) => ({
      url: `${BASE_URL}/state/${state.code}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...memberRows.map((member) => ({
      url: `${BASE_URL}/member/${member.bioguideId}`,
      lastModified: member.updatedAt ?? now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...billRows.map((bill) => ({
      url: `${BASE_URL}/bill/${bill.billId}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...committeeRows.map((committee) => ({
      url: `${BASE_URL}/committee/${committee.committeeId}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...raceRows.map((race) => ({
      url: `${BASE_URL}/race/${race.contestId}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: race.coverage === "fec_only" ? 0.5 : 0.8,
    })),
    ...candidateRows.rows.map((c) => ({
      url: `${BASE_URL}/candidate/${encodeURIComponent(c.person_id)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
