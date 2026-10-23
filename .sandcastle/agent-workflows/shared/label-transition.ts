/**
 * CLI entry for the agent workflows' lifecycle label transitions — the one
 * path every YAML step takes for `agent:*` label mutations. Guarded ops
 * (`assertOnlyAgentLabels`) and the workflow-token decision
 * (`WORKFLOW_GH_TOKEN`, never a PAT) live in `labels.ts`; this entry only
 * parses the invocation and applies the transition, failing loudly so a
 * miswired step lands in the blocked path with a legible reason.
 *
 * Usage:
 *   label-transition.ts --surface issue|pr --number <n> \
 *     --transition start|finish --trigger <label>
 */
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import {
  applyLabelOps,
  labelTransition,
  type LabelSurface,
  type TransitionPhase,
} from "./labels";

export interface TransitionArgs {
  surface: LabelSurface;
  subjectNumber: string;
  phase: TransitionPhase;
  /** Required for `start` (the consumed trigger); unused on `finish`. */
  triggerLabel?: string;
}

const flag = (argv: string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

/**
 * Parse the CLI invocation. Throws with the offending flag named — the
 * message surfaces in the Actions step log and, via the failure handler, on
 * the blocked subject.
 */
export const parseTransitionArgs = (argv: string[]): TransitionArgs => {
  const surface = flag(argv, "--surface");
  if (surface !== "issue" && surface !== "pr") {
    throw new Error(
      `--surface must be "issue" or "pr", got "${surface ?? "(missing)"}".`,
    );
  }
  const subjectNumber = flag(argv, "--number");
  if (!subjectNumber || subjectNumber.length === 0) {
    throw new Error("--number must be the issue or PR number.");
  }
  const phase = flag(argv, "--transition");
  if (phase !== "start" && phase !== "finish") {
    throw new Error(
      `--transition must be "start" or "finish", got "${phase ?? "(missing)"}".`,
    );
  }
  const triggerLabel = flag(argv, "--trigger");
  if (phase === "start" && (!triggerLabel || triggerLabel.length === 0)) {
    throw new Error("--trigger must be the workflow's trigger label.");
  }
  return { surface, subjectNumber, phase, triggerLabel };
};

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  try {
    const args = parseTransitionArgs(process.argv.slice(2));
    applyLabelOps({
      surface: args.surface,
      subjectNumber: args.subjectNumber,
      ops: labelTransition(args.triggerLabel, args.phase),
    });
    console.log(
      `Transition "${args.phase}" applied on ${args.surface} #${args.subjectNumber}.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}
