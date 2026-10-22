/**
 * Branch naming for the implement workflow: work lands on an isolated branch
 * named after the issue — `agent/issue-<n>-<slug>`.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { required } from "../shared/common";

/** Maximum length of the title slug in the branch name. */
export const MAX_SLUG_LENGTH = 50;

/**
 * Reduce an issue title to a branch-safe slug: lowercase, runs of
 * non-alphanumeric characters collapsed to single dashes, trimmed.
 * Characters outside a-z0-9 (including Cyrillic and other scripts) are
 * treated as separators.
 */
export const slugify = (title: string): string => {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
};

/**
 * The isolated branch for an issue's implementation work:
 * `agent/issue-<n>-<slug>`, or `agent/issue-<n>` when the title slugs to
 * nothing.
 */
export const branchForIssue = (issueNumber: number, title: string): string => {
  const slug = slugify(title);
  return slug.length > 0
    ? `agent/issue-${issueNumber}-${slug}`
    : `agent/issue-${issueNumber}`;
};

/**
 * CLI entry: prints the branch name for the workflow's compute-branch step.
 * Reads ISSUE_NUMBER and ISSUE_TITLE from the environment.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const issueNumber = Number(required("ISSUE_NUMBER"));
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    console.error("ISSUE_NUMBER must be a positive integer");
    process.exit(1);
  }
  const issueTitle = required("ISSUE_TITLE");
  process.stdout.write(`${branchForIssue(issueNumber, issueTitle)}\n`);
}
