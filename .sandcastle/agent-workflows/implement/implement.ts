import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { branchForIssue } from "./branch";
import { buildPromptArgs, renderPrompt, type IssueComment } from "./prompt";
import { fail, agentFromEnv, required, safeSh } from "../shared/common";
import { gh } from "../shared/cli";

const issueNumber = required("ISSUE_NUMBER");
const issueTitle = required("ISSUE_TITLE");
const sourceBranch = required("BRANCH");
const targetBranch = required("TARGET_BRANCH");

try {
  const expectedBranch = branchForIssue(Number(issueNumber), issueTitle);
  if (sourceBranch !== expectedBranch) {
    fail(
      `BRANCH is "${sourceBranch}" but the issue names "${expectedBranch}". Refusing to run on the wrong branch.`,
    );
  }

  const issue = JSON.parse(
    gh(["issue", "view", issueNumber, "--json", "body,comments"]),
  ) as {
    body?: string;
    comments?: { author?: { login?: string }; body?: string }[];
  };
  const comments: IssueComment[] = (issue.comments ?? []).map((comment) => ({
    author: comment.author?.login ?? "unknown",
    body: comment.body ?? "",
  }));
  const glossary = fs.readFileSync("GLOSSARY.md", "utf8");
  const template = fs.readFileSync(
    path.join(import.meta.dirname, "prompt.md"),
    "utf8",
  );

  const prompt = renderPrompt(
    template,
    buildPromptArgs({
      issueNumber: Number(issueNumber),
      issueTitle,
      issueBody: issue.body ?? "",
      issueComments: comments,
      glossary,
      sourceBranch,
      targetBranch,
    }),
  );

  const result = await sandcastle.run({
    name: `implement-#${issueNumber}`,
    // The ephemeral Actions runner is the isolation boundary: no-sandbox.
    sandbox: noSandbox(),
    agent: agentFromEnv(),
    logging: { type: "stdout" },
    // Rendered inline: Sandcastle delivers it verbatim, so issue content is
    // never scanned for placeholders.
    prompt,
  });

  console.log(
    `Iterations: ${result.iterations.length}; completion signal: ${result.completionSignal ?? "none"}.`,
  );

  const commitsAhead = Number(
    safeSh(`git rev-list --count ${targetBranch}..HEAD`).trim(),
  );
  if (!Number.isFinite(commitsAhead) || commitsAhead === 0) {
    fail("Agent finished but no commits were made on the branch.");
  }

  console.log(`Implementation produced ${commitsAhead} commit(s).`);
  console.log(`Commits this run: ${result.commits.length}.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
