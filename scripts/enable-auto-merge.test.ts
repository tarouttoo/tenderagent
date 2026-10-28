/**
 * Unit tests for the enablement wizard's pure verdict surface (spec #36,
 * leaf #41): the captured state of each human-only step — repo auto-merge,
 * the required CI check under optional branch protection, and the bot token
 * scopes — as API responses in, legible verdicts with gaps-and-fixes out.
 * No network, no gh, no TTY in tests, in the style of the merge-policy
 * tests. Wiring tests assert the runbook points at the script, that the
 * wizard's settings URLs name the exact pages it walks, and that the wizard
 * itself never performs a settings write — the trust act stays human
 * (ADR 0001).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CI_CHECK_NAME,
  TOKEN_SETTINGS_URL,
  autoMergeVerdict,
  branchProtectionUrl,
  parseRepoPermission,
  parseUserProbe,
  repoSettingsUrl,
  requiredCheckVerdict,
  runVerdict,
  sanitizeSecretChunk,
  tokenVerdict,
} from "./enable-auto-merge.js";
import type { CheckResult } from "./enable-auto-merge.js";

describe("repo auto-merge verdict", () => {
  it("passes when the API reports allow_auto_merge true", () => {
    const verdict = autoMergeVerdict(
      JSON.stringify({ name: "tenderagent", allow_auto_merge: true }),
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("allow_auto_merge");
  });

  it("fails when disabled, naming the exact settings fix", () => {
    const verdict = autoMergeVerdict(
      JSON.stringify({ name: "tenderagent", allow_auto_merge: false }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.fix).toContain("Allow auto-merge");
  });

  it("fails legibly on a response without the setting", () => {
    const verdict = autoMergeVerdict(JSON.stringify({ name: "tenderagent" }));

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("allow_auto_merge");
  });
});

describe("required status check verdict (optional branch protection)", () => {
  it("passes when CI is a required context (legacy shape)", () => {
    const verdict = requiredCheckVerdict(
      JSON.stringify({
        required_status_checks: { strict: true, contexts: ["test", "CI"] },
      }),
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain(CI_CHECK_NAME);
  });

  it("passes when CI is a required check (checks shape)", () => {
    const verdict = requiredCheckVerdict(
      JSON.stringify({
        required_status_checks: {
          strict: false,
          checks: [
            { context: "lint", app_id: null },
            { context: "CI", app_id: 15368 },
          ],
        },
      }),
    );

    expect(verdict.ok).toBe(true);
  });

  it("fails when protection exists but requires no status checks", () => {
    const verdict = requiredCheckVerdict(
      JSON.stringify({ required_status_checks: null, enforce_admins: true }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.fix).toContain("Require status checks");
    expect(verdict.fix).toContain(CI_CHECK_NAME);
  });

  it("fails when CI is absent from the required checks", () => {
    const verdict = requiredCheckVerdict(
      JSON.stringify({
        required_status_checks: { strict: true, contexts: ["lint"] },
      }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.fix).toContain(CI_CHECK_NAME);
  });
});

describe("bot token verdicts", () => {
  it("passes a classic token carrying both required scopes", () => {
    const verdict = tokenVerdict(
      { kind: "classic", scopes: ["repo", "workflow"] },
      { workflowsReadWrite: true, pullRequestWrite: true },
    );

    expect(verdict.ok).toBe(true);
  });

  it("names the workflow-scope gap and its fix", () => {
    const verdict = tokenVerdict(
      { kind: "classic", scopes: ["repo"] },
      { workflowsReadWrite: true, pullRequestWrite: true },
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.fix).toContain("workflow");
    expect(verdict.fix).toContain(TOKEN_SETTINGS_URL);
    expect(verdict.fix).toContain("Workflows");
  });

  it("names the repo-scope gap as the pull-request write fix", () => {
    const verdict = tokenVerdict(
      { kind: "classic", scopes: ["workflow"] },
      { workflowsReadWrite: true, pullRequestWrite: true },
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.fix).toContain("repo");
    expect(verdict.fix).toContain("Pull requests");
  });

  it("lists every missing scope at once, not just the first", () => {
    const verdict = tokenVerdict(
      { kind: "classic", scopes: [] },
      { workflowsReadWrite: true, pullRequestWrite: true },
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.fix).toContain("workflow");
    expect(verdict.fix).toContain("repo");
  });

  it("skips the workflow scope for a review token (PR write only)", () => {
    const verdict = tokenVerdict(
      { kind: "classic", scopes: ["repo"] },
      { workflowsReadWrite: false, pullRequestWrite: true },
    );

    expect(verdict.ok).toBe(true);
  });

  it("passes a fine-grained token with repo write, naming the toggles to confirm", () => {
    const verdict = tokenVerdict(
      {
        kind: "fine-grained",
        login: "tenderagent-bot",
        repoPermission: "write",
      },
      { workflowsReadWrite: true, pullRequestWrite: true },
    );

    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("Workflows");
    expect(verdict.detail).toContain("Pull requests");
    expect(verdict.detail).toContain("personal-access-tokens");
  });

  it("fails a read-only fine-grained token with the write-access fix", () => {
    const verdict = tokenVerdict(
      {
        kind: "fine-grained",
        login: "tenderagent-bot",
        repoPermission: "read",
      },
      { workflowsReadWrite: true, pullRequestWrite: true },
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.fix).toContain("write");
  });

  it("fails a fine-grained token with no repo access", () => {
    const verdict = tokenVerdict(
      {
        kind: "fine-grained",
        login: "tenderagent-bot",
        repoPermission: null,
      },
      { workflowsReadWrite: true, pullRequestWrite: true },
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.fix).toContain("Repository access");
  });

  it("fails a token the API rejected, pointing at the token's value", () => {
    const verdict = tokenVerdict(
      { kind: "error", detail: "HTTP 401: Bad credentials" },
      { workflowsReadWrite: true, pullRequestWrite: true },
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.fix).toContain("401");
    expect(verdict.fix).toContain(TOKEN_SETTINGS_URL);
  });
});

describe("run verdict (the exit contract)", () => {
  const pass: CheckResult = { ok: true, detail: "enabled" };
  const fail: CheckResult = { ok: false, detail: "dark", fix: "flip it" };

  it("passes only when every required check ran and verified", () => {
    const verdict = runVerdict([pass, pass], []);

    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("every required check");
  });

  it("fails when a check ran and failed", () => {
    expect(runVerdict([pass, fail], []).ok).toBe(false);
  });

  it("fails when a required check was skipped without running — exit 0 never overstates", () => {
    // A skipped AGENT_PAT check never ran, so the run is not green: an
    // operator must not be able to declare enablement with unverified
    // token scopes.
    const verdict = runVerdict([pass], [
      { note: "AGENT_PAT scopes — no token provided", required: true },
    ]);

    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("skipped");
    expect(verdict.fix).toContain("--agent-pat");
  });

  it("passes with optional skips, naming them instead of hiding them", () => {
    const verdict = runVerdict([pass], [
      {
        note: "REVIEW_PAT scopes — optional token, not provided",
        required: false,
      },
    ]);

    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("optional");
    expect(verdict.detail).toContain("skipped");
  });
});

describe("token probe parsing", () => {
  // What `gh api user --include` actually prints: CRLF response headers,
  // a blank line, then the JSON body — found live on the first wizard run.
  const GH_INCLUDE_OUTPUT = [
    "HTTP/2 200",
    "x-oauth-scopes: repo, workflow\r",
    "x-xss-protection: 0\r",
    "\r",
    '{"login":"tenderagent-bot","id":1}',
  ].join("\n");

  it("reads the body after CRLF-separated response headers (gh --include shape)", () => {
    const probe = parseUserProbe(GH_INCLUDE_OUTPUT);
    expect(probe).toEqual({ kind: "classic", scopes: ["repo", "workflow"] });
  });

  it("reads a fine-grained token's absence of a scopes header", () => {
    const probe = parseUserProbe(
      GH_INCLUDE_OUTPUT.replace("x-oauth-scopes: repo, workflow\r\n", ""),
    );
    expect(probe).toEqual({
      kind: "fine-grained",
      login: "tenderagent-bot",
    });
  });

  it("degrades a non-JSON collaborators response to an unreadable role, not a throw", () => {
    expect(parseRepoPermission("<html>rate limited</html>")).toBeNull();
    expect(parseRepoPermission(JSON.stringify({ permission: "admin" }))).toBe(
      "admin",
    );
    expect(parseRepoPermission(JSON.stringify({}))).toBeNull();
  });
});

describe("secret input chunks", () => {
  it("strips a trailing Enter that arrives inside one paste chunk", () => {
    // A clipboard paste can land as a single chunk with the Enter already
    // in it; an embedded \r would yield a token the API rejects with
    // "check the token's value".
    expect(sanitizeSecretChunk("ghp_tokens\r")).toBe("ghp_tokens");
    expect(sanitizeSecretChunk("ghp_tokens\r\n")).toBe("ghp_tokens");
    expect(sanitizeSecretChunk("ghp_tokens")).toBe("ghp_tokens");
  });
});

describe("the wizard's own surface", () => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    path.join(scriptDir, "enable-auto-merge.ts"),
    "utf8",
  );
  const runbook = readFileSync(
    path.join(scriptDir, "../docs/agents/agent-pipeline.md"),
    "utf8",
  );

  it("is referenced by the pipeline runbook", () => {
    expect(runbook).toContain("scripts/enable-auto-merge.ts");
  });

  it("never performs a settings write — the trust act stays human (ADR 0001)", () => {
    // The wizard guides and verifies only: an agent could run a PATCH/PUT
    // against the settings endpoints (long, short, or equals form), and
    // the feature exists precisely because the enablement is the one step
    // automation never takes.
    expect(source).not.toMatch(/--method[ \t=]+(PATCH|PUT|POST|DELETE)/);
    expect(source).not.toMatch(/--request[ \t=]+(PATCH|PUT|POST|DELETE)/);
    expect(source).not.toMatch(/(^|[^-\w])-X[ \t]+(PATCH|PUT|POST|DELETE)/);
  });

  it("cites an ADR that exists — the trust-act rationale is readable in-repo", () => {
    expect(runbook).toMatch(/\.\.\/adr\/0001-/);
    const adrDir = path.join(scriptDir, "../docs/adr");
    expect(
      readdirSync(adrDir).some((file) => /^0001-.*\.md$/.test(file)),
    ).toBe(true);
  });

  it("cross-checks CI_CHECK_NAME against the merge gate's own workflow name", () => {
    // The gate declares its workflow name once; reading it out of the gate
    // source enforces wizard↔gate consistency instead of commenting it.
    const gate = readFileSync(
      path.join(
        scriptDir,
        "../.sandcastle/agent-workflows/review/merge-gate.ts",
      ),
      "utf8",
    );
    expect(gate).toContain(`const CI_WORKFLOW_NAME = "${CI_CHECK_NAME}";`);
  });

  it("names the exact settings pages it walks", () => {
    expect(repoSettingsUrl("owner/name")).toBe(
      "https://github.com/owner/name/settings",
    );
    expect(branchProtectionUrl("owner/name")).toBe(
      "https://github.com/owner/name/settings/branches",
    );
  });
});
