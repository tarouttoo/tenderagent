/**
 * The bridge: translates a human triage decision into the machine lifecycle —
 * labeling an issue `ready-for-agent` adds the `agent:implement` trigger label,
 * which fires the implement workflow. Decision logic is pure and unit-tested;
 * the CLI entry at the bottom gathers the evidence via `gh`.
 *
 * The bridge only ever writes agent:* lifecycle labels (enforced by
 * `assertOnlyAgentLabels`); the human triage vocabulary is read-only here.
 * All decisions run against the issue's *current* state and labels, not the
 * stale event payload, so rapid triage toggles resolve to the latest intent.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertOnlyAgentLabels,
  IN_PROGRESS_LABEL,
  TRIGGER_LABEL,
} from "../shared/failure";

/** The human triage label that fires the bridge. */
export const BRIDGE_TRIAGE_LABEL = "ready-for-agent";

/**
 * Lifecycle labels meaning the pipeline is already engaged for this issue:
 * the implement label is pending or a run is live. Bridging over them would
 * queue duplicate implement runs.
 */
const ENGAGED_LABELS = [TRIGGER_LABEL, IN_PROGRESS_LABEL];

export type BridgeInput = {
  /** Name of the label event that fired (`github.event.label.name`). */
  eventLabel: string;
  /** Current issue state as reported by the API, case-insensitive: gh's GraphQL
   *  reports "OPEN"/"CLOSED", REST reports "open"/"closed". */
  issueState: string;
  /** Current label names on the issue, as reported by the API. */
  issueLabels: string[];
};

export type BridgeVerdict =
  | { act: true; add: string[] }
  | { act: false; reason: string };

/**
 * Decide whether a `ready-for-agent` labeling bridges to `agent:implement`.
 * Skips are no-ops with a reason, never failures: a reverted triage decision
 * or an already-engaged pipeline must not relabel anything.
 */
export const bridgeDecision = (input: BridgeInput): BridgeVerdict => {
  const { eventLabel, issueState, issueLabels } = input;

  if (eventLabel !== BRIDGE_TRIAGE_LABEL) {
    return {
      act: false,
      reason: `Event label "${eventLabel}" is not "${BRIDGE_TRIAGE_LABEL}"; nothing to bridge.`,
    };
  }

  if (!issueLabels.includes(BRIDGE_TRIAGE_LABEL)) {
    return {
      act: false,
      reason: `The "${BRIDGE_TRIAGE_LABEL}" label is no longer on the issue; the triage decision was reverted.`,
    };
  }

  if (issueState.toLowerCase() !== "open") {
    return {
      act: false,
      reason: `Issue is ${issueState}; only open issues are implemented.`,
    };
  }

  const engaged = ENGAGED_LABELS.filter((label) => issueLabels.includes(label));
  if (engaged.length > 0) {
    return {
      act: false,
      reason: `The agent pipeline is already engaged (${engaged.join(", ")}); bridging again would duplicate it.`,
    };
  }

  return { act: true, add: assertOnlyAgentLabels([TRIGGER_LABEL]) };
};

/**
 * CLI entry: gathers the issue's current state and labels via `gh`, decides,
 * and on `act` ensures the trigger label exists and applies it. Adding the
 * label is what fires the implement workflow, so it must be applied with a
 * PAT (the workflow supplies AGENT_PAT): events fired by the default
 * GITHUB_TOKEN do not trigger other workflows. Skips log their reason and
 * exit 0 — a skipped bridge is a no-op, not a failure. Reads ISSUE_NUMBER and
 * EVENT_LABEL from the environment; GH_REPO/GH_TOKEN scope the calls.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const env = (name: string): string => process.env[name] ?? "";

  const gh = (args: string[]): string => {
    try {
      return execFileSync("gh", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      console.error(
        `gh ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  };

  /** Best-effort gh call: logs failures, keeps going. */
  const ghBestEffort = (args: string[]): void => {
    try {
      execFileSync("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      console.error(
        `gh ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const issueNumber = env("ISSUE_NUMBER");
  const eventLabel = env("EVENT_LABEL");
  if (issueNumber.length === 0 || eventLabel.length === 0) {
    console.error("Missing required env vars: ISSUE_NUMBER, EVENT_LABEL");
    process.exit(1);
  }

  try {
    const issue = JSON.parse(
      gh(["issue", "view", issueNumber, "--json", "state,labels"]),
    ) as {
      state?: string | null;
      labels?: { name?: string | null }[] | null;
    };

    const verdict = bridgeDecision({
      eventLabel,
      issueState: issue.state ?? "unknown",
      issueLabels: (issue.labels ?? [])
        .map((label) => label.name ?? "")
        .filter((name) => name.length > 0),
    });

    if (!verdict.act) {
      console.log(`Bridge skipped: ${verdict.reason}`);
      process.exit(0);
    }

    // gh silently no-ops --add-label for a label the repo does not have;
    // make sure the lifecycle label exists first. Best-effort: `label create`
    // exits non-zero when the label already exists, which is fine.
    ghBestEffort(["label", "create", TRIGGER_LABEL]);
    gh(["issue", "edit", issueNumber, "--add-label", TRIGGER_LABEL]);
    console.log(
      `Bridged issue #${issueNumber}: "${BRIDGE_TRIAGE_LABEL}" → "${TRIGGER_LABEL}"; the implement workflow takes it from here.`,
    );
  } catch (error) {
    console.error(
      `Bridge could not gather its evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
