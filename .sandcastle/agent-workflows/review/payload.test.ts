import { describe, expect, it } from "vitest";
import {
  extractReviewPayload,
  formatReviewBody,
  reviewEventFor,
  reviewPayloadSchema,
  reviewPostPlan,
} from "./payload";

const payload = {
  verdict: "comment",
  summary: "Solid implementation; two small concerns.",
  findings: [
    {
      severity: "concern",
      file: ".sandcastle/agent-workflows/review/payload.ts",
      line: 42,
      note: "The fence regex also matches bare blocks; consider documenting that.",
    },
    { severity: "nit", note: "The verdict label map could be a const object." },
  ],
};

describe("reviewPayloadSchema", () => {
  it("accepts a well-formed payload", () => {
    expect(reviewPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("accepts an approve verdict with no findings", () => {
    expect(() =>
      reviewPayloadSchema.parse({
        verdict: "approve",
        summary: "Looks clean.",
        findings: [],
      }),
    ).not.toThrow();
  });

  it("rejects an unknown verdict", () => {
    expect(() =>
      reviewPayloadSchema.parse({ ...payload, verdict: "lgtm" }),
    ).toThrow();
  });

  it("rejects an unknown severity", () => {
    expect(() =>
      reviewPayloadSchema.parse({
        ...payload,
        findings: [{ severity: "huge", note: "…" }],
      }),
    ).toThrow();
  });

  it("rejects an empty summary", () => {
    expect(() => reviewPayloadSchema.parse({ ...payload, summary: "" })).toThrow();
  });

  it("rejects a non-positive line number", () => {
    expect(() =>
      reviewPayloadSchema.parse({
        ...payload,
        findings: [{ severity: "nit", line: 0, note: "…" }],
      }),
    ).toThrow();
  });
});

describe("extractReviewPayload", () => {
  it("extracts a json-fenced payload surrounded by prose", () => {
    const output = [
      "I reviewed the diff and checked the tests.",
      "",
      "```json",
      JSON.stringify(payload, null, 2),
      "```",
      "",
      "<promise>COMPLETE</promise>",
    ].join("\n");

    expect(extractReviewPayload(output)).toEqual({ ok: true, payload });
  });

  it("extracts a payload from bare (untagged) fences", () => {
    const output = ["```", JSON.stringify(payload), "```"].join("\n");

    expect(extractReviewPayload(output)).toEqual({ ok: true, payload });
  });

  it("extracts the payload when the agent omits the fence entirely", () => {
    const output = [
      "Here is my review:",
      JSON.stringify(payload),
      "<promise>COMPLETE</promise>",
    ].join("\n");

    expect(extractReviewPayload(output)).toEqual({ ok: true, payload });
  });

  it("skips fences that are not the payload and finds the real one", () => {
    const output = [
      "Diff stats:",
      "```text",
      " 3 files changed, 120 insertions(+)",
      "```",
      "",
      "```json",
      JSON.stringify(payload),
      "```",
    ].join("\n");

    expect(extractReviewPayload(output)).toEqual({ ok: true, payload });
  });

  it("tolerates extra unknown fields in the payload", () => {
    const output = `\`\`\`json\n${JSON.stringify({ ...payload, commit: "abc" })}\n\`\`\``;

    expect(extractReviewPayload(output)).toEqual({ ok: true, payload });
  });

  it("fails legibly when the output contains no payload", () => {
    const result = extractReviewPayload("I could not review the PR, sorry.");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no parseable review payload/i);
    }
  });

  it("fails legibly when the only json block violates the schema", () => {
    const output = '```json\n{"verdict": "ship it"}\n```';
    const result = extractReviewPayload(output);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/verdict/i);
    }
  });

  it("fails on empty output", () => {
    expect(extractReviewPayload("").ok).toBe(false);
  });
});

describe("reviewEventFor", () => {
  it("maps approve → the --approve flag", () => {
    expect(reviewEventFor("approve")).toBe("--approve");
  });

  it("maps request_changes → the --request-changes flag", () => {
    expect(reviewEventFor("request_changes")).toBe("--request-changes");
  });

  it("maps comment → the --comment flag", () => {
    expect(reviewEventFor("comment")).toBe("--comment");
  });
});

describe("reviewPostPlan", () => {
  it("posts a regular PR review honoring the verdict when allowed", () => {
    // The verdict is a gh CLI flag, not a positional argument — the bare word
    // form made `gh pr review` abort with "accepts at most 1 arg(s), received
    // 2" (found live by the #7 smoke test on PR #12).
    expect(reviewPostPlan("approve", false)).toEqual({
      command: "review",
      flag: "--approve",
    });
    expect(reviewPostPlan("request_changes", false)).toEqual({
      command: "review",
      flag: "--request-changes",
    });
    expect(reviewPostPlan("comment", false)).toEqual({
      command: "review",
      flag: "--comment",
    });
  });

  it("falls back to a PR comment when the reviewer is the PR author", () => {
    const plan = reviewPostPlan("request_changes", true);

    expect(plan).toMatchObject({ command: "comment" });
  });
});

describe("formatReviewBody", () => {
  it("renders the verdict, summary, and located findings", () => {
    const body = formatReviewBody({
      verdict: "request_changes",
      summary: "One blocker must be fixed.",
      findings: [
        {
          severity: "blocker",
          file: "src/main.ts",
          line: 7,
          note: "Unhandled promise rejection.",
        },
        { severity: "nit", note: "Typo in the doc comment." },
      ],
    });

    expect(body).toMatch(/request changes/i);
    expect(body).toContain("One blocker must be fixed.");
    expect(body).toContain("src/main.ts:7");
    expect(body).toContain("Unhandled promise rejection.");
    expect(body).toContain("Typo in the doc comment.");
  });

  it("states when there are no findings", () => {
    const body = formatReviewBody({
      verdict: "approve",
      summary: "Clean.",
      findings: [],
    });

    expect(body).toMatch(/no findings/i);
  });

  it("renders a finding without a file without dangling punctuation", () => {
    const body = formatReviewBody({
      verdict: "comment",
      summary: "s",
      findings: [{ severity: "nit", note: "Consider renaming." }],
    });

    expect(body).toContain("- ⚪ nit — Consider renaming.");
  });
});
