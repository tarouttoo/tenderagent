/**
 * The PR→review hop, automatic (#19): right after the implement workflow
 * opens the draft PR, it labels the PR `agent:review`, which fires the Agent
 * Review workflow — spec #1's "opens a draft PR referencing the issue and
 * requests an automated review" with no hand in between, mirroring the
 * bridge's triage→implement hop on the PR side. Decision logic is pure and
 * unit-tested; the CLI entry at the bottom runs the gh calls.
 *
 * Token rules here are deliberately different from the guarded lifecycle path
 * (shared/labels.ts): this add is a *trigger* — it must fire the review
 * workflow's `labeled` event, and events fired by the default GITHUB_TOKEN
 * never start other workflow runs. So the workflow step runs under `AGENT_PAT`
 * alone, no fallback (like the bridge's `agent:implement` add: a missing
 * secret must fail visibly instead of silently stranding the PR unlabeled),
 * and it bypasses `applyLabelOps`, whose workflow-token rule exists for run
 * transitions and failure relabels — mutations that must land regardless of
 * PAT scope. The label string is the shared `REVIEW_TRIGGER_LABEL` constant,
 * so the agent:* invariant holds by construction.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "../shared/common";
import { REVIEW_TRIGGER_LABEL } from "../shared/failure";

/**
 * The two gh invocations of a review request, in order: a best-effort
 * `label create` first — gh silently no-ops `--add-label` for a label the
 * repo lacks, which would strand the PR with no review and no failure —
 * then the strict add that fires the event.
 */
export const reviewRequestGhArgs = (
  prNumber: string,
): { ensure: string[]; add: string[] } => ({
  ensure: ["label", "create", REVIEW_TRIGGER_LABEL],
  add: ["pr", "edit", prNumber, "--add-label", REVIEW_TRIGGER_LABEL],
});

/** The last output lines kept in a classified failure reason. */
const outputTail = (output: string, maxChars = 400): string => {
  const trimmed = output.trim();
  return trimmed.length > maxChars
    ? `…${trimmed.slice(trimmed.length - maxChars)}`
    : trimmed;
};

/**
 * The recorded failure reason for a refused review request, so the blocked
 * comment carries the recovery instead of a raw gh dump. A refusal naming
 * missing credentials or permissions points at the step's token — `AGENT_PAT`,
 * the only token whose label events can start the review workflow; anything
 * else keeps the output excerpt. Both shapes name the PR-side retry: the
 * automation failed, but the request can still be made by hand — and the
 * issue-side retry is not an option, because preflight refuses issues already
 * closed by an open PR.
 */
export const classifyReviewRequestFailure = (
  output: string,
  prNumber: string,
): string => {
  const retry =
    `Retry by adding the ${REVIEW_TRIGGER_LABEL} label to PR #${prNumber} ` +
    `(gh pr edit ${prNumber} --add-label ${REVIEW_TRIGGER_LABEL}); ` +
    "do not re-add agent:implement — preflight refuses issues already closed by an open PR.";
  if (
    /resource not accessible|forbidden|http 403|http 401|bad credentials|must have pull|to use github cli/i.test(
      output,
    )
  ) {
    return (
      "The review request was refused: the AGENT_PAT secret is missing or lacks pull-requests write. " +
      "It must come from that PAT — the default GITHUB_TOKEN's label events never start the review workflow. " +
      `Fix the secret, then ${retry}`
    );
  }
  return `The review request failed: ${outputTail(output)} ${retry}`;
};

/** Run gh with piped output; failures come back with everything gh printed. */
const ghRun = (args: string[]): { ok: boolean; output: string } => {
  try {
    execFileSync("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, output: "" };
  } catch (error) {
    const e = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    const output =
      [e.stdout, e.stderr]
        .filter((chunk): chunk is string => typeof chunk === "string")
        .join("\n") ||
      (typeof e.message === "string" ? e.message : String(error));
    return { ok: false, output };
  }
};

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const rawNumber = process.env.IMPLEMENTED_PR_NUMBER ?? "";
  if (!/^\d+$/.test(rawNumber)) {
    fail(
      `IMPLEMENTED_PR_NUMBER is not a PR number ("${rawNumber}"); the Open draft PR step must export it. ` +
        `The draft PR may exist without a review request — find it and add ${REVIEW_TRIGGER_LABEL} by hand.`,
    );
  }

  const { ensure, add } = reviewRequestGhArgs(rawNumber);

  // Best-effort: `label create` exits non-zero when the label already
  // exists, which is fine (same trade as the bridge's). A real inability to
  // create labels surfaces at the strict add below.
  ghRun(ensure);

  const added = ghRun(add);
  if (!added.ok) {
    fail(classifyReviewRequestFailure(added.output, rawNumber));
  }

  console.log(
    `Requested the automated review: PR #${rawNumber} labeled ${REVIEW_TRIGGER_LABEL}; the Agent Review workflow takes it from here.`,
  );
}
