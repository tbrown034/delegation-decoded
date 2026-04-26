import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  getMembersByState,
  getMemberByBioguideId,
  getMemberBillCount,
  getMemberVoteSummary,
  getMemberFinance,
  getMemberCommittees,
  getVotingAgreement,
  getAllMembersForPicker,
  getDelegationBillCount,
  getDelegationBillCounts,
  getDelegationVoteSummaries,
  getStateDelegationFinance,
  getStateCommitteeCoverage,
  getStateByCode,
} from "@/lib/queries";
import { STATES, STATE_BY_CODE } from "@/lib/states";
import { effectiveTotal } from "@/lib/finance";
import { ComparePicker } from "@/components/compare-picker";
import { CompareMembers } from "@/components/compare-members";
import { CompareDelegation } from "@/components/compare-delegation";
import { CompareStates } from "@/components/compare-states";

type Props = {
  searchParams: Promise<{
    mode?: string;
    state?: string;
    a?: string;
    b?: string;
  }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const mode = sp.mode || "delegation";

  if (mode === "delegation" && sp.state) {
    const name = STATE_BY_CODE[sp.state.toUpperCase()]?.name;
    if (name) return { title: `Compare ${name} Delegation` };
  }

  if (mode === "members" && sp.a && sp.b) {
    const [a, b] = await Promise.all([
      getMemberByBioguideId(sp.a),
      getMemberByBioguideId(sp.b),
    ]);
    if (a && b) return { title: `${a.lastName} vs. ${b.lastName}` };
  }

  if (mode === "states" && sp.a && sp.b) {
    const nameA = STATE_BY_CODE[sp.a.toUpperCase()]?.name;
    const nameB = STATE_BY_CODE[sp.b.toUpperCase()]?.name;
    if (nameA && nameB) return { title: `${nameA} vs. ${nameB}` };
  }

  return { title: "Compare" };
}

export default async function ComparePage({ searchParams }: Props) {
  const sp = await searchParams;
  const mode = (sp.mode || "delegation") as "delegation" | "members" | "states";

  // For member picker, fetch all members when in members mode
  const allMembers =
    mode === "members" ? await getAllMembersForPicker() : undefined;

  // Pass state list for pickers
  const stateList = STATES.map((s) => ({ code: s.code, name: s.name }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          Compare
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Side-by-side comparison of members, delegations, and states.
        </p>
      </div>

      {/* Picker */}
      <Suspense>
        <ComparePicker
          mode={mode}
          selectedState={sp.state}
          selectedA={sp.a}
          selectedB={sp.b}
          states={stateList}
          allMembers={allMembers}
        />
      </Suspense>

      {/* Results */}
      {mode === "delegation" && sp.state && (
        <DelegationResults stateCode={sp.state.toUpperCase()} />
      )}

      {mode === "members" && sp.a && sp.b && sp.a !== sp.b && (
        <MemberResults idA={sp.a} idB={sp.b} />
      )}

      {mode === "members" && sp.a && sp.b && sp.a === sp.b && (
        <EmptyState message="Select two different members to compare." />
      )}

      {mode === "states" && sp.a && sp.b && sp.a !== sp.b && (
        <StateResults
          codeA={sp.a.toUpperCase()}
          codeB={sp.b.toUpperCase()}
        />
      )}

      {mode === "states" && sp.a && sp.b && sp.a === sp.b && (
        <EmptyState message="Select two different states to compare." />
      )}

      {/* Empty states */}
      {mode === "delegation" && !sp.state && <DelegationIntro />}
      {mode === "members" && (!sp.a || !sp.b) && <MembersIntro />}
      {mode === "states" && (!sp.a || !sp.b) && <StatesIntro />}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-200 px-6 py-16 text-center dark:border-neutral-800">
      <p className="text-sm text-neutral-400">{message}</p>
    </div>
  );
}

function IntroCard({
  lede,
  bullets,
  quickPicks,
}: {
  lede: string;
  bullets: string[];
  quickPicks?: { label: string; href: string }[];
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/40 p-6 dark:border-neutral-800 dark:bg-neutral-900/40 sm:p-8">
      <p className="text-sm text-neutral-700 dark:text-neutral-300">{lede}</p>

      <div className="mt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          What you&apos;ll see
        </p>
        <ul className="mt-2 grid gap-1.5 text-sm text-neutral-600 dark:text-neutral-400 sm:grid-cols-2">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2">
              <span className="text-neutral-300 dark:text-neutral-600">—</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>

      {quickPicks && quickPicks.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Try one
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {quickPicks.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-700 transition-colors hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-neutral-100"
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DelegationIntro() {
  return (
    <IntroCard
      lede="Pick a state to line up its senators and representatives. See how the same delegation votes, who fundraises hardest, and where the senators agree."
      bullets={[
        "Senators and House members side-by-side",
        "Bills sponsored and cosponsored",
        "Vote tallies — yea, nay, present",
        "FEC totals from the most recent cycle",
        "Senator-vs-senator voting agreement",
        "Committee assignments",
      ]}
      quickPicks={[
        { label: "California", href: "/compare?mode=delegation&state=CA" },
        { label: "Texas", href: "/compare?mode=delegation&state=TX" },
        { label: "New York", href: "/compare?mode=delegation&state=NY" },
        { label: "Florida", href: "/compare?mode=delegation&state=FL" },
        { label: "Pennsylvania", href: "/compare?mode=delegation&state=PA" },
        { label: "Georgia", href: "/compare?mode=delegation&state=GA" },
      ]}
    />
  );
}

function MembersIntro() {
  return (
    <IntroCard
      lede="Pick any two members of Congress — same party, opposite ends of the country, doesn't matter. The comparison handles the rest."
      bullets={[
        "Bills sponsored and cosponsored",
        "Vote breakdown across the cycle",
        "Voting agreement on shared roll calls",
        "FEC fundraising and donor mix",
        "Committees and subcommittees",
        "Tenure and chamber",
      ]}
    />
  );
}

function StatesIntro() {
  return (
    <IntroCard
      lede="Stack two state delegations against each other. Useful when one state punches above its weight on a committee or a fundraising cycle."
      bullets={[
        "Combined sponsored bills",
        "Aggregate FEC receipts",
        "Committee coverage across the delegation",
        "Party split and chamber breakdown",
      ]}
      quickPicks={[
        { label: "California vs. Texas", href: "/compare?mode=states&a=CA&b=TX" },
        { label: "New York vs. Florida", href: "/compare?mode=states&a=NY&b=FL" },
        { label: "Pennsylvania vs. Ohio", href: "/compare?mode=states&a=PA&b=OH" },
        { label: "Georgia vs. Arizona", href: "/compare?mode=states&a=GA&b=AZ" },
      ]}
    />
  );
}

// ─── Delegation comparison ──────────────────────────────────────────────────

async function DelegationResults({ stateCode }: { stateCode: string }) {
  const state = await getStateByCode(stateCode);
  if (!state) return <EmptyState message="State not found." />;

  const [membersList, billCountRows, voteSummaryRows, financeData] =
    await Promise.all([
      getMembersByState(stateCode),
      getDelegationBillCounts(stateCode),
      getDelegationVoteSummaries(stateCode),
      getStateDelegationFinance(stateCode),
    ]);

  if (membersList.length === 0) {
    return <EmptyState message="No current members found for this state." />;
  }

  // Build bill count map
  const billCounts: Record<
    string,
    { sponsored: number; cosponsored: number }
  > = {};
  for (const row of billCountRows) {
    if (!billCounts[row.bioguideId]) {
      billCounts[row.bioguideId] = { sponsored: 0, cosponsored: 0 };
    }
    if (row.role === "sponsor") billCounts[row.bioguideId].sponsored = row.count;
    else billCounts[row.bioguideId].cosponsored = row.count;
  }

  // Build vote summary map
  const voteSummaries: Record<
    string,
    { yea: number; nay: number; present: number; notVoting: number; total: number }
  > = {};
  for (const row of voteSummaryRows) {
    if (!voteSummaries[row.bioguideId]) {
      voteSummaries[row.bioguideId] = {
        yea: 0,
        nay: 0,
        present: 0,
        notVoting: 0,
        total: 0,
      };
    }
    const s = voteSummaries[row.bioguideId];
    if (row.position === "yea") s.yea = row.count;
    else if (row.position === "nay") s.nay = row.count;
    else if (row.position === "present") s.present = row.count;
    else s.notVoting = row.count;
    s.total += row.count;
  }

  // Build finance map (most recent cycle per member, using effective total)
  const financeMap: Record<string, { totalReceipts: number | null }> = {};
  const seenCycles: Record<string, number> = {};
  for (const f of financeData) {
    if (
      !seenCycles[f.bioguideId] ||
      f.electionCycle > seenCycles[f.bioguideId]
    ) {
      seenCycles[f.bioguideId] = f.electionCycle;
      financeMap[f.bioguideId] = { totalReceipts: effectiveTotal(f) };
    }
  }

  // Senator voting agreement
  const senators = membersList.filter((m) => m.chamber === "senate");
  let senatorAgreement = null;
  if (senators.length === 2) {
    senatorAgreement = await getVotingAgreement(
      senators[0].bioguideId,
      senators[1].bioguideId
    );
  }

  return (
    <CompareDelegation
      stateName={state.name}
      stateCode={state.code}
      members={membersList}
      billCounts={billCounts}
      voteSummaries={voteSummaries}
      financeMap={financeMap}
      senatorAgreement={senatorAgreement}
    />
  );
}

// ─── Member comparison ──────────────────────────────────────────────────────

async function MemberResults({ idA, idB }: { idA: string; idB: string }) {
  const [memberA, memberB] = await Promise.all([
    getMemberByBioguideId(idA),
    getMemberByBioguideId(idB),
  ]);

  if (!memberA || !memberB) {
    return (
      <EmptyState
        message={`Member ${!memberA ? idA : idB} not found.`}
      />
    );
  }

  const [billsA, billsB, votesA, votesB, financeA, financeB, committeesA, committeesB, agreement] =
    await Promise.all([
      getMemberBillCount(idA),
      getMemberBillCount(idB),
      getMemberVoteSummary(idA),
      getMemberVoteSummary(idB),
      getMemberFinance(idA),
      getMemberFinance(idB),
      getMemberCommittees(idA),
      getMemberCommittees(idB),
      getVotingAgreement(idA, idB),
    ]);

  return (
    <CompareMembers
      memberA={memberA}
      memberB={memberB}
      billsA={billsA}
      billsB={billsB}
      votesA={votesA}
      votesB={votesB}
      financeA={financeA[0] || null}
      financeB={financeB[0] || null}
      committeesA={committeesA}
      committeesB={committeesB}
      agreement={agreement}
    />
  );
}

// ─── State comparison ───────────────────────────────────────────────────────

async function StateResults({
  codeA,
  codeB,
}: {
  codeA: string;
  codeB: string;
}) {
  const [stateObjA, stateObjB] = await Promise.all([
    getStateByCode(codeA),
    getStateByCode(codeB),
  ]);

  if (!stateObjA || !stateObjB) {
    return <EmptyState message="One or both states not found." />;
  }

  const [
    membersA,
    membersB,
    financeA,
    financeB,
    committeesA,
    committeesB,
    billCountA,
    billCountB,
  ] = await Promise.all([
    getMembersByState(codeA),
    getMembersByState(codeB),
    getStateDelegationFinance(codeA),
    getStateDelegationFinance(codeB),
    getStateCommitteeCoverage(codeA),
    getStateCommitteeCoverage(codeB),
    getDelegationBillCount(codeA),
    getDelegationBillCount(codeB),
  ]);

  return (
    <CompareStates
      stateA={{
        stateCode: codeA,
        stateName: stateObjA.name,
        members: membersA,
        financeData: financeA,
        committeeCoverage: committeesA,
        billCount: billCountA,
      }}
      stateB={{
        stateCode: codeB,
        stateName: stateObjB.name,
        members: membersB,
        financeData: financeB,
        committeeCoverage: committeesB,
        billCount: billCountB,
      }}
    />
  );
}
