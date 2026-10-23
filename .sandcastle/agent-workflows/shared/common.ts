import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";

/** Directory the workflow reads failure artifacts from. */
export const outputDir = (): string => process.env.OUTPUT_DIR ?? "/tmp";

export const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
};

/**
 * Write the failure reason for the failure-handling step (lands with the
 * preflight/blocked follow-up), then exit non-zero so the run fails now.
 */
export const fail = (message: string): never => {
  console.error(`\nFAILED: ${message}`);
  fs.mkdirSync(outputDir(), { recursive: true });
  fs.writeFileSync(path.join(outputDir(), "failure_reason.txt"), message);
  process.exit(1);
};

export const sh = (cmd: string): string =>
  execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/**
 * Best-effort `sh`: "safe" buys a non-fatal path for advisory calls only —
 * a failed command is logged (stderr, like the failure reporter's gh calls)
 * and yields "" instead of throwing the run into `fail()`. Callers must read
 * "" as "unknown", never as a value; anything that gates the run's outcome
 * belongs to `sh`, whose failure is handled loudly.
 */
export const safeSh = (cmd: string): string => {
  try {
    return sh(cmd);
  } catch (error) {
    console.error(
      `${cmd} failed (continuing with ""): ${error instanceof Error ? error.message : String(error)}`,
    );
    return "";
  }
};

export const gh = (args: string[]): string =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * The workflow's coding agent (both the implement and the review workflow
 * build one this way): pi CLI over the provider/model named by the
 * workflow's env vars (`AGENT_PROVIDER`/`AGENT_MODEL`, e.g. `zai` +
 * `glm-5.3-flash`), authenticated via the `ZAI_API_KEY` secret.
 */
export const agentFromEnv = () =>
  sandcastle.pi(`${required("AGENT_PROVIDER")}/${required("AGENT_MODEL")}`, {
    env: { ZAI_API_KEY: required("ZAI_API_KEY") },
  });
