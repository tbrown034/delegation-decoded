import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { members, states, stockTransactions } from "@/lib/schema";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://delegation-decoded.vercel.app";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const [stateRows, memberRows, tickerRows] = await Promise.all([
    db.select({ code: states.code }).from(states),
    db
      .select({ bioguideId: members.bioguideId, updatedAt: members.updatedAt })
      .from(members)
      .where(eq(members.inOffice, true)),
    db
      .select({ ticker: stockTransactions.ticker })
      .from(stockTransactions)
      .where(sql`${stockTransactions.ticker} IS NOT NULL`)
      .groupBy(stockTransactions.ticker),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE_URL}/find`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/compare`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/trades`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE_URL}/trades/methodology`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/for-journalists`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE_URL}/health`, lastModified: now, changeFrequency: "hourly", priority: 0.4 },
    { url: `${BASE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];

  const stateRoutes: MetadataRoute.Sitemap = stateRows.map((s) => ({
    url: `${BASE_URL}/state/${s.code}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const memberRoutes: MetadataRoute.Sitemap = memberRows.map((m) => ({
    url: `${BASE_URL}/member/${m.bioguideId}`,
    lastModified: m.updatedAt ?? now,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  const tickerRoutes: MetadataRoute.Sitemap = tickerRows
    .filter((t): t is { ticker: string } => Boolean(t.ticker))
    .map((t) => ({
      url: `${BASE_URL}/trades/companies/${t.ticker}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
    }));

  return [...staticRoutes, ...stateRoutes, ...memberRoutes, ...tickerRoutes];
}
