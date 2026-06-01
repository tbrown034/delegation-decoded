import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { stockTransactions } from "@/lib/schema";
import { OgStat } from "@/components/og-stat";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = { params: Promise<{ ticker: string }> };

const assetNameStyle = {
  marginTop: 4,
  fontSize: 22,
  color: "#525252",
  fontFamily: "Georgia, serif",
  fontStyle: "italic",
  maxWidth: 1000,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
} as const;

export default async function opengraphImage({ params }: Params) {
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
            style={assetNameStyle}
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
            <OgStat label="trades" value={(stats?.total ?? 0).toLocaleString()} />
            <OgStat label="members" value={(stats?.holders ?? 0).toLocaleString()} />
            <OgStat label="buys" value={(stats?.buys ?? 0).toLocaleString()} color="#16a34a" />
            <OgStat label="sells" value={(stats?.sells ?? 0).toLocaleString()} color="#dc2626" />
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

