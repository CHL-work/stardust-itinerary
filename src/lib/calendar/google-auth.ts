import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import type { AuthConfig } from "@/lib/auth/config";

export const googleCalendarScope = "https://www.googleapis.com/auth/calendar.events";
export const calendarCookieNames = {
  state: "stardust.calendar-state",
  verifier: "stardust.calendar-verifier",
} as const;

export type CalendarAuthorizationTransaction = {
  authorizationUrl: URL;
  state: string;
  codeVerifier: string;
};

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  verified_account_subject: z.string().min(1).max(255).optional(),
});

export type GoogleCalendarTokens = z.infer<typeof tokenSchema>;

export function createCalendarAuthorizationTransaction(config: AuthConfig): CalendarAuthorizationTransaction {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const redirectUri = new URL("/api/integrations/google-calendar/callback", config.appBaseUrl);
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri.href,
    response_type: "code",
    scope: `${googleCalendarScope} openid`,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return { authorizationUrl, state, codeVerifier };
}

export async function completeCalendarAuthorization(
  config: AuthConfig,
  callbackUrl: URL,
  expectedState: string,
  codeVerifier: string,
): Promise<GoogleCalendarTokens> {
  const state = callbackUrl.searchParams.get("state");
  const code = callbackUrl.searchParams.get("code");
  if (!state || state !== expectedState || !code) throw new Error("Calendar authorization transaction is invalid.");
  const redirectUri = new URL("/api/integrations/google-calendar/callback", config.appBaseUrl);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri.href,
    }),
  });
  if (!response.ok) throw new Error("Google Calendar authorization failed.");
  const tokens = tokenSchema.omit({ verified_account_subject: true }).parse(await response.json());
  // The access token's own OIDC subject identifies the connected Calendar
  // account, which may deliberately differ from the app sign-in account.
  const identity = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!identity.ok) throw new Error("Calendar account identity could not be verified. Reconnect Google Calendar.");
  const user = z.object({ sub: z.string().min(1).max(255) }).parse(await identity.json());
  return { ...tokens, scope: tokens.scope ?? `${googleCalendarScope} openid`, verified_account_subject: user.sub };
}
