/**
 * Failure handling for the agent workflows: on any failure, post a legible
 * reason comment (with the workflow-run link) on the issue and relabel it
 * `agent:blocked`. Pure formatting and label logic lives here, unit-tested;
 * the CLI entry is `report-failure.ts`.
 *
 * Automation only ever writes `agent:*` lifecycle labels — the human triage
 * vocabulary is off-limits (enforced by `assertOnlyAgentLabels`).
 */

export const AGENT_LABEL_PREFIX = "agent:";
export const TRIGGER_LABEL = "agent:implement";
/** The review workflow's trigger label (PRs). */
export const REVIEW_TRIGGER_LABEL = "agent:review";
export const IN_PROGRESS_LABEL = "agent:in-progress";
export const BLOCKED_LABEL = "agent:blocked";
/** The merge gate's two outcome labels (spec #36): auto-merge eligible vs held for a human. */
export const MERGE_LABEL = "agent:merge";
export const HOLD_LABEL = "agent:hold";

/**
 * Guard the label invariant: every label automation writes must be an
 * `agent:*` lifecycle label. Human triage labels (ready-for-agent,
 * needs-triage, …) must never pass through.
 */
export const assertOnlyAgentLabels = (labels: string[]): string[] => {
  for (const label of labels) {
    if (!label.startsWith(AGENT_LABEL_PREFIX)) {
      throw new Error(
        `Refusing to write label "${label}": automation only writes agent:* lifecycle labels.`,
      );
    }
  }
  return labels;
};

/**
 * The label transition for a failed run: consume the trigger label (so a
 * blocked issue or PR never re-triggers on its own) and the in-progress
 * label, then apply the blocked label. Retrying means re-adding the trigger
 * label. The trigger is parameterized because the review workflow fires on a
 * different trigger label (`agent:review`) than the implement workflow
 * (`agent:implement`); everything else about the transition is shared.
 */
export const blockedLabelOps = (
  triggerLabel: string = TRIGGER_LABEL,
): { remove: string[]; add: string[] } => ({
  remove: assertOnlyAgentLabels([triggerLabel, IN_PROGRESS_LABEL]),
  add: assertOnlyAgentLabels([BLOCKED_LABEL]),
});

/** What a blocked comment is posted on: an issue or a PR. */
export type BlockedSubject = { kind: "issue" | "pr"; number: number };

const subjectNoun = (subject: BlockedSubject): string =>
  subject.kind === "pr" ? "PR" : "issue";

/**
 * The blocked comment for any agent workflow: header naming the subject, the
 * reason(s) as bullets, the workflow-run link, and the retry convention.
 * Multi-line reasons (the preflight collects several at once) become one
 * bullet per line. The retry label must be an agent:* lifecycle label.
 */
export const formatBlockedComment = ({
  subject,
  reason,
  runUrl,
  retryLabel,
}: {
  subject: BlockedSubject;
  reason: string;
  runUrl: string;
  retryLabel: string;
}): string => {
  assertOnlyAgentLabels([retryLabel]);

  const bullets = reason
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `- ${line.replace(/^-+\s*/, "")}`);

  const runLine =
    runUrl.length > 0
      ? `[View workflow run](${runUrl})`
      : "The workflow run link is unavailable; check the Actions tab.";

  return [
    `🚫 **Agent run blocked on ${subjectNoun(subject)} #${subject.number}**`,
    "",
    ...bullets,
    "",
    runLine,
    "",
    `_Retry by re-adding the \`${retryLabel}\` label._`,
  ].join("\n");
};
