/**
 * Prompt assembly for the implement workflow.
 *
 * The prompt skeleton (`prompt.md`) is an English template with {{KEY}}
 * placeholders; domain content — issue title, body, comments, glossary,
 * branch names — is injected as arguments. Placeholder substitution lives in
 * `shared/prompt.ts` and is reused by the review workflow; this module owns
 * the implement-specific argument map.
 */
import { type IssueComment, formatComments } from "../shared/prompt";

export { formatComments, renderPrompt, type IssueComment } from "../shared/prompt";

export interface PromptArgsInput {
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueComments: IssueComment[];
  /** Full text of the project glossary (GLOSSARY.md). */
  glossary: string;
  /** Branch the agent commits to — `agent/issue-<n>-<slug>`. */
  sourceBranch: string;
  /** Branch the draft PR targets — `main`. */
  targetBranch: string;
}

/** The {{KEY}} → value map injected into the prompt skeleton. */
export const buildPromptArgs = (
  input: PromptArgsInput,
): Record<string, string> => ({
  ISSUE_NUMBER: String(input.issueNumber),
  ISSUE_TITLE: input.issueTitle,
  ISSUE_BODY: input.issueBody,
  ISSUE_COMMENTS: formatComments(input.issueComments),
  GLOSSARY: input.glossary,
  SOURCE_BRANCH: input.sourceBranch,
  TARGET_BRANCH: input.targetBranch,
});
