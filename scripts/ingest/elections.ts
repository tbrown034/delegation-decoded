import "../lib/env";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
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

const DRY_RUN = process.argv.includes("--dry-run");
const BACKFILL = process.argv.includes("--backfill");
const STATE_ARG = process.argv.find((argument) => argument.startsWith("--state="));
const REQUESTED_STATE = STATE_ARG?.split("=", 2)[1]?.trim().toUpperCase() ?? null;
const INDIANA_SOURCE_ID = "state-in";
const DELAWARE_SOURCE_ID = "state-de";
const FLORIDA_SOURCE_ID = "state-fl";

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

async function fetchIndianaSources() {
  const [general, settings, primaryResults] = await Promise.all([
    safeFetchBuffer(INDIANA_2026_SOURCES.generalCandidateList, {
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

async function selectedStates(db: Database) {
  if (REQUESTED_STATE) return [REQUESTED_STATE];
  if (BACKFILL) return ["IN", "DE", "FL"];
  const due = await db
    .select({ stateCode: electionSources.stateCode })
    .from(electionSources)
    .where(
      and(
        lte(electionSources.nextCheckAt, new Date()),
        inArray(electionSources.adapterKey, ["indiana-2026", "delaware-2026", "florida-2026"])
      )
    );
  return due.map((row) => row.stateCode).filter((code): code is string => Boolean(code));
}

async function main() {
  if (REQUESTED_STATE && !["IN", "DE", "FL"].includes(REQUESTED_STATE)) {
    throw new Error(`No verified adapter is available for ${REQUESTED_STATE}`);
  }

  if (DRY_RUN) {
    const states = REQUESTED_STATE
      ? [REQUESTED_STATE]
      : BACKFILL
        ? ["IN", "DE", "FL"]
        : ["IN", "DE", "FL"];
    let count = 0;
    for (const state of states) {
      if (state === "IN") count += await ingestIndiana({} as Database);
      if (state === "DE") count += await ingestDelaware({} as Database);
      if (state === "FL") count += await ingestFlorida({} as Database);
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
