import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { count, eq, sql } from "drizzle-orm";
import { members, stockTransactions, disclosureFilings } from "@/lib/schema";
import { OgStat } from "@/components/og-stat";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "Delegation Decoded — congressional accountability, organized by state.";

const rootStyle = {
  width: "100%",
  height: "100%",
  background: "#ffffff",
  display: "flex",
  flexDirection: "column",
  padding: 64,
  fontFamily: "Georgia, serif",
} as const;

const logoStyle = {
  width: 56,
  height: 56,
  background: "#171717",
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  fontSize: 28,
  fontWeight: 700,
  letterSpacing: -2,
} as const;

async function getStats() {
  const [[m], [t], [f], [traders]] = await Promise.all([
    db.select({ n: count() }).from(members).where(eq(members.inOffice, true)),
    db.select({ n: count() }).from(stockTransactions),
    db.select({ n: count() }).from(disclosureFilings),
    db
      .select({
        n: sql<number>`COUNT(DISTINCT ${stockTransactions.bioguideId})::int`,
      })
      .from(stockTransactions),
  ]);
  return {
    members: m?.n ?? 0,
    trades: t?.n ?? 0,
    filings: f?.n ?? 0,
    traders: traders?.n ?? 0,
  };
}

export default async function opengraphImage() {
  const s = await getStats();
  return new ImageResponse(
    (
      <div
        style={rootStyle}
      >
        <div
          style={{
            height: 6,
            background: "#171717",
            width: 80,
            marginBottom: 32,
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={logoStyle}
          >
            DD
          </div>
          <div
            style={{
              fontSize: 22,
              color: "#525252",
              fontFamily: "system-ui, sans-serif",
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            Delegation Decoded
          </div>
        </div>

        <div
          style={{
            marginTop: 48,
            fontSize: 76,
            fontWeight: 600,
            color: "#171717",
            lineHeight: 1.05,
            letterSpacing: -2,
            maxWidth: 900,
          }}
        >
          Congressional accountability, organized by state.
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            gap: 56,
            fontFamily: "system-ui, sans-serif",
            color: "#404040",
          }}
        >
          <OgStat label="members" value={s.members.toLocaleString()} />
          <OgStat label="trades" value={s.trades.toLocaleString()} />
          <OgStat label="ptr filings" value={s.filings.toLocaleString()} />
          <OgStat label="traders" value={s.traders.toLocaleString()} />
        </div>
      </div>
    ),
    { ...size }
  );
}

