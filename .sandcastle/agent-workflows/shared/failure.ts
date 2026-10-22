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
export const IN_PROGRESS_LABEL = "agent:in-progress";
export const BLOCKED_LABEL = "agent:blocked";

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
 * blocked issue never re-triggers on its own) and the in-progress label, then
 * apply the blocked label. Retrying means re-adding the trigger label.
 */
export const blockedLabelOps = (): { remove: string[]; add: string[] } => ({
  remove: assertOnlyAgentLabels([TRIGGER_LABEL, IN_PROGRESS_LABEL]),
  add: assertOnlyAgentLabels([BLOCKED_LABEL]),
});

/**
 * The blocked-issue comment: header naming the issue, the reason(s) as
 * bullets, the workflow-run link, and the retry convention. Multi-line
 * reasons (the preflight collects several at once) become one bullet per line.
 */
export const formatFailureComment = ({
  issueNumber,
  reason,
  runUrl,
}: {
  issueNumber: number;
  reason: string;
  runUrl: string;
}): string => {
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
    `🚫 **Agent run blocked on issue #${issueNumber}**`,
    "",
    ...bullets,
    "",
    runLine,
    "",
    "_Retry by re-adding the `agent:implement` label._",
  ].join("\n");
};
