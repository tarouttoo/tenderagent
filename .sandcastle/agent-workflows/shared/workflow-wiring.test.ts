/**
 * Wiring test for the workflow-token invariant (#17, #32): every workflow
 * step that invokes the shared label-transition entry must pin
 * `GH_TOKEN: ${{ github.token }}` in its own `env:` block. The in-code
 * override in `applyLabelOps` sets the child env's GH_TOKEN, but the `gh`
 * subprocess resolves its auth token at startup from the *step's* ambient
 * environment — so without the step-level pin, `gh` authenticates as the
 * job-level `GH_TOKEN` (a PAT on both agent workflows) and PR-surface label
 * adds are refused (live evidence: runs 39910419320, 39913576270).
 *
 * Pure file reads: parses the workflow YAMLs and asserts the wiring. No
 * network, no gh, no Actions runtime.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

/** A label-transition step invokes the shared CLI entry by this script name. */
const TRANSITION_ENTRY = "label-transition.ts";

/** The merge gate step invokes the review workflow's gate CLI entry. */
const GATE_ENTRY = "review/merge-gate.ts";

/** The exact step-level env values the invariant demands. */
const WORKFLOW_TOKEN_PIN = "${{ github.token }}";

const workflowsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.github/workflows",
);

/** A step invoking the transition entry, with its step-level env. */
interface TransitionStep {
  name: string;
  env: Record<string, string> | undefined;
}

const workflow = (file: string): Record<string, any> =>
  parse(readFileSync(path.join(workflowsDir, file), "utf8"));

const transitionSteps = (file: string): TransitionStep[] => {
  const doc = workflow(file);
  const steps: TransitionStep[] = [];
  for (const job of Object.values(doc.jobs ?? {}) as any[]) {
    for (const step of job.steps ?? []) {
      if (typeof step.run === "string" && step.run.includes(TRANSITION_ENTRY)) {
        steps.push({ name: step.name, env: step.env });
      }
    }
  }
  return steps;
};

/** A step invoking the gate entry, with its condition, env, and run string. */
interface GateStep {
  name: string;
  ifCondition: string | undefined;
  env: Record<string, string> | undefined;
  run: string;
}

const gateSteps = (file: string): GateStep[] => {
  const doc = workflow(file);
  const steps: GateStep[] = [];
  for (const job of Object.values(doc.jobs ?? {}) as any[]) {
    for (const step of job.steps ?? []) {
      if (typeof step.run === "string" && step.run.includes(GATE_ENTRY)) {
        steps.push({
          name: step.name,
          ifCondition: step.if,
          env: step.env,
          run: step.run,
        });
      }
    }
  }
  return steps;
};

/** Names of every step in the file's first job, in file order. */
const stepNames = (file: string): string[] => {
  const doc = workflow(file);
  const [job] = Object.values(doc.jobs ?? {}) as any[];
  return (job.steps ?? []).map((step: any) => step.name);
};

describe("lifecycle label-mutation wiring", () => {
  for (const file of ["agent-review.yml", "agent-implement.yml"]) {
    describe(file, () => {
      it("runs the transition entry on exactly the two lifecycle steps", () => {
        expect(transitionSteps(file).map((step) => step.name)).toEqual([
          "Transition to in-progress",
          "Remove in-progress label",
        ]);
      });

      it("pins GH_TOKEN at step level on every transition step (#32)", () => {
        for (const step of transitionSteps(file)) {
          expect(
            step.env?.GH_TOKEN,
            `${file} step "${step.name}" must pin GH_TOKEN to "${WORKFLOW_TOKEN_PIN}" at step level — the in-code WORKFLOW_GH_TOKEN override never reaches the gh subprocess otherwise`,
          ).toBe(WORKFLOW_TOKEN_PIN);
        }
      });

      it("keeps WORKFLOW_GH_TOKEN beside the pin (the in-code guard reads it)", () => {
        for (const step of transitionSteps(file)) {
          expect(
            step.env?.WORKFLOW_GH_TOKEN,
            `${file} step "${step.name}" must keep WORKFLOW_GH_TOKEN set to "${WORKFLOW_TOKEN_PIN}" — mutationToken refuses to mutate without it`,
          ).toBe(WORKFLOW_TOKEN_PIN);
        }
      });
    });
  }
});

describe("merge gate wiring (#39)", () => {
  const reviewSteps = () => gateSteps("agent-review.yml");

  it("runs the gate on exactly one step of the review workflow", () => {
    expect(reviewSteps().map((step) => step.name)).toEqual(["Merge gate"]);
  });

  it("is the review workflow's final happy-path step: after the review posts and the PR flips ready", () => {
    const names = stepNames("agent-review.yml");
    const gate = names.indexOf("Merge gate");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(names.indexOf("Post review findings"));
    expect(gate).toBeGreaterThan(names.indexOf("Mark PR ready"));
    // And before the failure path, which only runs on !success().
    expect(gate).toBeLessThan(
      names.indexOf("Checkout for failure reporter"),
    );
  });

  it("skips when the review step skipped (closed PRs get no gate verdict either)", () => {
    for (const step of reviewSteps()) {
      expect(step.ifCondition).toBe("steps.review.outputs.skipped != 'true'");
    }
  });

  it("pins GH_TOKEN at step level — the gate's gh reads, merge request, and comment run as the workflow token, never the job-level PAT", () => {
    for (const step of reviewSteps()) {
      expect(step.env?.GH_TOKEN).toBe(WORKFLOW_TOKEN_PIN);
    }
  });

  it("keeps WORKFLOW_GH_TOKEN beside the pin — the gate's label mutations go through the guarded path", () => {
    for (const step of reviewSteps()) {
      expect(step.env?.WORKFLOW_GH_TOKEN).toBe(WORKFLOW_TOKEN_PIN);
    }
  });

  it("passes OUTPUT_DIR — the gate reads review-payload.json written by the review step", () => {
    for (const step of reviewSteps()) {
      expect(step.env?.OUTPUT_DIR).toBeDefined();
    }
  });

  it("leaves the implement workflow alone — the gate is the review workflow's final step only", () => {
    expect(gateSteps("agent-implement.yml")).toEqual([]);
  });
});
