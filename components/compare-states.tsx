import Link from "next/link";
import { PartyBar } from "./party-bar";
import { effectiveTotal, fmt } from "@/lib/finance";

interface MemberData {
  bioguideId: string;
  fullName: string;
  party: string;
  chamber: string;
}

interface FinanceRecord {
  bioguideId: string;
  totalReceipts: number | null;
  totalIndividual: number | null;
  totalPac: number | null;
  smallIndividual: number | null;
  electionCycle: number;
}

interface CommitteeCoverage {
  committeeId: string;
  committeeName: string;
}

interface StateStats {
  stateCode: string;
  stateName: string;
  members: MemberData[];
  financeData: FinanceRecord[];
  committeeCoverage: CommitteeCoverage[];
  billCount: number;
}

interface CompareStatesProps {
  stateA: StateStats;
  stateB: StateStats;
}

function getParties(membersList: MemberData[]) {
  return {
    democrat: membersList.filter((m) => m.party === "Democrat").length,
    republican: membersList.filter((m) => m.party === "Republican").length,
    independent: membersList.filter(
      (m) => m.party !== "Democrat" && m.party !== "Republican"
    ).length,
  };
}

function getTotalRaised(financeData: FinanceRecord[]) {
  // De-dupe: keep most recent cycle per member
  const byMember = new Map<string, number>();
  for (const f of financeData) {
    const raised = effectiveTotal(f);
    const existing = byMember.get(f.bioguideId);
    if (!existing || raised > existing) {
      byMember.set(f.bioguideId, raised);
    }
  }
  let total = 0;
  for (const v of byMember.values()) total += v;
  return { total, memberCount: byMember.size };
}

function getUniqueCommittees(coverage: CommitteeCoverage[]) {
  const ids = new Set(coverage.map((c) => c.committeeId));
  return ids.size;
}

function StatRow({
  label,
  valueA,
  valueB,
  mono = true,
}: {
  label: string;
  valueA: string | number;
  valueB: string | number;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline border-b border-neutral-100 py-2.5 dark:border-neutral-800">
      <span className="w-44 shrink-0 text-xs text-neutral-400">{label}</span>
      <span
        className={`flex-1 text-right text-sm ${mono ? "font-mono" : ""} font-medium text-neutral-900 dark:text-neutral-100`}
      >
        {valueA}
      </span>
      <span
        className={`flex-1 text-right text-sm ${mono ? "font-mono" : ""} font-medium text-neutral-900 dark:text-neutral-100`}
      >
        {valueB}
      </span>
    </div>
  );
}

function StateHeader({
  stateCode,
  stateName,
  parties,
}: {
  stateCode: string;
  stateName: string;
  parties: { democrat: number; republican: number; independent: number };
}) {
  return (
    <div className="flex-1">
      <Link
        href={`/state/${stateCode}`}
        className="font-serif text-xl font-semibold tracking-tight no-underline hover:text-neutral-600 dark:hover:text-neutral-300"
      >
        {stateName}
      </Link>
      <div className="mt-2">
        <PartyBar
          democrat={parties.democrat}
          republican={parties.republican}
          independent={parties.independent}
          showLabels
        />
      </div>
    </div>
  );
}

export function CompareStates({ stateA, stateB }: CompareStatesProps) {
  const partiesA = getParties(stateA.members);
  const partiesB = getParties(stateB.members);

  const raisedA = getTotalRaised(stateA.financeData);
  const raisedB = getTotalRaised(stateB.financeData);

  const uniqueCommA = getUniqueCommittees(stateA.committeeCoverage);
  const uniqueCommB = getUniqueCommittees(stateB.committeeCoverage);

  const senatorsA = stateA.members.filter((m) => m.chamber === "senate").length;
  const senatorsB = stateB.members.filter((m) => m.chamber === "senate").length;
  const repsA = stateA.members.filter((m) => m.chamber === "house").length;
  const repsB = stateB.members.filter((m) => m.chamber === "house").length;

  return (
    <div>
      {/* State Headers */}
      <div className="mb-8 grid grid-cols-2 gap-8">
        <StateHeader
          stateCode={stateA.stateCode}
          stateName={stateA.stateName}
          parties={partiesA}
        />
        <StateHeader
          stateCode={stateB.stateCode}
          stateName={stateB.stateName}
          parties={partiesB}
        />
      </div>

      {/* Comparison stats */}
      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Delegation Size
        </h2>
        <StatRow
          label="Total members"
          valueA={stateA.members.length}
          valueB={stateB.members.length}
        />
        <StatRow label="Senators" valueA={senatorsA} valueB={senatorsB} />
        <StatRow
          label="Representatives"
          valueA={repsA}
          valueB={repsB}
        />

        <h2 className="mb-3 mt-8 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Legislation
        </h2>
        <StatRow
          label="Bills introduced"
          valueA={stateA.billCount}
          valueB={stateB.billCount}
        />

        <h2 className="mb-3 mt-8 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Campaign Finance
        </h2>
        <StatRow
          label="Total raised"
          valueA={fmt(raisedA.total)}
          valueB={fmt(raisedB.total)}
        />
        <StatRow
          label="Avg. per member"
          valueA={
            raisedA.memberCount > 0
              ? fmt(Math.round(raisedA.total / raisedA.memberCount))
              : "N/A"
          }
          valueB={
            raisedB.memberCount > 0
              ? fmt(Math.round(raisedB.total / raisedB.memberCount))
              : "N/A"
          }
        />

        <h2 className="mb-3 mt-8 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Committee Coverage
        </h2>
        <StatRow
          label="Total committee seats"
          valueA={stateA.committeeCoverage.length}
          valueB={stateB.committeeCoverage.length}
        />
        <StatRow
          label="Unique committees"
          valueA={uniqueCommA}
          valueB={uniqueCommB}
        />
      </div>
    </div>
  );
}
