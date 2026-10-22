/**
 * CLI entry for the review workflow's agent run: gathers the PR evidence via
 * `gh`, renders the review prompt, runs the review agent, extracts the
 * structured payload from the agent's output, and persists it (plus the
 * rendered review body) for the posting step. Fails loudly but legibly via
 * `fail()` — the failure-handling step turns the reason into a blocked-PR
 * comment with the run link.
 *
 * Reads PR_NUMBER from the environment; GH_REPO/GH_TOKEN scope the calls;
 * OUTPUT_DIR receives review-payload.json.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { fail, agentFromEnv, gh, outputDir, required, safeSh } from "../shared/common";
import { REVIEW_TRIGGER_LABEL } from "../shared/failure";
import { renderPrompt } from "../shared/prompt";
import { buildReviewPromptArgs } from "./prompt";
import { extractReviewPayload, formatReviewBody } from "./payload";

const prNumber = required("PR_NUMBER");

try {
  const pr = JSON.parse(
    gh([
      "pr",
      "view",
      prNumber,
      "--json",
      "number,title,body,headRefName,baseRefName,state",
    ]),
  ) as {
    number: number;
    title: string;
    body: string | null;
    headRefName: string;
    baseRefName: string;
    state: string;
  };

  // Closed and merged PRs cannot be reviewed; skipping is a no-op with a
  // reason, not a failure (the trigger label is consumed so the PR does not
  // sit in the pipeline forever, and no blocked noise is posted).
  if (pr.state !== "OPEN") {
    safeSh(
      `gh pr edit ${prNumber} --remove-label ${JSON.stringify(REVIEW_TRIGGER_LABEL)}`,
    );
    console.log(
      `PR #${prNumber} is ${pr.state}; skipping the review (only open PRs are reviewed).`,
    );
    process.exit(0);
  }

  const diff = gh(["pr", "diff", prNumber]);
  const glossary = fs.readFileSync("GLOSSARY.md", "utf8");
  const template = fs.readFileSync(
    path.join(import.meta.dirname, "prompt.md"),
    "utf8",
  );

  const prompt = renderPrompt(
    template,
    buildReviewPromptArgs({
      prNumber: pr.number,
      prTitle: pr.title,
      prBody: pr.body,
      prDiff: diff,
      sourceBranch: pr.headRefName,
      // The PR's actual base, not a config var: the review is grounded in
      // where this PR really merges.
      targetBranch: pr.baseRefName,
      glossary,
    }),
  );

  const result = await sandcastle.run({
    name: `review-#${prNumber}`,
    // The ephemeral Actions runner is the isolation boundary: no-sandbox.
    sandbox: noSandbox(),
    agent: agentFromEnv(),
    logging: { type: "stdout" },
    // Rendered inline: Sandcastle delivers it verbatim, so PR/diff content is
    // never scanned for placeholders.
    prompt,
  });

  console.log(
    `Iterations: ${result.iterations.length}; completion signal: ${result.completionSignal ?? "none"}.`,
  );

  const extracted = extractReviewPayload(result.stdout);
  if (!extracted.ok) {
    fail(extracted.reason);
  }
  const review = extracted.payload;

  const dir = outputDir();
  fs.writeFileSync(
    path.join(dir, "review-payload.json"),
    JSON.stringify(review, null, 2),
  );
  fs.writeFileSync(path.join(dir, "review-body.md"), formatReviewBody(review));

  console.log(
    `Review payload extracted: verdict=${review.verdict}, findings=${review.findings.length}. Written to ${dir}.`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
