import { describe, expect, it } from "vitest";
import { branchForIssue } from "./branch";

describe("branchForIssue", () => {
  it("names the branch after the issue number and slugged title", () => {
    expect(branchForIssue(3, "Implement workflow: happy path")).toBe(
      "agent/issue-3-implement-workflow-happy-path",
    );
  });

  it("collapses runs of punctuation and whitespace into single dashes", () => {
    expect(branchForIssue(5, "Docs:   agent label lifecycle + end-to-end")).toBe(
      "agent/issue-5-docs-agent-label-lifecycle-end-to-end",
    );
  });

  it("truncates the slug so branch names stay bounded", () => {
    const longTitle = "Fix the very long issue title that keeps going and going";
    const branch = branchForIssue(7, longTitle);
    expect(branch).toMatch(/^agent\/issue-7-[a-z0-9-]+$/);
    expect(branch.length).toBeLessThanOrEqual("agent/issue-7-".length + 50);
  });

  it("treats non-latin scripts as separators", () => {
    expect(branchForIssue(9, "Реализовать workflow")).toBe(
      "agent/issue-9-workflow",
    );
  });

  it("falls back to a bare issue branch when the title slugs to nothing", () => {
    expect(branchForIssue(11, "???")).toBe("agent/issue-11");
    expect(branchForIssue(12, "Реализовать и проверить")).toBe("agent/issue-12");
  });
});
