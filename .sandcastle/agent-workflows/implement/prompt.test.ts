import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPromptArgs, renderPrompt } from "./prompt";

const input = {
  issueNumber: 3,
  issueTitle: "Implement workflow: happy path",
  issueBody: "Labeling a leaf issue `agent:implement` runs the agent.",
  issueComments: [
    { author: "maintainer", body: "Please keep the PR a draft." },
    { author: "reviewer", body: "Mind the concurrency group." },
  ],
  glossary: "**AFK agent**: A coding agent that works without a human.",
  sourceBranch: "agent/issue-3-implement-workflow-happy-path",
  targetBranch: "main",
};

describe("buildPromptArgs", () => {
  it("exposes every domain input as a prompt argument", () => {
    const args = buildPromptArgs(input);

    expect(args.ISSUE_NUMBER).toBe("3");
    expect(args.ISSUE_TITLE).toBe(input.issueTitle);
    expect(args.ISSUE_BODY).toBe(input.issueBody);
    expect(args.ISSUE_COMMENTS).toContain("Please keep the PR a draft.");
    expect(args.ISSUE_COMMENTS).toContain("Mind the concurrency group.");
    expect(args.GLOSSARY).toContain("AFK agent");
    expect(args.SOURCE_BRANCH).toBe(input.sourceBranch);
    expect(args.TARGET_BRANCH).toBe(input.targetBranch);
  });

  it("renders each comment with its author", () => {
    const comments = buildPromptArgs(input).ISSUE_COMMENTS;

    expect(comments).toContain("maintainer");
    expect(comments).toContain("reviewer");
  });

  it("marks an issue with no comments instead of injecting an empty block", () => {
    const args = buildPromptArgs({ ...input, issueComments: [] });

    expect(args.ISSUE_COMMENTS).not.toBe("");
  });
});

describe("renderPrompt", () => {
  const template = [
    "# TASK",
    "Implement issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}",
    "Source branch `{{SOURCE_BRANCH}}`, target `{{TARGET_BRANCH}}`.",
    "",
    "{{ISSUE_BODY}}",
    "{{ISSUE_COMMENTS}}",
    "{{GLOSSARY}}",
  ].join("\n");

  it("substitutes every placeholder with its argument", () => {
    const prompt = renderPrompt(template, buildPromptArgs(input));

    expect(prompt).toContain("Implement issue #3: Implement workflow: happy path");
    expect(prompt).toContain("agent/issue-3-implement-workflow-happy-path");
    expect(prompt).toContain("`main`");
    expect(prompt).toContain("Labeling a leaf issue");
    expect(prompt).toContain("Mind the concurrency group.");
    expect(prompt).toContain("AFK agent");
    expect(prompt).not.toContain("{{");
  });

  it("keeps issue content literal — placeholders inside the issue body are not expanded", () => {
    const sneaky = buildPromptArgs({
      ...input,
      issueBody: "Use the {{SOURCE_BRANCH}} trick from {{GLOSSARY}}",
    });
    const prompt = renderPrompt(
      "Body:\n{{ISSUE_BODY}}\nBranch: {{SOURCE_BRANCH}}",
      sneaky,
    );

    expect(prompt).toContain("Body:\nUse the {{SOURCE_BRANCH}} trick from {{GLOSSARY}}");
    expect(prompt).toContain("Branch: agent/issue-3-implement-workflow-happy-path");
  });

  it("fails fast when the template has a placeholder with no argument", () => {
    expect(() => renderPrompt("{{ISSUE_TITLE}} and {{MYSTERY_ARG}}", { ISSUE_TITLE: "x" })).toThrow(
      /MYSTERY_ARG/,
    );
  });

  it("fully renders the checked-in prompt skeleton", () => {
    const template = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
    const prompt = renderPrompt(template, buildPromptArgs(input));

    expect(prompt).not.toContain("{{");
    expect(prompt).toContain("Implement issue #3");
    expect(prompt).toContain("agent/issue-3-implement-workflow-happy-path");
    expect(prompt).toContain("<promise>COMPLETE</promise>");
  });
});

describe("prompt skeleton: PR body drafting", () => {
  const skeleton = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");

  it("inlines the pr-skill template — runners have no user-level skills", () => {
    expect(skeleton).toContain("## Summary");
    expect(skeleton).toContain("## Evidence");
    expect(skeleton).toContain("## Merge Danger");
  });

  it("tells the agent to write pr-body.md to OUTPUT_DIR before the completion signal", () => {
    expect(skeleton).toContain("pr-body.md");
    expect(skeleton).toContain("OUTPUT_DIR");
    const bodySection = skeleton.indexOf("pr-body.md");
    const signal = skeleton.indexOf("<promise>COMPLETE</promise>");
    expect(bodySection).toBeGreaterThan(-1);
    expect(signal).toBeGreaterThan(bodySection);
  });

  it("keeps the closing keyword as the body's first line", () => {
    expect(skeleton).toContain("Closes #{{ISSUE_NUMBER}}");
  });

  it("ends with the completion signal as the last line of the final section", () => {
    const nonEmptyLines = skeleton
      .split("\n")
      .filter((line) => line.trim().length > 0);

    expect(nonEmptyLines[nonEmptyLines.length - 1]).toBe(
      "When complete, output `<promise>COMPLETE</promise>`.",
    );
  });
});
