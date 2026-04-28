import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { stockTransactions } from "@/lib/schema";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = { params: Promise<{ ticker: string }> };

export default async function OG({ params }: Params) {
  const { ticker } = await params;
  const upper = ticker.toUpperCase();

  const [stats] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      holders: sql<number>`COUNT(DISTINCT ${stockTransactions.bioguideId})::int`,
      buys: sql<number>`SUM(CASE WHEN ${stockTransactions.txType} = 'P' THEN 1 ELSE 0 END)::int`,
      sells: sql<number>`SUM(CASE WHEN ${stockTransactions.txType} != 'P' THEN 1 ELSE 0 END)::int`,
      assetName: sql<string>`MAX(${stockTransactions.assetDescription})`,
    })
    .from(stockTransactions)
    .where(eq(stockTransactions.ticker, upper));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          padding: 64,
        }}
      >
        <div style={{ height: 6, background: "#171717", width: 80, marginBottom: 32 }} />

        <div
          style={{
            fontSize: 18,
            color: "#737373",
            textTransform: "uppercase",
            letterSpacing: 2,
            fontFamily: "system-ui",
          }}
        >
          Disclosed congressional trades
        </div>

        <div
          style={{
            marginTop: 12,
            fontSize: 144,
            fontWeight: 700,
            color: "#171717",
            fontFamily: "Georgia, serif",
            letterSpacing: -4,
            lineHeight: 1,
          }}
        >
          {upper}
        </div>

        {stats?.assetName && (
          <div
            style={{
              marginTop: 4,
              fontSize: 22,
              color: "#525252",
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              maxWidth: 1000,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {stats.assetName}
          </div>
        )}

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 32,
          }}
        >
          <div style={{ display: "flex", gap: 56 }}>
            <Stat label="trades" value={(stats?.total ?? 0).toLocaleString()} />
            <Stat label="members" value={(stats?.holders ?? 0).toLocaleString()} />
            <Stat label="buys" value={(stats?.buys ?? 0).toLocaleString()} color="#16a34a" />
            <Stat label="sells" value={(stats?.sells ?? 0).toLocaleString()} color="#dc2626" />
          </div>
          <div
            style={{
              fontSize: 18,
              color: "#737373",
              textTransform: "uppercase",
              letterSpacing: 1.5,
              fontFamily: "system-ui",
            }}
          >
            Delegation Decoded
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          fontSize: 48,
          fontWeight: 600,
          color: color ?? "#171717",
          fontFamily: "Georgia, serif",
          letterSpacing: -1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 14,
          color: "#737373",
          textTransform: "uppercase",
          letterSpacing: 1.2,
          marginTop: 4,
          fontFamily: "system-ui",
        }}
      >
        {label}
      </div>
    </div>
  );
}
