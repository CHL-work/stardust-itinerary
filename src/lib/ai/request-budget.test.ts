import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aiRequestDeliveryTimeoutMs, aiRequestWorkBudgetMs } from "@/lib/ai/request-budget";

describe("bounded multi-phase AI deadlines", () => {
  it("preserves image extraction headroom and delivery grace below the user lease", () => {
    expect(aiRequestWorkBudgetMs(false)).toBe(180_000);
    expect(aiRequestWorkBudgetMs(true)).toBe(225_000);
    expect(aiRequestDeliveryTimeoutMs(false)).toBe(200_000);
    expect(aiRequestDeliveryTimeoutMs(true)).toBe(245_000);
    expect(aiRequestDeliveryTimeoutMs(true)).toBeLessThan(600_000);
  });
  it("uses the shared deadline at the server/client and leaves route headroom", () => {
    const planner = readFileSync("src/lib/ai/planner.ts", "utf8");
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    const route = readFileSync("src/app/api/trips/[tripId]/ai/route.ts", "utf8");
    expect(planner).toContain("aiRequestWorkBudgetMs(images.length > 0)");
    expect(shell).toContain("aiRequestDeliveryTimeoutMs(Boolean(input.images?.length))");
    expect(route).toContain("export const maxDuration = 300;");
    expect(planner).toContain("Promise.race([providerPromise, deadline])");
  });
});
