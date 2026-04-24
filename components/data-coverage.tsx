import type { MemberCoverage } from "@/lib/queries";

const statusLabel: Record<string, { text: string; color: string }> = {
  good: { text: "Tracked", color: "text-emerald-600" },
  partial: { text: "Partial", color: "text-amber-600" },
  none: { text: "Not available", color: "text-neutral-300 dark:text-neutral-600" },
};

interface MemberCoverageBarProps {
  coverage: MemberCoverage;
}

export function MemberCoverageBar({ coverage }: MemberCoverageBarProps) {
  const sources = [
    { key: "bills", label: "Legislation" },
    { key: "votes", label: "Votes" },
    { key: "finance", label: "Finance" },
    { key: "pressReleases", label: "Press" },
    { key: "committees", label: "Committees" },
  ] as const;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px]">
      {sources.map(({ key, label }) => {
        const status = coverage[key];
        const { color } = statusLabel[status];
        return (
          <span key={key} className={color}>
            <span
              className={`mr-0.5 inline-block h-1 w-1 rounded-full ${
                status === "good"
                  ? "bg-emerald-600"
                  : status === "partial"
                    ? "bg-amber-500"
                    : "bg-neutral-200 dark:bg-neutral-700"
              }`}
            />
            {label}
          </span>
        );
      })}
    </div>
  );
}

interface StateCoverageNoteProps {
  totalMembers: number;
  membersWithPressReleases: number;
  membersWithFinance: number;
}

export function StateCoverageNote({
  totalMembers,
  membersWithPressReleases,
  membersWithFinance,
}: StateCoverageNoteProps) {
  const notes: string[] = [];

  if (membersWithFinance < totalMembers) {
    notes.push(
      `Campaign finance: ${membersWithFinance}/${totalMembers} members (FEC data availability varies by filing schedule)`
    );
  }
  if (membersWithPressReleases < totalMembers) {
    notes.push(
      `Press releases: ${membersWithPressReleases}/${totalMembers} members (via RSS — not all offices publish feeds)`
    );
  }

  if (notes.length === 0) return null;

  return (
    <div className="border-t border-neutral-100 pt-4 dark:border-neutral-800">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-300 dark:text-neutral-600">
        Data coverage
      </p>
      <div className="space-y-0.5">
        {notes.map((note, i) => (
          <p key={i} className="text-[11px] text-neutral-400">
            {note}
          </p>
        ))}
      </div>
    </div>
  );
}

interface SectionCoverageProps {
  status: "good" | "partial" | "none";
  note: string;
}

export function SectionCoverageNote({ status, note }: SectionCoverageProps) {
  if (status === "good") return null;
  return (
    <p className="mt-1 text-[10px] italic text-neutral-400">
      {note}
    </p>
  );
}
