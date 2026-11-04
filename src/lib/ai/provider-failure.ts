/** Browser-safe, allowlisted failure metadata. Never retain upstream text,
 * account identifiers, usage balances, credentials or SDK stderr. */
export const aiProviderFailureCodes = [
  "AI_PROVIDER_RATE_LIMITED", "AI_PROVIDER_AUTH_REQUIRED", "AI_PROVIDER_BILLING",
  "AI_PROVIDER_MODEL_UNAVAILABLE", "AI_PROVIDER_UNAVAILABLE", "AI_PROVIDER_OUTPUT_INVALID",
] as const;
export type AiProviderFailureCode = typeof aiProviderFailureCodes[number];
export type AiProviderFailureDetails = {
  code: AiProviderFailureCode; provider: "anthropic" | "openai"; retryAt?: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseAiProviderFailureDetails(value: unknown): AiProviderFailureDetails | null {
  if (!record(value) || Object.keys(value).some((key) => !["code", "provider", "retryAt"].includes(key))
    || !aiProviderFailureCodes.includes(value.code as AiProviderFailureCode)
    || (value.provider !== "anthropic" && value.provider !== "openai")) return null;
  let retryAt: string | undefined;
  if (value.retryAt !== undefined) {
    if (value.code !== "AI_PROVIDER_RATE_LIMITED" || typeof value.retryAt !== "string"
      || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.retryAt)) return null;
    const date = new Date(value.retryAt);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.retryAt) return null;
    retryAt = value.retryAt;
  }
  return { code: value.code as AiProviderFailureCode, provider: value.provider, ...(retryAt ? { retryAt } : {}) };
}

export class AiProviderFailureError extends Error {
  readonly details: AiProviderFailureDetails;
  constructor(details: AiProviderFailureDetails) {
    const clean = parseAiProviderFailureDetails(details);
    if (!clean) throw new Error("Invalid safe provider failure metadata.");
    super(clean.code);
    this.name = clean.code;
    this.details = Object.freeze(clean);
  }
}

export function aiProviderFailureDetails(error: unknown): AiProviderFailureDetails | null {
  return error instanceof AiProviderFailureError ? parseAiProviderFailureDetails(error.details) : null;
}

const assistantCodes: Readonly<Record<string, AiProviderFailureCode>> = {
  authentication_failed: "AI_PROVIDER_AUTH_REQUIRED", oauth_org_not_allowed: "AI_PROVIDER_AUTH_REQUIRED",
  account_on_hold: "AI_PROVIDER_BILLING", billing_error: "AI_PROVIDER_BILLING",
  rate_limit: "AI_PROVIDER_RATE_LIMITED", model_not_found: "AI_PROVIDER_MODEL_UNAVAILABLE",
  overloaded: "AI_PROVIDER_UNAVAILABLE", server_error: "AI_PROVIDER_UNAVAILABLE",
  max_output_tokens: "AI_PROVIDER_OUTPUT_INVALID",
};

/** Installed official Claude SDK enums: SDKAssistantMessageError,
 * SDKRateLimitEvent and SDKResultMessage. Warnings alone never fail a turn.
 * A reset estimate is attached only to a matching terminal rate-limit failure. */
export function createClaudeProviderFailureTracker(now: () => number = Date.now) {
  let assistantCode: AiProviderFailureCode | null = null;
  let retryAt: string | undefined;
  return {
    observe(message: unknown): AiProviderFailureError | null {
      if (!record(message)) return null;
      if (message.type === "rate_limit_event") {
        retryAt = undefined;
        const info = message.rate_limit_info;
        if (record(info) && info.status === "rejected" && typeof info.resetsAt === "number" && Number.isSafeInteger(info.resetsAt)) {
          const timestamp = info.resetsAt * 1000;
          const current = now();
          // Documented five-hour/seven-day windows, with one day of bounded slack.
          if (timestamp > current && timestamp <= current + 8 * 24 * 60 * 60_000) {
            retryAt = new Date(timestamp).toISOString();
          }
        }
      }
      if (message.type === "assistant") {
        assistantCode = typeof message.error === "string" && Object.hasOwn(assistantCodes, message.error)
          ? assistantCodes[message.error]! : null;
      }
      if (message.type !== "result") return null;
      if (!["success", "error_during_execution", "error_max_turns", "error_max_budget_usd", "error_max_structured_output_retries"].includes(String(message.subtype))) return null;
      if (message.subtype === "error_max_turns" || message.subtype === "error_max_budget_usd") {
        assistantCode = null; retryAt = undefined; return null;
      }
      if (message.subtype === "success" && message.is_error === false) {
        assistantCode = null; retryAt = undefined; return null;
      }
      if (message.is_error !== true && message.subtype === "success") return null;
      const code = message.subtype === "error_max_structured_output_retries" ? "AI_PROVIDER_OUTPUT_INVALID" : assistantCode;
      return code ? new AiProviderFailureError({ code, provider: "anthropic",
        ...(code === "AI_PROVIDER_RATE_LIMITED" && retryAt ? { retryAt } : {}) }) : null;
    },
  };
}
