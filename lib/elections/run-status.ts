// Pure decision logic for how one elections.ts run reports itself in
// sync_log, pulled out of the script so it can be unit tested without a
// database connection — the script itself runs main() unconditionally at
// import time, which an import-for-testing would trigger.
export type ElectionFailure = { state: string; message: string };

export type ElectionRunOutcome = {
  status: "success" | "failed";
  errorMessage: string | null;
};

// A partial failure (some states ran, some didn't) still counts as a
// successful run: the states that worked wrote real records, and the
// health gate's 72-hour elections staleness threshold is about overall
// freshness, not any one state. But if every attempted state failed,
// nothing worked, and the run is a failure, not a success with an empty
// accomplishment — lib/health.ts's partial-failure warn check reads
// error_message regardless of status, so either way the failed states
// are visible there and in their own next_check_at.
export function determineElectionRunStatus(
  failures: ElectionFailure[],
  totalStates: number
): ElectionRunOutcome {
  const errorMessage =
    failures.length > 0
      ? `${failures.length} of ${totalStates} states failed: ${failures
          .map((f) => `${f.state}: ${f.message}`)
          .join("; ")}`.slice(0, 1000)
      : null;
  const allFailed = totalStates > 0 && failures.length === totalStates;
  return { status: allFailed ? "failed" : "success", errorMessage };
}
