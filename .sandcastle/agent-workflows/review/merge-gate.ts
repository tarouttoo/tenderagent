/**
 * CLI entry for the review workflow's merge gate: the deterministic last
 * step (spec #36). After the review posts and the PR flips ready, it gathers
 * the decision inputs — the extracted review payload (the reviewer's verdict
 * and door assessment), the door declared in the PR body's Merge Danger
 * section, the changed paths and line count, the open blocked-by
 * dependencies of every sub-issue named by a closing keyword, the latest CI
 * run on the head commit, and the repo's auto-merge capability — evaluates
 * the pure merge policy (`merge-policy.ts`), and executes the outcome. Every
 * condition met: `agent:merge` and a squash auto-merge request. Anything
 * else: `agent:hold` plus one comment enumerating every failed condition.
 * Held PRs are never undrafted — they stay ready so a maintainer can merge
 * by hand instantly — and the agents' judgments are inputs only: the gate
 * itself, not the reviewer, performs every write.
 *
 * Reads PR_NUMBER and GITHUB_REPOSITORY from the environment; RUN_URL (set
 * by the workflow) links the hold comment to this run; OUTPUT_DIR provides
 * review-payload.json (written by the agent-run step) and receives
 * hold-comment.md. Label mutations go through the shared guarded path, so
 * the step must pin WORKFLOW_GH_TOKEN — and, per the #32 lesson, the
 * step-level GH_TOKEN the gh subprocess actually authenticates with — to the
 * workflow token; a PAT must never perform lifecycle mutations or drive the
 * merge of a pipeline PR.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fail, required } from "../shared/common";
import { gh, outputDir } from "../shared/cli";
import {
  HOLD_LABEL,
  MERGE_LABEL,
  REVIEW_TRIGGER_LABEL,
} from "../shared/failure";
import { applyLabelOps, labelOps } from "../shared/labels";
import {
  closingIssueNumbers,
  evaluateMergePolicy,
  formatHoldComment,
  parseDeclaredDoor,
} from "./merge-policy";
import { reviewPayloadSchema } from "./payload";

const prNumber = required("PR_NUMBER");
const repo = required("GITHUB_REPOSITORY");

/** The workflow whose latest run on the head commit must be green (story 9). */
const CI_WORKFLOW_NAME = "CI";

try {
  // 1. The reviewer's judgment: the payload extracted from the agent's
  // output by the review step. A payload that fails validation here is the
  // same legible failure the poster produces — nothing about the gate
  // relaxes the payload contract.
  const payloadPath = path.join(outputDir(), "review-payload.json");
  const parsed = reviewPayloadSchema.safeParse(
    JSON.parse(fs.readFileSync(payloadPath, "utf8")),
  );
  const review = parsed.success
    ? parsed.data
    : fail(
      `The extracted review payload at ${payloadPath} is not a valid review payload: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );

  // 2. The PR itself: the body carries the implementer's declared door and
  // the closing keyword naming the sub-issue; the file list carries the
  // changed paths and line counts; the head sha scopes the CI query.
  const pr = JSON.parse(
    gh(["pr", "view", prNumber, "--json", "body,files,headRefOid"]),
  ) as {
    body: string | null;
    files: { path: string; additions: number; deletions: number }[];
    headRefOid: string;
  };

  // 3. The gate's objective facts. Open blockers: the native blocked-by
  // dependencies of every sub-issue named by a closing keyword, as legible
  // `#N` refs for the hold comment. A sub-issue whose dependency call fails
  // throws — the run lands in the blocked path with the reason, never holds
  // or merges on a guessed blocker state.
  const declaredDoor = parseDeclaredDoor(pr.body);
  const changedFiles = pr.files.map((file) => file.path);
  const changedLines = pr.files.reduce(
    (total, file) => total + file.additions + file.deletions,
    0,
  );

  const openBlockers: string[] = [];
  for (const issueNumber of closingIssueNumbers(pr.body)) {
    const blockedBy = JSON.parse(
      gh(["api", `repos/${repo}/issues/${issueNumber}/dependencies/blocked_by`]),
    ) as { number: number; state: string }[];
    for (const blocker of blockedBy) {
      if (blocker.state === "open") openBlockers.push(`#${blocker.number}`);
    }
  }

  // CI self-check (story 9): the latest run of the CI workflow on this
  // exact head commit. Only "success" is green — a missing run (CI never
  // started) and an in-progress run both hold, the safe direction.
  const ciConclusion = gh([
    "api",
    `repos/${repo}/actions/runs?head_sha=${pr.headRefOid}`,
    "--jq",
    `[.workflow_runs[] | select(.name == "${CI_WORKFLOW_NAME}")] | sort_by(.run_number) | last | .conclusion // ""`,
  ]).trim();
  const ciGreen = ciConclusion === "success";

  // The feature's activation switch and kill switch (story 10): with repo
  // auto-merge disabled, an otherwise eligible PR holds on that single reason.
  const autoMergeEnabled =
    gh(["api", `repos/${repo}`, "--jq", ".allow_auto_merge"]).trim() === "true";

  console.log(
    `Merge gate inputs: verdict=${review.verdict}, reviewerDoor=${review.door}, declaredDoor=${declaredDoor ?? "unconfirmed"}, changedFiles=${changedFiles.length}, changedLines=${changedLines}, openBlockers=[${openBlockers.join(", ")}], ci=${ciConclusion || "none"}, autoMergeEnabled=${autoMergeEnabled}.`,
  );

  const decision = evaluateMergePolicy({
    verdict: review.verdict,
    reviewerDoor: review.door,
    declaredDoor,
    changedFiles,
    changedLines,
    openBlockers,
    ciGreen,
    autoMergeEnabled,
  });

  if (decision.outcome === "merge") {
    // The label is created best-effort first (gh silently no-ops a label the
    // repo lacks) and applied through the guarded path as the workflow token.
    applyLabelOps({
      surface: "pr",
      subjectNumber: prNumber,
      ops: labelOps([], [MERGE_LABEL]),
      ensureLabels: true,
    });
    // Story 15: merges are squash merges. --auto queues the request; GitHub
    // performs the merge once branch requirements (if any) are met.
    const alreadyQueued =
      gh([
        "pr",
        "view",
        prNumber,
        "--json",
        "autoMergeRequest",
        "--jq",
        ".autoMergeRequest != null",
      ]).trim() === "true";
    if (alreadyQueued) {
      console.log(
        `Auto-merge was already requested on PR #${prNumber}; nothing to do.`,
      );
    } else {
      gh(["pr", "merge", prNumber, "--squash", "--auto"]);
    }
    console.log(
      `Merge gate: every condition held; applied "${MERGE_LABEL}" and requested a squash auto-merge of PR #${prNumber}.`,
    );
  } else {
    // One comment enumerating every failed condition (story 2), then the
    // hold label. No undrafting: held PRs stay ready for review (story 14).
    const commentPath = path.join(outputDir(), "hold-comment.md");
    fs.writeFileSync(
      commentPath,
      formatHoldComment({
        prNumber: Number(prNumber),
        failures: decision.failures,
        runUrl: process.env.RUN_URL ?? "",
        retryLabel: REVIEW_TRIGGER_LABEL,
      }),
    );
    applyLabelOps({
      surface: "pr",
      subjectNumber: prNumber,
      ops: labelOps([], [HOLD_LABEL]),
      ensureLabels: true,
    });
    gh(["pr", "comment", prNumber, "--body-file", commentPath]);
    console.log(
      `Merge gate: held PR #${prNumber} on ${decision.failures.length} failed condition(s) (${decision.failures.map((failure) => failure.condition).join(", ")}); applied "${HOLD_LABEL}" and posted the hold comment.`,
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
