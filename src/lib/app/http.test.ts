import { describe, expect, it } from "vitest";
import { apiError } from "./http";
import { AppConflictError } from "./repository";

describe("conflict codes (JOB-100)", () => {
  it("passes a conflict's stable code to the browser, and only when it has one", async () => {
    const outside = apiError(new AppConflictError("The event dates must be within the current trip dates.", "TRIP_DATES_OUTSIDE"));
    expect(outside.status).toBe(409);
    expect(await outside.json()).toEqual({ error: "The event dates must be within the current trip dates.", code: "TRIP_DATES_OUTSIDE" });
    expect(await apiError(new AppConflictError("The plan item changed. Reload and try again.")).json())
      .toEqual({ error: "The plan item changed. Reload and try again." });
  });
});

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
