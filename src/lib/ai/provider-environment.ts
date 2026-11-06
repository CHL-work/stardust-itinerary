import { requireAiCredential, userCredentialEnvironment } from "@/lib/ai/credential-context";

/** OS, locale and network settings a provider CLI needs; nothing from the application's own configuration. */
const runtimeVariable = /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|LANG|LC_ALL|TZ|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/iu;
/** Provider state directories and API keys, matched exactly. Base-URL overrides are never forwarded. */
const providerVariable = /^(?:CODEX_HOME|CODEX_API_KEY|OPENAI_API_KEY|CLAUDE_CONFIG_DIR|ANTHROPIC_API_KEY)$/u;
/** Replaced wholesale when a request runs on a user's own or shared key. */
const operatorScoped = /^(?:CODEX_HOME|CODEX_API_KEY|OPENAI_API_KEY|CLAUDE_CONFIG_DIR|ANTHROPIC_API_KEY|HOME)$/u;

/**
 * Both installed SDKs replace (rather than merge) their subprocess env. Pass an explicit allowlist so
 * database URLs, session and OAuth secrets, map keys and publisher tokens never reach a model process.
 * Inside a user-key request the operator's keys and profile directories are swapped for that user's
 * key and a per-request directory (see credential-context.ts). Outside any credential context it
 * throws instead of handing out the operator's keys.
 */
export function providerEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const credential = requireAiCredential();
  const allowed = Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined
    && (runtimeVariable.test(entry[0]) || providerVariable.test(entry[0]))));
  if (credential.source === "operator") return allowed;
  // A free guest request (JOB-071) never starts a keyed provider; refuse rather than run keyless.
  if (credential.source === "free") throw new Error("A free guest AI request cannot start a keyed provider.");
  for (const key of Object.keys(allowed)) if (operatorScoped.test(key)) delete allowed[key];
  return { ...allowed, ...userCredentialEnvironment(credential) };
}

/** Feedback needs OS/runtime and existing documented Codex authentication only. */
export function feedbackProviderEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const allowed = /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|LANG|LC_ALL|TZ|CODEX_HOME|CODEX_API_KEY|OPENAI_API_KEY|OPENAI_BASE_URL|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/iu;
  return Object.fromEntries(Object.entries(providerEnvironment(source)).filter(([key]) => allowed.test(key)));
}
