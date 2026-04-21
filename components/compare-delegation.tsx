import Link from "next/link";
import Image from "next/image";
import { PartyBar } from "./party-bar";
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

interface BillCountMap {
  [bioguideId: string]: { sponsored: number; cosponsored: number };
}

interface VoteSummaryMap {
  [bioguideId: string]: {
    yea: number;
    nay: number;
    present: number;
    notVoting: number;
    total: number;
  };
}

interface FinanceMap {
  [bioguideId: string]: { totalReceipts: number | null };
}

interface VotingAgreement {
  sharedVotes: number;
  agreed: number;
  agreementPct: number;
}

interface CompareDelegationProps {
  stateName: string;
  stateCode: string;
  members: MemberData[];
  billCounts: BillCountMap;
  voteSummaries: VoteSummaryMap;
  financeMap: FinanceMap;
  senatorAgreement: VotingAgreement | null;
}

const partyDot: Record<string, string> = {
  Democrat: "bg-blue-600",
  Republican: "bg-red-600",
  Independent: "bg-purple-500",
};

const partyRing: Record<string, string> = {
  Democrat: "ring-blue-600",
  Republican: "ring-red-600",
  Independent: "ring-purple-500",
};


export function CompareDelegation({
  stateName,
  stateCode,
  members: membersList,
  billCounts,
  voteSummaries,
  financeMap,
  senatorAgreement,
}: CompareDelegationProps) {
  const senators = membersList.filter((m) => m.chamber === "senate");
  const reps = membersList.filter((m) => m.chamber === "house");

  const parties = {
    democrat: membersList.filter((m) => m.party === "Democrat").length,
    republican: membersList.filter((m) => m.party === "Republican").length,
    independent: membersList.filter(
      (m) => m.party !== "Democrat" && m.party !== "Republican"
    ).length,
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-baseline gap-3">
          <h2 className="font-serif text-2xl font-semibold tracking-tight">
            <Link
              href={`/state/${stateCode}`}
              className="no-underline hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              {stateName}
            </Link>
          </h2>
          <span className="font-mono text-xs text-neutral-400">
            {membersList.length} members
          </span>
        </div>
        <div className="mt-2 max-w-xs">
          <PartyBar
            democrat={parties.democrat}
            republican={parties.republican}
            independent={parties.independent}
            showLabels
          />
        </div>
      </div>

      {/* Senator Agreement */}
      {senators.length === 2 && senatorAgreement && (
        <div className="mb-8 rounded-lg border border-neutral-100 bg-neutral-50 px-6 py-4 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Senator Voting Agreement
          </p>
          <p className="mt-1 font-serif text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            {senatorAgreement.agreementPct}%
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-neutral-400">
            {senatorAgreement.agreed} of {senatorAgreement.sharedVotes} shared
            votes
          </p>
        </div>
      )}

      {/* Senators */}
      {senators.length > 0 && (
        <section className="mb-8">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Senators
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {senators.map((s) => {
              const bc = billCounts[s.bioguideId] || {
                sponsored: 0,
                cosponsored: 0,
              };
              const vs = voteSummaries[s.bioguideId] || {
                yea: 0,
                nay: 0,
                present: 0,
                notVoting: 0,
                total: 0,
              };
              const fin = financeMap[s.bioguideId];
              const ring = partyRing[s.party] || "ring-neutral-300";

              return (
                <Link
                  key={s.bioguideId}
                  href={`/member/${s.bioguideId}`}
                  className="group block rounded-lg border border-neutral-100 p-4 no-underline transition-colors hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-600"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`relative h-10 w-10 shrink-0 overflow-hidden rounded-full ring-2 ${ring}`}
                    >
                      {s.photoUrl ? (
                        <Image
                          src={s.photoUrl}
                          alt=""
                          fill
                          sizes="40px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-neutral-100 text-xs text-neutral-400 dark:bg-neutral-800">
                          ?
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-neutral-900 group-hover:text-neutral-600 dark:text-neutral-100 dark:group-hover:text-neutral-300">
                        {s.fullName}
                      </p>
                      <p className="text-xs text-neutral-500">
                        <span
                          className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${partyDot[s.party] || "bg-neutral-400"}`}
                        />
                        {s.party}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-4 font-mono text-xs text-neutral-400">
                    <span>
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        {bc.sponsored}
                      </span>{" "}
                      bills
                    </span>
                    <span>
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        {fmt(fin?.totalReceipts ?? null)}
                      </span>{" "}
                      raised
                    </span>
                    <span>
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        {vs.total}
                      </span>{" "}
                      votes
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Representatives Table */}
      {reps.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Representatives ({reps.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs font-medium uppercase tracking-wide text-neutral-400 dark:border-neutral-700">
                  <th className="pb-2 pr-4 font-medium">Member</th>
                  <th className="pb-2 pr-4 font-medium">Party</th>
                  <th className="pb-2 pr-4 text-right font-medium">Dist.</th>
                  <th className="pb-2 pr-4 text-right font-medium">Bills</th>
                  <th className="pb-2 pr-4 text-right font-medium">Raised</th>
                  <th className="pb-2 text-right font-medium">Votes</th>
                </tr>
              </thead>
              <tbody>
                {reps
                  .sort((a, b) => (a.district || 0) - (b.district || 0))
                  .map((r) => {
                    const bc = billCounts[r.bioguideId] || {
                      sponsored: 0,
                      cosponsored: 0,
                    };
                    const vs = voteSummaries[r.bioguideId] || {
                      yea: 0,
                      nay: 0,
                      present: 0,
                      notVoting: 0,
                      total: 0,
                    };
                    const fin = financeMap[r.bioguideId];

                    return (
                      <tr
                        key={r.bioguideId}
                        className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                      >
                        <td className="py-2 pr-4">
                          <Link
                            href={`/member/${r.bioguideId}`}
                            className="text-neutral-900 no-underline hover:text-neutral-600 dark:text-neutral-100 dark:hover:text-neutral-300"
                          >
                            {r.fullName}
                          </Link>
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${partyDot[r.party] || "bg-neutral-400"}`}
                          />
                          <span className="text-xs text-neutral-500">
                            {r.party[0]}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-xs text-neutral-500">
                          {r.district || "AL"}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-xs">
                          {bc.sponsored}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-xs">
                          {fmt(fin?.totalReceipts ?? null)}
                        </td>
                        <td className="py-2 text-right font-mono text-xs">
                          {vs.total}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
