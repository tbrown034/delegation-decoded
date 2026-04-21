import Link from "next/link";
import Image from "next/image";

interface MemberCardProps {
  bioguideId: string;
  fullName: string;
  party: string;
  chamber: string;
  district: number | null;
  photoUrl: string | null;
  stateCode: string;
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

export function MemberCard({
  bioguideId,
  fullName,
  party,
  chamber,
  district,
  photoUrl,
}: MemberCardProps) {
  const ringClass = partyRing[party] || "ring-neutral-300";
  const dotClass = partyDot[party] || "bg-neutral-400";

  const seat =
    chamber === "senate"
      ? "Senator"
      : district
        ? `District ${district}`
        : "At-Large";

  return (
    <Link
      href={`/member/${bioguideId}`}
      className="group flex items-center gap-3.5 border-b border-neutral-100 py-2.5 no-underline transition-colors last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
    >
      <div
        className={`relative h-9 w-9 shrink-0 overflow-hidden rounded-full ring-[1.5px] ${ringClass}`}
      >
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt=""
            fill
            sizes="36px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-neutral-100 text-[10px] text-neutral-400 dark:bg-neutral-800">
            ?
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-neutral-900 group-hover:text-neutral-600 dark:text-neutral-100">
          {fullName}
        </span>
      </div>
      <span className="flex items-center gap-1.5 text-xs text-neutral-400">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {seat}
      </span>
    </Link>
  );
}
