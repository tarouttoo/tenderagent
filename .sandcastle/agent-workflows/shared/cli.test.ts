import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { ghBestEffort, invokedDirectly, outputDir } from "./cli";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("invokedDirectly", () => {
  const argvBackup = process.argv;

  afterEach(() => {
    process.argv = argvBackup;
  });

  it("is true when the module is the script node was invoked to run", () => {
    process.argv = ["node", "/tmp/dir/script.ts"];
    expect(invokedDirectly(pathToFileURL("/tmp/dir/script.ts").href)).toBe(
      true,
    );
  });

  it("accepts the caller's own import.meta.url, as the CLI entries use it", () => {
    process.argv = ["node", fileURLToPath(import.meta.url)];
    expect(invokedDirectly(import.meta.url)).toBe(true);
  });

  it("is false when a different module was invoked", () => {
    process.argv = ["node", "/tmp/dir/other.ts"];
    expect(invokedDirectly(pathToFileURL("/tmp/dir/script.ts").href)).toBe(
      false,
    );
  });

  it("is false when the module is only imported, not invoked", () => {
    process.argv = ["node"];
    expect(invokedDirectly(pathToFileURL("/tmp/dir/script.ts").href)).toBe(
      false,
    );
  });
});

describe("outputDir", () => {
  const outputDirBackup = process.env.OUTPUT_DIR;

  afterEach(() => {
    if (outputDirBackup === undefined) delete process.env.OUTPUT_DIR;
    else process.env.OUTPUT_DIR = outputDirBackup;
  });

  it("returns OUTPUT_DIR and creates the directory when missing", () => {
    const dir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "cli-output-dir-")),
      "nested",
    );
    process.env.OUTPUT_DIR = dir;
    expect(fs.existsSync(dir)).toBe(false);
    expect(outputDir()).toBe(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("tolerates a directory that already exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-output-dir-"));
    process.env.OUTPUT_DIR = dir;
    expect(outputDir()).toBe(dir);
  });

  it("defaults to /tmp when OUTPUT_DIR is unset", () => {
    delete process.env.OUTPUT_DIR;
    expect(outputDir()).toBe("/tmp");
  });

  it("falls back to /tmp when OUTPUT_DIR is empty", () => {
    process.env.OUTPUT_DIR = "";
    expect(outputDir()).toBe("/tmp");
  });
});

describe("ghBestEffort", () => {
  it("returns false and logs the failing argv instead of throwing", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    expect(ghBestEffort(["definitely-not-a-gh-subcommand"])).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^gh definitely-not-a-gh-subcommand failed:/),
    );
  });
});
