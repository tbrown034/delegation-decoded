import "../lib/env";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
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
  ELECTION_SOURCE_REGISTRY,
  INDIANA_2026_SOURCES,
} from "../../lib/elections/registry";
import {
  candidateIdentity,
  houseContestId,
  normalizeCandidateName,
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

const DRY_RUN = process.argv.includes("--dry-run");
const BACKFILL = process.argv.includes("--backfill");
const STATE_ARG = process.argv.find((argument) => argument.startsWith("--state="));
const REQUESTED_STATE = STATE_ARG?.split("=", 2)[1]?.trim().toUpperCase() ?? null;
const INDIANA_SOURCE_ID = "state-in";

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
  const byRaceName = new Map<string, string[]>();
  for (const row of rows) {
    if (row.district == null) continue;
    const key = `${row.district}|${normalizeCandidateName(row.name)}`;
    const ids = byRaceName.get(key) ?? [];
    ids.push(row.candidateId);
    byRaceName.set(key, ids);
  }
  return byRaceName;
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

  await db.transaction(async (tx) => {
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
        const fecIds = fecMatches.get(`${district}|${candidate.normalizedName}`) ?? [];
        const fecCandidateId = fecIds.length === 1 ? fecIds[0] : null;
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
  });
  return fetched.generalCandidates.length + fetched.primary.candidates.length;
}

async function selectedStates(db: Database) {
  if (REQUESTED_STATE) return [REQUESTED_STATE];
  if (BACKFILL) return ["IN"];
  const due = await db
    .select({ stateCode: electionSources.stateCode })
    .from(electionSources)
    .where(
      and(
        lte(electionSources.nextCheckAt, new Date()),
        inArray(electionSources.adapterKey, ["indiana-2026"])
      )
    );
  return due.map((row) => row.stateCode).filter((code): code is string => Boolean(code));
}

async function main() {
  if (REQUESTED_STATE && REQUESTED_STATE !== "IN") {
    throw new Error(`No verified adapter is available for ${REQUESTED_STATE}`);
  }

  if (DRY_RUN) {
    const count = await ingestIndiana({} as Database);
    console.log(`Dry run complete. Parsed ${count} Indiana records; no database or Blob writes.`);
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
