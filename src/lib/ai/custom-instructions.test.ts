import type { Pool, PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { AppConflictError, AppForbiddenError } from "@/lib/app/repository";
import { aiInstructionsInputSchema } from "./custom-instructions-contract";
import { getAiInstructions, readAiInstructions, saveAiInstructions } from "./custom-instructions";

const session = { tripId: "trip-a", memberId: "member-a", userId: "user-a", role: "viewer" } as AuthenticatedSession;
const query = vi.fn();
const release = vi.fn();
const client = { query, release } as unknown as PoolClient;
const connect = vi.fn(async () => client);
const pool = { connect } as unknown as Pool;
let instructions = "Keep days relaxed. I enjoy anime shops.";
let revision = 1;
let bound = true;

describe("explicit account AI instructions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    instructions = "Keep days relaxed. I enjoy anime shops."; revision = 1; bound = true;
    query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("SELECT id FROM trips")) return { rows: [{ id: session.tripId }], rowCount: 1 };
      if (sql.includes("SELECT role FROM trip_members")) return { rows: bound ? [{ role: session.role }] : [], rowCount: bound ? 1 : 0 };
      if (sql.startsWith("SELECT ai_instructions")) return { rows: [{ ai_instructions: instructions, ai_instructions_revision: revision }], rowCount: 1 };
      if (sql.startsWith("UPDATE app_users")) {
        if (values?.[0] !== session.userId || values?.[2] !== revision) return { rows: [], rowCount: 0 };
        instructions = values[1] as string; revision++;
        return { rows: [{ ai_instructions: instructions, ai_instructions_revision: revision }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it("loads only the caller account after rechecking a current viewer binding", async () => {
    expect(await getAiInstructions(pool, session, session.tripId)).toEqual({ instructions, revision: 1 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE id = $1"), ["user-a"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'active'"), ["trip-a", "member-a", "user-a"]);
    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects a foreign trip before acquiring any connection", async () => {
    await expect(getAiInstructions(pool, session, "trip-other")).rejects.toBeInstanceOf(AppForbiddenError);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects a disabled or rebound member before reading or saving text", async () => {
    bound = false;
    await expect(getAiInstructions(pool, session, session.tripId)).rejects.toBeInstanceOf(AppForbiddenError);
    await expect(saveAiInstructions(pool, session, session.tripId, { instructions: "new", expectedRevision: 1 })).rejects.toBeInstanceOf(AppForbiddenError);
    expect(query.mock.calls.some(([sql]) => /SELECT ai_instructions|UPDATE app_users/.test(sql))).toBe(false);
  });

  it("saves explicit text with CAS and writes only content-free audit metadata", async () => {
    const text = "Budget cafes, no early mornings; prefer public transport.";
    expect(await saveAiInstructions(pool, session, session.tripId, { instructions: `  ${text}  `, expectedRevision: 1 })).toEqual({ instructions: text, revision: 2 });
    const audit = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO audit_events"));
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain(text);
    expect(JSON.parse(audit![1][8])).toEqual({ revision: 2, characterCount: text.length, cleared: false });
    expect(audit![1][6]).toBeNull();
    expect(audit![1][7]).toBeNull();
  });

  it("clears text for the next planner read without resurrecting old profiles", async () => {
    await saveAiInstructions(pool, session, session.tripId, { instructions: "   ", expectedRevision: 1 });
    expect(await readAiInstructions(client, session.userId)).toEqual({ instructions: "", revision: 2 });
    expect(query.mock.calls.some(([sql]) => /personal_memor|catalog_prefer|preference_revisions/.test(sql))).toBe(false);
  });

  it("rejects stale saves without auditing a successful change", async () => {
    await expect(saveAiInstructions(pool, session, session.tripId, { instructions: "stale", expectedRevision: 3 })).rejects.toBeInstanceOf(AppConflictError);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO audit_events"))).toBe(false);
  });

  it.each([
    { instructions: "x".repeat(8_001), expectedRevision: 1 },
    { instructions: "hello\0world", expectedRevision: 1 },
    { instructions: "hello", expectedRevision: 0 },
    { instructions: "hello", expectedRevision: 1, userId: "other" },
    { instructions: { anime: "JoJo" }, expectedRevision: 1 },
  ])("rejects unsupported inputs without persistence: %j", async (input) => {
    expect(aiInstructionsInputSchema.safeParse(input).success).toBe(false);
    await expect(saveAiInstructions(pool, session, session.tripId, input as never)).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });

  it("accepts multilingual plain text and preserves line breaks", () => {
    const text = "想行動漫舖，唔好太早\nゆっくり旅行したい\nI like cafés.";
    expect(aiInstructionsInputSchema.parse({ instructions: text, expectedRevision: 1 }).instructions).toBe(text);
  });
});
