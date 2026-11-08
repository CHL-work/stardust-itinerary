import type { NextResponse } from "next/server";
import { accountCookieName, verifyAccountOnboarding, type AccountPrincipal } from "@/lib/auth/account-session";
import { getAuthConfig, isAuthConfigured } from "@/lib/auth/config";
import { readAccountLocale } from "@/lib/auth/locale-preference";
import { verifySession, type AuthenticatedSession } from "@/lib/auth/repository";
import { authCookieNames } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";
import type { Locale } from "@/lib/i18n";
import { localeCookieMaxAge, localeCookieName, preferredLocale } from "@/lib/locale-preference";

type CookieReader = { get(name: string): { value: string } | undefined };

export async function resolveLocalePreference(jar: CookieReader, explicitLocale?: string) {
  let session: AuthenticatedSession | null = null;
  let account: AccountPrincipal | null = null;
  let accountLocale: Locale | null = null;
  if (isAuthConfigured()) {
    const config = getAuthConfig();
    const pool = getPool(config);
    const sessionToken = jar.get(authCookieNames.session)?.value;
    session = sessionToken ? await verifySession(pool, config, sessionToken) : null;
    if (!session) account = await verifyAccountOnboarding(pool, config, jar.get(accountCookieName)?.value);
    const principal = session ?? account;
    if (principal) accountLocale = await readAccountLocale(pool, principal.userId);
  }
  return { locale: preferredLocale(accountLocale, jar.get(localeCookieName)?.value, explicitLocale), session, account };
}

export async function resolveRequestLocale(jar: CookieReader, explicitLocale?: string): Promise<Locale> {
  return (await resolveLocalePreference(jar, explicitLocale)).locale;
}

export function setLocaleCookie(response: NextResponse, locale: Locale, secure: boolean): void {
  response.cookies.set(localeCookieName, locale, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: localeCookieMaxAge,
  });
}
