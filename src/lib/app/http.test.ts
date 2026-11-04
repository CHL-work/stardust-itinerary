import { describe, expect, it } from "vitest";
import { apiError } from "./http";

describe("financial capacity error response", () => {
  it("returns safe validation feedback without private database details", async () => {
    const response = apiError({ code: "23514", constraint: "member_payment_financial_capacity_ck",
      message: "private financial values", detail: "private trip totals" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "This record exceeds the supported financial range. Check the amount or ask a trip owner to review it." });
  });

  it.each([
    { code: "23514", constraint: "unrelated_constraint", detail: "private" },
    { code: "XX000", constraint: "member_payment_financial_capacity_ck", detail: "private" },
    null,
  ])("keeps unrelated failures generic", async (error) => {
    const response = apiError(error);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
