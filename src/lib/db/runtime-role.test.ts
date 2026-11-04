import { describe, expect, it } from "vitest";
// @ts-expect-error The operator script is plain JavaScript without type declarations.
import { administratorOnlyFunctions, grantStatements, runtimeRoleFromEnvironment } from "../../../scripts/db/runtime-role.mjs";

const client = {
  escapeIdentifier: (value: string) => `"${value.replaceAll('"', '""')}"`,
  escapeLiteral: (value: string) => `'${value.replaceAll("'", "''")}'`,
};

describe("the least-privilege runtime role", () => {
  it("is granted application functions but never the guest purge, and loses it if it ever had it", () => {
    expect(administratorOnlyFunctions).toContain("app_purge_expired_guest");
    const statements = (grantStatements(client, "stardust_app", "stardust") as string[]).join("\n");
    expect(statements).not.toMatch(/GRANT EXECUTE ON ALL FUNCTIONS/u);
    expect(statements).toMatch(/NOT \(p\.proname = ANY \('\{app_purge_expired_guest\}'::text\[\]\)\)/u);
    expect(statements).toMatch(/REVOKE ALL ON FUNCTION %s FROM %I/u);
    expect(statements).toContain("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  });

  it("is a separate, unprivileged-looking name and password only when the URLs use different users", () => {
    expect(runtimeRoleFromEnvironment({
      DATABASE_DIRECT_URL: "postgresql://postgres:synthetic@db/stardust", DATABASE_URL: "postgresql://postgres:synthetic@db/stardust",
    })).toBeNull();
    expect(runtimeRoleFromEnvironment({
      DATABASE_DIRECT_URL: "postgresql://postgres:synthetic@db/stardust",
      DATABASE_URL: `postgresql://stardust_app:${"a".repeat(32)}@db/stardust`,
    })).toEqual({ name: "stardust_app", password: "a".repeat(32) });
  });
});
