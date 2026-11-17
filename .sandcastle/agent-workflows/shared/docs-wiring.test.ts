/**
 * Wiring test for the tracker docs (spec #36, leaf #40): the label table
 * documents every `agent:*` lifecycle label the automation writes, the
 * runbook's merge-gate section points at the modules that implement it, and
 * every relative link in the docs resolves. Docs are the merge gate's only
 * human interface — a hold comment names condition ids the runbook explains —
 * so a drift between the two is worth a red test.
 *
 * Pure file reads: no network, no gh, no Actions runtime.
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BLOCKED_LABEL,
  HOLD_LABEL,
  IN_PROGRESS_LABEL,
  MERGE_LABEL,
  REVIEW_TRIGGER_LABEL,
  TRIGGER_LABEL,
} from "./failure";
import { MERGE_CONDITIONS } from "../review/merge-policy";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Absolute path for a repo-relative path. */
const resolved = (relative: string): string => path.join(repoRoot, relative);

/** The contents of a repo-relative markdown file. */
const docs = (relative: string): string => readFileSync(resolved(relative), "utf8");

/** Relative link targets in markdown: no http(s), no mailto, no bare anchors. */
const relativeLinks = (markdown: string): string[] =>
  [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1] as string)
    .filter((target) => !/^(?:[a-z]+:|#)/i.test(target))
    .map((target) => target.split("#")[0] as string)
    .filter((target) => target.length > 0);

/** The label table's row for one label, or undefined if the table lacks it. */
const labelRow = (table: string, label: string): string | undefined =>
  table.split("\n").find((line) => line.startsWith(`| \`${label}\``));

describe("lifecycle label table (docs/agents/triage-labels.md)", () => {
  const table = docs("docs/agents/triage-labels.md");
  const labels = [
    TRIGGER_LABEL,
    IN_PROGRESS_LABEL,
    REVIEW_TRIGGER_LABEL,
    MERGE_LABEL,
    HOLD_LABEL,
    BLOCKED_LABEL,
  ];

  it("has a row for every agent:* label the automation writes", () => {
    for (const label of labels) {
      expect(labelRow(table, label), `${label} row`).toBeDefined();
    }
  });

  it("credits the merge gate with both outcome labels", () => {
    for (const label of [MERGE_LABEL, HOLD_LABEL]) {
      expect(labelRow(table, label)).toContain("Merge gate");
    }
  });

  it("names the retry path for a held PR", () => {
    const hold = labelRow(table, HOLD_LABEL) ?? "";
    expect(hold).toContain(REVIEW_TRIGGER_LABEL);
    expect(hold).toMatch(/ready/i);
  });
});

describe("merge gate runbook (docs/agents/agent-pipeline.md)", () => {
  const runbook = docs("docs/agents/agent-pipeline.md");

  it("sections the gate under the lifecycle", () => {
    expect(runbook).toContain("### The merge gate");
  });

  it("links the two modules that implement it", () => {
    expect(runbook).toContain("review/merge-gate.ts");
    expect(runbook).toContain("review/merge-policy.ts");
  });

  it("documents every condition id the hold comment can print", () => {
    const rows = runbook.split("\n");
    for (const condition of MERGE_CONDITIONS) {
      expect(
        rows.some((line) => line.startsWith(`| \`${condition}\` |`)),
        `${condition} row in the conditions table`,
      ).toBe(true);
    }
  });

  it("gives a hold its own recovery recipe, distinct from a failure", () => {
    expect(runbook).toContain("Not a failure: the merge gate held the PR");
    expect(runbook).toContain(`\`${HOLD_LABEL}\``);
    expect(runbook).toContain(`\`${REVIEW_TRIGGER_LABEL}\``);
  });
});

describe("relative documentation links", () => {
  const files = [
    "README.md",
    "GLOSSARY.md",
    "AGENTS.md",
    "docs/agents/agent-pipeline.md",
    "docs/agents/triage-labels.md",
    "docs/agents/issue-tracker.md",
    "docs/agents/domain.md",
    "docs/adr/0001-afk-agents-merge-through-a-deterministic-gate.md",
  ];

  for (const file of files) {
    it(`${file} has no dangling relative links`, () => {
      for (const link of relativeLinks(docs(file))) {
        const target = path.resolve(path.dirname(resolved(file)), link);
        expect(existsSync(target), `${file} → ${link}`).toBe(true);
      }
    });
  }
});
