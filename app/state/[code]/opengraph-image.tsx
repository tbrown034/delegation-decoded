import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { members, states, stockTransactions } from "@/lib/schema";
import { OgStat } from "@/components/og-stat";
import { OgPartyDot } from "@/components/og-party-dot";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = { params: Promise<{ code: string }> };

const rootStyle = {
  width: "100%",
  height: "100%",
  background: "#ffffff",
  display: "flex",
  flexDirection: "column",
  padding: 64,
} as const;

const stateNameStyle = {
  display: "flex",
  marginTop: 12,
  fontSize: 96,
  fontWeight: 700,
  color: "#171717",
  fontFamily: "Georgia, serif",
  letterSpacing: -3,
  lineHeight: 1,
} as const;

export default async function opengraphImage({ params }: Params) {
  const { code } = await params;
  const upper = code.toUpperCase();

  const [[state], memberRows, [tradeAgg]] = await Promise.all([
    db.select().from(states).where(eq(states.code, upper)).limit(1),
    db
      .select({ chamber: members.chamber, party: members.party })
      .from(members)
      .where(and(eq(members.stateCode, upper), eq(members.inOffice, true))),
    db
      .select({ n: sql<number>`COUNT(${stockTransactions.id})::int` })
      .from(stockTransactions)
      .innerJoin(members, eq(members.bioguideId, stockTransactions.bioguideId))
      .where(eq(members.stateCode, upper)),
  ]);

  const senate = memberRows.filter((m) => m.chamber === "senate").length;
  const house = memberRows.filter((m) => m.chamber === "house").length;
  const dems = memberRows.filter((m) => m.party === "Democrat").length;
  const reps = memberRows.filter((m) => m.party === "Republican").length;
  const ind = memberRows.length - dems - reps;

  return new ImageResponse(
    (
      <div
        style={rootStyle}
      >
        <div style={{ display: "flex", height: 6, background: "#171717", width: 80, marginBottom: 32 }} />
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
          {`${state?.name || upper} delegation`}
        </div>
        <div
          style={stateNameStyle}
        >
          {state?.name || upper}
        </div>

        <div
          style={{
            marginTop: 48,
            display: "flex",
            flexDirection: "row",
            gap: 56,
          }}
        >
          <OgStat label="senate" value={senate.toString()} valueSize={56} valueLetterSpacing={-1.5} />
          <OgStat label="house" value={house.toString()} valueSize={56} valueLetterSpacing={-1.5} />
          <OgStat label="trades" value={(tradeAgg?.n ?? 0).toLocaleString()} valueSize={56} valueLetterSpacing={-1.5} />
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 24 }}>
            <OgPartyDot color="#2563eb" count={dems} label="D" />
            <OgPartyDot color="#dc2626" count={reps} label="R" />
            {ind > 0 ? <OgPartyDot color="#a855f7" count={ind} label="I" /> : null}
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

