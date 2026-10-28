import { describe, expect, it } from "vitest";
import {
  assertOnlyAgentLabels,
  blockedLabelOps,
  formatBlockedComment,
  HOLD_LABEL,
  MERGE_LABEL,
} from "./failure";

describe("assertOnlyAgentLabels", () => {
  it("accepts agent:* lifecycle labels", () => {
    expect(assertOnlyAgentLabels(["agent:implement", "agent:blocked"])).toEqual([
      "agent:implement",
      "agent:blocked",
    ]);
  });

  it("refuses human triage labels — automation never writes them", () => {
    for (const label of ["ready-for-agent", "needs-triage", "wontfix"]) {
      expect(() => assertOnlyAgentLabels([label])).toThrow(
        /automation only writes agent:/i,
      );
    }
  });
});

describe("blockedLabelOps", () => {
  it("removes the trigger and in-progress labels", () => {
    expect(blockedLabelOps().remove).toEqual([
      "agent:implement",
      "agent:in-progress",
    ]);
  });

  it("adds agent:blocked", () => {
    expect(blockedLabelOps().add).toEqual(["agent:blocked"]);
  });

  it("only ever writes agent:* labels (invariant)", () => {
    const ops = blockedLabelOps();
    expect(() => assertOnlyAgentLabels(ops.remove)).not.toThrow();
    expect(() => assertOnlyAgentLabels(ops.add)).not.toThrow();
  });

  it("parameterizes the trigger label for PR workflows", () => {
    const ops = blockedLabelOps("agent:review");
    expect(ops.remove).toEqual(["agent:review", "agent:in-progress"]);
    expect(ops.add).toEqual(["agent:blocked"]);
  });
});

describe("formatBlockedComment", () => {
  const prInput = {
    subject: { kind: "pr" as const, number: 12 },
    reason: "The review agent emitted no parseable review payload.",
    runUrl: "https://github.com/tarouttoo/tenderagent/actions/runs/987654321",
    retryLabel: "agent:review",
  };

  it("names the PR in the header", () => {
    expect(formatBlockedComment(prInput)).toContain("PR #12");
  });

  it("renders the reason as a bullet and links the run", () => {
    const comment = formatBlockedComment(prInput);
    expect(comment).toContain(
      "- The review agent emitted no parseable review payload.",
    );
    expect(comment).toContain(
      "[View workflow run](https://github.com/tarouttoo/tenderagent/actions/runs/987654321)",
    );
  });

  it("explains the retry convention for its trigger label", () => {
    const comment = formatBlockedComment(prInput);
    expect(comment).toContain("`agent:review`");
    expect(comment).toMatch(/re-add/i);
  });

  it("only ever writes agent:* retry labels (invariant)", () => {
    expect(() =>
      formatBlockedComment({ ...prInput, retryLabel: "ready-for-agent" }),
    ).toThrow(/automation only writes agent:/i);
  });

  // The issue-shaped case (the implement workflow's blocked comments, via
  // report-failure.ts's direct invocation) shares every rendering behavior
  // with the PR shape above; these pin the ones only the issue shape used
  // to cover.
  const issueInput = {
    subject: { kind: "issue" as const, number: 4 },
    reason: "Issue #4 has sub-issues; only leaf issues are implemented.",
    runUrl: "https://github.com/tarouttoo/tenderagent/actions/runs/1234567890",
    retryLabel: "agent:implement",
  };

  it("names the issue in the header", () => {
    expect(formatBlockedComment(issueInput)).toContain("issue #4");
  });

  it("renders multi-line reasons as one bullet per line", () => {
    const comment = formatBlockedComment({
      ...issueInput,
      reason: "First refusal reason.\nSecond refusal reason.",
    });
    expect(comment).toContain("- First refusal reason.");
    expect(comment).toContain("- Second refusal reason.");
  });

  it("strips leading dashes so reasons never render as nested lists", () => {
    const comment = formatBlockedComment({
      ...issueInput,
      reason: "- already a dash",
    });
    expect(comment).toContain("- already a dash");
    expect(comment).not.toContain("-- already a dash");
  });

  it("degrades gracefully when the run link is unavailable", () => {
    const comment = formatBlockedComment({ ...issueInput, runUrl: "" });
    expect(comment).toMatch(/workflow run link is unavailable/i);
    expect(comment).not.toContain("()");
  });
});

describe("merge gate lifecycle labels (spec #36)", () => {
  it("spells the two new lifecycle labels exactly", () => {
    expect(MERGE_LABEL).toBe("agent:merge");
    expect(HOLD_LABEL).toBe("agent:hold");
  });

  it("keeps both inside the agent:* invariant", () => {
    expect(() => assertOnlyAgentLabels([MERGE_LABEL, HOLD_LABEL])).not.toThrow();
  });
});
