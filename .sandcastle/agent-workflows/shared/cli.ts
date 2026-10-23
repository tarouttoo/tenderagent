/**
 * CLI plumbing shared by the agent-workflow entry scripts: the
 * direct-invocation guard, the artifact directory, and the two named `gh`
 * contracts. Node builtins only — the dependency-free failure reporter
 * (`report-failure.ts`) imports this module, so it must never gain a
 * dependency on anything from node_modules (e.g. @ai-hero/sandcastle, which
 * `common.ts` carries).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * True when the module at `moduleUrl` (pass the caller's `import.meta.url`)
 * is the script node/tsx was invoked to run, rather than a plain import.
 * Guards every CLI entry stanza:
 *
 *   if (invokedDirectly(import.meta.url)) { ...gather env, run... }
 */
export const invokedDirectly = (moduleUrl: string): boolean =>
  process.argv[1] !== undefined &&
  fileURLToPath(moduleUrl) === path.resolve(process.argv[1]);

/**
 * Directory the workflow scripts exchange artifacts in (failure reasons,
 * review payloads, comment bodies): `OUTPUT_DIR`, defaulting to /tmp. An
 * empty value falls back too — it would otherwise resolve artifacts against
 * the working directory. Created on demand so a missing directory can never
 * be the reason a run fails.
 */
export const outputDir = (): string => {
  const dir = process.env.OUTPUT_DIR || "/tmp";
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * gh, strict: run and return stdout; a failure throws and is the caller's
 * problem (preflight and review wrap it in `fail()`, the bridge in its exit
 * path). `env` overrides the child environment — the fallback-token path in
 * `post-review.ts` runs the same argv under a different identity.
 */
export const gh = (
  args: string[],
  opts: { env?: NodeJS.ProcessEnv } = {},
): string =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: opts.env ?? process.env,
  });

/**
 * gh, best-effort: run, log any failure to stderr, and report success —
 * never throws. For calls whose failure must not fail the caller: the
 * failure reporter (the run has already failed; reporting only makes it
 * legible) and the bridge's label pre-creation (`label create` exits
 * non-zero when the label already exists, which is fine). Returns whether
 * the call succeeded.
 */
export const ghBestEffort = (args: string[]): boolean => {
  try {
    execFileSync("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch (error) {
    console.error(
      `gh ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
};
