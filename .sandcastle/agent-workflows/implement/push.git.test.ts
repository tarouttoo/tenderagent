/**
 * Integration tests for the guarded push (#18): exercise the CLI entry the
 * workflow actually runs (`tsx push.ts` with BRANCH in the environment)
 * against a real bare-git origin in a temp directory. No network: the origin
 * is a local path remote.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./push.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url));

interface Fixture {
  /** The pushing clone (what the workflow's workspace is). */
  work: string;
  /** The bare origin (path remote). */
  origin: string;
  /** Where fail() records failure_reason.txt. */
  outputDir: string;
}

/** Run a git command in a fixture repo; any failure fails the test. */
const git = (args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string => {
  const result = spawnSync("git", args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.status}) in ${cwd}:\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
};

const makeFixture = (): Fixture => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "push-guard-"));
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  const outputDir = path.join(root, "out");
  fs.mkdirSync(outputDir);
  fs.mkdirSync(work);
  git(["init", "--bare", "--initial-branch=main", origin], root);
  git(["clone", "--quiet", origin, work], root);
  git(["config", "user.email", "test@example.com"], work);
  git(["config", "user.name", "Test"], work);
  git(["checkout", "--quiet", "-b", "agent/x"], work);
  git(["commit", "--quiet", "--allow-empty", "-m", "base"], work);
  return { work, origin, outputDir };
};

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

const runPush = (fixture: Fixture, env: NodeJS.ProcessEnv = {}): RunResult => {
  const result: SpawnSyncReturns<Buffer> = spawnSync(
    process.execPath,
    [TSX, SCRIPT],
    {
      cwd: fixture.work,
      env: {
        ...process.env,
        BRANCH: "agent/x",
        OUTPUT_DIR: fixture.outputDir,
        ...env,
      },
      encoding: "buffer",
      timeout: 30_000,
    },
  );
  if (result.error) {
    console.error("runPush error:", result.error, "signal:", result.signal);
  }
  if (process.env.DEBUG_PUSH_TEST) {
    console.error(
      `[runPush] status=${result.status} signal=${result.signal}\nstdout: ${result.stdout.toString()}\nstderr: ${result.stderr.toString()}\nreason: ${(() => {
        try {
          return fs.readFileSync(path.join(fixture.outputDir, "failure_reason.txt"), "utf8");
        } catch {
          return "(none)";
        }
      })()}\nhooklog: ${(() => {
        try {
          return fs.readFileSync(path.join(path.dirname(fixture.origin), "hooklog"), "utf8");
        } catch {
          return "(none)";
        }
      })()}`,
    );
  }
  return {
    status: result.status ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

const remoteBranchSha = (fixture: Fixture, branch = "agent/x"): string | null => {
  const out = git(["ls-remote", fixture.origin, `refs/heads/${branch}`], fixture.work);
  return out.length > 0 ? out.split(/\s+/)[0] ?? null : null;
};

/**
 * Install a pre-push hook that moves the remote branch to `raceSha` mid-push
 * — the deterministic stand-in for a concurrent writer landing in the window
 * between the script's ls-remote and the transfer. The sha must be one the
 * script cannot observe via its ls-remote (push it to a side ref first);
 * `--git-dir` is explicit because hooks inherit GIT_DIR pointing at the
 * pushing clone.
 */
const installRacer = (fixture: Fixture, raceSha: string): NodeJS.ProcessEnv => {
  const hooks = path.join(fixture.work, ".git", "hooks");
  fs.mkdirSync(hooks, { recursive: true });
  const hook = path.join(hooks, "pre-push");
  const log = path.join(path.dirname(fixture.origin), "hooklog");
  fs.writeFileSync(
    hook,
    `#!/bin/sh
{
  echo "HOOK RACE_ORIGIN=$RACE_ORIGIN RACE_SHA=$RACE_SHA"
  git --git-dir="$RACE_ORIGIN" update-ref refs/heads/agent/x "$RACE_SHA" 2>&1
  echo "HOOK rc=$?"
} >> "\$RACE_LOG" 2>&1
`,
  );
  fs.chmodSync(hook, 0o755);
  return { RACE_ORIGIN: fixture.origin, RACE_SHA: raceSha, RACE_LOG: log };
};

describe("push branch (integration)", () => {
  it("succeeds on a first push: the branch is absent on the remote", () => {
    const fixture = makeFixture();

    const result = runPush(fixture);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/first push/i);
    expect(remoteBranchSha(fixture)).toBe(
      git(["rev-parse", "HEAD"], fixture.work),
    );
  }, 30_000);

  it("re-pushes new commits over the branch's own remote state", () => {
    const fixture = makeFixture();
    runPush(fixture);
    git(["commit", "--quiet", "--allow-empty", "-m", "next"], fixture.work);

    const result = runPush(fixture);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/lease pinned/i);
    expect(remoteBranchSha(fixture)).toBe(
      git(["rev-parse", "HEAD"], fixture.work),
    );
  }, 30_000);

  it("force-lands rewritten history over the branch's own older remote state", () => {
    const fixture = makeFixture();
    runPush(fixture);
    git(["commit", "--quiet", "--allow-empty", "--amend", "-m", "rewritten"], fixture.work);

    const result = runPush(fixture);

    expect(result.status).toBe(0);
    expect(remoteBranchSha(fixture)).toBe(
      git(["rev-parse", "HEAD"], fixture.work),
    );
  }, 30_000);

  it("fails loudly when the branch moves between ls-remote and the transfer", () => {
    const fixture = makeFixture();
    runPush(fixture);
    // The concurrent writer: its first commit lands openly (the script will
    // pin it); its second hides on a side ref so the script's ls-remote
    // cannot see it, and the pre-push hook swaps it in mid-push.
    const other = path.join(path.dirname(fixture.work), "other");
    fs.mkdirSync(other);
    git(["clone", "--quiet", fixture.origin, other], path.dirname(fixture.work));
    git(["config", "user.email", "test@example.com"], other);
    git(["config", "user.name", "Test"], other);
    // The clone's HEAD is unborn (the bare origin's HEAD points at a
    // nonexistent main); build on the actual remote branch.
    git(["checkout", "--quiet", "-B", "agent/x", "origin/agent/x"], other);
    git(["commit", "--quiet", "--allow-empty", "-m", "concurrent-open"], other);
    git(["push", "--quiet", "origin", "HEAD:refs/heads/agent/x"], other);
    git(["commit", "--quiet", "--allow-empty", "-m", "concurrent-hidden"], other);
    git(["push", "--quiet", "origin", "HEAD:refs/heads/hidden"], other);
    const hiddenSha = git(
      ["ls-remote", fixture.origin, "refs/heads/hidden"],
      other,
    ).split(/\s+/)[0];
    expect(hiddenSha).toBeTruthy();
    // This run rewrote its own history against the state it will observe.
    git(["commit", "--quiet", "--allow-empty", "--amend", "-m", "rewritten"], fixture.work);
    const racerEnv = installRacer(fixture, hiddenSha);

    const result = runPush(fixture, racerEnv);

    expect(result.status).not.toBe(0);
    const reason = fs.readFileSync(
      path.join(fixture.outputDir, "failure_reason.txt"),
      "utf8",
    );
    expect(reason).toMatch(/--force-with-lease/);
    expect(reason).toMatch(/agent:implement/);
    // The newer remote work survived the refused push.
    expect(remoteBranchSha(fixture)).toBe(hiddenSha);
  }, 30_000);

  it("fails loudly when a first push collides with a concurrently created branch", () => {
    const fixture = makeFixture();
    runPush(fixture);
    // The racer commit hides on a side ref; the branch itself disappears, so
    // the script sees an absent ref and pushes under an empty expectation —
    // then the hook brings the branch back mid-push.
    const other = path.join(path.dirname(fixture.work), "other");
    fs.mkdirSync(other);
    git(["clone", "--quiet", fixture.origin, other], path.dirname(fixture.work));
    git(["config", "user.email", "test@example.com"], other);
    git(["config", "user.name", "Test"], other);
    // See the sibling test: the clone's HEAD is unborn.
    git(["checkout", "--quiet", "-B", "agent/x", "origin/agent/x"], other);
    git(["commit", "--quiet", "--allow-empty", "-m", "concurrent-hidden"], other);
    git(["push", "--quiet", "origin", "HEAD:refs/heads/hidden"], other);
    const hiddenSha = git(
      ["ls-remote", fixture.origin, "refs/heads/hidden"],
      other,
    ).split(/\s+/)[0];
    expect(hiddenSha).toBeTruthy();
    git(["push", "--quiet", "origin", "--delete", "agent/x"], fixture.work);
    const racerEnv = installRacer(fixture, hiddenSha);

    const result = runPush(fixture, racerEnv);

    expect(result.status).not.toBe(0);
    const reason = fs.readFileSync(
      path.join(fixture.outputDir, "failure_reason.txt"),
      "utf8",
    );
    expect(reason).toMatch(/--force-with-lease/);
  }, 30_000);
});
