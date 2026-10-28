import { describe, expect, it } from "vitest";
import {
  MERGE_POLICY,
  closingIssueNumbers,
  evaluateMergePolicy,
  formatHoldComment,
  parseDeclaredDoor,
  type MergeCondition,
  type MergeDecision,
  type MergePolicyInput,
} from "./merge-policy";

/** Every condition green — the control input the condition table perturbs. */
const passingInput = (): MergePolicyInput => ({
  verdict: "approve",
  reviewerDoor: "two_way",
  declaredDoor: "two_way",
  changedFiles: ["docs/agents/agent-pipeline.md", "src/ci-tooling.test.ts"],
  changedLines: 42,
  openBlockers: [],
  ciGreen: true,
  autoMergeEnabled: true,
});

const decisionFor = (input: MergePolicyInput): MergeDecision =>
  evaluateMergePolicy(input);

/** Asserts the decision is a hold naming exactly the given conditions, in order. */
const expectHoldWith = (
  input: MergePolicyInput,
  ...conditions: MergeCondition[]
): void => {
  const decision = evaluateMergePolicy(input);
  expect(decision.outcome).toBe("hold");
  if (decision.outcome !== "hold") return;
  expect(decision.failures.map((failure) => failure.condition)).toEqual(
    conditions,
  );
};

describe("closingIssueNumbers", () => {
  it("parses the pr-skill first line (Closes #N)", () => {
    expect(closingIssueNumbers("Closes #39\n\n## Summary\n\n…")).toEqual([39]);
  });

  it("collects every closing-keyword reference, not just the first", () => {
    expect(closingIssueNumbers("Fixes #1 and closes #2, resolves #3.")).toEqual(
      [1, 2, 3],
    );
  });

  it("ignores references without a closing keyword", () => {
    expect(closingIssueNumbers("Refs #5. Part of #6. Related to #7.")).toEqual(
      [],
    );
  });

  it("dedupes repeated references to the same issue", () => {
    expect(closingIssueNumbers("Closes #4 (fixes #4)")).toEqual([4]);
  });

  it("is case-insensitive", () => {
    expect(closingIssueNumbers("FIXES #7")).toEqual([7]);
  });

  it("treats a missing body as no closing keyword", () => {
    for (const body of [null, undefined, ""]) {
      expect(closingIssueNumbers(body)).toEqual([]);
    }
  });
});

describe("formatHoldComment", () => {
  const heldInput = {
    prNumber: 12,
    failures: [
      {
        condition: "ci_green" as const,
        reason: "CI is not green on the PR's head commit.",
      },
      {
        condition: "verdict" as const,
        reason: "Review verdict is `comment`, not `approve`.",
      },
    ],
    runUrl: "https://github.com/tarouttoo/tenderagent/actions/runs/987654321",
    retryLabel: "agent:review",
  };

  it("names the PR as held in the header", () => {
    expect(formatHoldComment(heldInput)).toContain("PR #12");
  });

  it("enumerates every failed condition as its own bullet, in order", () => {
    const body = formatHoldComment(heldInput);
    const bullets = body
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(bullets).toEqual([
      "- `ci_green`: CI is not green on the PR's head commit.",
      "- `verdict`: Review verdict is `comment`, not `approve`.",
    ]);
  });

  it("links the workflow run", () => {
    expect(formatHoldComment(heldInput)).toContain(
      "[View workflow run](https://github.com/tarouttoo/tenderagent/actions/runs/987654321)",
    );
  });

  it("keeps the held PR ready-for-review and names the retry path", () => {
    const body = formatHoldComment(heldInput);
    expect(body).toContain("ready for review");
    expect(body).toContain("agent:review");
  });

  it("falls back to a legible line when the run URL is unavailable", () => {
    const body = formatHoldComment({ ...heldInput, runUrl: "" });
    expect(body).not.toContain("[View workflow run]");
    expect(body).toContain("workflow run");
  });

  it("never writes a non-agent retry label (the triage vocabulary is human-only)", () => {
    expect(() =>
      formatHoldComment({ ...heldInput, retryLabel: "ready-for-agent" }),
    ).toThrow(/automation only writes agent:/i);
  });
});

describe("MERGE_POLICY", () => {
  it("caps changed lines at 300 (the spec's ceiling; tuning is a reviewed diff)", () => {
    expect(MERGE_POLICY.changedLineCeiling).toBe(300);
  });

  it("denies the pipeline's own files: workflow definitions", () => {
    expect(
      MERGE_POLICY.deniedPaths.some((pattern) =>
        pattern.test(".github/workflows/agent-review.yml"),
      ),
    ).toBe(true);
  });

  it("denies the agent harness directory", () => {
    expect(
      MERGE_POLICY.deniedPaths.some((pattern) =>
        pattern.test(".sandcastle/agent-workflows/review/review.ts"),
      ),
    ).toBe(true);
  });

  it("denies lockfiles at the repo root and nested", () => {
    for (const file of [
      "package-lock.json",
      "packages/app/package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "Cargo.lock",
    ]) {
      expect(
        MERGE_POLICY.deniedPaths.some((pattern) => pattern.test(file)),
        file,
      ).toBe(true);
    }
  });

  it("leaves ordinary sources alone", () => {
    for (const file of [
      "docs/agents/agent-pipeline.md",
      "src/ci-tooling.test.ts",
      "README.md",
    ]) {
      expect(
        MERGE_POLICY.deniedPaths.some((pattern) => pattern.test(file)),
        file,
      ).toBe(false);
    }
  });
});

describe("parseDeclaredDoor", () => {
  it("reads two-way from a heading section", () => {
    const body = [
      "Closes #38",
      "",
      "## Summary",
      "",
      "Small pure module.",
      "",
      "## Merge Danger",
      "",
      "Two-way door, tiny.",
      "",
      "## Evidence",
      "",
      "Red then green.",
    ].join("\n");

    expect(parseDeclaredDoor(body)).toBe("two_way");
  });

  it("reads one-way from a heading section", () => {
    const body = [
      "## Summary",
      "",
      "Edits a workflow.",
      "",
      "## Merge Danger",
      "",
      "One-way door, touches the leash.",
    ].join("\n");

    expect(parseDeclaredDoor(body)).toBe("one_way");
  });

  it("is case-insensitive", () => {
    const body = "## Merge Danger\n\nTWO-WAY door.\n";
    expect(parseDeclaredDoor(body)).toBe("two_way");
  });

  it("accepts the bold list-item form of the template", () => {
    const body =
      "## Summary\n\nSmall.\n\n- **Merge Danger**: one-way (touches .github/workflows).\n";
    expect(parseDeclaredDoor(body)).toBe("one_way");
  });

  it("accepts the door on the heading's own line", () => {
    const body = "## Merge Danger: two-way door\n\nTiny.\n";
    expect(parseDeclaredDoor(body)).toBe("two_way");
  });

  it("accepts spaced and underscored spellings", () => {
    expect(parseDeclaredDoor("## Merge Danger\n\ntwo way door.\n")).toBe(
      "two_way",
    );
    expect(parseDeclaredDoor("## Merge Danger\n\none_way door.\n")).toBe(
      "one_way",
    );
  });

  it("returns undefined for an absent section", () => {
    const body = "Closes #38\n\n## Summary\n\nForgot the section.\n";
    expect(parseDeclaredDoor(body)).toBeUndefined();
  });

  it("returns undefined for a missing body (canned stub PRs)", () => {
    expect(parseDeclaredDoor(null)).toBeUndefined();
    expect(parseDeclaredDoor(undefined)).toBeUndefined();
    expect(parseDeclaredDoor("")).toBeUndefined();
  });

  it("returns undefined for the ambiguous verbatim template line (both doors)", () => {
    const body =
      "- **Merge Danger**: one-way or two-way door, blast radius in one word.\n";
    expect(parseDeclaredDoor(body)).toBeUndefined();
  });

  it("returns undefined when the section names both doors", () => {
    const body = "## Merge Danger\n\nOne-way, or maybe two-way.\n";
    expect(parseDeclaredDoor(body)).toBeUndefined();
  });

  it("returns undefined when the section names neither door", () => {
    const body = "## Merge Danger\n\nBlast radius: small.\n";
    expect(parseDeclaredDoor(body)).toBeUndefined();
  });

  it("ignores door words past the section's next heading", () => {
    const body = [
      "## Merge Danger",
      "",
      "See the evidence below.",
      "",
      "## Evidence",
      "",
      "The two-way claim is only discussed here.",
    ].join("\n");

    expect(parseDeclaredDoor(body)).toBeUndefined();
  });
});

describe("evaluateMergePolicy — the condition table", () => {
  it("merges when every condition holds", () => {
    expect(decisionFor(passingInput())).toEqual({ outcome: "merge" });
  });

  it("holds on a comment verdict alone", () => {
    expectHoldWith({ ...passingInput(), verdict: "comment" }, "verdict");
  });

  it("holds on a request_changes verdict alone", () => {
    expectHoldWith(
      { ...passingInput(), verdict: "request_changes" },
      "verdict",
    );
  });

  it("holds when the reviewer assesses a one-way door alone (doors agree)", () => {
    expectHoldWith(
      { ...passingInput(), reviewerDoor: "one_way", declaredDoor: "one_way" },
      "reviewer_door",
    );
  });

  it("enumerates both door conditions when the reviewer sees one-way and the implementer declared two-way", () => {
    expectHoldWith(
      { ...passingInput(), reviewerDoor: "one_way" },
      "reviewer_door",
      "declared_door",
    );
  });

  it("holds when the Merge Danger section is missing or unparseable alone", () => {
    expectHoldWith({ ...passingInput(), declaredDoor: undefined }, "declared_door");
  });

  it("holds when the declared door disagrees with the reviewer alone", () => {
    expectHoldWith(
      { ...passingInput(), declaredDoor: "one_way" },
      "declared_door",
    );
  });

  it("holds on a denied workflow path alone", () => {
    expectHoldWith(
      {
        ...passingInput(),
        changedFiles: [".github/workflows/ci.yml"],
      },
      "denied_paths",
    );
  });

  it("holds on a denied harness path alone", () => {
    expectHoldWith(
      {
        ...passingInput(),
        changedFiles: [".sandcastle/agent-workflows/review/review.ts"],
      },
      "denied_paths",
    );
  });

  it("holds on a denied lockfile alone", () => {
    expectHoldWith(
      { ...passingInput(), changedFiles: ["package-lock.json"] },
      "denied_paths",
    );
  });

  it("holds when the diff is one line over the ceiling alone", () => {
    expectHoldWith(
      { ...passingInput(), changedLines: MERGE_POLICY.changedLineCeiling + 1 },
      "changed_lines",
    );
  });

  it("merges exactly at the ceiling", () => {
    expect(
      decisionFor({
        ...passingInput(),
        changedLines: MERGE_POLICY.changedLineCeiling,
      }),
    ).toEqual({ outcome: "merge" });
  });

  it("holds on open sub-issue blockers alone", () => {
    expectHoldWith(
      { ...passingInput(), openBlockers: ["#12", "#14"] },
      "open_blockers",
    );
  });

  it("holds on a red CI head commit alone", () => {
    expectHoldWith({ ...passingInput(), ciGreen: false }, "ci_green");
  });

  it("holds on disabled repo auto-merge alone — the dormancy rule", () => {
    expectHoldWith(
      { ...passingInput(), autoMergeEnabled: false },
      "auto_merge_enabled",
    );
  });

  it("enumerates every failed condition, in policy order", () => {
    expectHoldWith(
      {
        ...passingInput(),
        verdict: "request_changes",
        changedLines: 500,
        ciGreen: false,
        autoMergeEnabled: false,
      },
      "verdict",
      "changed_lines",
      "ci_green",
      "auto_merge_enabled",
    );
  });
});

describe("evaluateMergePolicy — the hold comment's reasons", () => {
  it("names the denied paths", () => {
    const decision = decisionFor({
      ...passingInput(),
      changedFiles: [".github/workflows/ci.yml", "package-lock.json"],
    });
    if (decision.outcome !== "hold") throw new Error("expected hold");
    const reason = decision.failures
      .filter((failure) => failure.condition === "denied_paths")
      .map((failure) => failure.reason)
      .join(" ");
    expect(reason).toContain(".github/workflows/ci.yml");
    expect(reason).toContain("package-lock.json");
  });

  it("names the line count and the ceiling", () => {
    const decision = decisionFor({ ...passingInput(), changedLines: 301 });
    if (decision.outcome !== "hold") throw new Error("expected hold");
    const reason = decision.failures
      .filter((failure) => failure.condition === "changed_lines")
      .map((failure) => failure.reason)
      .join(" ");
    expect(reason).toContain("301");
    expect(reason).toContain(String(MERGE_POLICY.changedLineCeiling));
  });

  it("names the open blockers", () => {
    const decision = decisionFor({
      ...passingInput(),
      openBlockers: ["#12"],
    });
    if (decision.outcome !== "hold") throw new Error("expected hold");
    const reason = decision.failures
      .filter((failure) => failure.condition === "open_blockers")
      .map((failure) => failure.reason)
      .join(" ");
    expect(reason).toContain("#12");
  });

  it("says the activation switch is off, not something is wrong with the PR", () => {
    const decision = decisionFor({ ...passingInput(), autoMergeEnabled: false });
    if (decision.outcome !== "hold") throw new Error("expected hold");
    expect(decision.failures[0]?.reason).toMatch(/auto-merge is disabled/i);
  });
});
