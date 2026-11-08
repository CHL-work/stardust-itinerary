import { describe, expect, it } from "vitest";

import { payerFromRow, routinePayerParameters, routinePayerSql, routineRequestColumns } from "@/lib/routine-checks/funding";

describe("routine check funding (JOB-094)", () => {
  it("chooses only an active, unsuspended member whose current key passed the search check, owners first", () => {
    const sql = routinePayerSql("trip.id", 4, 5);
    expect(sql).toContain("m.status = 'active'");
    expect(sql).toContain("payer_user.suspended_at IS NULL");
    expect(sql).toContain("p.routine_enabled");
    expect(sql).toContain("p.routine_verified_model = p.routine_model");
    expect(sql).toContain("c.updated_at <= p.routine_verified_at");
    expect(sql).toContain("unnest($4::text[], $5::text[])");
    expect(sql).toMatch(/ORDER BY \(m\.role = 'owner'\) DESC, p\.routine_enabled_at, m\.id\s+LIMIT 1/u);
    const [models, providers] = routinePayerParameters();
    expect(models).toHaveLength(providers.length);
    expect(providers[models.indexOf("claude-haiku-5-5")]).toBe("anthropic");
  });

  it("refuses a payer row whose model, effort or provider is not registered together", () => {
    const row = { member_id: "m", user_id: "u", model: "gemini-3.8-flash", effort: "low", provider: "google" };
    expect(payerFromRow(row)).toEqual({ memberId: "m", userId: "u", model: "gemini-3.8-flash", effort: "low", provider: "google" });
    expect(payerFromRow({ ...row, provider: "openai" })).toBeNull();
    expect(payerFromRow({ ...row, model: "gemini-1.0-pro" })).toBeNull();
    expect(payerFromRow({ ...row, effort: "max" })).toBeNull();
    expect(payerFromRow(undefined)).toBeNull();
  });

  it("records the paying member and the chosen model on member-funded checks only", () => {
    expect(routineRequestColumns({ kind: "operator" })).toEqual({ model: "gpt-6.1-sol", provider: "openai", transport: "codex_sdk",
      credentialSource: null, credentialMemberId: null, effort: "medium" });
    expect(routineRequestColumns({ kind: "member", payer: { memberId: "m", userId: "u", model: "claude-haiku-5-5", effort: "high", provider: "anthropic" } }))
      .toEqual({ model: "claude-haiku-5-5", provider: "anthropic", transport: "claude_agent_sdk", credentialSource: "own", credentialMemberId: "m", effort: "high" });
  });
});
