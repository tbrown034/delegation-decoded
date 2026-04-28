import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { members, states, stockTransactions } from "@/lib/schema";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Params = { params: Promise<{ code: string }> };

export default async function OG({ params }: Params) {
  const { code } = await params;
  const upper = code.toUpperCase();

  const [state] = await db.select().from(states).where(eq(states.code, upper)).limit(1);
  const memberRows = await db
    .select({ chamber: members.chamber, party: members.party })
    .from(members)
    .where(and(eq(members.stateCode, upper), eq(members.inOffice, true)));
  const [tradeAgg] = await db
    .select({ n: sql<number>`COUNT(${stockTransactions.id})::int` })
    .from(stockTransactions)
    .innerJoin(members, eq(members.bioguideId, stockTransactions.bioguideId))
    .where(eq(members.stateCode, upper));

  const senate = memberRows.filter((m) => m.chamber === "senate").length;
  const house = memberRows.filter((m) => m.chamber === "house").length;
  const dems = memberRows.filter((m) => m.party === "Democrat").length;
  const reps = memberRows.filter((m) => m.party === "Republican").length;
  const ind = memberRows.length - dems - reps;

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
          <Stat label="senate" value={senate.toString()} />
          <Stat label="house" value={house.toString()} />
          <Stat label="trades" value={(tradeAgg?.n ?? 0).toLocaleString()} />
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
            <PartyDot color="#2563eb" count={dems} label="D" />
            <PartyDot color="#dc2626" count={reps} label="R" />
            {ind > 0 ? <PartyDot color="#a855f7" count={ind} label="I" /> : null}
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

function PartyDot({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        fontSize: 22,
        fontWeight: 600,
        color: "#404040",
      }}
    >
      <div
        style={{
          display: "flex",
          width: 14,
          height: 14,
          borderRadius: 99,
          background: color,
        }}
      />
      <div style={{ display: "flex" }}>{`${count} ${label}`}</div>
    </div>
  );
}
