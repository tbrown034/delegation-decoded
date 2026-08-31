import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { committees } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

type Props = { params: Promise<{ committeeId: string }> };

const normalizeRole = (r: string) => r.toLowerCase().replace(/_/g, " ");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { committeeId } = await params;
  const [c] = await db
    .select()
    .from(committees)
    .where(eq(committees.committeeId, committeeId))
    .limit(1);
  if (!c) return { title: "Committee not found" };
  return {
    title: c.name,
    description: `Members and parent committee for ${c.name}.`,
    alternates: { canonical: `/committee/${c.committeeId}` },
  };
}

async function getCommittee(committeeId: string) {
  const [committee] = await db
    .select()
    .from(committees)
    .where(eq(committees.committeeId, committeeId))
    .limit(1);
  if (!committee) return null;

  // Pull most recent assignment per member (latest congress)
  const [parentRows, subcommittees, assignmentRows] = await Promise.all([
    committee.parentId
      ? db
          .select()
          .from(committees)
          .where(eq(committees.committeeId, committee.parentId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(committees)
      .where(eq(committees.parentId, committeeId))
      .orderBy(committees.name),
    db.execute(sql`
      SELECT DISTINCT ON (m.bioguide_id)
        m.bioguide_id, m.full_name, m.party, m.state_code, m.district, m.chamber,
        ca.role, ca.congress
      FROM committee_assignments ca
      JOIN members m ON m.bioguide_id = ca.bioguide_id
      WHERE ca.committee_id = ${committeeId}
        AND m.in_office = true
      ORDER BY m.bioguide_id, ca.congress DESC
    `),
  ]);
  const parent = parentRows[0] ?? null;

  type AssignmentRow = {
    bioguide_id: string;
    full_name: string;
    party: string;
    state_code: string;
    district: number | null;
    chamber: string;
    role: string;
    congress: number;
  };
  const memberAssignments = (assignmentRows.rows as AssignmentRow[]).sort((a, b) => {
    const roleRank: Record<string, number> = {
      chair: 0,
      "ranking member": 1,
      "vice chair": 2,
      member: 3,
    };
    const ra = roleRank[normalizeRole(a.role)] ?? 5;
    const rb = roleRank[normalizeRole(b.role)] ?? 5;
    if (ra !== rb) return ra - rb;
    return a.full_name.localeCompare(b.full_name);
  });

  return { committee, parent, subcommittees, memberAssignments };
}

const PARTY_DOT: Record<string, string> = {
  Democrat: "bg-blue-600",
  Republican: "bg-red-600",
  Independent: "bg-purple-500",
};

const CHAMBER_LABEL: Record<string, string> = {
  senate: "Senate",
  house: "House",
  joint: "Joint",
};

export default async function CommitteePage({ params }: Props) {
  const { committeeId } = await params;
  const data = await getCommittee(committeeId);
  if (!data) notFound();
  const { committee, parent, subcommittees, memberAssignments } = data;

  const partyCounts = memberAssignments.reduce<Record<string, number>>(
    (acc, m) => {
      acc[m.party] = (acc[m.party] ?? 0) + 1;
      return acc;
    },
    {}
  );

  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <nav className="mb-6 font-mono text-xs text-neutral-400">
        <Link href="/" className="hover:text-neutral-700">
          Home
        </Link>
        <span className="mx-1.5">/</span>
        <span>Committee</span>
        <span className="mx-1.5">/</span>
        <span className="text-neutral-900">{committee.committeeId}</span>
      </nav>

      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-neutral-500">
          {CHAMBER_LABEL[committee.chamber] ?? committee.chamber} committee
        </p>
        <h1 className="mt-1 font-serif text-3xl font-semibold leading-tight tracking-tight">
          {committee.name}
        </h1>
        {parent && (
          <p className="mt-2 text-sm text-neutral-500">
            Subcommittee of{" "}
            <Link
              href={`/committee/${parent.committeeId}`}
              className="underline hover:text-neutral-900"
            >
              {parent.name}
            </Link>
          </p>
        )}
        {committee.url && (
          <p className="mt-2">
            <a
              href={committee.url}
              className="text-[12px] underline hover:text-neutral-900"
              target="_blank"
              rel="noopener noreferrer"
            >
              Official site →
            </a>
          </p>
        )}
      </header>

      {memberAssignments.length > 0 && (
        <section className="mb-10">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-serif text-lg font-semibold">
              Members{" "}
              <span className="font-mono text-xs font-normal text-neutral-400">
                ({memberAssignments.length})
              </span>
            </h2>
            <p className="font-mono text-[11px] text-neutral-400">
              {Object.entries(partyCounts)
                .map(([p, n]) => `${n} ${p[0]}`)
                .join(" · ")}
            </p>
          </div>
          <ul className="divide-y divide-neutral-100 rounded border border-neutral-200">
            {memberAssignments.map((m) => (
              <li key={m.bioguide_id}>
                <Link
                  href={`/member/${m.bioguide_id}`}
                  className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm no-underline hover:bg-stone-50"
                >
                  <span className="flex items-baseline gap-2">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${PARTY_DOT[m.party] ?? "bg-neutral-400"}`}
                      aria-hidden
                    />
                    <span className="font-medium text-neutral-900">{m.full_name}</span>
                    <span className="font-mono text-[11px] text-neutral-400">
                      {m.state_code}
                      {m.district ? `-${m.district}` : ""}
                    </span>
                  </span>
                  {normalizeRole(m.role) !== "member" && (
                    <span className="font-mono text-[11px] uppercase tracking-wide text-neutral-700">
                      {normalizeRole(m.role)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {subcommittees.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-serif text-lg font-semibold">Subcommittees</h2>
          <ul className="divide-y divide-neutral-100 rounded border border-neutral-200">
            {subcommittees.map((s) => (
              <li key={s.committeeId}>
                <Link
                  href={`/committee/${s.committeeId}`}
                  className="block px-3 py-2 text-sm no-underline hover:bg-stone-50"
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

// No build-time prerender: pages generate on first request, then serve
// from the ISR cache for the site-wide revalidate window.
export function generateStaticParams() {
  return [];
}
