import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { getAiPolicy, updateAiSettings } from "@/lib/app/repository";
import type { AuthenticatedSession } from "@/lib/auth/repository";

const memberSession: AuthenticatedSession = {
  sessionId: "session-member",
  tripId: "10000000-0000-4000-8000-000000000001",
  memberId: "20000000-0000-4000-8000-000000000002",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "editor",
  expiresAt: new Date("2030-04-04T00:00:00.000Z"),
  absoluteExpiresAt: new Date("2030-04-06T00:00:00.000Z"),
  displayName: "Member",
  issuer: "test",
  subject: "member-subject",
  generation: 1,
};

function policyClient(usedToday: number, ownerDefaultModel = "claude-haiku-5-5",
  options: { ownProviders?: string[]; sponsored?: boolean; enabled?: boolean } = {}) {
  return {
    query: vi.fn(async (...args: [sql: unknown, params?: readonly unknown[]]) => {
      const [sql] = args;
      const statement = String(sql);
      if (statement.includes("pg_advisory_xact_lock")) return { rows: [{}] };
      if (statement.includes("to_regclass('public.user_ai_credentials')")) return { rows: [{ present: true }] };
      if (statement.includes("FROM user_ai_credentials")) return { rows: (options.ownProviders ?? []).map((provider) => ({ provider })) };
      if (statement.includes("FROM trip_ai_settings")) {
        return {
          rows: [{
            enabled: options.enabled ?? true,
            owner_default_model: ownerDefaultModel,
            member_model: "gpt-6.1-sol",
            member_daily_limit: 20,
            sponsored: options.sponsored ?? true,
            migrated: options.sponsored === false,
          }],
        };
      }
      if (statement.includes("FROM ai_requests")) {
        return { rows: [{ count: String(usedToday) }] };
      }
      throw new Error(`Unexpected query: ${statement}`);
    }),
  };
}

describe("AI policy quota serialization", () => {
  it("takes the transaction-scoped member lock before reading quota usage", async () => {
    const client = policyClient(19);

    const policy = await getAiPolicy(
      client as unknown as Pool,
      memberSession,
      undefined,
      { serializeMemberQuota: true },
    );

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("FROM ai_requests")));
    expect(client.query.mock.calls.find(([sql]) => String(sql).includes("pg_advisory_xact_lock"))?.[1]).toEqual([
      JSON.stringify([memberSession.tripId, memberSession.memberId, "ai-daily-quota"]),
    ]);
    expect(policy).toMatchObject({ model: "gpt-6.1-sol", usedToday: 19, limit: 20 });
  });

  it("keeps owners unlimited without taking the member quota lock", async () => {
    const client = policyClient(50);
    const ownerSession = { ...memberSession, role: "owner" as const };

    const policy = await getAiPolicy(
      client as unknown as Pool,
      ownerSession,
      "claude-haiku-5-5",
      { serializeMemberQuota: true },
    );

    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("pg_advisory_xact_lock")))
      .toBe(false);
    expect(policy).toMatchObject({ model: "claude-haiku-5-5", usedToday: 50, limit: null });
  });

  it("allows an owner to request Astra while keeping a member request fixed to Sol", async () => {
    const ownerClient = policyClient(50);
    const ownerSession = { ...memberSession, role: "owner" as const };

    const ownerPolicy = await getAiPolicy(
      ownerClient as unknown as Pool,
      ownerSession,
      "gpt-6-astra",
    );
    const memberPolicy = await getAiPolicy(
      policyClient(3) as unknown as Pool,
      memberSession,
      "gpt-6-astra",
    );

    expect(ownerPolicy).toMatchObject({ model: "gpt-6-astra", limit: null });
    expect(memberPolicy).toMatchObject({ model: "gpt-6.1-sol", usedToday: 3, limit: 20 });
  });

  it("uses a persisted Astra owner default without changing the member model", async () => {
    const ownerSession = { ...memberSession, role: "owner" as const };
    const ownerPolicy = await getAiPolicy(
      policyClient(4, "gpt-6-astra") as unknown as Pool,
      ownerSession,
    );
    const memberPolicy = await getAiPolicy(
      policyClient(4, "gpt-6-astra") as unknown as Pool,
      memberSession,
    );

    expect(ownerPolicy).toMatchObject({ model: "gpt-6-astra", usedToday: 4, limit: null });
    expect(memberPolicy).toMatchObject({ model: "gpt-6.1-sol", usedToday: 4, limit: 20 });
  });

  it("rejects a member attempt to persist Astra before any database write", async () => {
    const client = { query: vi.fn() };

    await expect(updateAiSettings(
      client as unknown as Pool,
      memberSession,
      memberSession.tripId,
      { ownerDefaultModel: "gpt-6-astra" },
    )).rejects.toThrow("Only the owner can change AI settings.");

    expect(client.query).not.toHaveBeenCalled();
  });

  it("returns a typed denial when a serialized member check reaches the hard limit", async () => {
    const client = policyClient(20);

    await expect(getAiPolicy(
      client as unknown as Pool,
      memberSession,
      undefined,
      { serializeMemberQuota: true },
    )).rejects.toMatchObject({
      reasonCode: "daily_limit_reached",
      model: "gpt-6.1-sol",
    });
  });
});

describe("AI policy with the requester's own keys", () => {
  it("keeps a sponsored trip free when the member makes no explicit model choice", async () => {
    const policy = await getAiPolicy(policyClient(3, "claude-haiku-5-5", { ownProviders: ["anthropic"] }) as unknown as Pool, memberSession);
    expect(policy).toMatchObject({ model: "gpt-6.1-sol", limit: 20, credentialSource: "operator" });
  });

  it("uses the member's own key, without the trip cap, for an explicitly chosen model of that provider", async () => {
    const policy = await getAiPolicy(policyClient(30, "claude-haiku-5-5", { ownProviders: ["anthropic"] }) as unknown as Pool,
      memberSession, "claude-sonnet-5-5", { serializeMemberQuota: true });
    expect(policy).toMatchObject({ model: "claude-sonnet-5-5", usedToday: 30, limit: null, credentialSource: "own" });
  });

  it("falls back to the trip's own rules for a model whose provider the member holds no key for", async () => {
    const policy = await getAiPolicy(policyClient(3, "claude-haiku-5-5", { ownProviders: ["anthropic"] }) as unknown as Pool,
      memberSession, "gpt-6-astra");
    expect(policy).toMatchObject({ model: "gpt-6.1-sol", credentialSource: "operator" });
  });

  it("lets a key holder plan in an unsponsored trip and asks everyone else for a key", async () => {
    const own = await getAiPolicy(policyClient(0, "gpt-6.1-sol", { ownProviders: ["google"], sponsored: false }) as unknown as Pool, memberSession);
    expect(own).toMatchObject({ model: "gemini-3.8-flash", limit: null, credentialSource: "own" });
    const sameProviderDefault = await getAiPolicy(policyClient(0, "gemini-4-argon", { ownProviders: ["google"], sponsored: false }) as unknown as Pool, memberSession);
    expect(sameProviderDefault).toMatchObject({ model: "gemini-4-argon", credentialSource: "own" });
    await expect(getAiPolicy(policyClient(0, "gpt-6.1-sol", { sponsored: false }) as unknown as Pool, memberSession))
      .rejects.toMatchObject({ reasonCode: "ai_key_required" });
  });

  it("still honors an owner's decision to turn AI off for the trip", async () => {
    await expect(getAiPolicy(policyClient(0, "gpt-6.1-sol", { ownProviders: ["openai"], enabled: false }) as unknown as Pool,
      memberSession, "gpt-6.1-terra")).rejects.toMatchObject({ reasonCode: "ai_disabled" });
  });
});