/** OS, locale and network settings a provider CLI needs; nothing from the application's own configuration. */
const runtimeVariable = /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|LANG|LC_ALL|TZ|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/iu;
/** Provider state directories and API keys, matched exactly. Base-URL overrides are never forwarded. */
const providerVariable = /^(?:CODEX_HOME|CODEX_API_KEY|OPENAI_API_KEY|CLAUDE_CONFIG_DIR|ANTHROPIC_API_KEY)$/u;

/**
 * Both installed SDKs replace (rather than merge) their subprocess env. Pass an explicit allowlist so
 * database URLs, session and OAuth secrets, map keys and publisher tokens never reach a model process.
 */
export function providerEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string> {
  return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined
    && (runtimeVariable.test(entry[0]) || providerVariable.test(entry[0]))));
}

/** Feedback needs OS/runtime and existing documented Codex authentication only. */
export function feedbackProviderEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const allowed = /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|LANG|LC_ALL|TZ|CODEX_HOME|CODEX_API_KEY|OPENAI_API_KEY|OPENAI_BASE_URL|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/iu;
  return Object.fromEntries(Object.entries(providerEnvironment(source)).filter(([key]) => allowed.test(key)));
}
