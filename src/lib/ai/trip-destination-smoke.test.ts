import { describe, expect, it, vi } from "vitest";
import { runTripDestinationSmoke } from "../../../scripts/test-trip-destination";
import { validateLookupOutput } from "@/lib/app/trip-destination-defaults";

function success(destination: string) {
  const japan = destination === "Japan";
  const ambiguous = destination === "USA";
  return { defaults: validateLookupOutput({ status: ambiguous ? "ambiguous" : "resolved", countryCode: japan ? "JP" : "US",
    timeZone: ambiguous ? null : japan ? "Asia/Tokyo" : "America/Chicago", timeZoneCandidates: [], currency: japan ? "JPY" : "USD",
    currencyCandidates: [] }, destination), effectiveModel: "gpt-6.1-sol", latencyMs: 1,
  usage: { inputTokens: 20, outputTokens: 15, cachedInputTokens: 0 } };
}

describe("synthetic live destination provider smoke", () => {
  it("is inert without explicit live opt-in, even with ambient credentials", async () => {
    const provider = vi.fn();
    expect(await runTripDestinationSmoke([], { OPENAI_API_KEY: "synthetic-do-not-output" }, provider))
      .toEqual({ pass: true, code: "LIVE_NOT_REQUESTED", results: [] });
    expect(provider).not.toHaveBeenCalled();
  });
  it.each(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL", "DATABASE_DIRECT_URL", "TEST_DATABASE_URL", "PGPASSWORD",
    "AUTH_SECRET", "GOOGLE_CLIENT_SECRET", "STARDUST_FEEDBACK_GITHUB_TOKEN", "NODE_OPTIONS"])("refuses %s without exposing it", async (key) => {
    const provider = vi.fn();
    const result = await runTripDestinationSmoke(["--run-live"], { [key]: "synthetic-private-value" }, provider);
    expect(result).toEqual({ pass: false, code: "UNSAFE_ENVIRONMENT", results: [] });
    expect(JSON.stringify(result)).not.toContain("synthetic-private-value"); expect(provider).not.toHaveBeenCalled();
  });
  it("checks Dallas and Japan deterministically with no raw result in its report", async () => {
    const provider = vi.fn(async ({ destination }) => success(destination));
    const report = await runTripDestinationSmoke(["--run-live"], { HOME: "/synthetic-home", CODEX_HOME: "/synthetic-profile" }, provider);
    expect(report.pass).toBe(true);
    expect(provider.mock.calls.map(([input]) => input.destination)).toEqual(["Dallas", "Japan"]);
    expect(report.results.map((result) => result.code)).toEqual(["DALLAS_PASS", "JAPAN_PASS"]);
    expect(report.results[0].tokens).toEqual({ inputTokens: 20, outputTokens: 15, cachedInputTokens: 0 });
    expect(JSON.stringify(report)).not.toMatch(/America\/Chicago|Asia\/Tokyo|synthetic-home/);
  });
  it("optionally tests a whole-country ambiguous result", async () => {
    const provider = vi.fn(async ({ destination }) => success(destination));
    const report = await runTripDestinationSmoke(["--run-live", "--include-usa"], {}, provider);
    expect(report.results).toHaveLength(3); expect(report.results[2].code).toBe("USA_PASS"); expect(report.pass).toBe(true);
  });
  it("fails wrong defaults and wrong models rather than merely checking transport success", async () => {
    const provider = vi.fn(async () => ({ ...success("Japan"), effectiveModel: "unexpected-model" }));
    const report = await runTripDestinationSmoke(["--run-live"], {}, provider);
    expect(report.pass).toBe(false); expect(report.results.every((result) => result.code.endsWith("RESULT_MISMATCH"))).toBe(true);
  });
  it("prints only allowlisted provider error codes", async () => {
    const provider = vi.fn().mockRejectedValueOnce({ code: "TIMEOUT", message: "secret-error" }).mockRejectedValueOnce(new Error("private-provider-detail"));
    const report = await runTripDestinationSmoke(["--run-live"], {}, provider);
    expect(report.results.map((result) => result.code)).toEqual(["DALLAS_TIMEOUT", "JAPAN_PROVIDER_UNAVAILABLE"]);
    expect(JSON.stringify(report)).not.toMatch(/secret-error|private-provider-detail/);
  });
  it("does not allow arbitrary model, destination or transport arguments", async () => {
    const provider = vi.fn();
    expect((await runTripDestinationSmoke(["--run-live", "--model=another"], {}, provider)).code).toBe("INVALID_ARGUMENTS");
    expect(provider).not.toHaveBeenCalled();
  });
});
