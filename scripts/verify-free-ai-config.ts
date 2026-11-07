import { pathToFileURL } from "node:url";
import { freeAiSettings } from "../src/lib/ai/free-model";
import { guestModeEnabled, turnstileMode } from "../src/lib/app/guest";

type Environment = Record<string, string | undefined>;
type FailureCode = "arguments_invalid" | "canonical_free_ai_disabled" | "free_ai_misconfigured"
  | "guest_mode_disabled" | "guest_turnstile_misconfigured";

export class FreeAiConfigurationError extends Error {
  constructor(readonly code: FailureCode) { super(code); this.name = "FreeAiConfigurationError"; }
}

/** Configuration only: no database access, provider requests or raw environment output. */
export function verifyFreeAiConfiguration(env: Environment, requireGuest = false) {
  if (env.FREE_AI_ENABLED !== "true") throw new FreeAiConfigurationError("canonical_free_ai_disabled");
  const settings = freeAiSettings(env);
  if (!settings.enabled) throw new FreeAiConfigurationError("free_ai_misconfigured");
  const guestEnabled = guestModeEnabled(env);
  const turnstile = turnstileMode(env);
  if (requireGuest && !guestEnabled) throw new FreeAiConfigurationError("guest_mode_disabled");
  if (guestEnabled && (turnstile === "misconfigured" || (turnstile === "required" && !env.TURNSTILE_SITE_KEY?.trim()))) {
    throw new FreeAiConfigurationError("guest_turnstile_misconfigured");
  }
  // Verify the existing admission policy, never replace it: an explicit
  // Turnstile waiver is usable and remains visible in this safe report.
  return {
    freeAi: "configured" as const,
    enabled: settings.enabled,
    models: settings.models,
    limits: { perUserDaily: settings.perUserDaily, hourly: settings.hourly, daily: settings.daily },
    guest: { enabled: guestEnabled, turnstile: guestEnabled ? turnstile : "disabled" as const },
  };
}

export function freeAiConfigMain(args: readonly string[] = process.argv.slice(2), env: Environment = process.env) {
  if (args.length > 1 || args.some((arg) => arg !== "--require-guest")) {
    throw new FreeAiConfigurationError("arguments_invalid");
  }
  return verifyFreeAiConfiguration(env, args.includes("--require-guest"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(freeAiConfigMain()));
  } catch (error) {
    console.error(JSON.stringify({ freeAi: "invalid", code: error instanceof FreeAiConfigurationError ? error.code : "verification_failed" }));
    process.exitCode = 1;
  }
}
