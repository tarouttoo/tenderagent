import { describe, expect, it } from "vitest";
import { parseTransitionArgs } from "./label-transition";

describe("parseTransitionArgs", () => {
  it("parses a start transition on an issue", () => {
    expect(
      parseTransitionArgs([
        "--surface",
        "issue",
        "--number",
        "17",
        "--transition",
        "start",
        "--trigger",
        "agent:implement",
      ]),
    ).toEqual({
      surface: "issue",
      subjectNumber: "17",
      phase: "start",
      triggerLabel: "agent:implement",
    });
  });

  it("parses a finish transition on a PR", () => {
    expect(
      parseTransitionArgs([
        "--surface",
        "pr",
        "--number",
        "9",
        "--transition",
        "finish",
        "--trigger",
        "agent:review",
      ]),
    ).toEqual({
      surface: "pr",
      subjectNumber: "9",
      phase: "finish",
      triggerLabel: "agent:review",
    });
  });

  it("refuses an unknown surface", () => {
    expect(() =>
      parseTransitionArgs([
        "--surface",
        "release",
        "--number",
        "17",
        "--transition",
        "start",
        "--trigger",
        "agent:implement",
      ]),
    ).toThrow(/surface/i);
  });

  it("refuses an unknown transition", () => {
    expect(() =>
      parseTransitionArgs([
        "--surface",
        "issue",
        "--number",
        "17",
        "--transition",
        "restart",
        "--trigger",
        "agent:implement",
      ]),
    ).toThrow(/transition/i);
  });

  it("requires the trigger label on start", () => {
    expect(() =>
      parseTransitionArgs([
        "--surface",
        "issue",
        "--number",
        "17",
        "--transition",
        "start",
      ]),
    ).toThrow(/--trigger/);
  });

  it("does not require the trigger label on finish (nothing consumes it)", () => {
    expect(
      parseTransitionArgs([
        "--surface",
        "issue",
        "--number",
        "17",
        "--transition",
        "finish",
      ]),
    ).toEqual({
      surface: "issue",
      subjectNumber: "17",
      phase: "finish",
      triggerLabel: undefined,
    });
  });

  it("requires a subject number", () => {
    expect(() =>
      parseTransitionArgs([
        "--surface",
        "issue",
        "--number",
        "",
        "--transition",
        "start",
        "--trigger",
        "agent:implement",
      ]),
    ).toThrow(/--number/);
  });
});
