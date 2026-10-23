/**
 * Guarded force-push of the agent branch (#18): the push never races
 * silently. The expected remote state is read with `git ls-remote` and pinned
 * with `--force-with-lease`, so a retry whose branch moved underneath it
 * fails loudly instead of clobbering newer commits, while a first push
 * (branch absent on the remote) is guarded by the empty expectation: the ref
 * must not exist. Failure handling lives in the CLI entry: every push failure
 * is recorded via fail() (shared/common.ts) so the blocked comment names the
 * actual cause instead of "failed without a recorded reason".
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fail, required } from "../shared/common";
import { TRIGGER_LABEL } from "../shared/failure";

/** The fully-qualified ref the workflow pushes to for the agent branch. */
export const remoteRef = (branch: string): string => `refs/heads/${branch}`;

/** A git object sha as printed by `git ls-remote` (SHA-1, or SHA-256 repos). */
const SHA_PATTERN = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

/**
 * The sha the remote names for `ref`, or null when the ref is absent —
 * `git ls-remote` prints `<sha>\t<ref>` lines and prints nothing for a ref
 * that does not exist remotely.
 */
export const parseLsRemote = (stdout: string, ref: string): string | null => {
  for (const line of stdout.split("\n")) {
    const [sha, lineRef] = line.trim().split(/\s+/);
    if (sha !== undefined && SHA_PATTERN.test(sha) && lineRef === ref) {
      return sha;
    }
  }
  return null;
};

/**
 * The push arguments pinning the observed remote state (#18): with the sha
 * observed by ls-remote, `--force-with-lease=<ref>:<sha>` rejects the push if
 * the branch moved since; for a first push the empty expectation means the
 * ref must not exist. The lease implies --force for that ref, so rewritten
 * agent-branch history still lands when the expectation holds.
 */
export const leaseArgs = (
  branch: string,
  remoteSha: string | null,
): string[] => [
  remoteSha === null
    ? `--force-with-lease=${remoteRef(branch)}:`
    : `--force-with-lease=${remoteRef(branch)}:${remoteSha}`,
];

/** The last output lines kept in a recorded failure reason. */
const outputTail = (output: string, maxChars = 400): string => {
  const trimmed = output.trim();
  return trimmed.length > maxChars
    ? `…${trimmed.slice(trimmed.length - maxChars)}`
    : trimmed;
};

/**
 * The recorded failure reason for a rejected push, classified by what git
 * actually said. Two shapes get an actionable reason instead of a raw output
 * dump: a lost lease race (the branch moved underneath this run — the #18
 * guard doing its job; the rejection surfaces as "stale info" over smart
 * HTTP, "incorrect old value provided" / "reference already exists" over the
 * local transport, and as a plain non-fast-forward in some client-side
 * orders) and a token refused workflow-file writes (the default
 * GITHUB_TOKEN can never push those; AGENT_PAT must carry the Workflows
 * permission). Anything else keeps the output excerpt — other server-side
 * refusals (branch protection, removed permissions) must not masquerade as
 * lease conflicts.
 */
export const classifyPushFailure = (output: string, branch: string): string => {
  if (output.includes("create or update workflow")) {
    return (
      "Push was refused because the push token may not create or update workflow files: " +
      "the default GITHUB_TOKEN can never do this, so issues touching .github/workflows/ need " +
      'the AGENT_PAT secret to carry the fine-grained "Workflows: Read and write" permission ' +
      "(classic PAT: the workflow scope). See the push-failure recipes in docs/agents/agent-pipeline.md."
    );
  }
  if (
    output.includes("(stale info)") ||
    output.includes("incorrect old value provided") ||
    output.includes("(non-fast-forward)") ||
    output.includes("(reference already exists)")
  ) {
    return (
      `Push of ${branch} was refused by --force-with-lease: origin/${branch} has commits this run never saw ` +
      "(a concurrent or earlier run pushed newer work). Inspect origin/" +
      `${branch}; if that newer work is disposable, delete the branch ` +
      `(git push origin --delete ${branch}) and re-add the ${TRIGGER_LABEL} label; ` +
      "otherwise salvage it manually."
    );
  }
  return `Push of ${branch} failed: ${outputTail(output)}`;
};

/** How the push ended up being guarded, for honest step logging. */
export type PushOutcome = "first-push" | "lease-guarded";

interface GitOutput {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Run git with piped output; never throws, failures come back as ok:false. */
const gitRun = (args: string[]): GitOutput => {
  try {
    const stdout = execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "" };
  } catch (error) {
    const e = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    return {
      ok: false,
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr:
        typeof e.stderr === "string" && e.stderr.length > 0
          ? e.stderr
          : typeof e.message === "string"
            ? e.message
            : String(error),
    };
  }
};

/**
 * Read the remote state and force-push the branch pinned to it. The lease is
 * enforced atomically by the server at push time, so the only race left is
 * the short window between ls-remote and the transfer — anything arriving in
 * it rejects the push loudly. Returns how the push was guarded.
 */
export const pushBranch = (branch: string): PushOutcome => {
  const remote = "origin";
  const ref = remoteRef(branch);
  const listed = gitRun(["ls-remote", remote, ref]);
  if (!listed.ok) {
    fail(
      `Could not read the remote state of ${ref} before the push: ${outputTail(listed.stderr || listed.stdout)}`,
    );
  }
  const remoteSha = parseLsRemote(listed.stdout, ref);

  const pushed = gitRun([
    "push",
    ...leaseArgs(branch, remoteSha),
    remote,
    branch,
  ]);
  if (!pushed.ok) {
    fail(
      classifyPushFailure(`${pushed.stdout}\n${pushed.stderr}`, branch),
    );
  }

  if (remoteSha === null) {
    console.log(
      `First push of ${ref}: the branch did not exist on ${remote}; created under an empty-expectation lease.`,
    );
    return "first-push";
  }
  console.log(
    `Pushed ${ref} to ${remote} under a lease pinned to the observed remote state (${remoteSha.slice(0, 12)}).`,
  );
  return "lease-guarded";
};

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  pushBranch(required("BRANCH"));
}
