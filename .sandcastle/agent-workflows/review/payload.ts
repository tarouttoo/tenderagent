/**
 * The review workflow's structured payload: the schema the review agent must
 * emit, the extraction that recovers it from the agent's output, the verdict
 * → review-event mapping, the posting plan (regular PR review vs. comment
 * fallback), and the rendered review body. Everything here is pure and
 * unit-tested — no network, no git, no live LLM.
 */
import { z } from "zod";

/** How severe a single finding is, in the agent's vocabulary. */
export const REVIEW_SEVERITIES = ["blocker", "concern", "nit"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

/** The review agent's overall call. */
export const REVIEW_VERDICTS = ["approve", "comment", "request_changes"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const reviewFindingSchema = z.object({
  severity: z.enum(REVIEW_SEVERITIES),
  /** Repo-relative path the finding is about, when there is one. */
  file: z.string().min(1).optional(),
  /** 1-based line in `file` the finding is about. */
  line: z.number().int().positive().optional(),
  note: z.string().min(1),
});

export const reviewPayloadSchema = z.object({
  verdict: z.enum(REVIEW_VERDICTS),
  summary: z.string().min(1),
  findings: z.array(reviewFindingSchema),
});

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ReviewPayload = z.infer<typeof reviewPayloadSchema>;

/**
 * One fenced code block's body, tagged or bare, with its language tag.
 * `json`-tagged blocks are collected separately so they are tried first.
 */
const FENCED_BLOCK = /```([A-Za-z0-9_-]*)[^\S\n]*\n([\s\S]*?)```/g;

const tryParse = (
  text: string,
): { payload: ReviewPayload } | { error: string } => {
  try {
    return {
      payload: reviewPayloadSchema.parse(JSON.parse(text)),
    };
  } catch (error) {
    let detail = String(error);
    if (error instanceof z.ZodError) {
      detail = error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
    }
    return { error: detail };
  }
};

/**
 * Recover the review payload from the agent's output. Strategies, in order:
 * the first `json`-tagged fenced block that parses, then any bare fenced
 * block, then the outermost `{…}` span of the raw output (a payload printed
 * without any fence). Returns a legible reason when nothing valid is found,
 * so a failed run explains itself in the blocked comment.
 */
export const extractReviewPayload = (
  output: string,
): { ok: true; payload: ReviewPayload } | { ok: false; reason: string } => {
  const jsonTagged: string[] = [];
  const bare: string[] = [];
  for (const match of output.matchAll(FENCED_BLOCK)) {
    const body = match[2] ?? "";
    if ((match[1] ?? "").toLowerCase() === "json") {
      jsonTagged.push(body);
    } else {
      bare.push(body);
    }
  }

  const candidates = [
    ...jsonTagged.map((body) => ({ body: body.trim(), fenced: true })),
    ...bare.map((body) => ({ body: body.trim(), fenced: true })),
  ];

  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start !== -1 && end > start) {
    candidates.push({ body: output.slice(start, end + 1), fenced: false });
  }

  let lastError: string | undefined;
  for (const candidate of candidates) {
    const parsed = tryParse(candidate.body);
    if ("payload" in parsed) return { ok: true, payload: parsed.payload };
    lastError = parsed.error;
  }

  const detail =
    lastError !== undefined
      ? ` The best candidate failed validation: ${lastError}.`
      : "";
  return {
    ok: false,
    reason: `The review agent's output contained no parseable review payload (expected one \`\`\`json fenced block with verdict, summary, and findings).${detail}`,
  };
};

/**
 * The `gh pr review` event a verdict maps to. `request_changes` is the
 * agent's snake_case spelling; GitHub's flag spells it `--request-changes`.
 */
export const reviewEventFor = (verdict: ReviewVerdict): string => {
  switch (verdict) {
    case "approve":
      return "approve";
    case "request_changes":
      return "request-changes";
    case "comment":
      return "comment";
  }
};

/**
 * How to deliver the review: a regular PR review honoring the verdict, or a
 * PR comment. GitHub refuses a review authored by the PR author — and the
 * review agent runs on the same token that opened the PR — so the self-review
 * case falls back to a comment on the same review surface.
 */
export const reviewPostPlan = (
  verdict: ReviewVerdict,
  selfReview: boolean,
): { command: "review"; flag: string } | { command: "comment"; reason: string } => {
  if (selfReview) {
    return {
      command: "comment",
      reason:
        "The token's identity authored this PR, and GitHub refuses a review by its author; posting the findings as a PR comment instead.",
    };
  }
  return { command: "review", flag: reviewEventFor(verdict) };
};

const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approve: "✅ Approve",
  comment: "💬 Comment",
  request_changes: "🛑 Request changes",
};

const SEVERITY_LABEL: Record<ReviewSeverity, string> = {
  blocker: "🔴 blocker",
  concern: "🟡 concern",
  nit: "⚪ nit",
};

const findingLocation = (finding: ReviewFinding): string => {
  if (finding.file === undefined) return "";
  return finding.line === undefined
    ? ` — \`${finding.file}\``
    : ` — \`${finding.file}:${finding.line}\``;
};

/** Render the payload as the PR review/comment body (Markdown). */
export const formatReviewBody = (payload: ReviewPayload): string => {
  const findingLines = payload.findings.map(
    (finding) =>
      `- ${SEVERITY_LABEL[finding.severity]}${findingLocation(finding)} — ${finding.note}`,
  );

  return [
    `## 🤖 Agent review — ${VERDICT_LABEL[payload.verdict]}`,
    "",
    payload.summary,
    "",
    ...(payload.findings.length === 0
      ? ["No findings — the change looks clean."]
      : ["### Findings", "", ...findingLines]),
    "",
    "_Posted by the agent review workflow._",
  ].join("\n");
};
