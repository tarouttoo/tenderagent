import { describe, expect, it } from "vitest";
import {
  applyLabelOps,
  labelOps,
  labelTransition,
  mutationToken,
  WORKFLOW_TOKEN_ENV,
  type GhCall,
} from "./labels";

const workflowEnv = {
  [WORKFLOW_TOKEN_ENV]: "workflow-token",
  GH_TOKEN: "pat-token",
};

/** Records gh invocations without touching the network. */
const recordingRun = (calls: GhCall[]) => (args: string[], env: NodeJS.ProcessEnv) => {
  calls.push({ args, env });
};

describe("mutationToken", () => {
  it("uses the workflow GITHUB_TOKEN for lifecycle label mutations", () => {
    expect(mutationToken({ [WORKFLOW_TOKEN_ENV]: "workflow-token" })).toBe(
      "workflow-token",
    );
  });

  it("never falls back to the PAT-backed GH_TOKEN", () => {
    // GH_TOKEN in the agent workflows is AGENT_PAT || REVIEW_PAT || fallback;
    // a mis-scoped PAT must never perform lifecycle mutations.
    expect(() => mutationToken({ GH_TOKEN: "pat-token" })).toThrow(
      new RegExp(WORKFLOW_TOKEN_ENV),
    );
  });

  it("throws when no workflow token was supplied", () => {
    expect(() => mutationToken({})).toThrow(new RegExp(WORKFLOW_TOKEN_ENV));
  });
});

describe("labelOps", () => {
  it("accepts agent:* lifecycle labels", () => {
    expect(labelOps(["agent:implement"], ["agent:in-progress"])).toEqual({
      remove: ["agent:implement"],
      add: ["agent:in-progress"],
    });
  });

  it("refuses human triage labels on either side", () => {
    expect(() => labelOps(["ready-for-agent"], [])).toThrow(
      /automation only writes agent:/i,
    );
    expect(() => labelOps([], ["needs-triage"])).toThrow(
      /automation only writes agent:/i,
    );
  });
});

describe("applyLabelOps", () => {
  it("removes first, then adds", () => {
    const calls: GhCall[] = [];
    applyLabelOps({
      surface: "issue",
      subjectNumber: "17",
      ops: { remove: ["agent:implement"], add: ["agent:in-progress"] },
      env: workflowEnv,
      run: recordingRun(calls),
    });
    expect(calls.map((call) => call.args)).toEqual([
      ["issue", "edit", "17", "--remove-label", "agent:implement"],
      ["issue", "edit", "17", "--add-label", "agent:in-progress"],
    ]);
  });

  it("executes under the workflow token, never the PAT", () => {
    const calls: GhCall[] = [];
    applyLabelOps({
      surface: "pr",
      subjectNumber: "9",
      ops: { remove: ["agent:review"], add: [] },
      env: workflowEnv,
      run: recordingRun(calls),
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.env.GH_TOKEN).toBe("workflow-token");
    }
  });

  it("refuses to mutate when the workflow token is missing", () => {
    const calls: GhCall[] = [];
    expect(() =>
      applyLabelOps({
        surface: "issue",
        subjectNumber: "17",
        ops: { remove: ["agent:implement"], add: [] },
        env: { GH_TOKEN: "pat-token" },
        run: recordingRun(calls),
      }),
    ).toThrow(new RegExp(WORKFLOW_TOKEN_ENV));
    expect(calls).toHaveLength(0);
  });

  it("asserts the agent:* invariant before executing anything", () => {
    const calls: GhCall[] = [];
    // Raw ops bypass labelOps to exercise the chokepoint itself: a caller
    // that skips the builder still cannot sneak a triage label through.
    expect(() =>
      applyLabelOps({
        surface: "issue",
        subjectNumber: "17",
        ops: { remove: [], add: ["ready-for-agent"] },
        env: workflowEnv,
        run: recordingRun(calls),
      }),
    ).toThrow(/automation only writes agent:/i);
    expect(calls).toHaveLength(0);
  });

  it("ensures added labels exist before adding them", () => {
    const calls: GhCall[] = [];
    applyLabelOps({
      surface: "issue",
      subjectNumber: "17",
      ops: { remove: [], add: ["agent:blocked"] },
      ensureLabels: true,
      env: workflowEnv,
      run: recordingRun(calls),
    });
    expect(calls.map((call) => call.args)).toEqual([
      ["label", "create", "agent:blocked"],
      ["issue", "edit", "17", "--add-label", "agent:blocked"],
    ]);
  });

  it("keeps going in best-effort mode (failure reporting)", () => {
    const calls: GhCall[] = [];
    const failingRun = (args: string[], env: NodeJS.ProcessEnv) => {
      recordingRun(calls)(args, env);
      throw new Error("gh went sideways");
    };
    expect(() =>
      applyLabelOps({
        surface: "issue",
        subjectNumber: "17",
        ops: { remove: ["agent:in-progress"], add: ["agent:blocked"] },
        ensureLabels: true,
        bestEffort: true,
        env: workflowEnv,
        run: failingRun,
      }),
    ).not.toThrow();
    expect(calls).toHaveLength(3);
  });

  it("fails loudly in strict mode when an add fails (run transitions)", () => {
    const calls: GhCall[] = [];
    const failingRun = (args: string[], env: NodeJS.ProcessEnv) => {
      recordingRun(calls)(args, env);
      throw new Error("gh went sideways");
    };
    expect(() =>
      applyLabelOps({
        surface: "pr",
        subjectNumber: "9",
        ops: { remove: [], add: ["agent:in-progress"] },
        env: workflowEnv,
        run: failingRun,
      }),
    ).toThrow(/gh went sideways/);
  });

  it("never fails the transition on a removal — the label may be absent", () => {
    // A consumed trigger or in-progress label may already be gone (retry
    // race); that must not fail the run the way it never did under `|| true`.
    const calls: GhCall[] = [];
    const failingRun = (args: string[], env: NodeJS.ProcessEnv) => {
      recordingRun(calls)(args, env);
      throw new Error("gh went sideways");
    };
    expect(() =>
      applyLabelOps({
        surface: "issue",
        subjectNumber: "17",
        ops: { remove: ["agent:implement"], add: [] },
        env: workflowEnv,
        run: failingRun,
      }),
    ).not.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("reports how many gh calls applied and failed", () => {
    // Callers (the failure reporter) must be able to tell whether the
    // relabel landed instead of claiming success unconditionally.
    const calls: GhCall[] = [];
    const flakyRun = (args: string[], env: NodeJS.ProcessEnv) => {
      recordingRun(calls)(args, env);
      if (args.includes("--remove-label")) throw new Error("gh went sideways");
    };
    const result = applyLabelOps({
      surface: "issue",
      subjectNumber: "17",
      ops: { remove: ["agent:implement"], add: ["agent:in-progress"] },
      env: workflowEnv,
      run: flakyRun,
    });
    expect(result).toEqual({ applied: 1, failed: 1 });
  });
});

describe("labelTransition", () => {
  it("start consumes the trigger label and applies in-progress", () => {
    expect(labelTransition("agent:implement", "start")).toEqual({
      remove: ["agent:implement"],
      add: ["agent:in-progress"],
    });
  });

  it("finish removes in-progress and adds nothing, needing no trigger", () => {
    expect(labelTransition(undefined, "finish")).toEqual({
      remove: ["agent:in-progress"],
      add: [],
    });
  });

  it("refuses a start transition without a trigger label", () => {
    expect(() => labelTransition(undefined, "start")).toThrow(/trigger/);
  });

  it("only ever writes agent:* labels for every trigger and phase", () => {
    for (const trigger of ["agent:implement", "agent:review"]) {
      for (const phase of ["start", "finish"] as const) {
        const ops = labelTransition(trigger, phase);
        expect(ops.remove.every((l) => l.startsWith("agent:"))).toBe(true);
        expect(ops.add.every((l) => l.startsWith("agent:"))).toBe(true);
      }
    }
  });
});
