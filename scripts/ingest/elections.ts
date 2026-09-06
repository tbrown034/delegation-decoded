import "../lib/env";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray, lt, lte, sql } from "drizzle-orm";
import {
  candidateIdentifiers,
  candidatePeople,
  candidateStatusEvents,
  candidacies,
  candidacyBallotLines,
  electionCandidates,
  electionContests,
  electionResults,
  electionSourceSnapshots,
  electionSources,
  electionStages,
  syncLog,
} from "../../lib/schema";
import {
  DELAWARE_2026_SOURCES,
  ELECTION_SOURCE_REGISTRY,
  FLORIDA_2026_SOURCES,
  INDIANA_2026_SOURCES,
  MICHIGAN_2026_SOURCES,
  NEBRASKA_2026_SOURCES,
  RHODE_ISLAND_2026_SOURCES,
  WASHINGTON_2026_SOURCES,
} from "../../lib/elections/registry";
import {
  candidateNamesLikelySame,
  candidateIdentity,
  houseContestId,
  normalizeCandidateName,
  senateContestId,
  stableElectionId,
} from "../../lib/elections/ids";
import { safeFetchBuffer } from "../lib/safe-fetch";
import { storeElectionSnapshot } from "../lib/election-snapshots";
import {
  parseIndianaGeneralWorkbook,
  parseIndianaPrimaryResults,
  type IndianaGeneralCandidate,
  type IndianaPrimaryCandidate,
} from "../lib/indiana-election-parser";
import {
  parseDelawareCandidateWorkbook,
  type DelawareCandidate,
} from "../lib/delaware-election-parser";
import {
  parseFloridaCandidateTsv,
  type FloridaCandidate,
} from "../lib/florida-election-parser";
import {
  parseRhodeIslandCandidateWorkbook,
  type RhodeIslandCandidate,
} from "../lib/rhode-island-election-parser";
import {
  parseNebraskaCurrentCandidateWorkbook,
  parseNebraskaPrimaryResultPages,
  validateNebraskaCanvassPdf,
  validateNebraskaSourcePage,
  type NebraskaCurrentCandidate,
  type NebraskaPrimaryCandidate,
  type NebraskaParty,
} from "../lib/nebraska-election-parser";
import {
  parseMichiganCandidateReport,
  parseMichiganCandidateReportHtml,
  type MichiganCandidate,
} from "../lib/michigan-election-parser";
import { parseWashingtonPrimaryCandidateHtml } from "../lib/washington-election-parser";

const DRY_RUN = process.argv.includes("--dry-run");
const BACKFILL = process.argv.includes("--backfill");
const STATE_ARG = process.argv.find((argument) => argument.startsWith("--state="));
const REQUESTED_STATE = STATE_ARG?.split("=", 2)[1]?.trim().toUpperCase() ?? null;
// Every state with an implemented adapter. The adapterKey list inside
// selectedStates stays literal on purpose: keys are named, not derived.
const ADAPTER_STATES = ["IN", "DE", "FL", "RI", "NE", "MI", "WA"];
const INDIANA_SOURCE_ID = "state-in";
const DELAWARE_SOURCE_ID = "state-de";
const FLORIDA_SOURCE_ID = "state-fl";
const RHODE_ISLAND_SOURCE_ID = "state-ri";
const NEBRASKA_SOURCE_ID = "state-ne";
const MICHIGAN_SOURCE_ID = "state-mi";
const WASHINGTON_SOURCE_ID = "state-wa";

type Database = ReturnType<typeof drizzle>;

function partyCode(party: string) {
  const normalized = party.toLowerCase();
  if (normalized.includes("democrat")) return "D";
  if (normalized.includes("republican")) return "R";
  return normalized.replace(/[^a-z0-9]/g, "").slice(0, 12) || "other";
}

async function seedSourceRegistry(db: Database) {
  for (const source of ELECTION_SOURCE_REGISTRY) {
    await db
      .insert(electionSources)
      .values(source)
      .onConflictDoUpdate({
        target: electionSources.sourceId,
        set: {
          authorityName: source.authorityName,
          sourceKind: source.sourceKind,
          sourceUrl: source.sourceUrl,
          adapterKey: source.adapterKey,
          isAuthoritative: source.isAuthoritative,
          certificationWindowDays: source.certificationWindowDays,
          nextExpectedEvent: source.nextExpectedEvent,
          notes: source.notes,
          updatedAt: new Date(),
        },
      });
  }
}

async function discoverIndianaGeneralListUrl() {
  try {
    const landing = await safeFetchBuffer(INDIANA_2026_SOURCES.candidateLanding, {
      allowedHosts: new Set(["www.in.gov"]),
      allowedContentTypes: ["text/html"],
      maxBytes: 2_000_000,
    });
    const match = landing.body
      .toString("utf8")
      .match(/["']([^"']*files\/2026-General-Candidate-List[^"']*\.xlsx)["']/i);
    if (match) {
      return new URL(match[1], INDIANA_2026_SOURCES.candidateLanding).toString();
    }
  } catch {
    // Landing page unavailable; the pinned revision below still works.
  }
  return INDIANA_2026_SOURCES.generalCandidateList;
}

async function fetchIndianaSources() {
  const generalListUrl = await discoverIndianaGeneralListUrl();
  const [general, settings, primaryResults] = await Promise.all([
    safeFetchBuffer(generalListUrl, {
      allowedHosts: new Set(["www.in.gov"]),
      allowedContentTypes: [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      maxBytes: 10_000_000,
    }),
    safeFetchBuffer(INDIANA_2026_SOURCES.primarySettings, {
      allowedHosts: new Set(["enr.indianavoters.in.gov"]),
      allowedContentTypes: ["application/json"],
      maxBytes: 100_000,
    }),
    safeFetchBuffer(INDIANA_2026_SOURCES.primaryHouseResults, {
      allowedHosts: new Set(["enr.indianavoters.in.gov"]),
      allowedContentTypes: ["application/json"],
      maxBytes: 5_000_000,
    }),
  ]);

  const [generalCandidates, primary] = await Promise.all([
    parseIndianaGeneralWorkbook(general.body),
    Promise.resolve(
      parseIndianaPrimaryResults(
        JSON.parse(settings.body.toString("utf8")),
        JSON.parse(primaryResults.body.toString("utf8"))
      )
    ),
  ]);
  return { general, settings, primaryResults, generalCandidates, primary };
}

async function fetchDelawareSources() {
  const [primary, general] = await Promise.all([
    safeFetchBuffer(DELAWARE_2026_SOURCES.primaryCandidateList, {
      allowedHosts: new Set(["elections.delaware.gov"]),
      allowedContentTypes: [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      maxBytes: 5_000_000,
    }),
    safeFetchBuffer(DELAWARE_2026_SOURCES.generalCandidateList, {
      allowedHosts: new Set(["elections.delaware.gov"]),
      allowedContentTypes: [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      maxBytes: 5_000_000,
    }),
  ]);
  const [primaryCandidates, generalCandidates] = await Promise.all([
    parseDelawareCandidateWorkbook(primary.body, "primary"),
    parseDelawareCandidateWorkbook(general.body, "general"),
  ]);
  return { primary, general, primaryCandidates, generalCandidates };
}

async function fetchFloridaSource() {
  const exportResult = await safeFetchBuffer(FLORIDA_2026_SOURCES.candidateExtract, {
    allowedHosts: new Set(["dos.elections.myflorida.com"]),
    allowedContentTypes: ["application/tab-separated-values"],
    maxBytes: 2_000_000,
    maxRedirects: 0,
    formData: {
      elecID: "20261103-GEN",
      office: "FED",
      status: "All",
      cantype: "STA",
      FormSubmit: "Download Candidate List",
    },
  });
  return {
    exportResult,
    candidates: parseFloridaCandidateTsv(exportResult.body),
  };
}

async function fetchRhodeIslandSource() {
  const workbook = await safeFetchBuffer(RHODE_ISLAND_2026_SOURCES.candidateWorkbook, {
    allowedHosts: new Set(["vote.sos.ri.gov"]),
    allowedContentTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    maxBytes: 1_000_000,
  });
  return {
    workbook,
    candidates: await parseRhodeIslandCandidateWorkbook(workbook.body),
  };
}

async function fetchNebraskaSources() {
  const sosHosts = new Set(["sos.nebraska.gov"]);
  const resultHosts = new Set(["electionresults.nebraska.gov"]);
  const [
    landing,
    workbook,
    canvass,
    certification,
    statewideResults,
    congressionalResults,
    petitionCertification,
  ] = await Promise.all([
    safeFetchBuffer(NEBRASKA_2026_SOURCES.electionLanding, {
      allowedHosts: sosHosts,
      allowedContentTypes: ["text/html"],
      maxBytes: 250_000,
    }),
    safeFetchBuffer(NEBRASKA_2026_SOURCES.currentCandidateWorkbook, {
      allowedHosts: sosHosts,
      allowedContentTypes: [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      maxBytes: 1_000_000,
    }),
    safeFetchBuffer(NEBRASKA_2026_SOURCES.primaryCanvass, {
      allowedHosts: sosHosts,
      allowedContentTypes: ["application/pdf"],
      maxBytes: 4_000_000,
    }),
    safeFetchBuffer(NEBRASKA_2026_SOURCES.primaryCertification, {
      allowedHosts: sosHosts,
      allowedContentTypes: ["text/html"],
      maxBytes: 250_000,
    }),
    safeFetchBuffer(NEBRASKA_2026_SOURCES.primaryStatewideResults, {
      allowedHosts: resultHosts,
      allowedContentTypes: ["text/html"],
      maxBytes: 500_000,
    }),
    safeFetchBuffer(NEBRASKA_2026_SOURCES.primaryCongressionalResults, {
      allowedHosts: resultHosts,
      allowedContentTypes: ["text/html"],
      maxBytes: 500_000,
    }),
    safeFetchBuffer(NEBRASKA_2026_SOURCES.petitionCertification, {
      allowedHosts: sosHosts,
      allowedContentTypes: ["text/html"],
      maxBytes: 250_000,
    }),
  ]);

  validateNebraskaSourcePage(landing.body.toString("utf8"), "2026 Elections", [
    "Where can I find the official certified 2026 Primary election results?",
    "Primary Election Official Results",
    "Statewide_Candidate_Filing_List.xlsx",
  ]);
  validateNebraskaSourcePage(
    certification.body.toString("utf8"),
    "Board of State Canvassers reviews and certifies the 2026 primary election results",
    ["June 8, 2026"]
  );
  validateNebraskaSourcePage(
    petitionCertification.body.toString("utf8"),
    "Secretary of State certifies Dan Osborn’s U.S. Senate candidate petition",
    ["July 16, 2026"]
  );
  validateNebraskaCanvassPdf(canvass.body);
  const [currentCandidates, primaryCandidates] = await Promise.all([
    parseNebraskaCurrentCandidateWorkbook(workbook.body),
    Promise.resolve(
      parseNebraskaPrimaryResultPages([
        statewideResults.body.toString("utf8"),
        congressionalResults.body.toString("utf8"),
      ])
    ),
  ]);

  for (const candidate of currentCandidates) {
    if (candidate.party === "By Petition") {
      if (
        candidate.office !== "S" ||
        candidate.district !== null ||
        candidate.normalizedName !== normalizeCandidateName("Dan Osborn")
      ) {
        throw new Error(
          "Nebraska current list contains a petition candidate without an adapter certification source"
        );
      }
      continue;
    }
    const result = primaryCandidates.find(
      (primary) =>
        primary.office === candidate.office &&
        primary.district === candidate.district &&
        primary.party === candidate.party &&
        primary.normalizedName === candidate.normalizedName
    );
    if (!result?.isWinner) {
      throw new Error(
        "Nebraska current partisan candidate did not match a certified primary winner"
      );
    }
  }

  return {
    landing,
    workbook,
    canvass,
    certification,
    statewideResults,
    congressionalResults,
    petitionCertification,
    currentCandidates,
    primaryCandidates,
  };
}

async function fetchMichiganSources() {
  const allowedHosts = new Set(["mi-boe.entellitrak.com"]);
  const [primary, general] = await Promise.all([
    safeFetchBuffer(MICHIGAN_2026_SOURCES.primaryCandidateReport, {
      allowedHosts,
      allowedContentTypes: ["text/html"],
      maxBytes: 2_000_000,
    }),
    safeFetchBuffer(MICHIGAN_2026_SOURCES.generalCandidateReport, {
      allowedHosts,
      allowedContentTypes: ["text/html"],
      maxBytes: 2_000_000,
    }),
  ]);
  const parsedGeneral = parseMichiganCandidateReport(
    general.body.toString("utf8"),
    "general"
  );
  return {
    primary,
    general,
    primaryCandidates: parseMichiganCandidateReportHtml(
      primary.body.toString("utf8"),
      "primary"
    ),
    // "unofficial" until the primary is canvassed, then "official": the
    // state's own label decides whether general rows are verified ballot
    // access or provisional filing evidence.
    generalReportKind: parsedGeneral.reportKind,
    generalCandidates: parsedGeneral.candidates,
  };
}

async function fetchWashingtonSource() {
  const primary = await safeFetchBuffer(
    WASHINGTON_2026_SOURCES.primaryCandidateList,
    {
      allowedHosts: new Set(["voter.votewa.gov"]),
      allowedContentTypes: ["text/html"],
      maxBytes: 5_000_000,
    }
  );
  return {
    primary,
    candidates: parseWashingtonPrimaryCandidateHtml(
      primary.body.toString("utf8")
    ),
  };
}

function candidateKey(candidate: { normalizedName: string; party: string }) {
  return `${candidate.normalizedName}|${partyCode(candidate.party)}`;
}

async function fecMatchesForIndiana(db: Database) {
  const rows = await db
    .select({
      candidateId: electionCandidates.candidateId,
      name: electionCandidates.name,
      district: electionCandidates.district,
    })
    .from(electionCandidates)
    .where(
      and(
        eq(electionCandidates.stateCode, "IN"),
        eq(electionCandidates.office, "H"),
        eq(electionCandidates.electionYear, 2026)
      )
    );
  return (district: number, ballotName: string) => {
    const districtRows = rows.filter((row) => row.district === district);
    const exact = districtRows.filter(
      (row) => normalizeCandidateName(row.name) === normalizeCandidateName(ballotName)
    );
    if (exact.length === 1) return exact[0].candidateId;
    if (exact.length > 1) return null;
    const likely = districtRows.filter((row) =>
      candidateNamesLikelySame(row.name, ballotName)
    );
    return likely.length === 1 ? likely[0].candidateId : null;
  };
}

async function fecMatchesForDelaware(db: Database) {
  const rows = await db
    .select({
      candidateId: electionCandidates.candidateId,
      name: electionCandidates.name,
      office: electionCandidates.office,
      district: electionCandidates.district,
    })
    .from(electionCandidates)
    .where(
      and(
        eq(electionCandidates.stateCode, "DE"),
        eq(electionCandidates.electionYear, 2026)
      )
    );

  return (office: "H" | "S", ballotName: string) => {
    const raceRows = rows.filter(
      (row) =>
        row.office === office &&
        (office === "S" || row.district === 0)
    );
    const exact = raceRows.filter(
      (row) => normalizeCandidateName(row.name) === normalizeCandidateName(ballotName)
    );
    if (exact.length === 1) return exact[0].candidateId;
    if (exact.length > 1) return null;
    const likely = raceRows.filter((row) => candidateNamesLikelySame(row.name, ballotName));
    return likely.length === 1 ? likely[0].candidateId : null;
  };
}

async function fecMatchesForFlorida(db: Database) {
  const rows = await db
    .select({
      candidateId: electionCandidates.candidateId,
      name: electionCandidates.name,
      office: electionCandidates.office,
      district: electionCandidates.district,
    })
    .from(electionCandidates)
    .where(
      and(
        eq(electionCandidates.stateCode, "FL"),
        eq(electionCandidates.electionYear, 2026)
      )
    );

  return (office: "H" | "S", district: number | null, ballotName: string) => {
    const raceRows = rows.filter(
      (row) => row.office === office && (office === "S" || row.district === district)
    );
    const exact = raceRows.filter(
      (row) => normalizeCandidateName(row.name) === normalizeCandidateName(ballotName)
    );
    if (exact.length === 1) return exact[0].candidateId;
    if (exact.length > 1) return null;
    const likely = raceRows.filter((row) => candidateNamesLikelySame(row.name, ballotName));
    return likely.length === 1 ? likely[0].candidateId : null;
  };
}

async function fecMatchesForRhodeIsland(db: Database) {
  const rows = await db
    .select({
      candidateId: electionCandidates.candidateId,
      name: electionCandidates.name,
      office: electionCandidates.office,
      district: electionCandidates.district,
    })
    .from(electionCandidates)
    .where(
      and(
        eq(electionCandidates.stateCode, "RI"),
        eq(electionCandidates.electionYear, 2026)
      )
    );

  return (office: "H" | "S", district: number | null, ballotName: string) => {
    const raceRows = rows.filter(
      (row) => row.office === office && (office === "S" || row.district === district)
    );
    const exact = raceRows.filter(
      (row) => normalizeCandidateName(row.name) === normalizeCandidateName(ballotName)
    );
    if (exact.length === 1) return exact[0].candidateId;
    if (exact.length > 1) return null;
    const likely = raceRows.filter((row) => candidateNamesLikelySame(row.name, ballotName));
    return likely.length === 1 ? likely[0].candidateId : null;
  };
}

async function fecMatchesForNebraska(db: Database) {
  const rows = await db
    .select({
      candidateId: electionCandidates.candidateId,
      name: electionCandidates.name,
      office: electionCandidates.office,
      district: electionCandidates.district,
    })
    .from(electionCandidates)
    .where(
      and(
        eq(electionCandidates.stateCode, "NE"),
        eq(electionCandidates.electionYear, 2026)
      )
    );

  return (office: "H" | "S", district: number | null, ballotName: string) => {
    const raceRows = rows.filter(
      (row) => row.office === office && (office === "S" || row.district === district)
    );
    const exact = raceRows.filter(
      (row) => normalizeCandidateName(row.name) === normalizeCandidateName(ballotName)
    );
    if (exact.length === 1) return exact[0].candidateId;
    if (exact.length > 1) return null;
    const likely = raceRows.filter((row) =>
      candidateNamesLikelySame(row.name, ballotName)
    );
    return likely.length === 1 ? likely[0].candidateId : null;
  };
}

async function fecMatchesForMichigan(db: Database) {
  const rows = await db
    .select({
      candidateId: electionCandidates.candidateId,
      name: electionCandidates.name,
      office: electionCandidates.office,
      district: electionCandidates.district,
    })
    .from(electionCandidates)
    .where(
      and(
        eq(electionCandidates.stateCode, "MI"),
        eq(electionCandidates.electionYear, 2026)
      )
    );

  return (office: "H" | "S", district: number | null, ballotName: string) => {
    const raceRows = rows.filter(
      (row) => row.office === office && (office === "S" || row.district === district)
    );
    const exact = raceRows.filter(
      (row) => normalizeCandidateName(row.name) === normalizeCandidateName(ballotName)
    );
    if (exact.length === 1) return exact[0].candidateId;
    if (exact.length > 1) return null;
    const likely = raceRows.filter((row) =>
      candidateNamesLikelySame(row.name, ballotName)
    );
    return likely.length === 1 ? likely[0].candidateId : null;
  };
}

async function fecMatchesForWashington(db: Database) {
  const rows = await db
    .select({
      candidateId: electionCandidates.candidateId,
      name: electionCandidates.name,
      district: electionCandidates.district,
    })
    .from(electionCandidates)
    .where(
      and(
        eq(electionCandidates.stateCode, "WA"),
        eq(electionCandidates.office, "H"),
        eq(electionCandidates.electionYear, 2026)
      )
    );

  return (district: number, ballotName: string) => {
    const raceRows = rows.filter((row) => row.district === district);
    const exact = raceRows.filter(
      (row) => normalizeCandidateName(row.name) === normalizeCandidateName(ballotName)
    );
    if (exact.length === 1) return exact[0].candidateId;
    if (exact.length > 1) return null;
    const likely = raceRows.filter((row) =>
      candidateNamesLikelySame(row.name, ballotName)
    );
    return likely.length === 1 ? likely[0].candidateId : null;
  };
}

async function ingestIndiana(db: Database) {
  const fetched = await fetchIndianaSources();
  console.log(
    `Indiana: ${fetched.generalCandidates.length} current general-list records; ${fetched.primary.candidates.length} primary result records (${fetched.primary.resultStatus}).`
  );

  if (DRY_RUN) return fetched.generalCandidates.length + fetched.primary.candidates.length;

  const [generalSnapshot, settingsSnapshot, resultSnapshot, fecMatches] = await Promise.all([
    storeElectionSnapshot(INDIANA_SOURCE_ID, fetched.general),
    storeElectionSnapshot(INDIANA_SOURCE_ID, fetched.settings),
    storeElectionSnapshot(INDIANA_SOURCE_ID, fetched.primaryResults),
    fecMatchesForIndiana(db),
  ]);

  const observedAt = new Date();
  const generalByDistrict = new Map<number, Map<string, IndianaGeneralCandidate>>();
  for (const candidate of fetched.generalCandidates) {
    const district = generalByDistrict.get(candidate.district) ?? new Map();
    district.set(candidateKey(candidate), candidate);
    generalByDistrict.set(candidate.district, district);
  }
  const primaryByDistrict = new Map<number, IndianaPrimaryCandidate[]>();
  for (const candidate of fetched.primary.candidates) {
    const district = primaryByDistrict.get(candidate.district) ?? [];
    district.push(candidate);
    primaryByDistrict.set(candidate.district, district);
  }

  // neon-http does not support interactive transactions. Every write below is
  // idempotent, so a failed run can safely resume from the first unfinished
  // upsert while sync_log records the partial failure.
  const tx = db;
    for (const snapshot of [generalSnapshot, settingsSnapshot, resultSnapshot]) {
      await tx
        .insert(electionSourceSnapshots)
        .values({
          snapshotSha256: snapshot.sha256,
          sourceId: INDIANA_SOURCE_ID,
          originalUrl: snapshot.originalUrl,
          blobUrl: snapshot.blobUrl,
          contentType: snapshot.contentType,
          contentLength: snapshot.contentLength,
          etag: snapshot.etag,
          lastModified: snapshot.lastModified,
        })
        .onConflictDoNothing();
    }

    for (let district = 1; district <= 9; district++) {
      const contestId = houseContestId("IN", district);
      const title = `Indiana U.S. House District ${district}`;
      const generalStageId = `${contestId}-general`;
      await tx
        .insert(electionContests)
        .values({
          contestId,
          electionCycle: 2026,
          stateCode: "IN",
          office: "H",
          district,
          title,
          currentStage: "general",
          coverageStatus: "verification_pending",
          certifiedThrough: null,
          nextExpectedEvent: "2026-11-03",
          primarySourceId: INDIANA_SOURCE_ID,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: electionContests.contestId,
          set: {
            title,
            currentStage: "general",
            coverageStatus: "verification_pending",
            nextExpectedEvent: "2026-11-03",
            primarySourceId: INDIANA_SOURCE_ID,
            updatedAt: observedAt,
          },
        });

      for (const party of ["Democratic", "Republican"] as const) {
        const stageId = `${contestId}-primary-${party === "Democratic" ? "D" : "R"}`;
        await tx
          .insert(electionStages)
          .values({
            stageId,
            contestId,
            stageKind: "primary",
            party,
            electionDate: fetched.primary.electionDate,
            sequenceNumber: party === "Democratic" ? 1 : 2,
            resultStatus: fetched.primary.resultStatus,
            certifiedAt: fetched.primary.resultStatus === "certified" ? observedAt : null,
            sourceId: INDIANA_SOURCE_ID,
            updatedAt: observedAt,
          })
          .onConflictDoUpdate({
            target: electionStages.stageId,
            set: {
              resultStatus: fetched.primary.resultStatus,
              certifiedAt: fetched.primary.resultStatus === "certified" ? observedAt : null,
              updatedAt: observedAt,
            },
          });
      }
      await tx
        .insert(electionStages)
        .values({
          stageId: generalStageId,
          contestId,
          stageKind: "general",
          electionDate: "2026-11-03",
          sequenceNumber: 3,
          resultStatus: "not_started",
          sourceId: INDIANA_SOURCE_ID,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: electionStages.stageId,
          set: { sourceId: INDIANA_SOURCE_ID, updatedAt: observedAt },
        });

      const generalCandidates = generalByDistrict.get(district) ?? new Map();
      const primaryCandidates = primaryByDistrict.get(district) ?? [];
      const combined = new Map<
        string,
        { general: IndianaGeneralCandidate | null; primary: IndianaPrimaryCandidate | null }
      >();
      for (const candidate of primaryCandidates) {
        combined.set(candidateKey(candidate), { general: null, primary: candidate });
      }
      for (const candidate of generalCandidates.values()) {
        const key = candidateKey(candidate);
        combined.set(key, { general: candidate, primary: combined.get(key)?.primary ?? null });
      }

      for (const pair of combined.values()) {
        const candidate = pair.general ?? pair.primary;
        if (!candidate) continue;
        const fecCandidateId = fecMatches(district, candidate.name);
        const identity = candidateIdentity(
          contestId,
          candidate.normalizedName,
          partyCode(candidate.party),
          fecCandidateId
        );
        const { personId, candidacyId } = identity;
        const isActive = pair.general != null || pair.primary?.isWinner === true;
        const currentStatus =
          pair.general?.status ??
          (pair.primary?.isWinner ? "state_reported_primary_winner" : "primary_defeated");

        await tx
          .insert(candidatePeople)
          .values({
            personId,
            displayName: candidate.name,
            normalizedName: candidate.normalizedName,
            updatedAt: observedAt,
          })
          .onConflictDoUpdate({
            target: candidatePeople.personId,
            set: { displayName: candidate.name, normalizedName: candidate.normalizedName, updatedAt: observedAt },
          });
        await tx
          .insert(candidacies)
          .values({
            candidacyId,
            contestId,
            personId,
            party: candidate.party,
            currentStatus,
            isActive,
            fecCandidateId,
            verifiedSourceId: INDIANA_SOURCE_ID,
            verifiedAt: observedAt,
            updatedAt: observedAt,
          })
          .onConflictDoUpdate({
            target: candidacies.candidacyId,
            set: {
              party: candidate.party,
              currentStatus,
              isActive,
              fecCandidateId,
              verifiedSourceId: INDIANA_SOURCE_ID,
              verifiedAt: observedAt,
              updatedAt: observedAt,
            },
          });

        if (pair.primary) {
          const primaryStageId = `${contestId}-primary-${
            pair.primary.party === "Democratic" ? "D" : "R"
          }`;
          const status = pair.primary.isWinner ? "primary_winner" : "primary_defeated";
          const resultId = stableElectionId("result", primaryStageId, candidacyId);
          await tx
            .insert(electionResults)
            .values({
              resultId,
              stageId: primaryStageId,
              candidacyId,
              totalVotes: pair.primary.totalVotes,
              isWinner: pair.primary.isWinner,
              resultStatus: fetched.primary.resultStatus,
              sourceId: INDIANA_SOURCE_ID,
              snapshotSha256: resultSnapshot.sha256,
              updatedAt: observedAt,
            })
            .onConflictDoUpdate({
              target: electionResults.resultId,
              set: {
                totalVotes: pair.primary.totalVotes,
                isWinner: pair.primary.isWinner,
                resultStatus: fetched.primary.resultStatus,
                snapshotSha256: resultSnapshot.sha256,
                updatedAt: observedAt,
              },
            });
          const eventId = stableElectionId(
            "event",
            candidacyId,
            primaryStageId,
            status,
            resultSnapshot.sha256
          );
          await tx
            .insert(candidateStatusEvents)
            .values({
              eventId,
              candidacyId,
              electionStageId: primaryStageId,
              status,
              effectiveDate: fetched.primary.electionDate,
              observedAt,
              sourceId: INDIANA_SOURCE_ID,
              snapshotSha256: resultSnapshot.sha256,
              details: {
                votes: pair.primary.totalVotes,
                result_status: fetched.primary.resultStatus,
              },
            })
            .onConflictDoNothing();
        }

        if (pair.general) {
          const ballotLineId = stableElectionId(
            "ballot",
            candidacyId,
            generalStageId,
            pair.general.party
          );
          await tx
            .insert(candidacyBallotLines)
            .values({
              ballotLineId,
              candidacyId,
              stageId: generalStageId,
              partyLabel: pair.general.party,
              sourceId: INDIANA_SOURCE_ID,
            })
            .onConflictDoUpdate({
              target: candidacyBallotLines.ballotLineId,
              set: { partyLabel: pair.general.party, sourceId: INDIANA_SOURCE_ID },
            });
          const eventId = stableElectionId(
            "event",
            candidacyId,
            generalStageId,
            pair.general.status,
            generalSnapshot.sha256
          );
          await tx
            .insert(candidateStatusEvents)
            .values({
              eventId,
              candidacyId,
              electionStageId: generalStageId,
              status: pair.general.status,
              effectiveDate: "2026-07-06",
              observedAt,
              sourceId: INDIANA_SOURCE_ID,
              snapshotSha256: generalSnapshot.sha256,
              details: { ballot_line: pair.general.party },
            })
            .onConflictDoNothing();
        }
      }
    }

    await tx
      .update(electionSources)
      .set({
        coverageStatus: "verification_pending",
        lastCheckedAt: observedAt,
        lastSuccessAt: observedAt,
        nextExpectedEvent: "2026-11-03",
        nextCheckAt: new Date(observedAt.getTime() + 24 * 60 * 60 * 1000),
        updatedAt: observedAt,
      })
      .where(eq(electionSources.sourceId, INDIANA_SOURCE_ID));
  return fetched.generalCandidates.length + fetched.primary.candidates.length;
}

function delawareStatus(candidate: DelawareCandidate) {
  if (candidate.status === "withdrawn") return "withdrawn";
  if (candidate.stage === "general") {
    return candidate.status === "qualified" ? "general_ballot" : "state_general_provisional";
  }
  return candidate.status === "qualified"
    ? "state_primary_qualified"
    : "state_primary_provisional";
}

async function ingestDelaware(db: Database) {
  const fetched = await fetchDelawareSources();
  console.log(
    `Delaware: ${fetched.primaryCandidates.length} primary-list records; ${fetched.generalCandidates.length} general-list records.`
  );

  if (DRY_RUN) return fetched.primaryCandidates.length + fetched.generalCandidates.length;

  const [primarySnapshot, generalSnapshot, fecMatches] = await Promise.all([
    storeElectionSnapshot(DELAWARE_SOURCE_ID, fetched.primary),
    storeElectionSnapshot(DELAWARE_SOURCE_ID, fetched.general),
    fecMatchesForDelaware(db),
  ]);
  const observedAt = new Date();
  const tx = db;

  for (const snapshot of [primarySnapshot, generalSnapshot]) {
    await tx
      .insert(electionSourceSnapshots)
      .values({
        snapshotSha256: snapshot.sha256,
        sourceId: DELAWARE_SOURCE_ID,
        originalUrl: snapshot.originalUrl,
        blobUrl: snapshot.blobUrl,
        contentType: snapshot.contentType,
        contentLength: snapshot.contentLength,
        etag: snapshot.etag,
        lastModified: snapshot.lastModified,
      })
      .onConflictDoNothing();
  }

  const contests = [
    {
      contestId: houseContestId("DE", 0),
      office: "H" as const,
      district: 0,
      senateClass: null,
      title: "Delaware U.S. House At-Large",
    },
    {
      contestId: senateContestId("DE", 2),
      office: "S" as const,
      district: null,
      senateClass: 2,
      title: "Delaware U.S. Senate Class 2",
    },
  ];

  for (const contest of contests) {
    await tx
      .insert(electionContests)
      .values({
        contestId: contest.contestId,
        electionCycle: 2026,
        stateCode: "DE",
        office: contest.office,
        district: contest.district,
        senateClass: contest.senateClass,
        title: contest.title,
        currentStage: "primary",
        coverageStatus: "verification_pending",
        certifiedThrough: null,
        nextExpectedEvent: "2026-09-15",
        primarySourceId: DELAWARE_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionContests.contestId,
        set: {
          title: contest.title,
          currentStage: "primary",
          coverageStatus: "verification_pending",
          nextExpectedEvent: "2026-09-15",
          primarySourceId: DELAWARE_SOURCE_ID,
          updatedAt: observedAt,
        },
      });

    for (const party of ["Democratic", "Republican"] as const) {
      const partyCodeValue = party === "Democratic" ? "D" : "R";
      const stageId = `${contest.contestId}-primary-${partyCodeValue}`;
      await tx
        .insert(electionStages)
        .values({
          stageId,
          contestId: contest.contestId,
          stageKind: "primary",
          party,
          electionDate: "2026-09-15",
          sequenceNumber: party === "Democratic" ? 1 : 2,
          resultStatus: "not_started",
          sourceId: DELAWARE_SOURCE_ID,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: electionStages.stageId,
          set: { sourceId: DELAWARE_SOURCE_ID, updatedAt: observedAt },
        });
    }

    const generalStageId = `${contest.contestId}-general`;
    await tx
      .insert(electionStages)
      .values({
        stageId: generalStageId,
        contestId: contest.contestId,
        stageKind: "general",
        electionDate: "2026-11-03",
        sequenceNumber: 3,
        resultStatus: "not_started",
        sourceId: DELAWARE_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionStages.stageId,
        set: { sourceId: DELAWARE_SOURCE_ID, updatedAt: observedAt },
      });

    const combined = new Map<
      string,
      { primary: DelawareCandidate | null; general: DelawareCandidate | null }
    >();
    for (const candidate of fetched.primaryCandidates.filter(
      (candidate) => candidate.office === contest.office
    )) {
      combined.set(candidateKey(candidate), { primary: candidate, general: null });
    }
    for (const candidate of fetched.generalCandidates.filter(
      (candidate) => candidate.office === contest.office
    )) {
      const key = candidateKey(candidate);
      combined.set(key, { primary: combined.get(key)?.primary ?? null, general: candidate });
    }

    for (const pair of combined.values()) {
      const current = pair.general ?? pair.primary;
      if (!current) continue;
      const fecCandidateId = fecMatches(contest.office, current.name);
      const { personId, candidacyId } = candidateIdentity(
        contest.contestId,
        current.normalizedName,
        partyCode(current.party),
        fecCandidateId
      );
      const currentStatus = delawareStatus(current);
      const isActive = current.status !== "withdrawn";

      await tx
        .insert(candidatePeople)
        .values({
          personId,
          displayName: current.name,
          normalizedName: current.normalizedName,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidatePeople.personId,
          set: {
            displayName: current.name,
            normalizedName: current.normalizedName,
            updatedAt: observedAt,
          },
        });
      await tx
        .insert(candidacies)
        .values({
          candidacyId,
          contestId: contest.contestId,
          personId,
          party: current.party,
          currentStatus,
          isActive,
          fecCandidateId,
          verifiedSourceId: DELAWARE_SOURCE_ID,
          verifiedAt: observedAt,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidacies.candidacyId,
          set: {
            party: current.party,
            currentStatus,
            isActive,
            fecCandidateId,
            verifiedSourceId: DELAWARE_SOURCE_ID,
            verifiedAt: observedAt,
            updatedAt: observedAt,
          },
        });

      for (const candidate of [pair.primary, pair.general].filter(
        (value): value is DelawareCandidate => value != null
      )) {
        const stageId =
          candidate.stage === "primary"
            ? `${contest.contestId}-primary-${candidate.party === "Democratic" ? "D" : "R"}`
            : generalStageId;
        const snapshot = candidate.stage === "primary" ? primarySnapshot : generalSnapshot;
        const status = delawareStatus(candidate);
        const effectiveDate =
          candidate.status === "withdrawn"
            ? candidate.withdrawalDate ?? candidate.filingDate
            : candidate.filingDate;

        if (candidate.status === "qualified") {
          const ballotLineId = stableElectionId(
            "ballot",
            candidacyId,
            stageId,
            candidate.party
          );
          await tx
            .insert(candidacyBallotLines)
            .values({
              ballotLineId,
              candidacyId,
              stageId,
              partyLabel: candidate.party,
              sourceId: DELAWARE_SOURCE_ID,
            })
            .onConflictDoUpdate({
              target: candidacyBallotLines.ballotLineId,
              set: { partyLabel: candidate.party, sourceId: DELAWARE_SOURCE_ID },
            });
        }

        const eventId = stableElectionId(
          "event",
          candidacyId,
          stageId,
          status,
          effectiveDate
        );
        await tx
          .insert(candidateStatusEvents)
          .values({
            eventId,
            candidacyId,
            electionStageId: stageId,
            status,
            effectiveDate,
            observedAt,
            sourceId: DELAWARE_SOURCE_ID,
            snapshotSha256: snapshot.sha256,
            details: {
              filing_date: candidate.filingDate,
              withdrawal_date: candidate.withdrawalDate,
              state_status: candidate.status,
            },
          })
          .onConflictDoNothing();
      }
    }
  }

  await tx
    .update(electionSources)
    .set({
      coverageStatus: "verification_pending",
      lastCheckedAt: observedAt,
      lastSuccessAt: observedAt,
      nextExpectedEvent: "2026-09-15",
      nextCheckAt: new Date(observedAt.getTime() + 24 * 60 * 60 * 1000),
      updatedAt: observedAt,
    })
    .where(eq(electionSources.sourceId, DELAWARE_SOURCE_ID));

  return fetched.primaryCandidates.length + fetched.generalCandidates.length;
}

function floridaStatus(candidate: FloridaCandidate) {
  if (candidate.status === "withdrawn") return "withdrawn";
  if (candidate.status === "did_not_qualify") return "did_not_qualify";
  if (candidate.status === "primary_unopposed") return "state_reported_primary_unopposed";
  if (candidate.partyCode === "WRI") return "qualified_write_in";
  if (candidate.partyCode === "DEM" || candidate.partyCode === "REP") {
    return "state_primary_qualified";
  }
  return "state_general_qualified";
}

function floridaPrimaryParty(candidate: FloridaCandidate) {
  if (candidate.partyCode === "DEM") return "D" as const;
  if (candidate.partyCode === "REP") return "R" as const;
  return null;
}

async function ingestFlorida(db: Database) {
  const fetched = await fetchFloridaSource();
  const activeCount = fetched.candidates.filter(
    (candidate) => candidate.status === "qualified" || candidate.status === "primary_unopposed"
  ).length;
  console.log(
    `Florida: ${fetched.candidates.length} federal candidate records across 29 contests; ${activeCount} active state-qualified or unopposed records.`
  );

  if (DRY_RUN) return fetched.candidates.length;

  const [snapshot, fecMatches] = await Promise.all([
    storeElectionSnapshot(FLORIDA_SOURCE_ID, fetched.exportResult),
    fecMatchesForFlorida(db),
  ]);
  const observedAt = new Date();
  const tx = db;

  await tx
    .insert(electionSourceSnapshots)
    .values({
      snapshotSha256: snapshot.sha256,
      sourceId: FLORIDA_SOURCE_ID,
      originalUrl: snapshot.originalUrl,
      blobUrl: snapshot.blobUrl,
      contentType: snapshot.contentType,
      contentLength: snapshot.contentLength,
      etag: snapshot.etag,
      lastModified: snapshot.lastModified,
    })
    .onConflictDoNothing();

  const contests = [
    ...Array.from({ length: 28 }, (_, index) => ({
      contestId: houseContestId("FL", index + 1),
      office: "H" as const,
      district: index + 1,
      senateClass: null,
      electionType: "regular" as const,
      title: `Florida U.S. House District ${index + 1}`,
      specialElectionUrl: null,
    })),
    {
      contestId: senateContestId("FL", 3, "special"),
      office: "S" as const,
      district: null,
      senateClass: 3,
      electionType: "special" as const,
      title: "Florida U.S. Senate Class 3 Special Election",
      specialElectionUrl: FLORIDA_2026_SOURCES.senateVacancyLaw,
    },
  ];

  for (const contest of contests) {
    await tx
      .insert(electionContests)
      .values({
        contestId: contest.contestId,
        electionCycle: 2026,
        stateCode: "FL",
        office: contest.office,
        district: contest.district,
        senateClass: contest.senateClass,
        electionType: contest.electionType,
        title: contest.title,
        currentStage: "primary",
        coverageStatus: "verification_pending",
        certifiedThrough: null,
        nextExpectedEvent: "2026-08-18",
        primarySourceId: FLORIDA_SOURCE_ID,
        specialElectionUrl: contest.specialElectionUrl,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionContests.contestId,
        set: {
          title: contest.title,
          currentStage: "primary",
          coverageStatus: "verification_pending",
          nextExpectedEvent: "2026-08-18",
          primarySourceId: FLORIDA_SOURCE_ID,
          specialElectionUrl: contest.specialElectionUrl,
          updatedAt: observedAt,
        },
      });

    for (const party of ["Democratic", "Republican"] as const) {
      const partyCodeValue = party === "Democratic" ? "D" : "R";
      const stageId = `${contest.contestId}-primary-${partyCodeValue}`;
      await tx
        .insert(electionStages)
        .values({
          stageId,
          contestId: contest.contestId,
          stageKind: "primary",
          party,
          electionDate: "2026-08-18",
          sequenceNumber: party === "Democratic" ? 1 : 2,
          resultStatus: "not_started",
          sourceId: FLORIDA_SOURCE_ID,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: electionStages.stageId,
          set: { sourceId: FLORIDA_SOURCE_ID, updatedAt: observedAt },
        });
    }

    const generalStageId = `${contest.contestId}-general`;
    await tx
      .insert(electionStages)
      .values({
        stageId: generalStageId,
        contestId: contest.contestId,
        stageKind: "general",
        electionDate: "2026-11-03",
        sequenceNumber: 3,
        resultStatus: "not_started",
        sourceId: FLORIDA_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionStages.stageId,
        set: { sourceId: FLORIDA_SOURCE_ID, updatedAt: observedAt },
      });

    const contestCandidates = fetched.candidates.filter(
      (candidate) =>
        candidate.office === contest.office &&
        (candidate.office === "S" || candidate.district === contest.district)
    );
    for (const candidate of contestCandidates) {
      const fecCandidateId = fecMatches(candidate.office, candidate.district, candidate.name);
      const { personId, candidacyId } = candidateIdentity(
        contest.contestId,
        candidate.normalizedName,
        candidate.partyCode,
        fecCandidateId
      );
      const currentStatus = floridaStatus(candidate);
      const isActive =
        candidate.status === "qualified" || candidate.status === "primary_unopposed";

      await tx
        .insert(candidatePeople)
        .values({
          personId,
          displayName: candidate.name,
          normalizedName: candidate.normalizedName,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidatePeople.personId,
          set: {
            displayName: candidate.name,
            normalizedName: candidate.normalizedName,
            updatedAt: observedAt,
          },
        });
      await tx
        .insert(candidateIdentifiers)
        .values({
          personId,
          identifierType: "fl_candidate_account",
          identifierValue: candidate.stateCandidateId,
          sourceId: FLORIDA_SOURCE_ID,
        })
        .onConflictDoNothing();
      await tx
        .insert(candidacies)
        .values({
          candidacyId,
          contestId: contest.contestId,
          personId,
          party: candidate.party,
          currentStatus,
          isActive,
          fecCandidateId,
          verifiedSourceId: FLORIDA_SOURCE_ID,
          verifiedAt: observedAt,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidacies.candidacyId,
          set: {
            party: candidate.party,
            currentStatus,
            isActive,
            fecCandidateId,
            verifiedSourceId: FLORIDA_SOURCE_ID,
            verifiedAt: observedAt,
            updatedAt: observedAt,
          },
        });

      const primaryParty = floridaPrimaryParty(candidate);
      const primaryStageId = primaryParty
        ? `${contest.contestId}-primary-${primaryParty}`
        : null;
      const eventStageId = primaryStageId ?? generalStageId;
      const ballotStageId =
        !isActive || candidate.partyCode === "WRI"
          ? null
          : candidate.status === "primary_unopposed" || primaryParty == null
            ? generalStageId
            : primaryStageId;

      if (ballotStageId) {
        const ballotLineId = stableElectionId(
          "ballot",
          candidacyId,
          ballotStageId,
          candidate.party
        );
        await tx
          .insert(candidacyBallotLines)
          .values({
            ballotLineId,
            candidacyId,
            stageId: ballotStageId,
            partyLabel: candidate.party,
            sourceId: FLORIDA_SOURCE_ID,
          })
          .onConflictDoUpdate({
            target: candidacyBallotLines.ballotLineId,
            set: { partyLabel: candidate.party, sourceId: FLORIDA_SOURCE_ID },
          });
      }

      const eventId = stableElectionId(
        "event",
        candidacyId,
        candidate.stateCandidateId,
        currentStatus
      );
      await tx
        .insert(candidateStatusEvents)
        .values({
          eventId,
          candidacyId,
          electionStageId: eventStageId,
          status: currentStatus,
          effectiveDate: null,
          observedAt,
          sourceId: FLORIDA_SOURCE_ID,
          snapshotSha256: snapshot.sha256,
          details: {
            state_candidate_id: candidate.stateCandidateId,
            state_status: candidate.status,
            party_code: candidate.partyCode,
          },
        })
        .onConflictDoNothing();
    }
  }

  await tx
    .update(electionSources)
    .set({
      coverageStatus: "verification_pending",
      lastCheckedAt: observedAt,
      lastSuccessAt: observedAt,
      nextExpectedEvent: "2026-08-18",
      nextCheckAt: new Date(observedAt.getTime() + 24 * 60 * 60 * 1000),
      updatedAt: observedAt,
    })
    .where(eq(electionSources.sourceId, FLORIDA_SOURCE_ID));

  return fetched.candidates.length;
}

function rhodeIslandStatus(candidate: RhodeIslandCandidate) {
  if (candidate.status === "did_not_qualify") return "did_not_qualify";
  if (candidate.status === "primary_winner") return "primary_winner";
  if (candidate.status === "lost_primary") return "lost_primary";
  if (candidate.status === "elected") return "elected";
  if (candidate.status === "lost_general") return "lost_general";
  return candidate.stage === "primary"
    ? "state_primary_qualified"
    : "state_general_qualified";
}

function rhodeIslandPartyCode(candidate: RhodeIslandCandidate) {
  if (candidate.party === "Democratic") return "D";
  if (candidate.party === "Republican") return "R";
  return "IND";
}

async function ingestRhodeIsland(db: Database) {
  const fetched = await fetchRhodeIslandSource();
  const activeCount = fetched.candidates.filter(
    (candidate) =>
      candidate.status === "qualified" ||
      candidate.status === "primary_winner" ||
      candidate.status === "elected"
  ).length;
  console.log(
    `Rhode Island: ${fetched.candidates.length} federal candidate records across 3 contests; ${activeCount} active ballot-qualified records.`
  );

  if (DRY_RUN) return fetched.candidates.length;

  const [snapshot, fecMatches] = await Promise.all([
    storeElectionSnapshot(RHODE_ISLAND_SOURCE_ID, fetched.workbook),
    fecMatchesForRhodeIsland(db),
  ]);
  const observedAt = new Date();
  const tx = db;

  await tx
    .insert(electionSourceSnapshots)
    .values({
      snapshotSha256: snapshot.sha256,
      sourceId: RHODE_ISLAND_SOURCE_ID,
      originalUrl: snapshot.originalUrl,
      blobUrl: snapshot.blobUrl,
      contentType: snapshot.contentType,
      contentLength: snapshot.contentLength,
      etag: snapshot.etag,
      lastModified: snapshot.lastModified,
    })
    .onConflictDoNothing();

  const hasPrimaryOutcome = fetched.candidates.some(
    (candidate) =>
      candidate.status === "primary_winner" || candidate.status === "lost_primary"
  );
  const hasGeneralOutcome = fetched.candidates.some(
    (candidate) => candidate.status === "elected" || candidate.status === "lost_general"
  );
  const currentStage = hasPrimaryOutcome || hasGeneralOutcome ? "general" : "primary";
  const nextExpectedEvent = hasGeneralOutcome
    ? null
    : hasPrimaryOutcome
      ? "2026-11-03"
      : "2026-09-09";

  const contests = [
    {
      contestId: houseContestId("RI", 1),
      office: "H" as const,
      district: 1,
      senateClass: null,
      title: "Rhode Island U.S. House District 1",
    },
    {
      contestId: houseContestId("RI", 2),
      office: "H" as const,
      district: 2,
      senateClass: null,
      title: "Rhode Island U.S. House District 2",
    },
    {
      contestId: senateContestId("RI", 2),
      office: "S" as const,
      district: null,
      senateClass: 2,
      title: "Rhode Island U.S. Senate Class 2",
    },
  ];

  for (const contest of contests) {
    await tx
      .insert(electionContests)
      .values({
        contestId: contest.contestId,
        electionCycle: 2026,
        stateCode: "RI",
        office: contest.office,
        district: contest.district,
        senateClass: contest.senateClass,
        title: contest.title,
        currentStage,
        coverageStatus: "verified_ballot",
        certifiedThrough: null,
        nextExpectedEvent,
        primarySourceId: RHODE_ISLAND_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionContests.contestId,
        set: {
          title: contest.title,
          currentStage,
          coverageStatus: "verified_ballot",
          nextExpectedEvent,
          primarySourceId: RHODE_ISLAND_SOURCE_ID,
          updatedAt: observedAt,
        },
      });

    for (const party of ["Democratic", "Republican"] as const) {
      const code = party === "Democratic" ? "D" : "R";
      const stageId = `${contest.contestId}-primary-${code}`;
      await tx
        .insert(electionStages)
        .values({
          stageId,
          contestId: contest.contestId,
          stageKind: "primary",
          party,
          electionDate: "2026-09-09",
          sequenceNumber: party === "Democratic" ? 1 : 2,
          resultStatus: hasPrimaryOutcome ? "unofficial" : "not_started",
          sourceId: RHODE_ISLAND_SOURCE_ID,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: electionStages.stageId,
          set: {
            resultStatus: hasPrimaryOutcome ? "unofficial" : "not_started",
            sourceId: RHODE_ISLAND_SOURCE_ID,
            updatedAt: observedAt,
          },
        });
    }

    const generalStageId = `${contest.contestId}-general`;
    await tx
      .insert(electionStages)
      .values({
        stageId: generalStageId,
        contestId: contest.contestId,
        stageKind: "general",
        electionDate: "2026-11-03",
        sequenceNumber: 3,
        resultStatus: hasGeneralOutcome ? "unofficial" : "not_started",
        sourceId: RHODE_ISLAND_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionStages.stageId,
        set: {
          resultStatus: hasGeneralOutcome ? "unofficial" : "not_started",
          sourceId: RHODE_ISLAND_SOURCE_ID,
          updatedAt: observedAt,
        },
      });

    const contestCandidates = fetched.candidates.filter(
      (candidate) =>
        candidate.office === contest.office &&
        (candidate.office === "S" || candidate.district === contest.district)
    );
    for (const candidate of contestCandidates) {
      const fecCandidateId = fecMatches(candidate.office, candidate.district, candidate.name);
      const { personId, candidacyId } = candidateIdentity(
        contest.contestId,
        candidate.normalizedName,
        rhodeIslandPartyCode(candidate),
        fecCandidateId
      );
      const currentStatus = rhodeIslandStatus(candidate);
      const isActive =
        candidate.status === "qualified" ||
        candidate.status === "primary_winner" ||
        candidate.status === "elected";

      await tx
        .insert(candidatePeople)
        .values({
          personId,
          displayName: candidate.name,
          normalizedName: candidate.normalizedName,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidatePeople.personId,
          set: {
            displayName: candidate.name,
            normalizedName: candidate.normalizedName,
            updatedAt: observedAt,
          },
        });
      await tx
        .insert(candidacies)
        .values({
          candidacyId,
          contestId: contest.contestId,
          personId,
          party: candidate.party,
          currentStatus,
          isActive,
          fecCandidateId,
          verifiedSourceId: RHODE_ISLAND_SOURCE_ID,
          verifiedAt: observedAt,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidacies.candidacyId,
          set: {
            party: candidate.party,
            currentStatus,
            isActive,
            fecCandidateId,
            verifiedSourceId: RHODE_ISLAND_SOURCE_ID,
            verifiedAt: observedAt,
            updatedAt: observedAt,
          },
        });

      const primaryStageId =
        candidate.party === "Democratic"
          ? `${contest.contestId}-primary-D`
          : candidate.party === "Republican"
            ? `${contest.contestId}-primary-R`
            : null;
      const eventStageId = candidate.stage === "primary" ? primaryStageId : generalStageId;
      if (!eventStageId) {
        throw new Error("Rhode Island candidate could not be assigned to an election stage");
      }

      for (const ballotStageId of [
        candidate.onPrimaryBallot ? primaryStageId : null,
        candidate.onElectionBallot ? generalStageId : null,
      ].filter((value): value is string => value != null)) {
        const ballotLineId = stableElectionId(
          "ballot",
          candidacyId,
          ballotStageId,
          candidate.party
        );
        await tx
          .insert(candidacyBallotLines)
          .values({
            ballotLineId,
            candidacyId,
            stageId: ballotStageId,
            partyLabel: candidate.party,
            sourceId: RHODE_ISLAND_SOURCE_ID,
          })
          .onConflictDoUpdate({
            target: candidacyBallotLines.ballotLineId,
            set: { partyLabel: candidate.party, sourceId: RHODE_ISLAND_SOURCE_ID },
          });
      }

      const eventId = stableElectionId("event", candidacyId, eventStageId, currentStatus);
      await tx
        .insert(candidateStatusEvents)
        .values({
          eventId,
          candidacyId,
          electionStageId: eventStageId,
          status: currentStatus,
          effectiveDate: null,
          observedAt,
          sourceId: RHODE_ISLAND_SOURCE_ID,
          snapshotSha256: snapshot.sha256,
          details: {
            state_status: candidate.status,
            on_primary_ballot: candidate.onPrimaryBallot,
            on_election_ballot: candidate.onElectionBallot,
          },
        })
        .onConflictDoNothing();
    }
  }

  await tx
    .update(electionSources)
    .set({
      coverageStatus: "verified_ballot",
      lastCheckedAt: observedAt,
      lastSuccessAt: observedAt,
      nextExpectedEvent,
      nextCheckAt: new Date(observedAt.getTime() + 24 * 60 * 60 * 1000),
      updatedAt: observedAt,
    })
    .where(eq(electionSources.sourceId, RHODE_ISLAND_SOURCE_ID));

  return fetched.candidates.length;
}

function nebraskaPrimaryPartyCode(party: Exclude<NebraskaParty, "By Petition">) {
  if (party === "Republican") return "R";
  if (party === "Democratic") return "D";
  if (party === "Libertarian") return "L";
  return "LMN";
}

function nebraskaCandidateKey(candidate: {
  office: "H" | "S";
  district: number | null;
  normalizedName: string;
  party: NebraskaParty;
}) {
  return `${candidate.office}|${candidate.district ?? "statewide"}|${candidate.normalizedName}|${candidate.party}`;
}

async function ingestNebraska(db: Database) {
  const fetched = await fetchNebraskaSources();
  console.log(
    `Nebraska: ${fetched.currentCandidates.length} current federal candidates; ${fetched.primaryCandidates.length} certified primary result records, including ${fetched.primaryCandidates.filter((candidate) => candidate.isWinner).length} nominees.`
  );

  if (DRY_RUN) {
    return fetched.currentCandidates.length + fetched.primaryCandidates.length;
  }

  const [
    landingSnapshot,
    workbookSnapshot,
    canvassSnapshot,
    certificationSnapshot,
    statewideResultSnapshot,
    congressionalResultSnapshot,
    petitionCertificationSnapshot,
    fecMatches,
  ] = await Promise.all([
    storeElectionSnapshot(NEBRASKA_SOURCE_ID, fetched.landing),
    storeElectionSnapshot(NEBRASKA_SOURCE_ID, fetched.workbook),
    storeElectionSnapshot(NEBRASKA_SOURCE_ID, fetched.canvass),
    storeElectionSnapshot(NEBRASKA_SOURCE_ID, fetched.certification),
    storeElectionSnapshot(NEBRASKA_SOURCE_ID, fetched.statewideResults),
    storeElectionSnapshot(NEBRASKA_SOURCE_ID, fetched.congressionalResults),
    storeElectionSnapshot(NEBRASKA_SOURCE_ID, fetched.petitionCertification),
    fecMatchesForNebraska(db),
  ]);
  const observedAt = new Date();
  const certifiedAt = new Date("2026-06-08T12:00:00Z");
  const tx = db;

  for (const snapshot of [
    landingSnapshot,
    workbookSnapshot,
    canvassSnapshot,
    certificationSnapshot,
    statewideResultSnapshot,
    congressionalResultSnapshot,
    petitionCertificationSnapshot,
  ]) {
    await tx
      .insert(electionSourceSnapshots)
      .values({
        snapshotSha256: snapshot.sha256,
        sourceId: NEBRASKA_SOURCE_ID,
        originalUrl: snapshot.originalUrl,
        blobUrl: snapshot.blobUrl,
        contentType: snapshot.contentType,
        contentLength: snapshot.contentLength,
        etag: snapshot.etag,
        lastModified: snapshot.lastModified,
      })
      .onConflictDoNothing();
  }

  const contests = [
    {
      contestId: senateContestId("NE", 2),
      office: "S" as const,
      district: null,
      senateClass: 2,
      title: "Nebraska U.S. Senate Class 2",
    },
    ...[1, 2, 3].map((district) => ({
      contestId: houseContestId("NE", district),
      office: "H" as const,
      district,
      senateClass: null,
      title: `Nebraska U.S. House District ${district}`,
    })),
  ];

  for (const contest of contests) {
    await tx
      .insert(electionContests)
      .values({
        contestId: contest.contestId,
        electionCycle: 2026,
        stateCode: "NE",
        office: contest.office,
        district: contest.district,
        senateClass: contest.senateClass,
        title: contest.title,
        currentStage: "general",
        coverageStatus: "verified_ballot",
        certifiedThrough: "2026-05-12",
        nextExpectedEvent: "2026-11-03",
        primarySourceId: NEBRASKA_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionContests.contestId,
        set: {
          title: contest.title,
          currentStage: "general",
          coverageStatus: "verified_ballot",
          certifiedThrough: "2026-05-12",
          nextExpectedEvent: "2026-11-03",
          primarySourceId: NEBRASKA_SOURCE_ID,
          updatedAt: observedAt,
        },
      });

    const contestPrimary = fetched.primaryCandidates.filter(
      (candidate) =>
        candidate.office === contest.office &&
        (candidate.office === "S" || candidate.district === contest.district)
    );
    const primaryParties = Array.from(
      new Set(contestPrimary.map((candidate) => candidate.party))
    );
    for (const [index, party] of primaryParties.entries()) {
      const stageId = `${contest.contestId}-primary-${nebraskaPrimaryPartyCode(party)}`;
      await tx
        .insert(electionStages)
        .values({
          stageId,
          contestId: contest.contestId,
          stageKind: "primary",
          party,
          electionDate: "2026-05-12",
          sequenceNumber: index + 1,
          resultStatus: "certified",
          certifiedAt,
          sourceId: NEBRASKA_SOURCE_ID,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: electionStages.stageId,
          set: {
            resultStatus: "certified",
            certifiedAt,
            sourceId: NEBRASKA_SOURCE_ID,
            updatedAt: observedAt,
          },
        });
    }

    const generalStageId = `${contest.contestId}-general`;
    await tx
      .insert(electionStages)
      .values({
        stageId: generalStageId,
        contestId: contest.contestId,
        stageKind: "general",
        electionDate: "2026-11-03",
        sequenceNumber: 10,
        resultStatus: "not_started",
        sourceId: NEBRASKA_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionStages.stageId,
        set: { sourceId: NEBRASKA_SOURCE_ID, updatedAt: observedAt },
      });

    const combined = new Map<
      string,
      {
        current: NebraskaCurrentCandidate | null;
        primary: NebraskaPrimaryCandidate | null;
      }
    >();
    for (const candidate of contestPrimary) {
      combined.set(nebraskaCandidateKey(candidate), { current: null, primary: candidate });
    }
    for (const candidate of fetched.currentCandidates.filter(
      (current) =>
        current.office === contest.office &&
        (current.office === "S" || current.district === contest.district)
    )) {
      const key = nebraskaCandidateKey(candidate);
      combined.set(key, {
        current: candidate,
        primary: combined.get(key)?.primary ?? null,
      });
    }

    for (const pair of combined.values()) {
      const candidate = pair.current ?? pair.primary;
      if (!candidate) continue;
      const fecCandidateId = fecMatches(
        candidate.office,
        candidate.district,
        candidate.name
      );
      const { personId, candidacyId } = candidateIdentity(
        contest.contestId,
        candidate.normalizedName,
        partyCode(candidate.party),
        fecCandidateId
      );
      const currentStatus = pair.current
        ? pair.current.party === "By Petition"
          ? "state_general_qualified"
          : "general_ballot"
        : pair.primary?.isWinner
          ? "certified_primary_winner_not_on_current_list"
          : "primary_defeated";
      const isActive = pair.current != null;

      await tx
        .insert(candidatePeople)
        .values({
          personId,
          displayName: candidate.name,
          normalizedName: candidate.normalizedName,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidatePeople.personId,
          set: {
            displayName: candidate.name,
            normalizedName: candidate.normalizedName,
            updatedAt: observedAt,
          },
        });
      await tx
        .insert(candidacies)
        .values({
          candidacyId,
          contestId: contest.contestId,
          personId,
          party: candidate.party,
          currentStatus,
          isActive,
          fecCandidateId,
          verifiedSourceId: NEBRASKA_SOURCE_ID,
          verifiedAt: observedAt,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidacies.candidacyId,
          set: {
            party: candidate.party,
            currentStatus,
            isActive,
            fecCandidateId,
            verifiedSourceId: NEBRASKA_SOURCE_ID,
            verifiedAt: observedAt,
            updatedAt: observedAt,
          },
        });

      if (pair.primary) {
        const primaryStageId = `${contest.contestId}-primary-${nebraskaPrimaryPartyCode(pair.primary.party)}`;
        const ballotLineId = stableElectionId(
          "ballot",
          candidacyId,
          primaryStageId,
          pair.primary.party
        );
        await tx
          .insert(candidacyBallotLines)
          .values({
            ballotLineId,
            candidacyId,
            stageId: primaryStageId,
            partyLabel: pair.primary.party,
            sourceId: NEBRASKA_SOURCE_ID,
          })
          .onConflictDoUpdate({
            target: candidacyBallotLines.ballotLineId,
            set: { partyLabel: pair.primary.party, sourceId: NEBRASKA_SOURCE_ID },
          });

        const resultId = stableElectionId("result", primaryStageId, candidacyId);
        await tx
          .insert(electionResults)
          .values({
            resultId,
            stageId: primaryStageId,
            candidacyId,
            totalVotes: pair.primary.totalVotes,
            isWinner: pair.primary.isWinner,
            resultStatus: "certified",
            sourceId: NEBRASKA_SOURCE_ID,
            snapshotSha256: canvassSnapshot.sha256,
            updatedAt: observedAt,
          })
          .onConflictDoUpdate({
            target: electionResults.resultId,
            set: {
              totalVotes: pair.primary.totalVotes,
              isWinner: pair.primary.isWinner,
              resultStatus: "certified",
              snapshotSha256: canvassSnapshot.sha256,
              updatedAt: observedAt,
            },
          });

        const resultValueSnapshot =
          pair.primary.office === "S"
            ? statewideResultSnapshot
            : congressionalResultSnapshot;
        const status = pair.primary.isWinner ? "primary_winner" : "primary_defeated";
        await tx
          .insert(candidateStatusEvents)
          .values({
            eventId: stableElectionId(
              "event",
              candidacyId,
              primaryStageId,
              status,
              canvassSnapshot.sha256
            ),
            candidacyId,
            electionStageId: primaryStageId,
            status,
            effectiveDate: "2026-05-12",
            observedAt,
            sourceId: NEBRASKA_SOURCE_ID,
            snapshotSha256: canvassSnapshot.sha256,
            details: {
              votes: pair.primary.totalVotes,
              result_status: "certified",
              result_value_snapshot_sha256: resultValueSnapshot.sha256,
              certification_page_snapshot_sha256: certificationSnapshot.sha256,
            },
          })
          .onConflictDoNothing();
      }

      if (pair.current) {
        const ballotLineId = stableElectionId(
          "ballot",
          candidacyId,
          generalStageId,
          pair.current.party
        );
        await tx
          .insert(candidacyBallotLines)
          .values({
            ballotLineId,
            candidacyId,
            stageId: generalStageId,
            partyLabel: pair.current.party,
            sourceId: NEBRASKA_SOURCE_ID,
          })
          .onConflictDoUpdate({
            target: candidacyBallotLines.ballotLineId,
            set: { partyLabel: pair.current.party, sourceId: NEBRASKA_SOURCE_ID },
          });

        const isPetition = pair.current.party === "By Petition";
        const eventSnapshot = isPetition
          ? petitionCertificationSnapshot
          : workbookSnapshot;
        await tx
          .insert(candidateStatusEvents)
          .values({
            eventId: stableElectionId(
              "event",
              candidacyId,
              generalStageId,
              currentStatus
            ),
            candidacyId,
            electionStageId: generalStageId,
            status: currentStatus,
            effectiveDate: isPetition ? "2026-07-16" : "2026-06-08",
            observedAt,
            sourceId: NEBRASKA_SOURCE_ID,
            snapshotSha256: eventSnapshot.sha256,
            details: {
              qualification_basis: isPetition
                ? "state_certified_candidate_petition"
                : "certified_primary_nominee_on_current_state_list",
              incumbency_status: pair.current.isIncumbent
                ? "incumbent"
                : "nonincumbent",
            },
          })
          .onConflictDoNothing();
      }
    }
  }

  await tx
    .update(electionSources)
    .set({
      coverageStatus: "verified_ballot",
      lastCheckedAt: observedAt,
      lastSuccessAt: observedAt,
      nextExpectedEvent: "2026-11-03",
      nextCheckAt: new Date(observedAt.getTime() + 24 * 60 * 60 * 1000),
      updatedAt: observedAt,
    })
    .where(eq(electionSources.sourceId, NEBRASKA_SOURCE_ID));

  return fetched.currentCandidates.length + fetched.primaryCandidates.length;
}

function michiganCandidateStatus(candidate: MichiganCandidate) {
  if (candidate.status === "qualified") {
    return candidate.stage === "general" ? "general_ballot" : "state_primary_ballot";
  }
  if (candidate.status === "filed_unofficial") {
    return "state_general_filing_unofficial";
  }
  return candidate.status;
}

async function ingestMichigan(db: Database) {
  const fetched = await fetchMichiganSources();
  const activePrimary = fetched.primaryCandidates.filter(
    (candidate) => candidate.status === "qualified"
  ).length;
  const generalIsOfficial = fetched.generalReportKind === "official";
  const activeGeneral = fetched.generalCandidates.filter((candidate) =>
    generalIsOfficial
      ? candidate.status === "qualified"
      : candidate.status === "filed_unofficial"
  ).length;
  console.log(
    generalIsOfficial
      ? `Michigan: ${fetched.primaryCandidates.length} official primary records (${activePrimary} primary ballot candidates); ${fetched.generalCandidates.length} official general records (${activeGeneral} verified general ballot candidates).`
      : `Michigan: ${fetched.primaryCandidates.length} official primary records (${activePrimary} active ballot candidates); ${fetched.generalCandidates.length} unofficial general filing records (${activeGeneral} active provisional filings).`
  );

  if (DRY_RUN) {
    return fetched.primaryCandidates.length + fetched.generalCandidates.length;
  }

  const [primarySnapshot, generalSnapshot, fecMatches] = await Promise.all([
    storeElectionSnapshot(MICHIGAN_SOURCE_ID, fetched.primary),
    storeElectionSnapshot(MICHIGAN_SOURCE_ID, fetched.general),
    fecMatchesForMichigan(db),
  ]);
  const observedAt = new Date();
  const tx = db;
  // The official general listing is the state's verified November ballot;
  // the unofficial one is filing evidence only, so contests stay pending.
  const michiganContestStage = generalIsOfficial ? "general" : "primary";
  const michiganCoverage = generalIsOfficial
    ? ("verified_ballot" as const)
    : ("verification_pending" as const);
  const michiganNextEvent = generalIsOfficial ? "2026-11-03" : "2026-08-04";

  for (const snapshot of [primarySnapshot, generalSnapshot]) {
    await tx
      .insert(electionSourceSnapshots)
      .values({
        snapshotSha256: snapshot.sha256,
        sourceId: MICHIGAN_SOURCE_ID,
        originalUrl: snapshot.originalUrl,
        blobUrl: snapshot.blobUrl,
        contentType: snapshot.contentType,
        contentLength: snapshot.contentLength,
        etag: snapshot.etag,
        lastModified: snapshot.lastModified,
      })
      .onConflictDoNothing();
  }

  const contests = [
    {
      contestId: senateContestId("MI", 2),
      office: "S" as const,
      district: null,
      senateClass: 2 as const,
      title: "Michigan U.S. Senate Class 2",
    },
    ...Array.from({ length: 13 }, (_, index) => ({
      contestId: houseContestId("MI", index + 1),
      office: "H" as const,
      district: index + 1,
      senateClass: null,
      title: `Michigan U.S. House District ${index + 1}`,
    })),
  ];

  for (const contest of contests) {
    await tx
      .insert(electionContests)
      .values({
        contestId: contest.contestId,
        electionCycle: 2026,
        stateCode: "MI",
        office: contest.office,
        district: contest.district,
        senateClass: contest.senateClass,
        title: contest.title,
        currentStage: michiganContestStage,
        coverageStatus: michiganCoverage,
        certifiedThrough: null,
        nextExpectedEvent: michiganNextEvent,
        primarySourceId: MICHIGAN_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionContests.contestId,
        set: {
          title: contest.title,
          currentStage: michiganContestStage,
          coverageStatus: michiganCoverage,
          certifiedThrough: null,
          nextExpectedEvent: michiganNextEvent,
          primarySourceId: MICHIGAN_SOURCE_ID,
          updatedAt: observedAt,
        },
      });

    for (const party of ["Democratic", "Republican"] as const) {
      const stageId = `${contest.contestId}-primary-${party === "Democratic" ? "D" : "R"}`;
      await tx
        .insert(electionStages)
        .values({
          stageId,
          contestId: contest.contestId,
          stageKind: "primary",
          party,
          electionDate: "2026-08-04",
          sequenceNumber: party === "Democratic" ? 1 : 2,
          resultStatus: "not_started",
          sourceId: MICHIGAN_SOURCE_ID,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: electionStages.stageId,
          set: {
            resultStatus: "not_started",
            sourceId: MICHIGAN_SOURCE_ID,
            updatedAt: observedAt,
          },
        });
    }

    const generalStageId = `${contest.contestId}-general`;
    await tx
      .insert(electionStages)
      .values({
        stageId: generalStageId,
        contestId: contest.contestId,
        stageKind: "general",
        electionDate: "2026-11-03",
        sequenceNumber: 3,
        resultStatus: "not_started",
        sourceId: MICHIGAN_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionStages.stageId,
        set: { sourceId: MICHIGAN_SOURCE_ID, updatedAt: observedAt },
      });

    const inContest = (candidate: MichiganCandidate) =>
      candidate.office === contest.office &&
      (candidate.office === "S" || candidate.district === contest.district);
    const combined = new Map<
      string,
      { primary: MichiganCandidate | null; general: MichiganCandidate | null }
    >();
    for (const candidate of fetched.primaryCandidates.filter(inContest)) {
      const key = `${candidate.normalizedName}|${candidate.party}`;
      combined.set(key, { primary: candidate, general: null });
    }
    for (const candidate of fetched.generalCandidates.filter(inContest)) {
      const key = `${candidate.normalizedName}|${candidate.party}`;
      combined.set(key, {
        primary: combined.get(key)?.primary ?? null,
        general: candidate,
      });
    }

    for (const pair of combined.values()) {
      const candidate = pair.general ?? pair.primary;
      if (!candidate) continue;
      const fecCandidateId = fecMatches(
        candidate.office,
        candidate.district,
        candidate.name
      );
      const { personId, candidacyId } = candidateIdentity(
        contest.contestId,
        candidate.normalizedName,
        partyCode(candidate.party),
        fecCandidateId
      );
      const currentRecord = pair.general ?? pair.primary;
      if (!currentRecord) continue;
      // Once the state publishes the official general list, a primary-only
      // candidacy is no longer on the November ballot. The adapter does not
      // ingest Michigan primary results, so it records absence from the
      // official list rather than asserting a defeat.
      const droppedFromGeneral =
        generalIsOfficial &&
        pair.general == null &&
        pair.primary?.status === "qualified";
      const currentStatus = droppedFromGeneral
        ? "not_on_state_general_list"
        : michiganCandidateStatus(currentRecord);
      const isActive =
        !droppedFromGeneral &&
        (currentRecord.status === "qualified" ||
          currentRecord.status === "filed_unofficial");

      await tx
        .insert(candidatePeople)
        .values({
          personId,
          displayName: candidate.name,
          normalizedName: candidate.normalizedName,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidatePeople.personId,
          set: {
            displayName: candidate.name,
            normalizedName: candidate.normalizedName,
            updatedAt: observedAt,
          },
        });
      await tx
        .insert(candidacies)
        .values({
          candidacyId,
          contestId: contest.contestId,
          personId,
          party: candidate.party,
          currentStatus,
          isActive,
          fecCandidateId,
          verifiedSourceId: MICHIGAN_SOURCE_ID,
          verifiedAt: observedAt,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidacies.candidacyId,
          set: {
            party: candidate.party,
            currentStatus,
            isActive,
            fecCandidateId,
            verifiedSourceId: MICHIGAN_SOURCE_ID,
            verifiedAt: observedAt,
            updatedAt: observedAt,
          },
        });

      if (pair.primary) {
        const primaryStageId = `${contest.contestId}-primary-${pair.primary.party === "Democratic" ? "D" : "R"}`;
        const status = michiganCandidateStatus(pair.primary);
        if (pair.primary.status === "qualified") {
          const ballotLineId = stableElectionId(
            "ballot",
            candidacyId,
            primaryStageId,
            pair.primary.party
          );
          await tx
            .insert(candidacyBallotLines)
            .values({
              ballotLineId,
              candidacyId,
              stageId: primaryStageId,
              partyLabel: pair.primary.party,
              sourceId: MICHIGAN_SOURCE_ID,
            })
            .onConflictDoUpdate({
              target: candidacyBallotLines.ballotLineId,
              set: {
                partyLabel: pair.primary.party,
                sourceId: MICHIGAN_SOURCE_ID,
              },
            });
        }
        await tx
          .insert(candidateStatusEvents)
          .values({
            eventId: stableElectionId(
              "event",
              candidacyId,
              primaryStageId,
              status
            ),
            candidacyId,
            electionStageId: primaryStageId,
            status,
            effectiveDate: null,
            observedAt,
            sourceId: MICHIGAN_SOURCE_ID,
            snapshotSha256: primarySnapshot.sha256,
            details: {
              filed_on: pair.primary.filedOn,
              filing_method: pair.primary.filingMethod,
              source_report: "Official Candidate Listing",
            },
          })
          .onConflictDoNothing();
      }

      if (pair.general) {
        const status = michiganCandidateStatus(pair.general);
        if (generalIsOfficial && pair.general.status === "qualified") {
          const ballotLineId = stableElectionId(
            "ballot",
            candidacyId,
            generalStageId,
            pair.general.party
          );
          await tx
            .insert(candidacyBallotLines)
            .values({
              ballotLineId,
              candidacyId,
              stageId: generalStageId,
              partyLabel: pair.general.party,
              sourceId: MICHIGAN_SOURCE_ID,
            })
            .onConflictDoUpdate({
              target: candidacyBallotLines.ballotLineId,
              set: {
                partyLabel: pair.general.party,
                sourceId: MICHIGAN_SOURCE_ID,
              },
            });
        }
        await tx
          .insert(candidateStatusEvents)
          .values({
            eventId: stableElectionId(
              "event",
              candidacyId,
              generalStageId,
              status
            ),
            candidacyId,
            electionStageId: generalStageId,
            status,
            effectiveDate: null,
            observedAt,
            sourceId: MICHIGAN_SOURCE_ID,
            snapshotSha256: generalSnapshot.sha256,
            details: {
              filed_on: pair.general.filedOn,
              filing_method: pair.general.filingMethod,
              source_report: generalIsOfficial
                ? "Official Candidate Listing"
                : "Unofficial Candidate Listing",
              ballot_access_verified: generalIsOfficial,
            },
          })
          .onConflictDoNothing();
      }
    }
  }

  if (generalIsOfficial) {
    // A candidacy the state no longer lists (a name that changed spelling
    // between reports, or a filer removed outright) is not on the November
    // ballot. Rows untouched by this run are retired with an event instead
    // of lingering as active provisional filings.
    const stale = await tx
      .select({
        candidacyId: candidacies.candidacyId,
        contestId: candidacies.contestId,
      })
      .from(candidacies)
      .where(
        and(
          inArray(
            candidacies.contestId,
            contests.map((contest) => contest.contestId)
          ),
          eq(candidacies.isActive, true),
          lt(candidacies.updatedAt, observedAt)
        )
      );
    for (const row of stale) {
      await tx
        .update(candidacies)
        .set({
          currentStatus: "not_on_state_general_list",
          isActive: false,
          updatedAt: observedAt,
        })
        .where(eq(candidacies.candidacyId, row.candidacyId));
      const generalStageId = `${row.contestId}-general`;
      await tx
        .insert(candidateStatusEvents)
        .values({
          eventId: stableElectionId(
            "event",
            row.candidacyId,
            generalStageId,
            "not_on_state_general_list"
          ),
          candidacyId: row.candidacyId,
          electionStageId: generalStageId,
          status: "not_on_state_general_list",
          effectiveDate: null,
          observedAt,
          sourceId: MICHIGAN_SOURCE_ID,
          snapshotSha256: generalSnapshot.sha256,
          details: {
            source_report: "Official Candidate Listing",
            reason: "absent from the official general candidate listing",
          },
        })
        .onConflictDoNothing();
    }
    if (stale.length > 0) {
      console.log(
        `Michigan: retired ${stale.length} candidacies absent from the official general listing.`
      );
    }
  }

  await tx
    .update(electionSources)
    .set({
      coverageStatus: michiganCoverage,
      lastCheckedAt: observedAt,
      lastSuccessAt: observedAt,
      nextExpectedEvent: michiganNextEvent,
      nextCheckAt: new Date(observedAt.getTime() + 24 * 60 * 60 * 1000),
      updatedAt: observedAt,
    })
    .where(eq(electionSources.sourceId, MICHIGAN_SOURCE_ID));

  return fetched.primaryCandidates.length + fetched.generalCandidates.length;
}

async function ingestWashington(db: Database) {
  const fetched = await fetchWashingtonSource();
  const activeCandidates = fetched.candidates.filter(
    (candidate) => candidate.status === "qualified"
  ).length;
  console.log(
    `Washington: ${fetched.candidates.length} official federal primary records (${activeCandidates} active ballot candidates).`
  );

  if (DRY_RUN) return fetched.candidates.length;

  const [primarySnapshot, fecMatches] = await Promise.all([
    storeElectionSnapshot(WASHINGTON_SOURCE_ID, fetched.primary),
    fecMatchesForWashington(db),
  ]);
  const observedAt = new Date();
  const tx = db;

  await tx
    .insert(electionSourceSnapshots)
    .values({
      snapshotSha256: primarySnapshot.sha256,
      sourceId: WASHINGTON_SOURCE_ID,
      originalUrl: primarySnapshot.originalUrl,
      blobUrl: primarySnapshot.blobUrl,
      contentType: primarySnapshot.contentType,
      contentLength: primarySnapshot.contentLength,
      etag: primarySnapshot.etag,
      lastModified: primarySnapshot.lastModified,
    })
    .onConflictDoNothing();

  for (let district = 1; district <= 10; district += 1) {
    const contestId = houseContestId("WA", district);
    const title = `Washington U.S. House District ${district}`;
    await tx
      .insert(electionContests)
      .values({
        contestId,
        electionCycle: 2026,
        stateCode: "WA",
        office: "H",
        district,
        senateClass: null,
        title,
        currentStage: "primary",
        coverageStatus: "verified_ballot",
        certifiedThrough: null,
        nextExpectedEvent: "2026-08-04",
        primarySourceId: WASHINGTON_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionContests.contestId,
        set: {
          title,
          currentStage: "primary",
          coverageStatus: "verified_ballot",
          certifiedThrough: null,
          nextExpectedEvent: "2026-08-04",
          primarySourceId: WASHINGTON_SOURCE_ID,
          updatedAt: observedAt,
        },
      });

    const primaryStageId = `${contestId}-primary-top-two`;
    await tx
      .insert(electionStages)
      .values({
        stageId: primaryStageId,
        contestId,
        stageKind: "primary",
        party: null,
        electionDate: "2026-08-04",
        sequenceNumber: 1,
        resultStatus: "not_started",
        sourceId: WASHINGTON_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionStages.stageId,
        set: {
          resultStatus: "not_started",
          sourceId: WASHINGTON_SOURCE_ID,
          updatedAt: observedAt,
        },
      });

    const generalStageId = `${contestId}-general`;
    await tx
      .insert(electionStages)
      .values({
        stageId: generalStageId,
        contestId,
        stageKind: "general",
        party: null,
        electionDate: "2026-11-03",
        sequenceNumber: 2,
        resultStatus: "not_started",
        sourceId: WASHINGTON_SOURCE_ID,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: electionStages.stageId,
        set: { sourceId: WASHINGTON_SOURCE_ID, updatedAt: observedAt },
      });

    for (const candidate of fetched.candidates.filter(
      (record) => record.district === district
    )) {
      const fecCandidateId = fecMatches(district, candidate.name);
      const { personId, candidacyId } = candidateIdentity(
        contestId,
        candidate.normalizedName,
        partyCode(candidate.partyPreference),
        fecCandidateId
      );
      const currentStatus =
        candidate.status === "qualified" ? "state_primary_ballot" : "withdrawn";
      const isActive = candidate.status === "qualified";

      await tx
        .insert(candidatePeople)
        .values({
          personId,
          displayName: candidate.name,
          normalizedName: candidate.normalizedName,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidatePeople.personId,
          set: {
            displayName: candidate.name,
            normalizedName: candidate.normalizedName,
            updatedAt: observedAt,
          },
        });
      await tx
        .insert(candidacies)
        .values({
          candidacyId,
          contestId,
          personId,
          party: candidate.partyPreference,
          currentStatus,
          isActive,
          fecCandidateId,
          verifiedSourceId: WASHINGTON_SOURCE_ID,
          verifiedAt: observedAt,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: candidacies.candidacyId,
          set: {
            party: candidate.partyPreference,
            currentStatus,
            isActive,
            fecCandidateId,
            verifiedSourceId: WASHINGTON_SOURCE_ID,
            verifiedAt: observedAt,
            updatedAt: observedAt,
          },
        });

      if (candidate.status === "qualified") {
        const ballotLineId = stableElectionId(
          "ballot",
          candidacyId,
          primaryStageId,
          candidate.partyPreference
        );
        await tx
          .insert(candidacyBallotLines)
          .values({
            ballotLineId,
            candidacyId,
            stageId: primaryStageId,
            partyLabel: candidate.partyPreference,
            sourceId: WASHINGTON_SOURCE_ID,
          })
          .onConflictDoUpdate({
            target: candidacyBallotLines.ballotLineId,
            set: {
              partyLabel: candidate.partyPreference,
              sourceId: WASHINGTON_SOURCE_ID,
            },
          });
      }

      await tx
        .insert(candidateStatusEvents)
        .values({
          eventId: stableElectionId(
            "event",
            candidacyId,
            primaryStageId,
            currentStatus
          ),
          candidacyId,
          electionStageId: primaryStageId,
          status: currentStatus,
          effectiveDate: candidate.filedOn,
          observedAt,
          sourceId: WASHINGTON_SOURCE_ID,
          snapshotSha256: primarySnapshot.sha256,
          details: {
            filed_on: candidate.filedOn,
            ballot_order: candidate.ballotOrder,
            party_preference: candidate.partyPreference,
            primary_type: "top_two",
          },
        })
        .onConflictDoNothing();
    }
  }

  await tx
    .update(electionSources)
    .set({
      coverageStatus: "verified_ballot",
      lastCheckedAt: observedAt,
      lastSuccessAt: observedAt,
      nextExpectedEvent: "2026-08-04",
      nextCheckAt: new Date(observedAt.getTime() + 24 * 60 * 60 * 1000),
      updatedAt: observedAt,
    })
    .where(eq(electionSources.sourceId, WASHINGTON_SOURCE_ID));

  return fetched.candidates.length;
}

async function selectedStates(db: Database) {
  if (REQUESTED_STATE) return [REQUESTED_STATE];
  if (BACKFILL) return ADAPTER_STATES;
  const due = await db
    .select({ stateCode: electionSources.stateCode })
    .from(electionSources)
    .where(
      and(
        lte(electionSources.nextCheckAt, new Date()),
        inArray(electionSources.adapterKey, [
          "indiana-2026",
          "delaware-2026",
          "florida-2026",
          "rhode-island-2026",
          "nebraska-2026",
          "michigan-2026",
          "washington-2026",
        ])
      )
    );
  return due.map((row) => row.stateCode).filter((code): code is string => Boolean(code));
}

async function main() {
  if (REQUESTED_STATE && !ADAPTER_STATES.includes(REQUESTED_STATE)) {
    throw new Error(`No verified adapter is available for ${REQUESTED_STATE}`);
  }

  if (DRY_RUN) {
    // Dry runs never touch the database, so --due has nothing to consult;
    // every adapter state runs unless one was requested explicitly.
    const states = REQUESTED_STATE ? [REQUESTED_STATE] : ADAPTER_STATES;
    let count = 0;
    for (const state of states) {
      if (state === "IN") count += await ingestIndiana({} as Database);
      if (state === "DE") count += await ingestDelaware({} as Database);
      if (state === "FL") count += await ingestFlorida({} as Database);
      if (state === "RI") count += await ingestRhodeIsland({} as Database);
      if (state === "NE") count += await ingestNebraska({} as Database);
      if (state === "MI") count += await ingestMichigan({} as Database);
      if (state === "WA") count += await ingestWashington({} as Database);
    }
    console.log(
      `Dry run complete. Parsed ${count} records across ${states.join(", ")}; no database or Blob writes.`
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required so source snapshots survive GitHub Actions");
  }

  const db = drizzle(neon(process.env.DATABASE_URL));
  await seedSourceRegistry(db);
  const states = await selectedStates(db);
  if (states.length === 0) {
    console.log("No election adapters are due.");
    return;
  }

  const [run] = await db
    .insert(syncLog)
    .values({ source: "state_election_authorities", entityType: "elections", status: "running" })
    .returning();
  try {
    let records = 0;
    for (const state of states) {
      if (state === "IN") records += await ingestIndiana(db);
      if (state === "DE") records += await ingestDelaware(db);
      if (state === "FL") records += await ingestFlorida(db);
      if (state === "RI") records += await ingestRhodeIsland(db);
      if (state === "NE") records += await ingestNebraska(db);
      if (state === "MI") records += await ingestMichigan(db);
      if (state === "WA") records += await ingestWashington(db);
    }
    await db
      .update(syncLog)
      .set({ status: "success", completedAt: new Date(), recordsCount: records })
      .where(sql`id = ${run.id}`);
    console.log(`Election ingest complete. Processed ${records} records.`);
  } catch (error) {
    await db
      .update(syncLog)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Unknown election ingest error",
      })
      .where(sql`id = ${run.id}`);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Election ingest failed");
  process.exit(1);
});
