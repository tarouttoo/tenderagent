/**
 * Prompt assembly for the review workflow.
 *
 * The prompt skeleton (`prompt.md`) is an English template with {{KEY}}
 * placeholders; domain content — PR title, body, diff, glossary, branch
 * names — is injected as arguments. Placeholder substitution lives in
 * `shared/prompt.ts` and is shared with the implement workflow; this module
 * owns the review-specific argument map.
 */

export interface ReviewPromptArgsInput {
  prNumber: number;
  prTitle: string;
  /** PR body; `null` for a PR opened without a body. */
  prBody: string | null;
  /** Unified diff of the PR (`gh pr diff` output). */
  prDiff: string;
  /** Branch the PR merges from. */
  sourceBranch: string;
  /** Branch the PR merges into. */
  targetBranch: string;
  /** Full text of the project glossary (GLOSSARY.md). */
  glossary: string;
}

/** The {{KEY}} → value map injected into the prompt skeleton. */
export const buildReviewPromptArgs = (
  input: ReviewPromptArgsInput,
): Record<string, string> => ({
  PR_NUMBER: String(input.prNumber),
  PR_TITLE: input.prTitle,
  PR_BODY: input.prBody ?? "",
  PR_DIFF: input.prDiff.trim().length > 0 ? input.prDiff : "(empty diff)",
  SOURCE_BRANCH: input.sourceBranch,
  TARGET_BRANCH: input.targetBranch,
  GLOSSARY: input.glossary,
});
