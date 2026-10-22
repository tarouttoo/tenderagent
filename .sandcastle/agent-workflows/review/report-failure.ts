/**
 * CLI failure handler for the review workflow. On any failure, reports the
 * reason on the PR and relabels it `agent:blocked` (trigger label removed;
 * retrying means re-adding `agent:review`). Consistent with the implement
 * workflow's failure path: same comment format, same label transition, same
 * run-link behavior — surfaced on the PR instead of the issue.
 *
 * A thin wrapper over the shared, dependency-free reporter; imports only the
 * shared pure modules, so it runs via `npx tsx` even when `npm ci` or the
 * agent setup itself is what failed.
 */
import { REVIEW_TRIGGER_LABEL } from "../shared/failure";
import { reportFailure } from "../shared/report-failure";

reportFailure({
  subjectKind: "pr",
  numberEnv: "PR_NUMBER",
  retryLabel: REVIEW_TRIGGER_LABEL,
  workflowName: "review workflow",
});
