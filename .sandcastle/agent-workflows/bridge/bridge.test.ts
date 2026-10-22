import { describe, expect, it } from "vitest";
import { assertOnlyAgentLabels } from "../shared/failure";
import { bridgeDecision } from "./bridge";

const input = {
  eventLabel: "ready-for-agent",
  issueState: "open",
  issueLabels: ["ready-for-agent"],
};

describe("bridgeDecision", () => {
  it("bridges a freshly triaged open issue", () => {
    expect(bridgeDecision(input)).toEqual({
      act: true,
      add: ["agent:implement"],
    });
  });

  it("ignores label events that are not the triage label", () => {
    for (const eventLabel of ["agent:implement", "needs-triage", "bug"]) {
      expect(bridgeDecision({ ...input, eventLabel })).toMatchObject({
        act: false,
      });
    }
  });

  it("skips when the triage label was already removed — stale event", () => {
    expect(bridgeDecision({ ...input, issueLabels: [] })).toMatchObject({
      act: false,
    });
  });

  it("skips closed issues", () => {
    expect(bridgeDecision({ ...input, issueState: "closed" })).toMatchObject({
      act: false,
    });
  });

  it("skips while the pipeline is engaged — implement label pending or run live", () => {
    for (const engaged of [["agent:implement"], ["agent:in-progress"]]) {
      expect(
        bridgeDecision({
          ...input,
          issueLabels: ["ready-for-agent", ...engaged],
        }),
      ).toMatchObject({ act: false });
    }
  });

  it("bridges a blocked issue — a fresh triage decision may retry it", () => {
    expect(
      bridgeDecision({
        ...input,
        issueLabels: ["ready-for-agent", "agent:blocked"],
      }),
    ).toEqual({ act: true, add: ["agent:implement"] });
  });

  it("ignores ordinary triage labels on the issue", () => {
    expect(
      bridgeDecision({
        ...input,
        issueLabels: ["ready-for-agent", "needs-info", "bug"],
      }),
    ).toEqual({ act: true, add: ["agent:implement"] });
  });

  it("never writes a human triage label (invariant)", () => {
    const verdict = bridgeDecision(input);
    expect(verdict.act).toBe(true);
    if (verdict.act) {
      expect(() => assertOnlyAgentLabels(verdict.add)).not.toThrow();
    }
  });

  it("writes exactly the agent:implement label", () => {
    const verdict = bridgeDecision(input);
    expect(verdict.act && verdict.add).toEqual(["agent:implement"]);
  });
});
