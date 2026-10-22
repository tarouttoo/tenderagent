/**
 * CLI failure handler for the implement workflow. On any failure, reports the
 * reason on the issue and relabels it `agent:blocked` (trigger label removed;
 * retrying means re-adding `agent:implement`).
 *
 * Deliberately dependency-free — it imports only node builtins and the pure
 * formatting module below — so it runs via `npx tsx` even when `npm ci` or the
 * agent setup itself is what failed.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  blockedLabelOps,
  formatFailureComment,
} from "./failure";

const env = (name: string): string => process.env[name] ?? "";

const outputDir = (): string => {
  const dir = env("OUTPUT_DIR") || "/tmp";
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** The reason recorded by `fail()` in shared/common.ts, when there was one. */
const recordedReason = (): string => {
  try {
    const recorded = fs
      .readFileSync(path.join(outputDir(), "failure_reason.txt"), "utf8")
      .trim();
    if (recorded.length > 0) return recorded;
  } catch {
    // fall through to the generic reason
  }
  return "The implement workflow failed without a recorded reason; check the workflow run logs for details.";
};

/** Best-effort gh call: logs failures, never throws (the run already failed). */
const gh = (args: string[]): boolean => {
  try {
    execFileSync("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch (error) {
    console.error(
      `gh ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
};

const issueNumber = env("ISSUE_NUMBER");
const runUrl = env("RUN_URL");
const reason = recordedReason();

console.log(`Failure reason:\n${reason}\n`);

const commentPath = path.join(outputDir(), "blocked_comment.md");
fs.writeFileSync(
  commentPath,
  formatFailureComment({ issueNumber: Number(issueNumber) || 0, reason, runUrl }),
);

if (issueNumber.length === 0) {
  console.error("ISSUE_NUMBER is not set; cannot report the failure on the issue.");
  process.exit(0);
}

if (gh(["issue", "comment", issueNumber, "--body-file", commentPath])) {
  console.log(`Posted the failure comment on issue #${issueNumber}.`);
}

const ops = blockedLabelOps();
for (const label of ops.remove) {
  gh(["issue", "edit", issueNumber, "--remove-label", label]);
}
for (const label of ops.add) {
  // gh silently no-ops --add-label for a label the repo does not have; make
  // sure the lifecycle label exists first (a no-op here would leave the issue
  // unlabeled, failing the "ends as agent:blocked" guarantee).
  gh(["label", "create", label]);
  if (gh(["issue", "edit", issueNumber, "--add-label", label])) {
    console.log(`Relabeled issue #${issueNumber} with "${label}".`);
  }
}
