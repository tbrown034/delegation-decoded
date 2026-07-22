export type HouseSeat = {
  office: "H";
  district: number;
};

export type SenateSeat = {
  office: "S";
  senateClass: 1 | 2 | 3;
};

export type MemberSeat = HouseSeat | SenateSeat;

type MemberLike = {
  chamber: string;
  district: number | null;
};

type TermLike = {
  chamber: string;
  endDate: string | null;
  isCurrent: boolean;
};

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Senate classes repeat on a six-year calendar: Class 1 was regularly elected
 * in 2024, Class 2 in 2026, and Class 3 in 2028. A senator appointed to fill a
 * vacancy keeps the class (and scheduled term end) of that physical seat.
 */
export function regularSenateClassForElectionYear(
  electionYear: number
): 1 | 2 | 3 | null {
  const offset = positiveModulo(electionYear - 2024, 6);
  if (offset === 0) return 1;
  if (offset === 2) return 2;
  if (offset === 4) return 3;
  return null;
}

export function senateClassFromTermEnd(
  endDate: string | null
): 1 | 2 | 3 | null {
  if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const endYear = Number(endDate.slice(0, 4));
  if (!Number.isInteger(endYear)) return null;
  return regularSenateClassForElectionYear(endYear - 1);
}

export function resolveMemberSeat(
  member: MemberLike,
  terms: readonly TermLike[]
): MemberSeat | null {
  if (member.chamber === "house") {
    const district = member.district ?? 0;
    return Number.isInteger(district) && district >= 0
      ? { office: "H", district }
      : null;
  }
  if (member.chamber !== "senate") return null;
  const current = terms.find(
    (term) => term.isCurrent && term.chamber === "senate"
  );
  const senateClass = senateClassFromTermEnd(current?.endDate ?? null);
  return senateClass ? { office: "S", senateClass } : null;
}

export function memberSeatKey(seat: MemberSeat) {
  return seat.office === "H" ? `H${seat.district}` : `S${seat.senateClass}`;
}

export function memberSeatLabel(seat: MemberSeat) {
  return seat.office === "H"
    ? seat.district === 0
      ? "U.S. House at-large seat"
      : `U.S. House District ${seat.district}`
    : `U.S. Senate Class ${seat.senateClass} seat`;
}
