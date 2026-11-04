import { describe, expect, it } from "vitest";
import { activeAiRequests, withAiRequestSlot } from "@/lib/ai/concurrency";
import { RateLimitError } from "@/lib/auth/errors";

describe("AI request slots", () => {
  it("refuses a request beyond the cap at once and frees slots when requests finish or fail", async () => {
    const env = { STARDUST_AI_MAX_CONCURRENT: "2" };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const running = [withAiRequestSlot(() => gate.then(() => "a"), env), withAiRequestSlot(() => gate.then(() => "b"), env)];
    expect(activeAiRequests()).toBe(2);
    await expect(withAiRequestSlot(async () => "c", env)).rejects.toBeInstanceOf(RateLimitError);
    release();
    expect(await Promise.all(running)).toEqual(["a", "b"]);
    await expect(withAiRequestSlot(async () => { throw new Error("synthetic failure"); }, env)).rejects.toThrow("synthetic failure");
    expect(activeAiRequests()).toBe(0);
    expect(await withAiRequestSlot(async () => "d", env)).toBe("d");
  });

  it("falls back to four for a missing or unusable setting", async () => {
    for (const value of [undefined, "", "0", "-1", "1.5", "65", "many"]) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const env = { STARDUST_AI_MAX_CONCURRENT: value };
      const running = Array.from({ length: 4 }, () => withAiRequestSlot(() => gate, env));
      await expect(withAiRequestSlot(async () => undefined, env), String(value)).rejects.toBeInstanceOf(RateLimitError);
      release();
      await Promise.all(running);
    }
  });
});
