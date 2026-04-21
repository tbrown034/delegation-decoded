import type { Metadata } from "next";
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
      {mode === "delegation" && !sp.state && (
        <EmptyState message="Select a state to compare its delegation members side-by-side." />
      )}
      {mode === "members" && (!sp.a || !sp.b) && (
        <EmptyState message="Pick two members of Congress to compare head-to-head." />
      )}
      {mode === "states" && (!sp.a || !sp.b) && (
        <EmptyState message="Choose two states to compare their congressional delegations." />
      )}
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
