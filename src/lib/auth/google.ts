import * as oidc from "openid-client";

import type { AuthConfig } from "@/lib/auth/config";

const GOOGLE_ISSUER = new URL("https://accounts.google.com");
let cachedConfiguration: { clientId: string; value: oidc.Configuration } | null = null;

export type GoogleAuthorizationTransaction = {
  authorizationUrl: URL;
  codeVerifier: string;
  nonce: string;
  state: string;
};

export type GoogleIdentity = {
  issuer: string;
  subject: string;
  emailHint: string | null;
  displayNameHint: string | null;
};

async function getGoogleConfiguration(config: AuthConfig): Promise<oidc.Configuration> {
  if (cachedConfiguration?.clientId === config.googleClientId) {
    return cachedConfiguration.value;
  }

  const value = await oidc.discovery(
    GOOGLE_ISSUER,
    config.googleClientId,
    { client_secret: config.googleClientSecret },
    oidc.ClientSecretPost(config.googleClientSecret),
  );
  cachedConfiguration = { clientId: config.googleClientId, value };
  return value;
}

export async function createGoogleAuthorizationTransaction(
  config: AuthConfig,
): Promise<GoogleAuthorizationTransaction> {
  const provider = await getGoogleConfiguration(config);
  return buildGoogleAuthorizationTransaction(provider, config);
}

export function canonicalizeGoogleCallbackUrl(config: AuthConfig, callbackUrl: URL): URL {
  const canonicalCallbackUrl = new URL("/api/auth/google/callback", config.appBaseUrl);
  canonicalCallbackUrl.search = callbackUrl.search;
  return canonicalCallbackUrl;
}

export async function buildGoogleAuthorizationTransaction(
  provider: oidc.Configuration,
  config: AuthConfig,
): Promise<GoogleAuthorizationTransaction> {
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const nonce = oidc.randomNonce();
  const state = oidc.randomState();
  const redirectUri = new URL("/api/auth/google/callback", config.appBaseUrl);

  const authorizationUrl = oidc.buildAuthorizationUrl(provider, {
    client_id: config.googleClientId,
    redirect_uri: redirectUri.href,
    response_type: "code",
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    nonce,
    state,
    prompt: "select_account",
  });

  return { authorizationUrl, codeVerifier, nonce, state };
}

export async function completeGoogleAuthorization(
  config: AuthConfig,
  callbackUrl: URL,
  transaction: Pick<GoogleAuthorizationTransaction, "codeVerifier" | "nonce" | "state">,
): Promise<GoogleIdentity> {
  const provider = await getGoogleConfiguration(config);
  const canonicalCallbackUrl = canonicalizeGoogleCallbackUrl(config, callbackUrl);
  const tokens = await oidc.authorizationCodeGrant(provider, canonicalCallbackUrl, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedNonce: transaction.nonce,
    expectedState: transaction.state,
    idTokenExpected: true,
  });
  const claims = tokens.claims();

  if (!claims?.sub || claims.iss !== GOOGLE_ISSUER.href.slice(0, -1)) {
    throw new Error("Google returned an invalid identity.");
  }

  const emailHint =
    claims.email_verified === true && typeof claims.email === "string" ? claims.email : null;
  const displayNameHint = typeof claims.name === "string" ? claims.name : null;

  return {
    issuer: claims.iss,
    subject: claims.sub,
    emailHint,
    displayNameHint,
  };
}
