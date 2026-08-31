import { unstable_cache } from "next/cache";
import Link from "next/link";
import { buildHealthReport } from "@/lib/health";

type Level = "ok" | "warn" | "crit" | "unknown";

// Reads the same report /health renders. The footer used to run its own
// sync_log query with different thresholds, so the two could disagree on the
// same page load — the footer saying "Critical issues" while /health said
// "Minor issues". One source, one answer.
const fetchLevel = unstable_cache(
  async (): Promise<Level> => {
    try {
      return (await buildHealthReport()).level;
    } catch {
      return "unknown";
    }
  },
  ["footer-health-level"],
  // The footer renders on every page, so this value caps the whole site's
  // route revalidate (Next takes the minimum). Keep it at an hour — /health
  // itself is force-dynamic and always fresh.
  { revalidate: 3600 }
);

const STYLE: Record<Level, { color: string; label: string }> = {
  ok: { color: "bg-emerald-500", label: "All systems normal" },
  warn: { color: "bg-amber-500", label: "Minor issues" },
  crit: { color: "bg-red-500", label: "Critical issues" },
  unknown: { color: "bg-neutral-300", label: "Status unavailable" },
};

export async function HealthDot() {
  const level = await fetchLevel();
  const s = STYLE[level];
  return (
    <Link
      href="/health"
      className="inline-flex items-center gap-1.5 transition-colors hover:text-neutral-900"
      title={s.label}
      aria-label={`Pipeline health: ${s.label}`}
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${s.color}`}
      />
      Health
    </Link>
  );
}
