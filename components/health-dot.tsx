import { unstable_cache } from "next/cache";
import Link from "next/link";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

type Level = "ok" | "warn" | "crit" | "unknown";

const fetchLevel = unstable_cache(
  async (): Promise<Level> => {
    try {
      const result = await db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM sync_log
            WHERE status = 'failed' AND started_at > now() - interval '14 days') AS failures,
          (SELECT COUNT(*)::int FROM sync_log
            WHERE status = 'running' AND started_at < now() - interval '6 hours') AS stuck
      `);
      const r = result.rows[0] as { failures: number; stuck: number };
      if (r.stuck > 0 || r.failures >= 3) return "crit";
      if (r.failures > 0) return "warn";
      return "ok";
    } catch {
      return "unknown";
    }
  },
  ["footer-health-level"],
  { revalidate: 60 }
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
