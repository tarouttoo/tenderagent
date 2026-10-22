/**
 * Prompt assembly shared by the agent workflows.
 *
 * A prompt skeleton (`prompt.md`) is an English template with {{KEY}}
 * placeholders; domain content — issue text, PR diff, glossary, branch names —
 * is injected as arguments. The rendered prompt is passed to Sandcastle as an
 * inline prompt, which is delivered verbatim (ADR 0008 in the Sandcastle
 * repo): placeholders that happen to appear inside injected content are never
 * expanded.
 */

export interface IssueComment {
  /** Comment author login. */
  author: string;
  /** Comment body as Markdown. */
  body: string;
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
