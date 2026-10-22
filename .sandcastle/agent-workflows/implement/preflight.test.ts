import { describe, expect, it } from "vitest";
import {
  findBlockingPullRequest,
  isPrdShaped,
  isSubIssue,
  runPreflight,
  type OpenPullRequest,
} from "./preflight";

/** Leaf-shaped body, mirroring the tracker's atomic-issue template. */
const leafBody = [
  "## What to build",
  "",
  "The implement workflow refuses work it should not take.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] Sub-issues are refused with a reason",
  "- [ ] Failed issues end as `agent:blocked`",
].join("\n");

/** PRD-shaped body, mirroring the tracker's parent/PRD issue template. */
const prdBody = [
  "## Problem Statement",
  "",
  "Implementing features requires manually launching coding agents.",
  "",
  "## User Stories",
  "",
  "1. As a maintainer, I want an issue labeled `ready-for-agent` to trigger the agent.",
  "2. As a maintainer, I want the agent to work on an isolated branch.",
  "3. As a maintainer, I want a draft PR opened automatically.",
].join("\n");

const pr = (overrides: Partial<OpenPullRequest> = {}): OpenPullRequest => ({
  number: 8,
  title: "Fix #4: preflight gates",
  body: "Closes #4",
  url: "https://github.com/tarouttoo/tenderagent/pull/8",
  authorAssociation: "COLLABORATOR",
  ...overrides,
});

describe("isSubIssue", () => {
  it("refuses an issue with sub-issues", () => {
    expect(isSubIssue({ subIssueCount: 2, body: leafBody })).toBe(true);
  });

  it("refuses the legacy 'Part of #N' body marker", () => {
    expect(isSubIssue({ subIssueCount: 0, body: "Part of #1\n\n" + leafBody })).toBe(
      true,
    );
  });

  it("does not match 'part of #N' mid-sentence", () => {
    expect(
      isSubIssue({ subIssueCount: 0, body: "This file is part of #5 of the docs." }),
    ).toBe(false);
  });

  it("accepts a leaf issue", () => {
    expect(isSubIssue({ subIssueCount: 0, body: leafBody })).toBe(false);
  });
});

describe("isPrdShaped", () => {
  it("refuses a User Stories section", () => {
    expect(isPrdShaped(prdBody)).toBe(true);
  });

  it("refuses a Problem Statement section at any heading level", () => {
    expect(isPrdShaped("# Problem Statement\n\nBig.")).toBe(true);
    expect(isPrdShaped("### problem statement\n\nBig.")).toBe(true);
  });

  it("refuses three or more user stories even without PRD headings", () => {
    const stories = [
      "As a maintainer, I want fast triage.",
      "As a reviewer, I need structured feedback.",
      "As an agent, I would like full task context.",
    ].join("\n");
    expect(isPrdShaped(stories)).toBe(true);
  });

  it("accepts one or two user stories", () => {
    expect(
      isPrdShaped("As a maintainer, I want retries.\nAs a reviewer, I want diffs."),
    ).toBe(false);
  });

  it("accepts a leaf issue", () => {
    expect(isPrdShaped(leafBody)).toBe(false);
  });
});

describe("findBlockingPullRequest", () => {
  it("finds an open collaborator PR with a closing keyword in the body", () => {
    const found = findBlockingPullRequest(4, [pr()]);
    expect(found?.number).toBe(8);
  });

  it("finds a closing keyword in the title", () => {
    const found = findBlockingPullRequest(4, [
      pr({ body: "Implements the gates.", title: "Resolves #4" }),
    ]);
    expect(found?.number).toBe(8);
  });

  it("matches closing keywords case-insensitively", () => {
    expect(findBlockingPullRequest(4, [pr({ body: "FIXES #4" })])?.number).toBe(8);
  });

  it("ignores references without a closing keyword", () => {
    expect(
      findBlockingPullRequest(4, [pr({ title: "Related to #4", body: "See #4" })]),
    ).toBeUndefined();
  });

  it("ignores other issues' numbers", () => {
    expect(
      findBlockingPullRequest(4, [
        pr({ title: "Unrelated work", body: "Closes #40 and fixes #41" }),
      ]),
    ).toBeUndefined();
  });

  it("ignores PRs from non-collaborators", () => {
    for (const association of ["NONE", "FIRST_TIME_CONTRIBUTOR", "CONTRIBUTOR"]) {
      expect(findBlockingPullRequest(4, [pr({ authorAssociation: association })])).toBeUndefined();
    }
  });

  it("accepts owner and member associations as collaborators", () => {
    expect(findBlockingPullRequest(4, [pr({ authorAssociation: "OWNER" })])?.number).toBe(8);
    expect(findBlockingPullRequest(4, [pr({ authorAssociation: "MEMBER" })])?.number).toBe(8);
  });
});

describe("runPreflight", () => {
  const pass = {
    issueNumber: 4,
    body: leafBody,
    subIssueCount: 0,
    openPullRequests: [],
  };

  it("passes a leaf issue with no in-flight collaborator PR", () => {
    expect(runPreflight(pass)).toEqual({ ok: true });
  });

  it("refuses a sub-issue with a reason naming the issue", () => {
    const verdict = runPreflight({ ...pass, subIssueCount: 1 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("#4");
  });

  it("refuses a PRD-shaped issue with a reason", () => {
    const verdict = runPreflight({ ...pass, body: prdBody });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/requirements document|PRD/i);
  });

  it("refuses when an open collaborator PR already closes the issue", () => {
    const verdict = runPreflight({ ...pass, openPullRequests: [pr()] });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("#8");
      expect(verdict.reason).toContain(pr().url);
    }
  });

  it("collects every refusal reason in one pass", () => {
    const verdict = runPreflight({
      issueNumber: 4,
      body: prdBody,
      subIssueCount: 1,
      openPullRequests: [pr()],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/sub-issue/i);
      expect(verdict.reason).toMatch(/PRD/i);
      expect(verdict.reason).toMatch(/pull request/i);
    }
  });
});
