import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { freeAiConfigMain, verifyFreeAiConfiguration } from "../../../scripts/verify-free-ai-config";
import { DEFAULT_FREE_MODELS } from "@/lib/ai/free-model";

const protectedGuest = { FREE_AI_ENABLED: "true", GUEST_MODE_ENABLED: "true",
  TURNSTILE_SECRET_KEY: "synthetic-secret-canary", TURNSTILE_SITE_KEY: "synthetic-site-canary" };

describe("safe runtime free AI configuration verification", () => {
  it("reports only allowlisted settings without secrets, identities or connections", () => {
    const result = verifyFreeAiConfiguration({ ...protectedGuest, AUTH_SECRET: "auth-secret-canary",
      DATABASE_URL: "postgresql://private-canary", ANTHROPIC_API_KEY: "provider-secret-canary",
      OWNER_GOOGLE_EMAIL: "synthetic-owner@example.test" }, true);
    expect(result).toEqual({ freeAi: "configured", enabled: true, models: [...DEFAULT_FREE_MODELS],
      limits: { perUserDaily: 10, hourly: 60, daily: 500 }, guest: { enabled: true, turnstile: "required" } });
    expect(JSON.stringify(result)).not.toMatch(/canary|example\.test|postgresql|SECRET|API_KEY/u);
  });

  it.each([
    [{ GUEST_FREE_AI_ENABLED: "true" }, "canonical_free_ai_disabled"],
    [{ FREE_AI_ENABLED: "false" }, "canonical_free_ai_disabled"],
    [{ FREE_AI_ENABLED: "true", FREE_AI_ENDPOINT: "https://private-canary.example/" }, "free_ai_misconfigured"],
    [{ FREE_AI_ENABLED: "true", FREE_AI_MODELS: "nvidia/trial:free" }, "free_ai_misconfigured"],
    [{ ...protectedGuest, GUEST_MODE_ENABLED: "false" }, "guest_mode_disabled"],
    [{ ...protectedGuest, TURNSTILE_SECRET_KEY: "" }, "guest_turnstile_misconfigured"],
    [{ ...protectedGuest, TURNSTILE_SITE_KEY: " " }, "guest_turnstile_misconfigured"],
  ])("fails closed with a stable code and no environment disclosure", (env, code) => {
    expect(() => verifyFreeAiConfiguration(env, true)).toThrow(code);
    try { verifyFreeAiConfiguration(env, true); } catch (error) {
      expect(String(error)).not.toMatch(/canary|https?:|postgresql/u);
    }
  });

  it("lets private/custom deployments omit guests or keep an explicit waiver", () => {
    expect(verifyFreeAiConfiguration({ FREE_AI_ENABLED: "true" }).guest).toEqual({ enabled: false, turnstile: "disabled" });
    expect(verifyFreeAiConfiguration({ FREE_AI_ENABLED: "true", GUEST_MODE_ENABLED: "true", GUEST_ALLOW_WITHOUT_TURNSTILE: "true" }).guest)
      .toEqual({ enabled: true, turnstile: "waived" });
  });

  it("honors an existing explicit waiver with --require-guest without silently creating one", () => {
    const env = { FREE_AI_ENABLED: "true", GUEST_MODE_ENABLED: "true", GUEST_ALLOW_WITHOUT_TURNSTILE: "true" };
    expect(freeAiConfigMain(["--require-guest"], env).guest).toEqual({ enabled: true, turnstile: "waived" });
    expect(env).toEqual({ FREE_AI_ENABLED: "true", GUEST_MODE_ENABLED: "true", GUEST_ALLOW_WITHOUT_TURNSTILE: "true" });
    expect(() => freeAiConfigMain(["--require-guest"], { FREE_AI_ENABLED: "true", GUEST_MODE_ENABLED: "true" }))
      .toThrow("guest_turnstile_misconfigured");
  });

  it("accepts only the documented CLI flag", () => {
    expect(freeAiConfigMain(["--require-guest"], protectedGuest).enabled).toBe(true);
    expect(() => freeAiConfigMain(["--dump-env"], protectedGuest)).toThrow("arguments_invalid");
    expect(() => freeAiConfigMain(["--require-guest", "--require-guest"], protectedGuest)).toThrow("arguments_invalid");
  });

  it("uses the ordinary secret-loading entrypoint after rollout and before public health verification", () => {
    const entrypoint = readFileSync("deploy/container/entrypoint.sh", "utf8");
    expect(entrypoint).toContain('exec node $env_flags --import tsx scripts/verify-free-ai-config.ts "$@"');
    const deploy = readFileSync("deploy/deploy.sh", "utf8");
    const check = deploy.indexOf('echo "== free AI configuration"');
    expect(check).toBeGreaterThan(deploy.indexOf("rollout status deployment/stardust-web"));
    expect(check).toBeLessThan(deploy.indexOf('echo "== health"'));
    expect(deploy).toContain('if [[ $free_ai_enabled == true ]]');
    expect(deploy).toContain('if [[ ${relative_overlay%/} == overlays/gke ]]; then free_ai_args=(--require-guest); fi');
  });
});
