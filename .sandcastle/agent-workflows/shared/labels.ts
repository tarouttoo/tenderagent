/**
 * The shared path for lifecycle label mutations in the agent workflows:
 * every transition declares its ops through `labelOps`/`labelTransition`
 * (guarded by `assertOnlyAgentLabels`) and executes them through
 * `applyLabelOps`, which authenticates as the workflow's own GITHUB_TOKEN —
 * never as a PAT. Unit-tested decision, unit-tested guard; the CLI entry is
 * `label-transition.ts`.
 *
 * Why token choice lives here: the implement workflow's job-level GH_TOKEN is
 * `AGENT_PAT || GITHUB_TOKEN`, so a raw `gh issue edit` inside a step mutates
 * labels under the PAT. A run that dies mid-flight can then strand labels the
 * best-effort failure reporter cannot recover (issue #17). The workflow token
 * is guaranteed by the job's permissions block; a PAT is not.
 */
import { execFileSync } from "node:child_process";
import {
  assertOnlyAgentLabels,
  IN_PROGRESS_LABEL,
} from "./failure";

/**
 * The env var carrying the workflow GITHUB_TOKEN into mutation-capable
 * scripts (`WORKFLOW_GH_TOKEN: ${{ github.token }}` in the workflow YAML).
 * Distinct from GH_TOKEN on purpose: there, the job-level value may be a PAT.
 */
export const WORKFLOW_TOKEN_ENV = "WORKFLOW_GH_TOKEN";

/**
 * The token decision for lifecycle label mutations: only the workflow's own
 * GITHUB_TOKEN. The PAT-backed GH_TOKEN is deliberately not a fallback — a
 * mis-scoped PAT must never perform lifecycle mutations, so a missing
 * workflow token fails the step instead of silently degrading to the PAT.
 */
export const mutationToken = (env: NodeJS.ProcessEnv = process.env): string => {
  const token = env[WORKFLOW_TOKEN_ENV];
  if (!token || token.length === 0) {
    throw new Error(
      `${WORKFLOW_TOKEN_ENV} is not set; refusing to mutate lifecycle labels without the workflow GITHUB_TOKEN (a PAT fallback is never allowed).`,
    );
  }
  return token;
};

/** Which gh command namespace a subject lives in (`gh issue` / `gh pr`). */
export type LabelSurface = "issue" | "pr";

/** A guarded label transition: what to take off, what to put on. */
export interface LabelOps {
  remove: string[];
  add: string[];
}

/** Build transition ops: the agent:* invariant is asserted up front, so
 * refused labels never reach execution. */
export const labelOps = (remove: string[], add: string[]): LabelOps => ({
  remove: assertOnlyAgentLabels(remove),
  add: assertOnlyAgentLabels(add),
});

/** The two phases of a successful run's label lifecycle. */
export type TransitionPhase = "start" | "finish";

/**
 * The run transitions shared by both agent workflows, parameterized by the
 * workflow's trigger label: `start` consumes the trigger and applies
 * in-progress; `finish` takes in-progress off and needs no trigger (success —
 * the failure path is `blockedLabelOps` in failure.ts). The table lives here
 * so the lifecycle label strings are declared once, guarded, and reused by
 * the workflow CLI — never re-typed inline in YAML where the guard cannot run.
 */
export const labelTransition = (
  triggerLabel: string | undefined,
  phase: TransitionPhase,
): LabelOps => {
  if (phase === "finish") {
    return labelOps([IN_PROGRESS_LABEL], []);
  }
  if (!triggerLabel || triggerLabel.length === 0) {
    throw new Error(
      "The start transition requires the workflow's trigger label (the one it consumes).",
    );
  }
  return labelOps([triggerLabel], [IN_PROGRESS_LABEL]);
};

/** One observed gh invocation: the argv and the exact env it would run under. */
export interface GhCall {
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** gh executor, injectable for tests; the default shells out under the
 * workflow token (see `applyLabelOps`). */
export type GhRunner = (args: string[], env: NodeJS.ProcessEnv) => void;

const ghMutate: GhRunner = (args, env) => {
  execFileSync("gh", args, { stdio: ["ignore", "pipe", "pipe"], env });
};

export interface ApplyLabelOpsInput {
  /** Surface the mutation runs on (`gh issue` / `gh pr`). */
  surface: LabelSurface;
  /** Subject number as a string (workflow env vars are strings). */
  subjectNumber: string;
  /** The transition; asserted again at this chokepoint regardless of builder. */
  ops: LabelOps;
  /**
   * Ensure each added label exists before adding it: gh silently no-ops
   * `--add-label` for a label the repo lacks, which would strand the subject
   * unlabeled. Used by the failure reporter (`agent:blocked` must land).
   */
  ensureLabels?: boolean;
  /**
   * Best-effort mode (failure reporting): log gh failures and keep going —
   * the run has already failed, so reporting must only make things legible.
   * Strict mode (run transitions) fails the step on the first gh error.
   */
  bestEffort?: boolean;
  /** Environment the token decision reads from; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** gh executor override (tests, alternate transports). */
  run?: GhRunner;
}

/** Outcome of a transition: gh calls that ran vs. ones that failed (all
 * failures also land on stderr; strict mode throws instead of counting). */
export interface LabelMutationResult {
  applied: number;
  failed: number;
}

/**
 * Execute a label transition as the workflow GITHUB_TOKEN: remove-then-add,
 * with the agent:* invariant asserted before any gh call runs — a refused
 * label never leaves a partial transition behind. Removals always tolerate
 * failure: a consumed trigger or in-progress label may already be absent,
 * and that must not fail the transition. Adds fail the step (strict) unless
 * `bestEffort` is set by the failure reporter, where the run has already
 * failed and reporting must only make things legible. Returns the call
 * counts so callers never have to claim success blindly.
 */
export const applyLabelOps = (input: ApplyLabelOpsInput): LabelMutationResult => {
  const ops: LabelOps = {
    remove: assertOnlyAgentLabels(input.ops.remove),
    add: assertOnlyAgentLabels(input.ops.add),
  };
  const env: NodeJS.ProcessEnv = {
    ...(input.env ?? process.env),
    GH_TOKEN: mutationToken(input.env),
  };
  const run = input.run ?? ghMutate;
  const result: LabelMutationResult = { applied: 0, failed: 0 };

  /** Log and continue: for failure reporting, and for tolerable failures. */
  const bestEffort = (args: string[]): void => {
    try {
      run(args, env);
      result.applied += 1;
    } catch (error) {
      result.failed += 1;
      console.error(
        `gh ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  for (const label of ops.remove) {
    // Removals always tolerate failure: a consumed trigger or in-progress
    // label may already be absent, and that benign race must not fail the
    // transition (the inline steps this path replaced used `|| true`).
    bestEffort([input.surface, "edit", input.subjectNumber, "--remove-label", label]);
  }
  for (const label of ops.add) {
    if (input.ensureLabels) {
      // Tolerable too: the label may already exist in the repo.
      bestEffort(["label", "create", label]);
    }
    if (input.bestEffort) {
      bestEffort([input.surface, "edit", input.subjectNumber, "--add-label", label]);
    } else {
      run([input.surface, "edit", input.subjectNumber, "--add-label", label], env);
      result.applied += 1;
    }
  }
  return result;
};
