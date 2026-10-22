/**
 * CLI entry for the review workflow's posting step: reads the extracted
 * review payload, renders the review body, and posts it as a regular PR
 * review honoring the verdict (`gh pr review --approve` / `--request-changes`
 * / `--comment`). GitHub refuses a review by the PR author — and the agent
 * runs on the same token that opened the PR — so that case posts the findings
 * as a PR comment on the same review surface instead.
 *
 * Reads PR_NUMBER from the environment; the payload comes from
 * `review-payload.json` in OUTPUT_DIR (written by the agent-run step).
 * Marking the PR ready is the workflow's next step, not this script's.
 */
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import {
  fail,
  gh,
  outputDir,
  required,
} from "../shared/common";
import {
  formatReviewBody,
  reviewPayloadSchema,
  reviewPostPlan,
} from "./payload";

const prNumber = required("PR_NUMBER");

/**
 * gh under FALLBACK_GH_TOKEN when the workflow supplies one. The findings
 * must land even when the review identity cannot write (a fine-grained
 * REVIEW_PAT scoped without PR write gets "Resource not accessible" — found
 * live by the #7 smoke test); the workflow token's write access is
 * guaranteed by the job's permissions block.
 */
const ghFallback = (args: string[]): string => {
  const override = process.env.FALLBACK_GH_TOKEN;
  if (!override) return gh(args);
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GH_TOKEN: override },
  });
};

try {
  const payloadPath = path.join(outputDir(), "review-payload.json");
  const parsed = reviewPayloadSchema.safeParse(
    JSON.parse(fs.readFileSync(payloadPath, "utf8")),
  );
  if (!parsed.success) {
    fail(
      `The extracted review payload at ${payloadPath} is not a valid review payload: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const review = parsed.data;

  // Self-review detection: GitHub refuses a review whose author is the PR
  // author, and the token that runs this workflow opened the PR.
  const prAuthor = gh([
    "pr",
    "view",
    prNumber,
    "--json",
    "author",
    "--jq",
    ".author.login",
  ]).trim();
  const tokenLogin = gh(["api", "user", "--jq", ".login"]).trim();
  const selfReview = prAuthor.length > 0 && prAuthor === tokenLogin;

  const plan = reviewPostPlan(review.verdict, selfReview);
  const bodyFile = path.join(outputDir(), "review-body-post.md");
  fs.writeFileSync(bodyFile, formatReviewBody(review));

  if (plan.command === "review") {
    try {
      gh(["pr", "review", prNumber, plan.flag, "--body-file", bodyFile]);
      console.log(`Posted a "${plan.flag}" PR review on PR #${prNumber}.`);
      process.exit(0);
    } catch (error) {
      // Defensive: even with the author check above, GitHub can refuse the
      // review; the findings must still land on the PR.
      console.error(
        `gh pr review ${prNumber} ${plan.flag} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    console.log(`Comment fallback: ${plan.reason}`);
  }

  ghFallback(["pr", "comment", prNumber, "--body-file", bodyFile]);
  console.log(`Posted the review findings as a PR comment on PR #${prNumber}.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
