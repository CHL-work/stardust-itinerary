import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthConfig } from "@/lib/auth/config";
import { AuthConfigurationError } from "@/lib/auth/errors";

describe("operator emails in the auth configuration (JOB-078)", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "s".repeat(32));
    vi.stubEnv("DATABASE_URL", "postgresql://local/test");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-secret");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads one email, or several comma-separated accounts, lower-cased", () => {
    vi.stubEnv("OWNER_GOOGLE_EMAIL", "Owner@example.test");
    expect(getAuthConfig().ownerGoogleEmails).toEqual(["owner@example.test"]);
    vi.stubEnv("OWNER_GOOGLE_EMAIL", "first@example.test, Second@example.test");
    expect(getAuthConfig().ownerGoogleEmails).toEqual(["first@example.test", "second@example.test"]);
  });

  it("treats an unset or blank setting as no operator", () => {
    vi.stubEnv("OWNER_GOOGLE_EMAIL", "");
    expect(getAuthConfig().ownerGoogleEmails).toEqual([]);
    vi.stubEnv("OWNER_GOOGLE_EMAIL", undefined);
    expect(getAuthConfig().ownerGoogleEmails).toEqual([]);
  });

  it("refuses a list with an entry that is not an email", () => {
    vi.stubEnv("OWNER_GOOGLE_EMAIL", "first@example.test,second");
    expect(() => getAuthConfig()).toThrow(AuthConfigurationError);
  });
});
