// Constant-time secret comparison, shared by every route that checks a
// caller-supplied value against a server secret (the /admin key gate in
// proxy.ts, the /api/revalidate secret). Hashing both sides first means the
// XOR loop always walks two fixed-length digests, so comparison time does
// not leak how many characters of the candidate were correct. Refuses
// whenever the expected value or the candidate is missing, so an unset env
// var can never be satisfied by an empty or absent header.
export async function secretMatches(
  candidate: string | null | undefined,
  expected: string | null | undefined
): Promise<boolean> {
  if (!expected || !candidate) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}
