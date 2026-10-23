/**
 * CLI failure handler shared by the agent workflows: on any failure, post a
 * legible reason comment (with the workflow-run link) on the subject and
 * relabel it `agent:blocked` (trigger label removed; retrying means re-adding
 * the trigger). Parameterized by subject kind, number env var, trigger label,
 * and workflow name — see `reportFailure`.
 *
 * Deliberately dependency-free — it imports only node builtins and the pure
 * shared modules (`failure.ts`, `labels.ts`, `cli.ts`) — so it runs via
 * `npx tsx` even when `npm ci` or the agent setup itself is what failed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ghBestEffort, invokedDirectly, outputDir } from "./cli";
import {
  blockedLabelOps,
  formatBlockedComment,
  TRIGGER_LABEL,
  type BlockedSubject,
} from "./failure";
import { applyLabelOps } from "./labels";

const env = (name: string): string => process.env[name] ?? "";

/** The reason recorded by `fail()` in shared/common.ts, when there was one. */
const recordedReason = (workflowName: string): string => {
  try {
    const recorded = fs
      .readFileSync(path.join(outputDir(), "failure_reason.txt"), "utf8")
      .trim();
    if (recorded.length > 0) return recorded;
  } catch {
    // fall through to the generic reason
  }
  return `The ${workflowName} failed without a recorded reason; check the workflow run logs for details.`;
};

export interface FailureReportConfig {
  /** Surface the failure is posted on. */
  subjectKind: "issue" | "pr";
  /** Env var holding the subject's number (`ISSUE_NUMBER` / `PR_NUMBER`). */
  numberEnv: string;
  /** The trigger label a retry re-adds (must be an agent:* lifecycle label). */
  retryLabel: string;
  /** Workflow name in the generic fallback reason when none was recorded. */
  workflowName: string;
}

/**
 * Report a failed run: comment on the subject with the reason and run link,
 * then relabel it blocked. Best-effort throughout — the run has already
 * failed, so reporting never makes things worse; it only makes them legible.
 */
export const reportFailure = (config: FailureReportConfig): void => {
  const runUrl = env("RUN_URL");
  const reason = recordedReason(config.workflowName);
  const subjectNumber = env(config.numberEnv);

  console.log(`Failure reason:\n${reason}\n`);

  if (subjectNumber.length === 0) {
    console.error(
      `${config.numberEnv} is not set; cannot report the failure on the ${config.subjectKind}.`,
    );
    return;
  }

  const subject: BlockedSubject = {
    kind: config.subjectKind,
    number: Number(subjectNumber) || 0,
  };
  const surface = config.subjectKind === "pr" ? "pr" : "issue";

  const commentPath = path.join(outputDir(), "blocked_comment.md");
  fs.writeFileSync(
    commentPath,
    formatBlockedComment({
      subject,
      reason,
      runUrl,
      retryLabel: config.retryLabel,
    }),
  );

  if (
    ghBestEffort([
      surface,
      "comment",
      subjectNumber,
      "--body-file",
      commentPath,
    ])
  ) {
    console.log(
      `Posted the failure comment on ${config.subjectKind} #${subjectNumber}.`,
    );
  }

  // The relabel is a label mutation: it goes through the shared guarded path
  // and runs under the workflow token (WORKFLOW_GH_TOKEN), never the PAT —
  // best-effort, since the run has already failed and reporting must only
  // make things legible. The result decides the log line: never claim
  // "agent:blocked" landed when a gh call failed.
  const { applied, failed } = applyLabelOps({
    surface,
    subjectNumber,
    ops: blockedLabelOps(config.retryLabel),
    ensureLabels: true,
    bestEffort: true,
  });
  if (failed === 0) {
    console.log(
      `Relabeled ${config.subjectKind} #${subjectNumber}: trigger and in-progress consumed, "agent:blocked" applied (${applied} gh calls).`,
    );
  } else {
    console.error(
      `Relabel incomplete on ${config.subjectKind} #${subjectNumber}: ${failed} of ${applied + failed} gh calls failed (see above); the subject may not carry "agent:blocked".`,
    );
  }
};

/**
 * Direct invocation is the implement workflow's failure handler: the
 * issue-flavored case (see agent-implement.yml). The review workflow wraps
 * `reportFailure` from its own entry instead.
 */
if (invokedDirectly(import.meta.url)) {
  reportFailure({
    subjectKind: "issue",
    numberEnv: "ISSUE_NUMBER",
    retryLabel: TRIGGER_LABEL,
    workflowName: "implement workflow",
  });
}
