import { describe, expect, it } from "vitest";
import {
  classifyPushFailure,
  leaseArgs,
  parseLsRemote,
} from "./push";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("parseLsRemote", () => {
  it("reads the sha when the remote names the ref", () => {
    const stdout = `${SHA}\trefs/heads/agent/issue-18\n`;
    expect(parseLsRemote(stdout, "refs/heads/agent/issue-18")).toBe(SHA);
  });

  it("returns null when the branch is absent on the remote (empty output)", () => {
    expect(parseLsRemote("", "refs/heads/agent/issue-18")).toBeNull();
  });

  it("returns null when only other refs are listed", () => {
    const stdout =
      "5cf57d0a1d2e3e4c5b6a7988123456789abcdef0\trefs/heads/main\n" +
      `${SHA}\trefs/pull/24/head\n`;
    expect(parseLsRemote(stdout, "refs/heads/agent/issue-18")).toBeNull();
  });

  it("picks the matching ref among several", () => {
    const stdout =
      "5cf57d0a1d2e3e4c5b6a7988123456789abcdef0\trefs/heads/main\n" +
      `${SHA}\trefs/heads/agent/issue-18\n`;
    expect(parseLsRemote(stdout, "refs/heads/agent/issue-18")).toBe(SHA);
  });
});

describe("leaseArgs", () => {
  it("pins the observed sha when the branch exists on the remote", () => {
    expect(leaseArgs("agent/issue-18", SHA)).toEqual([
      `--force-with-lease=refs/heads/agent/issue-18:${SHA}`,
    ]);
  });

  it("demands absence (empty expectation) for a first push", () => {
    expect(leaseArgs("agent/issue-18", null)).toEqual([
      "--force-with-lease=refs/heads/agent/issue-18:",
    ]);
  });
});

describe("classifyPushFailure", () => {
  it("explains a lost lease race and how to recover", () => {
    const output =
      "To https://github.com/tarouttoo/tenderagent.git\n" +
      " ! [rejected]        agent/issue-18 -> agent/issue-18 (stale info)\n" +
      "error: failed to push some refs to 'https://github.com/tarouttoo/tenderagent.git'\n";
    const message = classifyPushFailure(output, "agent/issue-18");
    expect(message).toMatch(/--force-with-lease/);
    expect(message).toMatch(/origin\/agent\/issue-18/);
    expect(message).toMatch(/agent:implement/);
  });

  it("recognizes the non-fast-forward rejection a lost lease can surface as", () => {
    const output =
      "To /tmp/origin.git\n" +
      " ! [rejected]        agent/issue-18 -> agent/issue-18 (non-fast-forward)\n" +
      "error: failed to push some refs to '/tmp/origin.git'\n";
    const message = classifyPushFailure(output, "agent/issue-18");
    expect(message).toMatch(/--force-with-lease/);
    expect(message).toMatch(/agent:implement/);
  });

  it("recognizes the local-transport wording of a lost lease", () => {
    const output =
      "To /tmp/origin.git\n" +
      " ! [remote rejected] agent/issue-18 -> agent/issue-18 (incorrect old value provided)\n" +
      "error: failed to push some refs to '/tmp/origin.git'\n";
    const message = classifyPushFailure(output, "agent/issue-18");
    expect(message).toMatch(/--force-with-lease/);
    expect(message).toMatch(/agent:implement/);
  });

  it("explains a token refused workflow-file writes", () => {
    const output =
      " ! [remote rejected] agent/issue-18 -> agent/issue-18 (refusing to allow a GitHub App to create or update workflow `.github/workflows/agent-implement.yml` without `workflows` permission)\n";
    const message = classifyPushFailure(output, "agent/issue-18");
    expect(message).toMatch(/workflow files/);
    expect(message).toMatch(/AGENT_PAT/);
  });

  it("falls back to the output excerpt for anything else", () => {
    const output = "fatal: could not read Username for 'https://github.com': No such device or address\n";
    const message = classifyPushFailure(output, "agent/issue-18");
    expect(message).toMatch(/agent\/issue-18/);
    expect(message).toContain("could not read Username");
  });
});
