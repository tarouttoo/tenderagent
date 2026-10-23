import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cannedBody, PR_BODY_FILE, resolvePrBody } from "./pr-body";

let dir: string;

const makeOutputDir = (): string => {
  dir = mkdtempSync(path.join(os.tmpdir(), "pr-body-"));
  return dir;
};

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

describe("cannedBody", () => {
  it("opens with the closing keyword and names the workflow", () => {
    expect(cannedBody(26)).toBe(
      "Closes #26\n\nImplemented by the agent implement workflow.\n",
    );
  });
});

describe("resolvePrBody", () => {
  it("returns the agent's draft verbatim when pr-body.md is present", () => {
    const outputDir = makeOutputDir();
    const draft =
      "Closes #26\n\n## Summary\n\nThe agent drafted this body.\n\n## Evidence\n\nRed then green.\n\n## Merge Danger\n\nTwo-way door, tiny.\n";
    writeFileSync(path.join(outputDir, PR_BODY_FILE), draft);

    expect(resolvePrBody(26, outputDir)).toBe(draft);
  });

  it("falls back to the canned stub when pr-body.md is absent", () => {
    const outputDir = makeOutputDir();

    expect(resolvePrBody(26, outputDir)).toBe(cannedBody(26));
    expect(resolvePrBody(26, outputDir)).toContain("Closes #26");
  });

  it("treats an empty draft as absent — the closing keyword must survive", () => {
    const outputDir = makeOutputDir();
    writeFileSync(path.join(outputDir, PR_BODY_FILE), "   \n");

    expect(resolvePrBody(26, outputDir)).toBe(cannedBody(26));
  });
});
