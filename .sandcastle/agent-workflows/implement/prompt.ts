/**
 * Prompt assembly for the implement workflow.
 *
 * The prompt skeleton (`prompt.md`) is an English template with {{KEY}}
 * placeholders; domain content — issue title, body, comments, glossary,
 * branch names — is injected as arguments. The rendered prompt is passed to
 * Sandcastle as an inline prompt, which is delivered verbatim (ADR 0008 in
 * the Sandcastle repo): placeholders that happen to appear inside issue
 * content are never expanded.
 */

export interface IssueComment {
  /** Comment author login. */
  author: string;
  /** Comment body as Markdown. */
  body: string;
}

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

/** Render the issue comments as a readable Markdown block. */
export const formatComments = (comments: IssueComment[]): string => {
  if (comments.length === 0) {
    return "(no comments)";
  }
  return comments
    .map((comment) => `### ${comment.author}\n\n${comment.body}`)
    .join("\n\n---\n\n");
};

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

const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

/**
 * Substitute {{KEY}} placeholders in the template. Fails fast on any
 * placeholder with no matching argument — a half-rendered prompt must never
 * reach the agent.
 */
export const renderPrompt = (
  template: string,
  args: Record<string, string>,
): string => {
  const missing = new Set<string>();
  const rendered = template.replace(PLACEHOLDER, (placeholder, key: string) => {
    const value = args[key];
    if (value === undefined) {
      missing.add(key);
      return placeholder;
    }
    return value;
  });
  if (missing.size > 0) {
    throw new Error(
      `Prompt arguments have no value for: ${[...missing].sort().join(", ")}`,
    );
  }
  return rendered;
};
