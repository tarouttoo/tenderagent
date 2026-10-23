import { describe, expect, it } from "vitest";
import { REVIEW_TRIGGER_LABEL } from "../shared/failure";
import {
  classifyReviewRequestFailure,
  reviewRequestGhArgs,
} from "./review-request";

describe("reviewRequestGhArgs", () => {
  it("builds the ensure-then-add pair for the review trigger label", () => {
    expect(reviewRequestGhArgs("42")).toEqual({
      ensure: ["label", "create", "agent:review"],
      add: ["pr", "edit", "42", "--add-label", "agent:review"],
    });
  });

  it("targets the PR surface with the shared trigger-label constant", () => {
    const { add } = reviewRequestGhArgs("7");
    expect(add[0]).toBe("pr");
    expect(add).toContain(REVIEW_TRIGGER_LABEL);
  });
});

describe("classifyReviewRequestFailure", () => {
  // The step's GH_TOKEN is AGENT_PAT alone — the default GITHUB_TOKEN's label
  // events never start the review workflow, so a missing or under-scoped PAT
  // is the dominant failure shape and must get an actionable reason.
  it("classifies a missing token as the AGENT_PAT prerequisite", () => {
    const reason = classifyReviewRequestFailure(
      "gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.",
      "42",
    );
    expect(reason).toMatch(/AGENT_PAT/);
    expect(reason).toMatch(/agent:review/);
    expect(reason).toMatch(/gh pr edit 42 --add-label agent:review/);
  });

  it("classifies a permission refusal as the AGENT_PAT prerequisite", () => {
    for (const output of [
      "gh: Resource not accessible by integration (HTTP 403)",
      "gh: Forbidden (HTTP 403)",
      "gh: Bad credentials (HTTP 401)",
    ]) {
      const reason = classifyReviewRequestFailure(output, "9");
      expect(reason).toMatch(/AGENT_PAT/);
      expect(reason).toMatch(/gh pr edit 9 --add-label agent:review/);
    }
  });

  it("keeps the output excerpt for unrecognized failures", () => {
    const reason = classifyReviewRequestFailure(
      "gh: unexpected 502 upstream error",
      "3",
    );
    expect(reason).toContain("unexpected 502 upstream error");
    expect(reason).toMatch(/gh pr edit 3 --add-label agent:review/);
  });

  it("always names the PR-side retry, never the issue-side one", () => {
    // Re-implementing is refused by preflight while an open PR closes the
    // issue, so the reason must steer the retry to the PR's review trigger.
    for (const prNumber of ["42", "9", "3"]) {
      const reason = classifyReviewRequestFailure("anything", prNumber);
      expect(reason).toMatch(new RegExp(`agent:review.*PR #${prNumber}|PR #${prNumber}[\\s\\S]*agent:review`));
      expect(reason).toMatch(/agent:implement/);
    }
  });
});
