import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { bills, billSponsorships, members } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

type Props = { params: Promise<{ billId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { billId } = await params;
  const [b] = await db.select().from(bills).where(eq(bills.billId, billId)).limit(1);
  if (!b) return { title: "Bill not found" };
  const label = `${b.billType.toUpperCase()} ${b.billNumber}`;
  return {
    title: `${label} — ${b.title.slice(0, 80)}`,
    description: b.title,
  };
}

async function getBill(billId: string) {
  const [bill] = await db
    .select()
    .from(bills)
    .where(eq(bills.billId, billId))
    .limit(1);
  if (!bill) return null;

  const sponsorships = await db
    .select({
      role: billSponsorships.role,
      cosponsoredDate: billSponsorships.cosponsoredDate,
      bioguideId: members.bioguideId,
      fullName: members.fullName,
      party: members.party,
      stateCode: members.stateCode,
      district: members.district,
      chamber: members.chamber,
    })
    .from(billSponsorships)
    .innerJoin(members, eq(members.bioguideId, billSponsorships.bioguideId))
    .where(eq(billSponsorships.billId, billId))
    .orderBy(billSponsorships.role, members.lastName);

  const sponsor = sponsorships.find((s) => s.role === "sponsor");
  const cosponsors = sponsorships.filter((s) => s.role !== "sponsor");

  return { bill, sponsor, cosponsors };
}

const PARTY_DOT: Record<string, string> = {
  Democrat: "bg-blue-600",
  Republican: "bg-red-600",
  Independent: "bg-purple-500",
};

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function BillPage({ params }: Props) {
  const { billId } = await params;
  const data = await getBill(billId);
  if (!data) notFound();
  const { bill, sponsor, cosponsors } = data;

  const label = `${bill.billType.toUpperCase()} ${bill.billNumber}`;
  const cosponsorPartyCounts = cosponsors.reduce<Record<string, number>>(
    (acc, c) => {
      acc[c.party] = (acc[c.party] ?? 0) + 1;
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
        <span>Bill</span>
        <span className="mx-1.5">/</span>
        <span className="text-neutral-900">{label}</span>
      </nav>

      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-neutral-500">
          {label} · {bill.congress}th Congress
        </p>
        <h1 className="mt-1 font-serif text-3xl font-semibold leading-tight tracking-tight">
          {bill.title}
        </h1>
        {bill.shortTitle && bill.shortTitle !== bill.title && (
          <p className="mt-2 text-sm italic text-neutral-500">
            Short title: {bill.shortTitle}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-neutral-500">
          {bill.introducedDate && <span>Introduced {fmtDate(bill.introducedDate)}</span>}
          {bill.latestActionDate && (
            <span>Last action {fmtDate(bill.latestActionDate)}</span>
          )}
          {bill.policyArea && <span>· {bill.policyArea}</span>}
          {bill.billUrl && (
            <a
              href={bill.billUrl}
              className="underline hover:text-neutral-900"
              target="_blank"
              rel="noopener noreferrer"
            >
              Congress.gov →
            </a>
          )}
        </div>
      </header>

      {bill.latestActionText && (
        <section className="mb-8 rounded border border-neutral-200 bg-stone-50 p-4 text-sm leading-relaxed text-neutral-700">
          <p className="font-mono text-[10px] uppercase tracking-wide text-neutral-500">
            Latest action
          </p>
          <p className="mt-1.5">{bill.latestActionText}</p>
        </section>
      )}

      {sponsor && (
        <section className="mb-10">
          <h2 className="mb-3 font-serif text-lg font-semibold">Sponsor</h2>
          <SponsorCard sponsor={sponsor} />
        </section>
      )}

      {cosponsors.length > 0 && (
        <section className="mb-10">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-serif text-lg font-semibold">
              Cosponsors{" "}
              <span className="font-mono text-xs font-normal text-neutral-400">
                ({cosponsors.length})
              </span>
            </h2>
            <p className="font-mono text-[11px] text-neutral-400">
              {Object.entries(cosponsorPartyCounts)
                .map(([p, n]) => `${n} ${p[0]}`)
                .join(" · ")}
            </p>
          </div>
          <ul className="divide-y divide-neutral-100 rounded border border-neutral-200">
            {cosponsors.map((c) => (
              <li key={c.bioguideId}>
                <Link
                  href={`/member/${c.bioguideId}`}
                  className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm no-underline hover:bg-stone-50"
                >
                  <span className="flex items-baseline gap-2">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${PARTY_DOT[c.party] ?? "bg-neutral-400"}`}
                      aria-hidden
                    />
                    <span className="font-medium text-neutral-900">{c.fullName}</span>
                    <span className="font-mono text-[11px] text-neutral-400">
                      {c.stateCode}
                      {c.district ? `-${c.district}` : ""}
                    </span>
                  </span>
                  {c.cosponsoredDate && (
                    <span className="font-mono text-[11px] text-neutral-400">
                      {fmtDate(c.cosponsoredDate)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

type SponsorRow = {
  bioguideId: string;
  fullName: string;
  party: string;
  stateCode: string;
  district: number | null;
  chamber: string;
};

function SponsorCard({ sponsor }: { sponsor: SponsorRow }) {
  const districtSuffix = sponsor.district ? `-${sponsor.district}` : "";
  return (
    <Link
      href={`/member/${sponsor.bioguideId}`}
      className="flex items-baseline justify-between gap-4 rounded border border-neutral-200 px-4 py-3 no-underline transition-colors hover:border-neutral-400 hover:bg-stone-50"
    >
      <span className="flex items-baseline gap-2">
        <span
          className={`h-2 w-2 shrink-0 self-center rounded-full ${PARTY_DOT[sponsor.party] ?? "bg-neutral-400"}`}
          aria-hidden
        />
        <span className="font-serif text-base font-semibold text-neutral-900">
          {sponsor.fullName}
        </span>
        <span className="text-sm text-neutral-500">
          {sponsor.party} · {sponsor.stateCode}
          {districtSuffix}
        </span>
      </span>
      <span className="font-mono text-[11px] uppercase tracking-wide text-neutral-400">
        Profile →
      </span>
    </Link>
  );
}
