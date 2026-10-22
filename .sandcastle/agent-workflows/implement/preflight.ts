/**
 * Preflight gates for the implement workflow: refuse work the AFK agent
 * should not take before a single iteration is spent. Decision logic is pure
 * and unit-tested; the CLI entry at the bottom gathers the evidence via `gh`.
 *
 * Gates (issue #4, carried over from the Sandcastle reference workflows):
 *  1. Sub-issues are refused — only leaf issues are implemented.
 *  2. PRD-shaped issues are refused — product specs need human decomposition.
 *  3. An open collaborator PR already closing the issue is refused — the work
 *     is in flight; a second agent would duplicate it.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fail, gh, required } from "../shared/common";

export type OpenPullRequest = {
  number: number;
  title: string;
  body: string;
  url: string;
  /** GitHub author association: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, … */
  authorAssociation: string;
};

export type PreflightInput = {
  issueNumber: number;
  body: string;
  subIssueCount: number;
  openPullRequests: OpenPullRequest[];
};

export type PreflightVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Author associations that count as collaborators (the maintainer's own
 * circles). External drive-by PRs must not block the agent.
 */
const COLLABORATOR_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** GitHub's closing keywords, per docs/basics/writing-issues reference. */
const CLOSING_KEYWORD =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

/**
 * Legacy sub-issue marker from the issue-tracker conventions ("put `Part of
 * #<parent>` at the top of the child body"), matched at line start only.
 */
const PART_OF_MARKER = /^part of #\d+/im;

/** PRD section headings — a body carrying them is a product spec, not a task. */
const PRD_HEADING = /^#{1,6}\s*(?:user stories|problem statement)\s*$/im;

/**
 * A user-story sentence: "As a maintainer, I want …". Three or more mark the
 * issue as an undecomposed product spec even without PRD headings.
 */
const USER_STORY =
  /\bas an?\b[^.!\n]{0,160}?\bi\s*(?:want|need|would like|'d like)\b/gi;

const countMatches = (pattern: RegExp, text: string): number => {
  return [...text.matchAll(pattern)].length;
};

export const isSubIssue = (subIssueCount: number, body: string): boolean =>
  subIssueCount > 0 || PART_OF_MARKER.test(body);

export const isPrdShaped = (body: string): boolean => {
  return PRD_HEADING.test(body) || countMatches(USER_STORY, body) >= 3;
};

/**
 * The open collaborator PR that already closes the issue, if any: a PR is
 * blocking when authored from a collaborator association and its title or
 * body closes this issue with a GitHub closing keyword.
 */
export const findBlockingPullRequest = (
  issueNumber: number,
  openPullRequests: OpenPullRequest[],
): OpenPullRequest | undefined => {
  return openPullRequests.find((pr) => {
    const association = pr.authorAssociation.trim().toUpperCase();
    if (!COLLABORATOR_ASSOCIATIONS.has(association)) return false;
    const text = `${pr.title}\n${pr.body}`;
    return [...text.matchAll(CLOSING_KEYWORD)].some(
      (match) => Number(match[1]) === issueNumber,
    );
  });
};

/**
 * Run every gate and collect all refusal reasons in one pass, so a retry
 * after relabeling never plays whack-a-mole.
 */
export const runPreflight = (input: PreflightInput): PreflightVerdict => {
  const { issueNumber, body, subIssueCount, openPullRequests } = input;
  const reasons: string[] = [];

  if (isSubIssue(subIssueCount, body)) {
    reasons.push(
      `Issue #${issueNumber} has sub-issues; only leaf issues are implemented. Implement the leaf tasks instead.`,
    );
  }

  if (isPrdShaped(body)) {
    reasons.push(
      `Issue #${issueNumber} is PRD-shaped (problem statement, user stories, or 3+ user stories); product specs need human decomposition into leaf issues first.`,
    );
  }

  const blocking = findBlockingPullRequest(issueNumber, openPullRequests);
  if (blocking) {
    reasons.push(
      `Open pull request #${blocking.number} already closes issue #${issueNumber}: ${blocking.title} (${blocking.url}). Refusing to duplicate in-flight work.`,
    );
  }

  if (reasons.length === 0) return { ok: true };
  return { ok: false, reason: reasons.join("\n") };
};

/**
 * CLI entry: gathers the gate evidence via `gh` and fails loudly but legibly
 * (the failure-handling step turns the reason into a blocked-issue comment).
 * Reads ISSUE_NUMBER from the environment; GH_REPO/GH_TOKEN scope the calls.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const issueNumber = Number(required("ISSUE_NUMBER"));

  try {
    const issue = JSON.parse(
      gh(["issue", "view", String(issueNumber), "--json", "body"]),
    ) as { body?: string | null };
    const body = issue.body ?? "";

    // Native sub-issues (REST). A count beyond the first page still exceeds
    // zero, so pagination cannot flip a refusal into a pass.
    const subIssueCount = Number(
      gh([
        "api",
        `repos/${required("GH_REPO")}/issues/${issueNumber}/sub_issues`,
        "--jq",
        "length",
      ]).trim(),
    );

    // REST pulls list: one line of JSON per open PR (gh pr list does not
    // expose author_association; the REST field is exactly the enum the
    // decision logic expects).
    const openPullRequests = gh([
      "api",
      "--paginate",
      `repos/${required("GH_REPO")}/pulls?state=open&per_page=100`,
      "--jq",
      ".[] | {number: .number, title: .title, body: .body, url: .html_url, authorAssociation: .author_association} | tostring",
    ])
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map(
        (line) =>
          JSON.parse(line) as {
            number: number;
            title: string;
            body: string | null;
            url: string;
            authorAssociation: string;
          },
      );

    const verdict = runPreflight({
      issueNumber,
      body,
      subIssueCount: Number.isFinite(subIssueCount) ? subIssueCount : 0,
      openPullRequests: openPullRequests.map((pr) => ({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        url: pr.url,
        authorAssociation: pr.authorAssociation,
      })),
    });

    if (!verdict.ok) {
      fail(`Preflight refused the run.\n${verdict.reason}`);
    }
  } catch (error) {
    fail(
      `Preflight could not gather its evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  console.log(
    "Preflight passed: leaf issue, not PRD-shaped, no in-flight PR.",
  );
}
