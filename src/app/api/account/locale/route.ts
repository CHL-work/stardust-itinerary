import { NextRequest, NextResponse } from "next/server";
import { accountCookieName, verifyAccountOnboarding } from "@/lib/auth/account-session";
import { getAuthConfig, isAuthConfigured } from "@/lib/auth/config";
import { SessionUnavailableError } from "@/lib/auth/errors";
import { saveAccountLocale } from "@/lib/auth/locale-preference";
import { authenticatedSession, authCookieNames, requireSameOrigin } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import { isLocale } from "@/lib/i18n";
import { setLocaleCookie } from "@/lib/locale-preference-server";

async function readInput(request: NextRequest): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (!request.body || request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json"
    || (length !== null && (!/^\d+$/u.test(length) || Number(length) > 128))) throw new SyntaxError("Invalid language.");
  const reader = request.body.getReader();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const chunks: Uint8Array[] = []; let size = 0;
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new SyntaxError("Invalid language.");
    while (true) {
      const part = await reader.read();
      if (signal.aborted) throw new SyntaxError("Invalid language.");
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 128) throw new SyntaxError("Invalid language.");
      chunks.push(part.value);
    }
    if (length !== null && Number(length) !== size) throw new SyntaxError("Invalid language.");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { cancel(); throw new SyntaxError("Invalid language."); }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

export async function PUT(request: NextRequest) {
  const config = isAuthConfigured() ? getAuthConfig() : null;
  try {
    if (config) requireSameOrigin(request, config);
    else if (request.headers.get("origin") !== request.nextUrl.origin) throw new Error("Origin refused.");
  } catch {
    return NextResponse.json({ error: "Origin refused." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const body: unknown = await readInput(request);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1 || !("locale" in body) || typeof body.locale !== "string" || !isLocale(body.locale)) {
      return NextResponse.json({ error: "Choose a supported language." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (config) {
      const pool = getPool(config);
      const principal = await authenticatedSession(request, config)
        ?? await verifyAccountOnboarding(pool, config, request.cookies.get(accountCookieName)?.value);
      // Do not falsely report account persistence when a stale session is still present.
      if (!principal && (request.cookies.has(authCookieNames.session) || request.cookies.has(accountCookieName))) {
        return NextResponse.json({ error: "Sign in again to save your language." }, { status: 401, headers: { "Cache-Control": "no-store" } });
      }
      if (principal) await saveAccountLocale(pool, principal, body.locale);
    }
    const response = NextResponse.json({ locale: body.locale }, { headers: { "Cache-Control": "no-store" } });
    setLocaleCookie(response, body.locale, (config?.appBaseUrl ?? request.nextUrl).protocol === "https:");
    return response;
  } catch (error) {
    return NextResponse.json({ error: "Could not save the language. Try again." }, {
      status: error instanceof SyntaxError ? 400 : error instanceof SessionUnavailableError ? 401 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
