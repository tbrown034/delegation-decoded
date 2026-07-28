import assert from "node:assert/strict";
import test from "node:test";
import {
  currentFecId,
  isReportableEmployer,
  mapCandidateFinance,
} from "../scripts/lib/fec-mapping";
import { effectiveTotal, fmt } from "../lib/finance";

// Every case below is drawn from a bug that shipped to production. They all
// failed silently — a stale ID, a zero, or a placeholder outranking real
// donors — so none of them would have been caught by an error path.

// ---------------------------------------------------------------------------
// currentFecId — chamber-switchers pointed at dead committees
// ---------------------------------------------------------------------------

test("currentFecId picks the Senate ID for a member who moved up from the House", () => {
  // Schiff's real id.fec, oldest-first. Taking [0] gave H0CA27085, his 2000
  // House run, whose committee stopped filing two decades ago.
  assert.equal(
    currentFecId(["H0CA27085", "S4CA00555"], "senate"),
    "S4CA00555"
  );
});

test("currentFecId keeps the House ID for a sitting representative", () => {
  assert.equal(currentFecId(["H8PA15195"], "house"), "H8PA15195");
});

test("currentFecId picks the newest matching ID when several share a chamber", () => {
  assert.equal(
    currentFecId(["H4MS01078", "S8MS00196", "S8MS00300"], "senate"),
    "S8MS00300"
  );
});

test("currentFecId ignores the other chamber's IDs entirely", () => {
  // A senator with two House runs and one Senate run must not get a House ID.
  const picked = currentFecId(
    ["H8VT01016", "H8VT01017", "S4VT00033"],
    "senate"
  );
  assert.equal(picked, "S4VT00033");
  assert.ok(picked?.startsWith("S"));
});

test("currentFecId falls back to the newest ID when no office letter matches", () => {
  // Keeps a usable ID rather than dropping the member from finance entirely.
  assert.equal(currentFecId(["H0CA27085"], "senate"), "H0CA27085");
});

test("currentFecId returns null for missing or empty ID lists", () => {
  assert.equal(currentFecId(undefined, "senate"), null);
  assert.equal(currentFecId(null, "house"), null);
  assert.equal(currentFecId([], "senate"), null);
});

test("currentFecId never returns a House ID for a senator who has a Senate one", () => {
  // Regression guard for the whole class: 37 sitting members were affected.
  const cases: Array<[string[], string]> = [
    [["H0CA27085", "S4CA00555"], "S4CA00555"],
    [["H4MS01078", "S8MS00196"], "S8MS00196"],
    [["H6NY20167", "S0NY00410"], "S0NY00410"],
    [["H8WI00018", "S2WI00219"], "S2WI00219"],
    [["H2TN06030", "S8TN00337"], "S8TN00337"],
  ];
  for (const [ids, expected] of cases) {
    assert.equal(currentFecId(ids, "senate"), expected);
  }
});

// ---------------------------------------------------------------------------
// isReportableEmployer — "NULL" outranked real donors on 433 member pages
// ---------------------------------------------------------------------------

test("isReportableEmployer rejects the FEC's NULL aggregation bucket", () => {
  // This was Schiff's top "contributor" at $309,460 before the filter caught it.
  assert.equal(isReportableEmployer("NULL"), false);
  assert.equal(isReportableEmployer("null"), false);
  assert.equal(isReportableEmployer("  NULL  "), false);
});

test("isReportableEmployer rejects FEC reporting categories", () => {
  for (const value of [
    "RETIRED",
    "HOMEMAKER",
    "SELF-EMPLOYED",
    "SELF EMPLOYED",
    "UNEMPLOYED",
    "NOT EMPLOYED",
    "NONE",
    "N/A",
    "NA",
    "REQUESTED",
    "INFORMATION REQUESTED",
    "INFORMATION REQUESTED PER BEST EFFORTS",
  ]) {
    assert.equal(isReportableEmployer(value), false, `should reject ${value}`);
  }
});

test("isReportableEmployer rejects values with no letters", () => {
  // A bare filer ID showed up as a contributor name in the first full run.
  assert.equal(isReportableEmployer("561798998"), false);
  assert.equal(isReportableEmployer("-"), false);
  assert.equal(isReportableEmployer("--"), false);
  assert.equal(isReportableEmployer("."), false);
  assert.equal(isReportableEmployer("   "), false);
});

test("isReportableEmployer rejects empty and missing values", () => {
  assert.equal(isReportableEmployer(""), false);
  assert.equal(isReportableEmployer(null), false);
  assert.equal(isReportableEmployer(undefined), false);
});

test("isReportableEmployer accepts real organizations", () => {
  for (const value of [
    "EDISON INTERNATIONAL",
    "BLACKSTONE",
    "PANISH SHEA BOYLE RAVIPUDI, LLP",
    "STATE OF CALIFORNIA",
    "DREYER BABICH BUCCOLA WOOD CAMPORA",
  ]) {
    assert.equal(isReportableEmployer(value), true, `should accept ${value}`);
  }
});

test("isReportableEmployer does not reject organizations that merely contain a category word", () => {
  // "SELF" is filtered, but a firm whose name contains it must survive.
  assert.equal(isReportableEmployer("SELF RELIANCE CREDIT UNION"), true);
  assert.equal(isReportableEmployer("RETIRED TEACHERS ASSOCIATION"), true);
  assert.equal(isReportableEmployer("NULL ISLAND HOLDINGS"), true);
});

// ---------------------------------------------------------------------------
// mapCandidateFinance — a field-name typo zeroed all 2,811 rows
// ---------------------------------------------------------------------------

// A real /candidate/S4CA00555/totals row, trimmed to the fields we read.
const SCHIFF_2026 = {
  cycle: 2026,
  receipts: 8832154.09,
  disbursements: 4960719.67,
  last_cash_on_hand_end_period: 10252461.04,
  individual_contributions: 7218132.59,
  other_political_committee_contributions: 69401,
  individual_unitemized_contributions: 4386313.44,
};

test("mapCandidateFinance reads the field names the FEC actually returns", () => {
  assert.deepEqual(mapCandidateFinance(SCHIFF_2026), {
    totalReceipts: 8832154,
    totalDisbursements: 4960720,
    cashOnHand: 10252461,
    totalIndividual: 7218133,
    totalPac: 69401,
    smallIndividual: 4386313,
  });
});

test("mapCandidateFinance yields a non-zero total for a funded candidate", () => {
  // The bug's signature was a plausible row of zeros, never an error.
  const mapped = mapCandidateFinance(SCHIFF_2026);
  assert.ok(mapped.totalReceipts > 0, "receipts must not be zero");
  assert.ok(mapped.cashOnHand > 0, "cash on hand must not be zero");
  assert.ok(mapped.totalIndividual > 0, "individual must not be zero");
});

test("mapCandidateFinance ignores the total_-prefixed names that do not exist", () => {
  // Guards the exact regression: a payload carrying only the old field names
  // must map to zeros, proving those keys are no longer what we read. If
  // someone reintroduces the prefix, the assertion above starts failing.
  const legacyShape = {
    total_receipts: 8832154.09,
    total_disbursements: 4960719.67,
    cash_on_hand_end_period: 10252461.04,
    total_individual_contributions: 7218132.59,
  } as unknown as Parameters<typeof mapCandidateFinance>[0];

  const mapped = mapCandidateFinance(legacyShape);
  assert.equal(mapped.totalReceipts, 0);
  assert.equal(mapped.totalDisbursements, 0);
  assert.equal(mapped.cashOnHand, 0);
  assert.equal(mapped.totalIndividual, 0);
});

test("mapCandidateFinance treats missing values as zero rather than NaN", () => {
  const mapped = mapCandidateFinance({});
  assert.deepEqual(mapped, {
    totalReceipts: 0,
    totalDisbursements: 0,
    cashOnHand: 0,
    totalIndividual: 0,
    totalPac: 0,
    smallIndividual: 0,
  });
  for (const value of Object.values(mapped)) {
    assert.ok(Number.isFinite(value), "every mapped value must be finite");
  }
});

test("mapCandidateFinance rounds to whole dollars for BIGINT columns", () => {
  const mapped = mapCandidateFinance({ receipts: 100.49, disbursements: 100.5 });
  assert.equal(mapped.totalReceipts, 100);
  assert.equal(mapped.totalDisbursements, 101);
  assert.ok(Number.isInteger(mapped.totalReceipts));
});

// ---------------------------------------------------------------------------
// effectiveTotal — the fallback that masked the zeroing for months
// ---------------------------------------------------------------------------

test("effectiveTotal prefers reported receipts over summing components", () => {
  // Once receipts are populated the fallback must stop being used, or pages
  // keep showing a component sum in place of the real reported figure.
  assert.equal(
    effectiveTotal({
      totalReceipts: 8832154,
      totalIndividual: 7218133,
      totalPac: 69401,
      smallIndividual: 4386313,
    }),
    8832154
  );
});

test("effectiveTotal falls back to components only when receipts are absent", () => {
  assert.equal(
    effectiveTotal({
      totalReceipts: 0,
      totalIndividual: 7218133,
      totalPac: 69401,
      smallIndividual: 4386313,
    }),
    7218133 + 69401
  );
});

test("effectiveTotal uses small-dollar total when the individual total is missing", () => {
  assert.equal(
    effectiveTotal({
      totalReceipts: 0,
      totalIndividual: 0,
      totalPac: 5000,
      smallIndividual: 12000,
    }),
    17000
  );
});

test("effectiveTotal returns zero for a filer reporting nothing", () => {
  // Legitimate case: 15 sitting members have cycles the FEC reports as $0.
  assert.equal(
    effectiveTotal({
      totalReceipts: 0,
      totalIndividual: 0,
      totalPac: 0,
      smallIndividual: 0,
    }),
    0
  );
});

test("effectiveTotal handles null columns without producing NaN", () => {
  const total = effectiveTotal({
    totalReceipts: null,
    totalIndividual: null,
    totalPac: null,
    smallIndividual: null,
  });
  assert.equal(total, 0);
  assert.ok(Number.isFinite(total));
});

// ---------------------------------------------------------------------------
// fmt — what the reader actually sees
// ---------------------------------------------------------------------------

test("fmt renders campaign totals at newsroom precision", () => {
  assert.equal(fmt(8832154), "$8.8M");
  assert.equal(fmt(48149197), "$48.1M");
  assert.equal(fmt(54800), "$55K");
  assert.equal(fmt(521804), "$522K");
  assert.equal(fmt(950), "$950");
});

test("fmt shows zero rather than a blank for a filer with no receipts", () => {
  assert.equal(fmt(0), "$0");
  assert.equal(fmt(null), "$0");
});
