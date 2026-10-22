import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReviewPromptArgs } from "./prompt";
import { renderPrompt } from "../shared/prompt";

const input = {
  prNumber: 12,
  prTitle: "Fix #6: Review workflow on agent:review PRs",
  prBody: "Closes #6\n\nImplemented by the agent implement workflow.",
  prDiff:
    "diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,3 +1,4 @@\n+console.log(\"hi\");",
  sourceBranch: "agent/issue-6-review-workflow",
  targetBranch: "main",
  glossary: "**AFK agent**: A coding agent that works without a human.",
};

describe("buildReviewPromptArgs", () => {
  it("exposes every review input as a prompt argument", () => {
    const args = buildReviewPromptArgs(input);

    expect(args.PR_NUMBER).toBe("12");
    expect(args.PR_TITLE).toBe(input.prTitle);
    expect(args.PR_BODY).toBe(input.prBody);
    expect(args.PR_DIFF).toContain("+++ b/src/main.ts");
    expect(args.SOURCE_BRANCH).toBe(input.sourceBranch);
    expect(args.TARGET_BRANCH).toBe(input.targetBranch);
    expect(args.GLOSSARY).toContain("AFK agent");
  });

  it("marks an empty diff instead of injecting a blank section", () => {
    const args = buildReviewPromptArgs({ ...input, prDiff: "   " });

    expect(args.PR_DIFF).not.toBe("");
    expect(args.PR_DIFF).toMatch(/empty diff/i);
  });

  it("renders a null PR body as empty text, not the string 'null'", () => {
    const args = buildReviewPromptArgs({ ...input, prBody: null });

    expect(args.PR_BODY).toBe("");
  });
});

describe("the checked-in review prompt skeleton", () => {
  const template = readFileSync(
    path.join(import.meta.dirname, "prompt.md"),
    "utf8",
  );

  it("fully renders with the review arguments", () => {
    const prompt = renderPrompt(template, buildReviewPromptArgs(input));

    expect(prompt).not.toContain("{{");
    expect(prompt).toContain("Review pull request #12");
    expect(prompt).toContain("<promise>COMPLETE</promise>");
  });

  it("specifies the structured payload contract the workflow parses", () => {
    const prompt = renderPrompt(template, buildReviewPromptArgs(input));

    expect(prompt).toContain("```json");
    for (const word of ["verdict", "summary", "findings", "severity"]) {
      expect(prompt).toContain(word);
    }
    for (const verdict of ["approve", "comment", "request_changes"]) {
      expect(prompt).toContain(verdict);
    }
    for (const severity of ["blocker", "concern", "nit"]) {
      expect(prompt).toContain(severity);
    }
  });

  it("keeps the review read-only", () => {
    const prompt = renderPrompt(template, buildReviewPromptArgs(input));

    expect(prompt).toMatch(/read-only/i);
    expect(prompt).toMatch(/do not commit/i);
  });
});
