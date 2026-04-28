import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { members, stockTransactions, billSponsorships } from "@/lib/schema";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = { params: Promise<{ bioguideId: string }> };

const PARTY_COLOR: Record<string, string> = {
  Democrat: "#2563eb",
  Republican: "#dc2626",
  Independent: "#a855f7",
};

export default async function OG({ params }: Params) {
  const { bioguideId } = await params;
  const [m] = await db
    .select()
    .from(members)
    .where(eq(members.bioguideId, bioguideId))
    .limit(1);

  if (!m) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            fontSize: 48,
            fontFamily: "Georgia, serif",
          }}
        >
          Member not found
        </div>
      ),
      { ...size }
    );
  }

  const [trades] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(stockTransactions)
    .where(eq(stockTransactions.bioguideId, bioguideId));
  const [sponsorships] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(billSponsorships)
    .where(eq(billSponsorships.bioguideId, bioguideId));

  const partyColor = PARTY_COLOR[m.party] || "#404040";
  const districtSuffix = m.district ? `-${m.district}` : "";
  const role = m.chamber === "senate" ? "U.S. Senator" : "U.S. Representative";
  const subtitle = `${role} · ${m.party} · ${m.stateCode}${districtSuffix}`;

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
        <div style={{ display: "flex", height: 6, background: partyColor, width: 80, marginBottom: 32 }} />

        <div
          style={{
            display: "flex",
            fontSize: 18,
            color: "#737373",
            textTransform: "uppercase",
            letterSpacing: 2,
            fontFamily: "system-ui",
          }}
        >
          {subtitle}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 12,
            fontSize: 96,
            fontWeight: 700,
            color: "#171717",
            fontFamily: "Georgia, serif",
            letterSpacing: -3,
            lineHeight: 1,
          }}
        >
          {m.fullName}
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 32,
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", gap: 56 }}>
            <Stat label="bills sponsored" value={(sponsorships?.n ?? 0).toLocaleString()} />
            <Stat label="trades disclosed" value={(trades?.n ?? 0).toLocaleString()} />
          </div>
          <div
            style={{
              display: "flex",
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          fontSize: 56,
          fontWeight: 600,
          color: "#171717",
          fontFamily: "Georgia, serif",
          letterSpacing: -1.5,
        }}
      >
        {value}
      </div>
      <div
        style={{
          display: "flex",
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
