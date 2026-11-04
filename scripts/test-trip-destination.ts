import path from "node:path";
import { fileURLToPath } from "node:url";
import type { lookupTripDestination } from "../src/lib/ai/trip-destination-provider";

type Provider = typeof lookupTripDestination;
type CaseCode = "DALLAS" | "JAPAN" | "USA";
type ReportedTokens = { inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null };
type CaseResult = { pass: boolean; code: string; tokens: ReportedTokens | null };
export type DestinationSmokeReport = { pass: boolean; code: string; results: CaseResult[] };

const cases: { code: CaseCode; destination: string }[] = [
  { code: "DALLAS", destination: "Dallas" },
  { code: "JAPAN", destination: "Japan" },
];
const safeErrorCodes = new Set(["TIMEOUT", "PROVIDER_UNAVAILABLE", "INVALID_OUTPUT", "TOOL_BLOCKED"]);

function safeTokens(usage: Awaited<ReturnType<Provider>>["usage"]): ReportedTokens {
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return { inputTokens: count(usage.inputTokens), outputTokens: count(usage.outputTokens), cachedInputTokens: count(usage.cachedInputTokens) };
}

function matches(code: CaseCode, output: Awaited<ReturnType<Provider>>): boolean {
  if (output.effectiveModel !== "gpt-6.1-sol") return false;
  const value = output.defaults;
  if (value.reason !== null) return false;
  if (code === "USA") return value.status === "ambiguous" && value.countryCode === "US" && value.timeZone === null
    && value.currency === "USD" && value.countryTimeZones.length > 1 && value.countryTimeZones.includes("America/Chicago");
  return value.status === "resolved" && value.countryCode === (code === "DALLAS" ? "US" : "JP")
    && value.timeZone === (code === "DALLAS" ? "America/Chicago" : "Asia/Tokyo")
    && value.currency === (code === "DALLAS" ? "USD" : "JPY");
}

/** No env-file loading, database access, private trip data, or persisted app
 * records. Runtime provider imports happen only after explicit opt-in and the
 * credential-environment guard. The optional provider is for deterministic tests. */
export async function runTripDestinationSmoke(
  args: readonly string[], env: Readonly<Record<string, string | undefined>>, injectedProvider?: Provider,
): Promise<DestinationSmokeReport> {
  if (!args.includes("--run-live")) return { pass: true, code: "LIVE_NOT_REQUESTED", results: [] };
  if (args.some((arg) => !["--run-live", "--include-usa"].includes(arg))
    || new Set(args).size !== args.length) return { pass: false, code: "INVALID_ARGUMENTS", results: [] };
  // Credentials must come solely from the existing, restricted subscription
  // profile. Do not silently strip accidentally inherited application secrets.
  const forbidden = /API[_-]?(?:KEY|TOKEN)|AUTH[_-]?TOKEN|DATABASE|(?:^|_)PG(?:USER|PASSWORD|HOST|PORT|DATABASE|SERVICE|PASSFILE)$|(?:^|_)DB(?:_|$)|AUTH_SECRET|GOOGLE_CLIENT_SECRET|GITHUB_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|AWS_ACCESS_KEY|OPENAI_BASE_URL|ANTHROPIC_BASE_URL|^NODE_OPTIONS$/iu;
  if (Object.entries(env).some(([key, value]) => value !== undefined && value !== "" && forbidden.test(key))) {
    return { pass: false, code: "UNSAFE_ENVIRONMENT", results: [] };
  }
  let provider: Provider;
  try { provider = injectedProvider ?? (await import("../src/lib/ai/trip-destination-provider")).lookupTripDestination; }
  catch { return { pass: false, code: "PROVIDER_LOAD_FAILED", results: [] }; }
  const selected = args.includes("--include-usa") ? [...cases, { code: "USA" as const, destination: "USA" }] : cases;
  const results: CaseResult[] = [];
  for (const test of selected) {
    try {
      // Same 20-second allowance and actual provider harness as the app. This
      // outer signal also covers setup before the provider starts its timer.
      const output = await provider({ destination: test.destination, locale: "en", signal: AbortSignal.timeout(20_000) });
      const pass = matches(test.code, output);
      results.push({ pass, code: `${test.code}_${pass ? "PASS" : "RESULT_MISMATCH"}`, tokens: safeTokens(output.usage) });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        && safeErrorCodes.has(error.code) ? error.code : "PROVIDER_UNAVAILABLE";
      results.push({ pass: false, code: `${test.code}_${code}`, tokens: null });
    }
  }
  return { pass: results.every((result) => result.pass), code: "DESTINATION_SMOKE_COMPLETE", results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runTripDestinationSmoke(process.argv.slice(2), process.env);
    console.log(JSON.stringify(report));
    process.exitCode = report.pass ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ pass: false, code: "SMOKE_FAILED", results: [] }));
    process.exitCode = 1;
  }
}
