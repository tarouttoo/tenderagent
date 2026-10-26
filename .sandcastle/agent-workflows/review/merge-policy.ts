/**
 * The merge gate's pure, unit-tested surface (spec #36, leaf #38): the
 * repo-owned merge policy as a decision, the parsing its inputs need
 * (the door declared in the PR body, the sub-issue named by the closing
 * keyword), and the hold comment that renders a hold decision. Structured
 * inputs in — the two agents' structured judgments (the review verdict and
 * the reviewer's own door assessment; the implementer's door declared in
 * the PR body's Merge Danger section) plus the objective facts the gate
 * gathers (changed paths and line count, sub-issue blockers, CI on the head
 * commit, repo auto-merge capability) — and one decision out, with every
 * failed condition enumerated so a held PR's single comment can list exactly
 * what failed. No network, no git, no live LLM: the review workflow's gate
 * step (the `merge-gate.ts` CLI entry) gathers the inputs and turns the
 * outcome into lifecycle labels, the auto-merge request, and the hold
 * comment; this module owns only the pure logic.
 *
 * The policy is a conjunction — every condition must hold for the outcome to
 * be a merge; any failure holds. Policy numbers live in `MERGE_POLICY`, so
 * tuning is an ordinary one-line reviewed diff.
 */
import { assertOnlyAgentLabels } from "../shared/failure";
import type { ReviewVerdict } from "./payload";

/**
 * The door vocabulary (glossary: *door*): a one-way door is hard to reverse
 * and always held for human merge; a two-way door is easy to reverse and may
 * auto-merge when the rest of the policy holds.
 */
export const DOORS = ["one_way", "two_way"] as const;
export type Door = (typeof DOORS)[number];

/**
 * The policy numbers in one place (spec #36 story 17): the changed-line
 * ceiling and the denied-path patterns. Changing either is an ordinary
 * reviewed PR.
 */
export const MERGE_POLICY = {
  /** Diffs above this many changed lines hold for human review (story 7). */
  changedLineCeiling: 300,
  /**
   * Changed paths an auto-merge may never touch (story 4): the workflow
   * definitions and the agent harness directory — the pipeline's own leash —
   * and lockfiles.
   */
  deniedPaths: [
    // Workflow definitions.
    /^\.github\/workflows\//,
    // The agent harness directory.
    /^\.sandcastle\//,
    // Lockfiles, at any depth.
    /(?:^|\/)package-lock\.json$/,
    /(?:^|\/)npm-shrinkwrap\.json$/,
    /(?:^|\/)yarn\.lock$/,
    /(?:^|\/)pnpm-lock\.yaml$/,
    /(?:^|\/)bun\.lockb?$/,
    /(?:^|\/)Cargo\.lock$/,
    /(?:^|\/)poetry\.lock$/,
    /(?:^|\/)Pipfile\.lock$/,
    /(?:^|\/)Gemfile\.lock$/,
    /(?:^|\/)composer\.lock$/,
  ],
} as const;

/**
 * The gate's conditions, in the order the hold comment enumerates them (the
 * order of the spec's policy statement).
 */
export const MERGE_CONDITIONS = [
  "verdict",
  "reviewer_door",
  "declared_door",
  "denied_paths",
  "changed_lines",
  "open_blockers",
  "ci_green",
  "auto_merge_enabled",
] as const;
export type MergeCondition = (typeof MERGE_CONDITIONS)[number];

/** Everything the gate needs to decide; all gathered by the caller, no I/O. */
export interface MergePolicyInput {
  /** The review agent's verdict (the review payload). */
  verdict: ReviewVerdict;
  /** The reviewer's independent door assessment (the review payload, #37). */
  reviewerDoor: Door;
  /**
   * The implementer's declared door, parsed from the PR body's Merge Danger
   * section; undefined when the section is missing or unparseable — which
   * counts as unconfirmed and holds.
   */
  declaredDoor: Door | undefined;
  /** Repo-relative paths of the changed files. */
  changedFiles: readonly string[];
  /** Total changed-line count (additions + deletions). */
  changedLines: number;
  /**
   * The sub-issue's open blocked-by dependencies (native GitHub
   * dependencies), as legible refs for the hold comment.
   */
  openBlockers: readonly string[];
  /** Whether CI is green on the PR's head commit. */
  ciGreen: boolean;
  /** Whether repo auto-merge is enabled — the feature's activation switch. */
  autoMergeEnabled: boolean;
}

/** One failed condition: a stable id plus the reason the hold comment quotes. */
export interface FailedCondition {
  condition: MergeCondition;
  reason: string;
}

/**
 * The gate's outcome: a merge (the caller requests an auto-merge, squash)
 * or a hold enumerating every failed condition (the caller applies
 * `agent:hold` and posts one comment).
 */
export type MergeDecision =
  | { outcome: "merge" }
  | { outcome: "hold"; failures: readonly FailedCondition[] };

/**
 * A line that starts the Merge Danger section: an ATX heading
 * ("## Merge Danger"), with or without the door on the same line, or the
 * template's bold list-item form ("- **Merge Danger**: …").
 */
const MERGE_DANGER_LABEL =
  /^#{1,6}[ \t]+merge[ \t]+danger\b|^[ \t]*(?:[-*][ \t]+)?\*{0,2}merge[ \t]+danger\b\*{0,2}[ \t]*:/im;

/** A following ATX heading ends the Merge Danger section. */
const NEXT_HEADING = /^#{1,6}[ \t]+\S/;

const ONE_WAY = /\bone[-_ ]way\b/i;
const TWO_WAY = /\btwo[-_ ]way\b/i;

/**
 * Parse the door the implementer declared in the PR body's Merge Danger
 * section. Returns the door when the section names exactly one; undefined
 * when the section (or the whole body) is absent, or ambiguous — it names
 * both doors (e.g. the verbatim template line) or neither. An undefined
 * return makes the caller hold: a missing or unparseable declaration counts
 * as unconfirmed, never as two-way.
 */
export const parseDeclaredDoor = (
  prBody: string | null | undefined,
): Door | undefined => {
  if (prBody === null || prBody === undefined || prBody.trim().length === 0) {
    return undefined;
  }

  const lines = prBody.split("\n");
  const labelLine = lines.findIndex((line) => MERGE_DANGER_LABEL.test(line));
  if (labelLine === -1) return undefined;

  // The door can share the label's line ("## Merge Danger: two-way door");
  // keep everything after the word "danger" on it.
  const label = lines[labelLine] ?? "";
  const inlineTail = label
    .slice(label.toLowerCase().indexOf("danger") + "danger".length)
    .replace(/^[^A-Za-z0-9]*/, " ");

  let sectionEnd = lines.length;
  for (let i = labelLine + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (NEXT_HEADING.test(line)) {
      sectionEnd = i;
      break;
    }
  }

  const section = [...lines.slice(labelLine + 1, sectionEnd), inlineTail].join(
    "\n",
  );

  const oneWay = ONE_WAY.test(section);
  const twoWay = TWO_WAY.test(section);
  if (oneWay === twoWay) return undefined; // both (ambiguous) or neither
  return oneWay ? "one_way" : "two_way";
};

/**
 * The merge gate's decision: the merge policy as a pure function. Collects
 * every failed condition — never just the first — so a held PR's single
 * comment enumerates exactly what failed (spec #36 story 2). The door
 * cross-check (story 6) needs the reviewer's door to be two-way *and* to
 * agree with the implementer's declaration; a missing or unparseable Merge
 * Danger section is unconfirmed and holds.
 */
export const evaluateMergePolicy = (
  input: MergePolicyInput,
): MergeDecision => {
  const failures: FailedCondition[] = [];

  if (input.verdict !== "approve") {
    failures.push({
      condition: "verdict",
      reason: `Review verdict is \`${input.verdict}\`, not \`approve\` — any verdict other than approve holds the PR.`,
    });
  }

  if (input.reviewerDoor !== "two_way") {
    failures.push({
      condition: "reviewer_door",
      reason: `The reviewer assessed the change as a \`${input.reviewerDoor}\` door — one-way changes are held for human merge.`,
    });
  }

  if (input.declaredDoor === undefined) {
    failures.push({
      condition: "declared_door",
      reason:
        "The declared door is unconfirmed: the PR body has no parseable Merge Danger section.",
    });
  } else if (input.declaredDoor !== input.reviewerDoor) {
    failures.push({
      condition: "declared_door",
      reason: `The declared door (\`${input.declaredDoor}\`) disagrees with the reviewer's assessment (\`${input.reviewerDoor}\`) — a mis-declared one-way change cannot ride an approve into an irreversible merge.`,
    });
  }

  const denied = input.changedFiles.filter((file) =>
    MERGE_POLICY.deniedPaths.some((pattern) => pattern.test(file)),
  );
  if (denied.length > 0) {
    failures.push({
      condition: "denied_paths",
      reason: `Changed paths hit the merge-policy denylist: ${denied.map((file) => `\`${file}\``).join(", ")} — the pipeline's own files and lockfiles are always held for human merge.`,
    });
  }

  if (input.changedLines > MERGE_POLICY.changedLineCeiling) {
    failures.push({
      condition: "changed_lines",
      reason: `The diff touches ${input.changedLines} changed lines, over the ceiling of ${MERGE_POLICY.changedLineCeiling} — an unexpectedly large change gets human review even when every other condition is green.`,
    });
  }

  if (input.openBlockers.length > 0) {
    failures.push({
      condition: "open_blockers",
      reason: `The sub-issue still has open blockers: ${input.openBlockers.map((blocker) => `\`${blocker}\``).join(", ")} — the decision map's frontier never advances out of order.`,
    });
  }

  if (!input.ciGreen) {
    failures.push({
      condition: "ci_green",
      reason:
        "CI is not green on the PR's head commit — the gate verifies CI itself; branch protection is recommended but never assumed.",
    });
  }

  if (!input.autoMergeEnabled) {
    failures.push({
      condition: "auto_merge_enabled",
      reason:
        "Repo auto-merge is disabled — the settings flip is the feature's activation switch and kill switch, so an otherwise eligible PR holds until a maintainer enables it.",
    });
  }

  return failures.length === 0
    ? { outcome: "merge" }
    : { outcome: "hold", failures };
};

/**
 * A line that closes an issue: GitHub's closing keywords (close/closes/
 * closed, fix/fixes/fixed, resolve/resolves/resolved) before a same-repo
 * `#N` reference. Cross-repo `owner/repo#N` is out of scope: sub-issues are
 * same-repo by construction.
 */
const CLOSING_KEYWORD =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

/**
 * The sub-issues a PR closes, parsed from the body's closing keywords —
 * the gate checks each one's open blocked-by dependencies (story 8: the
 * decision map's frontier never advances out of order). Deduped, in order
 * of first mention; a missing or keyword-less body closes nothing.
 */
export const closingIssueNumbers = (
  prBody: string | null | undefined,
): number[] => {
  if (prBody === null || prBody === undefined || prBody.trim().length === 0) {
    return [];
  }
  const numbers: number[] = [];
  for (const match of prBody.matchAll(CLOSING_KEYWORD)) {
    const number = Number(match[1]);
    if (!numbers.includes(number)) numbers.push(number);
  }
  return numbers;
};

/** Everything the hold comment needs; gathered by the gate CLI entry. */
export interface HoldCommentInput {
  prNumber: number;
  /** Every failed condition, in policy order — one bullet each. */
  failures: readonly FailedCondition[];
  /** The workflow-run URL; empty renders the fallback line. */
  runUrl: string;
  /** The trigger label a retry re-adds (must be an agent:* lifecycle label). */
  retryLabel: string;
}

/**
 * The single comment a held PR gets (story 2): header, one bullet per failed
 * condition — the stable id plus the reason the decision module wrote — the
 * workflow-run link, and the retry convention (story 13: a held PR retries
 * via the review trigger exactly like today) with story 14's promise that a
 * held PR stays ready for review. The retry label is guarded: the gate never
 * writes the human triage vocabulary.
 */
export const formatHoldComment = (input: HoldCommentInput): string => {
  assertOnlyAgentLabels([input.retryLabel]);

  const bullets = input.failures.map(
    (failure) => `- \`${failure.condition}\`: ${failure.reason}`,
  );

  const runLine =
    input.runUrl.length > 0
      ? `[View workflow run](${input.runUrl})`
      : "The workflow run link is unavailable; check the Actions tab.";

  return [
    `⏸️ **Merge gate held PR #${input.prNumber}** — the merge policy did not fully hold:`,
    "",
    ...bullets,
    "",
    runLine,
    "",
    `_Held PRs stay ready for review: merge by hand, or fix the failed conditions and retry by re-adding the \`${input.retryLabel}\` label._`,
  ].join("\n");
};
