import Image from "next/image";
import Link from "next/link";
import { STATE_BY_CODE } from "@/lib/states";
import { effectiveTotal, fmt } from "@/lib/finance";

interface MemberData {
  bioguideId: string;
  fullName: string;
  party: string;
  stateCode: string;
  chamber: string;
  district: number | null;
  photoUrl: string | null;
}

interface BillCounts {
  sponsored: number;
  cosponsored: number;
}

interface VoteSummary {
  yea: number;
  nay: number;
  present: number;
  notVoting: number;
  total: number;
}

interface FinanceRecord {
  totalReceipts: number | null;
  totalIndividual: number | null;
  totalPac: number | null;
  smallIndividual: number | null;
  electionCycle: number;
}

interface Committee {
  committeeId: string;
  name: string;
  role: string | null;
  parentId: string | null;
}

interface VotingAgreement {
  sharedVotes: number;
  agreed: number;
  agreementPct: number;
}

interface CompareMembersProps {
  memberA: MemberData;
  memberB: MemberData;
  billsA: BillCounts;
  billsB: BillCounts;
  votesA: VoteSummary;
  votesB: VoteSummary;
  financeA: FinanceRecord | null;
  financeB: FinanceRecord | null;
  committeesA: Committee[];
  committeesB: Committee[];
  agreement: VotingAgreement;
}

const partyRing: Record<string, string> = {
  Democrat: "ring-blue-600",
  Republican: "ring-red-600",
  Independent: "ring-purple-500",
};

const partyDot: Record<string, string> = {
  Democrat: "bg-blue-600",
  Republican: "bg-red-600",
  Independent: "bg-purple-500",
};

function MemberHeader({ member }: { member: MemberData }) {
  const ring = partyRing[member.party] || "ring-neutral-300";
  const stateName = STATE_BY_CODE[member.stateCode]?.name || member.stateCode;
  const seat =
    member.chamber === "senate"
      ? "Senator"
      : member.district
        ? `District ${member.district}`
        : "At-Large";

  return (
    <Link
      href={`/member/${member.bioguideId}`}
      className="group block no-underline"
    >
      <div className="flex items-center gap-3">
        <div
          className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-full ring-2 ${ring}`}
        >
          {member.photoUrl ? (
            <Image
              src={member.photoUrl}
              alt=""
              fill
              sizes="48px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-neutral-100 text-sm text-neutral-400 dark:bg-neutral-800">
              ?
            </div>
          )}
        </div>
        <div>
          <p className="font-serif text-lg font-semibold tracking-tight group-hover:text-neutral-600 dark:group-hover:text-neutral-300">
            {member.fullName}
          </p>
          <p className="text-xs text-neutral-500">
            <span
              className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${partyDot[member.party] || "bg-neutral-400"}`}
            />
            {member.party} {seat} — {stateName}
          </p>
        </div>
      </div>
    </Link>
  );
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
    <div className="flex items-baseline border-b border-neutral-100 py-2 dark:border-neutral-800">
      <span className="w-40 shrink-0 text-xs text-neutral-400">{label}</span>
      <span
        className={`flex-1 text-right text-sm ${mono ? "font-mono" : ""} text-neutral-900 dark:text-neutral-100`}
      >
        {valueA}
      </span>
      <span
        className={`flex-1 text-right text-sm ${mono ? "font-mono" : ""} text-neutral-900 dark:text-neutral-100`}
      >
        {valueB}
      </span>
    </div>
  );
}

function FinanceBar({ finance }: { finance: FinanceRecord | null }) {
  const total = finance ? effectiveTotal(finance) : 0;
  if (!finance || total === 0) {
    return (
      <span className="text-xs text-neutral-300 dark:text-neutral-600">
        No data
      </span>
    );
  }
  const small = finance.smallIndividual || 0;
  const large = (finance.totalIndividual || 0) - small;
  const pac = finance.totalPac || 0;

  const pctSmall = total > 0 ? (small / total) * 100 : 0;
  const pctLarge = total > 0 ? (large / total) * 100 : 0;
  const pctPac = total > 0 ? (pac / total) * 100 : 0;

  return (
    <div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-sm bg-neutral-100 dark:bg-neutral-800">
        {pctSmall > 0 && (
          <div
            className="bg-emerald-600"
            style={{ width: `${pctSmall}%` }}
          />
        )}
        {pctLarge > 0 && (
          <div className="bg-blue-500" style={{ width: `${pctLarge}%` }} />
        )}
        {pctPac > 0 && (
          <div className="bg-amber-500" style={{ width: `${pctPac}%` }} />
        )}
      </div>
      <div className="mt-1 flex gap-3 text-[10px] text-neutral-400">
        <span>
          <span className="mr-0.5 inline-block h-1 w-1 rounded-full bg-emerald-600" />
          Small {Math.round(pctSmall)}%
        </span>
        <span>
          <span className="mr-0.5 inline-block h-1 w-1 rounded-full bg-blue-500" />
          Large {Math.round(pctLarge)}%
        </span>
        <span>
          <span className="mr-0.5 inline-block h-1 w-1 rounded-full bg-amber-500" />
          PAC {Math.round(pctPac)}%
        </span>
      </div>
    </div>
  );
}

export function CompareMembers({
  memberA,
  memberB,
  billsA,
  billsB,
  votesA,
  votesB,
  financeA,
  financeB,
  committeesA,
  committeesB,
  agreement,
}: CompareMembersProps) {
  const sameChamber = memberA.chamber === memberB.chamber;
  const topCommitteesA = committeesA.filter((c) => !c.parentId);
  const topCommitteesB = committeesB.filter((c) => !c.parentId);

  return (
    <div>
      {/* Voting Agreement Hero */}
      {sameChamber ? (
        <div className="mb-8 rounded-lg border border-neutral-100 bg-neutral-50 px-6 py-5 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Voting Agreement
          </p>
          <p className="mt-1 font-serif text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            {agreement.agreementPct}%
          </p>
          <p className="mt-1 font-mono text-xs text-neutral-400">
            agreed on {agreement.agreed} of {agreement.sharedVotes} shared votes
          </p>
        </div>
      ) : (
        <div className="mb-8 rounded-lg border border-neutral-100 bg-neutral-50 px-6 py-4 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs text-neutral-400">
            Different chambers — no shared roll call votes to compare
          </p>
        </div>
      )}

      {/* Member Headers */}
      <div className="mb-8 grid grid-cols-2 gap-6">
        <MemberHeader member={memberA} />
        <MemberHeader member={memberB} />
      </div>

      {/* Stats Comparison */}
      <div>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Legislation
        </h2>
        <StatRow
          label="Bills sponsored"
          valueA={billsA.sponsored}
          valueB={billsB.sponsored}
        />
        <StatRow
          label="Bills cosponsored"
          valueA={billsA.cosponsored}
          valueB={billsB.cosponsored}
        />

        <h2 className="mb-3 mt-8 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Campaign Finance
        </h2>
        <StatRow
          label="Total raised"
          valueA={fmt(financeA ? effectiveTotal(financeA) : 0)}
          valueB={fmt(financeB ? effectiveTotal(financeB) : 0)}
        />
        <div className="flex border-b border-neutral-100 py-2 dark:border-neutral-800">
          <span className="w-40 shrink-0 text-xs text-neutral-400">
            Funding mix
          </span>
          <div className="flex-1 px-2">
            <FinanceBar finance={financeA} />
          </div>
          <div className="flex-1 px-2">
            <FinanceBar finance={financeB} />
          </div>
        </div>

        <h2 className="mb-3 mt-8 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Voting Record
        </h2>
        <StatRow
          label="Total votes"
          valueA={votesA.total}
          valueB={votesB.total}
        />
        <StatRow label="Yea" valueA={votesA.yea} valueB={votesB.yea} />
        <StatRow label="Nay" valueA={votesA.nay} valueB={votesB.nay} />
        <StatRow
          label="Missed"
          valueA={votesA.notVoting}
          valueB={votesB.notVoting}
        />

        <h2 className="mb-3 mt-8 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Committees
        </h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="mb-2 font-mono text-xs text-neutral-400">
              {topCommitteesA.length} committee{topCommitteesA.length !== 1 ? "s" : ""}
            </p>
            {topCommitteesA.map((c) => (
              <div
                key={c.committeeId}
                className="border-b border-neutral-100 py-1.5 text-xs text-neutral-700 last:border-0 dark:border-neutral-800 dark:text-neutral-300"
              >
                {c.name}
                {c.role && c.role !== "member" && (
                  <span className="ml-1.5 rounded bg-neutral-100 px-1 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {c.role}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 font-mono text-xs text-neutral-400">
              {topCommitteesB.length} committee{topCommitteesB.length !== 1 ? "s" : ""}
            </p>
            {topCommitteesB.map((c) => (
              <div
                key={c.committeeId}
                className="border-b border-neutral-100 py-1.5 text-xs text-neutral-700 last:border-0 dark:border-neutral-800 dark:text-neutral-300"
              >
                {c.name}
                {c.role && c.role !== "member" && (
                  <span className="ml-1.5 rounded bg-neutral-100 px-1 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {c.role}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
