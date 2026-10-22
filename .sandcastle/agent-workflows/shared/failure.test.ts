import { describe, expect, it } from "vitest";
import {
  assertOnlyAgentLabels,
  blockedLabelOps,
  formatFailureComment,
} from "./failure";

const input = {
  issueNumber: 4,
  reason: "Issue #4 has sub-issues; only leaf issues are implemented.",
  runUrl: "https://github.com/tarouttoo/tenderagent/actions/runs/1234567890",
};

describe("formatFailureComment", () => {
  it("renders the reason as a bullet", () => {
    const comment = formatFailureComment(input);
    expect(comment).toContain(
      "- Issue #4 has sub-issues; only leaf issues are implemented.",
    );
  });

  it("links the workflow run", () => {
    const comment = formatFailureComment(input);
    expect(comment).toContain(
      "[View workflow run](https://github.com/tarouttoo/tenderagent/actions/runs/1234567890)",
    );
  });

  it("names the issue in the header", () => {
    expect(formatFailureComment(input)).toContain("issue #4");
  });

  it("explains how to retry by re-adding the trigger label", () => {
    const comment = formatFailureComment(input);
    expect(comment).toContain("`agent:implement`");
    expect(comment).toMatch(/re-add/i);
  });

  it("renders multi-line reasons as one bullet per line", () => {
    const comment = formatFailureComment({
      ...input,
      reason: "First refusal reason.\nSecond refusal reason.",
    });
    expect(comment).toContain("- First refusal reason.");
    expect(comment).toContain("- Second refusal reason.");
  });

  it("strips leading dashes so reasons never render as nested lists", () => {
    const comment = formatFailureComment({
      ...input,
      reason: "- already a dash",
    });
    expect(comment).toContain("- already a dash");
    expect(comment).not.toContain("-- already a dash");
  });

  it("degrades gracefully when the run link is unavailable", () => {
    const comment = formatFailureComment({ ...input, runUrl: "" });
    expect(comment).toMatch(/workflow run link is unavailable/i);
    expect(comment).not.toContain("()");
  });
});

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
});
