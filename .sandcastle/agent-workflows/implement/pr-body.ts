/**
 * PR body resolution for the implement workflow (issue #26): the AFK agent
 * drafts the body per the `pr` skill template (inlined in prompt.md) into
 * `$OUTPUT_DIR/pr-body.md` before emitting the completion signal, and the
 * workflow's Open draft PR step passes the resolved file to
 * `gh pr create --body-file`. Resolution is a soft gate: a missing (or
 * empty) draft falls back to the canned stub the workflow used to hardcode,
 * so style never lands in `agent:blocked` — while the canned stub keeps the
 * `Closes #<n>` first line, so merging still closes the issue.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { outputDir, required } from "../shared/common";

/**
 * Filename the implement prompt tells the agent to write its draft body to,
 * inside the directory exposed as `OUTPUT_DIR` (= `RUNNER_TEMP`).
 */
export const PR_BODY_FILE = "pr-body.md";

/**
 * Filename the resolver writes the resolved body to; the workflow passes
 * this path to `gh pr create --body-file`.
 */
export const RESOLVED_PR_BODY_FILE = "resolved-pr-body.md";

/**
 * The body a draft PR gets when the agent wrote no `pr-body.md` — the
 * canned two-liner the Open draft PR step hardcoded before issue #26,
 * closing keyword first.
 */
export const cannedBody = (issueNumber: number): string =>
  `Closes #${issueNumber}\n\nImplemented by the agent implement workflow.\n`;

/**
 * The body the draft PR gets: the agent's `pr-body.md` draft when present
 * and non-empty, the canned stub otherwise. Never throws — a missing draft
 * is a fallback, not a failure.
 */
export const resolvePrBody = (
  issueNumber: number,
  dir: string = outputDir(),
): string => {
  try {
    const draft = fs.readFileSync(path.join(dir, PR_BODY_FILE), "utf8");
    if (draft.trim().length > 0) {
      return draft;
    }
  } catch {
    // Absent or unreadable draft — soft gate, fall through to the stub.
  }
  return cannedBody(issueNumber);
};

/**
 * CLI entry: writes the resolved body to `$OUTPUT_DIR/resolved-pr-body.md`
 * and prints that path for the workflow's `body_file=$(...)` capture. Reads
 * ISSUE_NUMBER from the environment.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const issueNumber = Number(required("ISSUE_NUMBER"));
  const body = resolvePrBody(issueNumber);
  const resolvedPath = path.join(outputDir(), RESOLVED_PR_BODY_FILE);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, body);
  process.stdout.write(`${resolvedPath}\n`);
}
