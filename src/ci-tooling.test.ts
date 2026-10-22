import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("CI tooling", () => {
  it("runs TypeScript tests through vitest", () => {
    expect(1 + 1).toBe(2);
  });

  it("validates payloads with zod", () => {
    const payload = z.object({ ok: z.boolean() });

    expect(payload.parse({ ok: true })).toEqual({ ok: true });
    expect(payload.safeParse({ ok: "nope" }).success).toBe(false);
  });

  it("resolves the sandcastle library entry point", async () => {
    const sandcastle = await import("@ai-hero/sandcastle");

    expect(typeof sandcastle.run).toBe("function");
    expect(sandcastle.pi).toBeDefined();
  });
});
