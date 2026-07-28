import Link from "next/link";

// Every person named anywhere on the site resolves to a page. Which page
// depends on what we actually hold for them:
//   sitting member  -> the full member record
//   ballot record   -> the candidate profile
//   FEC filer only  -> the thin filing-backed profile
// A person with none of the three is rendered as plain text rather than a
// link that would 404.
export function candidateHref({
  bioguideId,
  personId,
  fecCandidateId,
}: {
  bioguideId?: string | null;
  personId?: string | null;
  fecCandidateId?: string | null;
}) {
  if (bioguideId) return `/member/${bioguideId}`;
  if (personId) return `/candidate/${encodeURIComponent(personId)}`;
  if (fecCandidateId) return `/candidate/fec-${encodeURIComponent(fecCandidateId)}`;
  return null;
}

export function CandidateName({
  name,
  bioguideId,
  personId,
  fecCandidateId,
  className = "",
}: {
  name: string;
  bioguideId?: string | null;
  personId?: string | null;
  fecCandidateId?: string | null;
  className?: string;
}) {
  const href = candidateHref({ bioguideId, personId, fecCandidateId });
  if (!href) return <span className={className}>{name}</span>;
  return (
    <Link
      href={href}
      className={`no-underline hover:underline decoration-neutral-300 underline-offset-2 ${className}`}
    >
      {name}
    </Link>
  );
}
