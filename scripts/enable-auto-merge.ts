/**
 * The enablement wizard (spec #36, leaf #41): an interactive script for the
 * steps only a human can take, so enabling auto-merge stops being a
 * re-explained settings hunt. It walks the maintainer through
 *
 *   1. enabling repo auto-merge in the GitHub settings — the merge gate's
 *      activation switch and kill switch (its dormancy holds every eligible
 *      PR until the flip);
 *   2. optionally, branch protection with the CI check required (the gate
 *      verifies CI itself; protection only makes GitHub enforce it
 *      server-side, so this branch is optional and defaults to skipped);
 *   3. verifying the bot token scopes the pipeline relies on — Workflows
 *      read/write (workflow-file pushes) and Pull requests write (PR
 *      labels) on `AGENT_PAT`; PR write on the optional `REVIEW_PAT` —
 *      naming any gap and its fix.
 *
 * Every step verifies the captured state via the API before moving on, so a
 * re-run on a fully enabled repo completes without changes (idempotent).
 * The wizard guides and verifies only — it never performs a settings write.
 * The enablement is the one step automation never takes: flipping the
 * setting is the human-only trust act (ADR 0001), and nothing in this
 * script is a step an agent could do itself.
 *
 * Usage:
 *
 *   npx tsx scripts/enable-auto-merge.ts [options]
 *
 * Options:
 *   --repo owner/name   the repository (defaults to GITHUB_REPOSITORY, then
 *                       the current clone's origin)
 *   --agent-pat <tok>   the AGENT_PAT token to check (or set AGENT_PAT);
 *                       prompted for when interactive and absent
 *   --review-pat <tok>  the REVIEW_PAT token to check (or set REVIEW_PAT);
 *                       optional — checked when provided
 *   --timeout <secs>    how long each settings wait accepts (default 300)
 *   --no-open           do not try to open the browser; just print URLs
 *
 * Requires `gh` authenticated as someone with admin on the repo (branch
 * protection is admin-readable). Exit code 0 only when every required check
 * verified; exit code 2 on usage/setup problems (repo unresolvable, gh
 * unreadable) — the wizard never got to the checks.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { env, exit, stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";

/**
 * The required check the wizard (and the merge gate, `merge-gate.ts`) look
 * for: a required status check under any other name is not the one the gate
 * verifies.
 */
export const CI_CHECK_NAME = "CI";

/** Where classic PAT scopes are edited (the classic-token fix URL). */
export const TOKEN_SETTINGS_URL = "https://github.com/settings/tokens";

/** Where fine-grained PAT toggles are confirmed (the fine-grained fix URL). */
export const FINE_GRAINED_TOKENS_URL =
  "https://github.com/settings/personal-access-tokens";

/** The repo settings page hosting the "Allow auto-merge" checkbox. */
export const repoSettingsUrl = (repo: string): string =>
  `https://github.com/${repo}/settings`;

/** The branch-protection rules page (the optional CI-check branch). */
export const branchProtectionUrl = (repo: string): string =>
  `https://github.com/${repo}/settings/branches`;

/**
 * The captured state of one step: what the API reported, and — when not ok
 * — exactly what to flip and where (gaps-and-fixes, legibly).
 */
export interface CheckResult {
  ok: boolean;
  detail: string;
  fix?: string;
}

const ok = (detail: string): CheckResult => ({ ok: true, detail });

const bad = (detail: string, fix: string): CheckResult => ({
  ok: false,
  detail,
  fix,
});

/**
 * Step 1's verdict: repo auto-merge on the repo object (`GET /repos/{repo}`).
 * Anything but the API's own `allow_auto_merge: true` fails — the wizard
 * never assumes.
 */
export const autoMergeVerdict = (repoJson: string): CheckResult => {
  let repo: { allow_auto_merge?: unknown };
  try {
    repo = JSON.parse(repoJson);
  } catch {
    return bad(
      "the repo API response was not valid JSON",
      "Re-run the wizard; if this repeats, check `gh auth status` and your access to the repo.",
    );
  }
  if (repo.allow_auto_merge === true) {
    return ok("repo auto-merge is enabled (allow_auto_merge: true)");
  }
  return bad(
    `the repo API reports allow_auto_merge: ${String(repo.allow_auto_merge)}`,
    "Open the repo's Settings page and, under “Pull Requests”, check “Allow auto-merge”.",
  );
};

/**
 * Step 2's verdict: the required status checks on the protection object
 * (`GET /repos/{repo}/branches/{branch}/protection`). Handles both response
 * shapes GitHub sends — the legacy `contexts` list and the `checks` list —
 * and looks for exactly the workflow name the merge gate queries.
 */
export const requiredCheckVerdict = (
  protectionJson: string,
  checkName: string = CI_CHECK_NAME,
): CheckResult => {
  let protection: {
    required_status_checks?:
      | {
          contexts?: string[];
          checks?: { context: string }[];
        }
      | null;
  };
  try {
    protection = JSON.parse(protectionJson);
  } catch {
    return bad(
      "the branch-protection API response was not valid JSON",
      "Re-run the wizard; if this repeats, check your admin access to the repo.",
    );
  }
  const rule = protection.required_status_checks;
  if (rule === null || rule === undefined) {
    return bad(
      "the branch protection rule does not require any status checks",
      "On the branch-protection page, edit the rule: enable “Require status checks to pass”, then search and select “CI”.",
    );
  }
  const required = [
    ...(rule.contexts ?? []),
    ...(rule.checks ?? []).map((check) => check.context),
  ];
  if (required.includes(checkName)) {
    return ok(
      `“${checkName}” is a required status check (${required.join(", ")})`,
    );
  }
  return bad(
    `the rule requires status checks, but not “${checkName}” (requires: ${required.join(", ") || "nothing"})`,
    `On the branch-protection page, edit the rule: under “Require status checks to pass”, search and select “${checkName}”.`,
  );
};

/**
 * What the API let the wizard learn about one bot token: a classic PAT (the
 * `x-oauth-scopes` header enumerates its scopes), a fine-grained PAT or App
 * token (no scopes header; only the aggregated repo role is readable — the
 * API cannot enumerate a fine-grained token's permission toggles), or a
 * rejection (bad value, expired, wrong audience).
 */
export type TokenProbe =
  | { kind: "error"; detail: string }
  | { kind: "classic"; scopes: readonly string[] }
  | {
      kind: "fine-grained";
      login: string;
      /** Aggregated repo role from the collaborators endpoint; null when unreadable. */
      repoPermission: string | null;
    };

/** What `GET /user` alone tells the wizard, before the repo-role lookup. */
export type UserProbe =
  | { kind: "error"; detail: string }
  | { kind: "classic"; scopes: readonly string[] }
  | { kind: "fine-grained"; login: string };

/**
 * Parse what `gh api user --include` printed: response headers (CRLF — found
 * live on the first wizard run, where splitting on `\n\n` alone swallowed the
 * body into the header block) and then the JSON body. The `x-oauth-scopes`
 * header's presence marks a classic PAT and enumerates its scopes; its
 * absence marks a fine-grained/App token. An unparseable body is an error
 * probe — the verdict names the fix.
 */
export const parseUserProbe = (includeOutput: string): UserProbe => {
  const body = includeOutput.split(/\r?\n\r?\n/).pop() ?? "";
  let login: string;
  try {
    login = (JSON.parse(body).login as string | undefined) ?? "(unknown)";
  } catch {
    return { kind: "error", detail: "the /user response was not parseable" };
  }
  const scopes = includeOutput
    .match(/^x-oauth-scopes:[ \t]*(.*)$/im)?.[1]
    ?.trim();
  return scopes !== undefined
    ? {
        kind: "classic",
        scopes: scopes.length > 0 ? scopes.split(/,[ \t]*/) : [],
      }
    : { kind: "fine-grained", login };
};

/** Which scopes each token must carry (the gate relies on both for AGENT_PAT). */
export interface TokenRequirements {
  /** Workflows read/write — workflow-file pushes (classic: `workflow`). */
  workflowsReadWrite: boolean;
  /** Pull requests write — PR labels, comments, merges (classic: `repo`). */
  pullRequestWrite: boolean;
}

/**
 * The fine-grained toggles a token's requirements name, for the confirm
 * note. A fine-grained token's permission toggles are not API-readable, so
 * the wizard names exactly which ones the maintainer must confirm by hand.
 */
const togglesFor = (requirements: TokenRequirements): string => {
  const toggles: string[] = [];
  if (requirements.pullRequestWrite) {
    toggles.push("“Pull requests: Read and write”");
  }
  if (requirements.workflowsReadWrite) {
    toggles.push("“Workflows: Read and write”");
  }
  return toggles.join(" and ");
};

/**
 * Step 3's verdict: one bot token's probe in, gaps-and-fixes out. Classic
 * tokens are fully verifiable from their scopes header; for fine-grained
 * tokens the wizard verifies the repo role it can and names the exact
 * toggles the maintainer must confirm by hand — the API has no endpoint
 * that enumerates a fine-grained token's permissions.
 */
export const tokenVerdict = (
  probe: TokenProbe,
  requirements: TokenRequirements,
): CheckResult => {
  if (probe.kind === "error") {
    return bad(
      `the API rejected the token: ${probe.detail}`,
      `The API said: ${probe.detail}. Check the token's value and that it has not expired; regenerate it at ${TOKEN_SETTINGS_URL} if needed.`,
    );
  }

  if (probe.kind === "classic") {
    const missing: string[] = [];
    if (requirements.pullRequestWrite && !probe.scopes.includes("repo")) {
      missing.push("repo");
    }
    if (requirements.workflowsReadWrite && !probe.scopes.includes("workflow")) {
      missing.push("workflow");
    }
    const held = `classic token; scopes: ${probe.scopes.length > 0 ? probe.scopes.join(", ") : "(none)"}`;
    if (missing.length === 0) return ok(held);
    const why = [
      requirements.pullRequestWrite && missing.includes("repo")
        ? "`repo` covers Pull requests read/write (PR labels and merges)"
        : "",
      requirements.workflowsReadWrite && missing.includes("workflow")
        ? "`workflow` covers Workflows read/write (pushing workflow-file changes)"
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    return bad(
      held,
      `Edit the token at ${TOKEN_SETTINGS_URL} and add the missing scope(s): ${missing.join(", ")} — ${why}.`,
    );
  }

  // Fine-grained (or App) token: verify the repo role, then name the
  // toggles only the token's owner can confirm in the settings UI.
  if (probe.repoPermission === null) {
    return bad(
      `fine-grained token for ${probe.login}; the API could not read its role on this repo`,
      `Grant the token access to this repository: edit it at ${FINE_GRAINED_TOKENS_URL} — under “Repository access”, include this repo.`,
    );
  }
  if (!["write", "admin"].includes(probe.repoPermission)) {
    return bad(
      `fine-grained token for ${probe.login}; repo role: ${probe.repoPermission}`,
      `Grant the token write access to this repository: edit it at ${FINE_GRAINED_TOKENS_URL} — “Repository access” must include this repo, and Pull requests write needs at least repo write.`,
    );
  }
  return ok(
    `fine-grained token for ${probe.login}; repo role: ${probe.repoPermission}` +
      `. The API cannot enumerate a fine-grained token's permission toggles — confirm ` +
      `${togglesFor(requirements)} at ${FINE_GRAINED_TOKENS_URL} (edit the token, “Repository permissions”).`,
  );
};

// ─── Everything below is the interactive walk; the verdicts above are the
// ─── unit-tested decision surface. No call in this section writes anything:
// ─── the wizard reads state and guides the human who flips the settings.

/** One `gh api` invocation; read-only endpoints only. */
const ghApi = (
  args: string[],
  token?: string,
): { stdout: string; stderr: string; ok: boolean } => {
  try {
    const stdoutText = execFileSync("gh", ["api", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: token ? { ...env, GH_TOKEN: token } : env,
    });
    return { stdout: stdoutText, stderr: "", ok: true };
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    return {
      stdout: "",
      stderr: err.stderr ?? err.message ?? "unknown gh failure",
      ok: false,
    };
  }
};

const firstLine = (text: string): string =>
  text.split("\n")[0]?.trim() || "request failed";

const sleep = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** Best-effort browser open; the URL is printed either way. */
const openBrowser = (url: string): boolean => {
  if (!stdin.isTTY) return false;
  const args =
    process.platform === "win32"
      ? ["/c", "start", "", url]
      : [url];
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  try {
    execFileSync(opener, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const interactive = (): boolean => stdin.isTTY === true;

const confirm = async (prompt: string): Promise<string> => {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return answer;
};

/** Read a token without echoing it (TTY only; Ctrl-C skips the check). */
const readSecret = (prompt: string): Promise<string> =>
  new Promise((resolve) => {
    if (!stdin.isTTY) {
      resolve("");
      return;
    }
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    let secret = "";
    const onKeypress = (chunk: Buffer): void => {
      const key = chunk.toString("utf8");
      if (key === "\r" || key === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(secret);
      } else if (key === "\u0003") {
        // Ctrl-C: skip this check rather than abort the whole wizard.
        cleanup();
        stdout.write("\n(skipped)\n");
        resolve("");
      } else if (key === "\u007f" || key === "\b") {
        secret = secret.slice(0, -1);
      } else if (key >= " ") {
        secret += key;
      }
    };
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onKeypress);
    };
    stdin.on("data", onKeypress);
  });

const mark = (result: CheckResult): string => (result.ok ? "✔" : "✖");

const printResult = (name: string, result: CheckResult): void => {
  console.log(`${mark(result)} ${name}`);
  console.log(`    ${result.detail}`);
  if (result.fix) {
    console.log(`    FIX: ${result.fix}`);
  }
};

/**
 * One guided settings step: verify the captured state first (an idempotent
 * re-run stops here), then instruct, open the exact page, and re-verify
 * until the API confirms — or the wait runs out.
 */
const guidedVerify = async (step: {
  name: string;
  settingsUrl: string;
  instructions: string[];
  openUrl: boolean;
  timeoutSeconds: number;
  check: () => CheckResult;
}): Promise<CheckResult> => {
  console.log(`\n── ${step.name} ──`);
  let verdict = step.check();
  if (verdict.ok) {
    printResult(step.name, verdict);
    console.log("    Already enabled — nothing to do.");
    return verdict;
  }
  console.log(`    ${verdict.detail}`);
  console.log(`    Open: ${step.settingsUrl}`);
  for (const line of step.instructions) console.log(`    ${line}`);
  const opened = step.openUrl && openBrowser(step.settingsUrl);
  console.log(
    opened
      ? "    (opened in your browser)"
      : "    (open the URL above; --no-open suppresses browser attempts)",
  );

  const deadline = Date.now() + step.timeoutSeconds * 1000;
  while (!verdict.ok) {
    if (interactive()) {
      await confirm(
        "    Flip the setting, then press Enter to re-verify (Ctrl-C aborts)… ",
      );
    } else {
      console.log(
        "    Non-interactive session: re-checking in 5s (run without a pipe for guided prompts)…",
      );
      await sleep(5);
    }
    verdict = step.check();
    if (!verdict.ok) {
      console.log(`    Still not verified: ${verdict.detail}`);
      if (Date.now() >= deadline) break;
    }
  }
  printResult(step.name, verdict);
  return verdict;
};

/**
 * Probe one bot token through the API (read-only): who it belongs to, its
 * scopes header (classic tokens), and its aggregated repo role. Any API
 * rejection becomes an error probe — the verdict names the fix.
 */
const probeToken = (token: string, repo: string): TokenProbe => {
  const user = ghApi(["user", "--include"], token);
  if (!user.ok) {
    return { kind: "error", detail: firstLine(user.stderr) };
  }
  const parsed = parseUserProbe(user.stdout);
  if (parsed.kind !== "fine-grained") {
    return parsed;
  }
  const permission = ghApi(
    [`repos/${repo}/collaborators/${parsed.login}/permission`],
    token,
  );
  return {
    kind: "fine-grained",
    login: parsed.login,
    repoPermission: permission.ok
      ? ((JSON.parse(permission.stdout).permission as string | undefined) ?? null)
      : null,
  };
};

/** One bot-token step: probe via the API, then the gaps-and-fixes verdict. */
const verifyToken = async (step: {
  name: string;
  token: string;
  requirements: TokenRequirements;
  repo: string;
}): Promise<CheckResult> => {
  console.log(`\n── ${step.name} ──`);
  const verdict = tokenVerdict(probeToken(step.token, step.repo), step.requirements);
  printResult(step.name, verdict);
  return verdict;
};

// ─── Entry point

const parseArgs = (argv: string[]): Record<string, string | boolean> => {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--repo":
      case "--agent-pat":
      case "--review-pat":
      case "--timeout": {
        const value = argv[i + 1];
        if (value === undefined) {
          console.error(`Missing value for ${arg}`);
          exit(2);
        }
        args[arg.slice(2)] = value;
        i += 1;
        break;
      }
      case "--no-open":
        args["no-open"] = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        console.error(`Unknown argument: ${arg} (see --help)`);
        exit(2);
    }
  }
  return args;
};

const usage = (): string =>
  [
    "Usage: npx tsx scripts/enable-auto-merge.ts [options]",
    "",
    "  --repo owner/name   the repository (defaults to GITHUB_REPOSITORY, then the clone's origin)",
    "  --agent-pat <tok>   AGENT_PAT token to verify (or env AGENT_PAT; prompted when interactive)",
    "  --review-pat <tok>  REVIEW_PAT token to verify (or env REVIEW_PAT; optional)",
    "  --timeout <secs>    seconds each settings wait accepts (default 300)",
    "  --no-open           print URLs without opening a browser",
    "",
    "Guides the human-only steps of enabling the merge gate (ADR 0001):",
    "repo auto-merge, optional branch protection with CI required, and the",
    "bot token scopes. Verifies every step via the API; idempotent on re-run.",
  ].join("\n");

/** True when this module is the script node/tsx was invoked to run. */
const invokedDirectly = (): boolean =>
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    exit(0);
  }

  console.log(
    [
      "╭──────────────────────────────────────────────────────────╮",
      "│ Enablement wizard — repo auto-merge for the merge gate   │",
      "╰──────────────────────────────────────────────────────────╯",
      "",
      "This wizard walks the steps only a human can take (ADR 0001: the",
      "enablement is the trust act). It guides and verifies — it never",
      "flips a setting itself, and every step checks the captured state",
      "via the API before moving on. Re-running it on a fully enabled",
      "repo completes without changes.",
    ].join("\n"),
  );

  // Resolve the repo: flag, then env, then the clone's origin.
  let repo = (args.repo as string | undefined) ?? env.GITHUB_REPOSITORY ?? "";
  if (!repo) {
    try {
      repo = (
        JSON.parse(
          execFileSync("gh", ["repo", "view", "--json", "nameWithOwner"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          }),
        ) as { nameWithOwner?: string }
      ).nameWithOwner as string;
    } catch {
      console.error(
        "Could not resolve the repository — pass --repo owner/name or run inside a clone.",
      );
      exit(2);
    }
  }

  const timeoutSeconds = Number(args.timeout ?? 300);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    console.error("--timeout must be a positive number of seconds");
    exit(2);
  }

  const results: { name: string; verdict: CheckResult }[] = [];
  const skipped: string[] = [];

  // ── Step 1: repo auto-merge (the activation switch).
  const repoJson = ghApi([`repos/${repo}`]);
  if (!repoJson.ok) {
    console.error(
      `Could not read ${repo} (${firstLine(repoJson.stderr)}) — check gh auth (gh auth status) and your access to the repo.`,
    );
    exit(2);
  }
  const defaultBranch =
    (JSON.parse(repoJson.stdout).default_branch as string | undefined) ?? "main";
  results.push({
    name: "Repo auto-merge",
    verdict: await guidedVerify({
      name: "1. Repo auto-merge (the gate's activation switch)",
      settingsUrl: repoSettingsUrl(repo),
      instructions: [
        "Scroll to the “Pull Requests” section.",
        "Check “Allow auto-merge”.",
      ],
      openUrl: !args["no-open"],
      timeoutSeconds,
      check: () => {
        const fresh = ghApi([`repos/${repo}`]);
        return fresh.ok
          ? autoMergeVerdict(fresh.stdout)
          : bad(
              `the repo API call failed: ${firstLine(fresh.stderr)}`,
              "Check gh authentication and network, then re-verify.",
            );
      },
    }),
  });

  // ── Step 2: branch protection with the CI check required (optional).
  let takeBranchProtection = false;
  if (interactive()) {
    const answer = (
      await confirm(
        `\n    Optional: add branch protection requiring the CI check on ${defaultBranch}? [y/N] `,
      )
    )
      .trim()
      .toLowerCase();
    takeBranchProtection = answer === "y" || answer === "yes";
  }
  if (!takeBranchProtection) {
    const note = interactive()
      ? "declined — the merge gate verifies CI on the head commit itself"
      : "non-interactive session — the merge gate verifies CI on the head commit itself";
    console.log(`\n⏭️  Branch protection skipped (${note}).`);
    skipped.push(`Branch protection with CI required — ${note}`);
  } else {
    results.push({
      name: "Branch protection (CI required)",
      verdict: await guidedVerify({
        name: `2. Branch protection: require the CI check on ${defaultBranch}`,
        settingsUrl: branchProtectionUrl(repo),
        instructions: [
          `Under “Branch protection rules”, add a rule (or edit the existing one) for \`${defaultBranch}\`.`,
          "Enable “Require a pull request before merging” if not already on.",
          "Enable “Require status checks to pass before merging”, search and select “CI”, and save.",
        ],
        openUrl: !args["no-open"],
        timeoutSeconds,
        check: () => {
          const fresh = ghApi([
            `repos/${repo}/branches/${defaultBranch}/protection`,
          ]);
          return fresh.ok
            ? requiredCheckVerdict(fresh.stdout)
            : bad(
                `no branch protection rule is readable on ${defaultBranch} (${firstLine(fresh.stderr)})`,
                "Create the rule on the branch-protection page with “Require status checks to pass” and “CI” selected.",
              );
        },
      }),
    });
  }

  // ── Step 3: the bot token scopes (workflows read/write, PR write).
  const agentToken =
    (args["agent-pat"] as string | undefined) ??
    env.AGENT_PAT ??
    (interactive()
      ? await readSecret(
          "\n    Paste the AGENT_PAT token to verify (hidden; empty input skips): ",
        )
      : "");
  if (agentToken) {
    results.push({
      name: "AGENT_PAT scopes",
      verdict: await verifyToken({
        name: "3. AGENT_PAT (Workflows read/write, Pull requests write)",
        token: agentToken,
        requirements: { workflowsReadWrite: true, pullRequestWrite: true },
        repo,
      }),
    });
  } else {
    const note = "no token provided — pass --agent-pat, set AGENT_PAT, or paste it when prompted";
    console.log(`\n⏭️  AGENT_PAT check skipped (${note}).`);
    skipped.push(`AGENT_PAT scopes — ${note}`);
  }

  const reviewToken =
    (args["review-pat"] as string | undefined) ??
    env.REVIEW_PAT ??
    (interactive()
      ? await readSecret(
          "    Paste the REVIEW_PAT token to verify (optional; empty input skips): ",
        )
      : "");
  if (reviewToken) {
    results.push({
      name: "REVIEW_PAT scopes",
      verdict: await verifyToken({
        name: "4. REVIEW_PAT (Pull requests write — formal reviews)",
        token: reviewToken,
        requirements: { workflowsReadWrite: false, pullRequestWrite: true },
        repo,
      }),
    });
  } else {
    const note =
      "optional token, not provided — without it the review verdict posts as a PR comment instead of a formal review";
    console.log(`\n⏭️  REVIEW_PAT check skipped (${note}).`);
    skipped.push(`REVIEW_PAT scopes — ${note}`);
  }

  // ── Summary and exit.
  console.log("\n════ Summary ════");
  for (const note of skipped) console.log(`⏭️  ${note}`);
  const failed = results.filter((entry) => !entry.verdict.ok);
  for (const entry of results) printResult(entry.name, entry.verdict);
  if (failed.length > 0) {
    console.log(
      `\n${failed.length} required check(s) did not verify — apply the FIX lines above and re-run the wizard (it is idempotent).`,
    );
    exit(1);
  }
  console.log(
    "\nAll steps verified. The merge gate can request a squash auto-merge for two-way-door PRs that pass every policy condition; anything else queues under the agent:hold label for you.",
  );
  exit(0);
};

if (invokedDirectly()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    exit(1);
  });
}
