import * as oidc from "openid-client";
import { describe, expect, it } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import { buildGoogleAuthorizationTransaction, canonicalizeGoogleCallbackUrl } from "@/lib/auth/google";

describe("Google OIDC authorization", () => {
  it("uses authorization code, PKCE, state, and nonce without browser secrets", async () => {
    const config: AuthConfig = {
      appBaseUrl: new URL("http://localhost:3100"),
      allowedOrigins: new Set(["http://localhost:3100"]),
      authSecret: "a".repeat(32),
      databaseUrl: "postgresql://local/test",
      googleClientId: "synthetic-client-id",
      googleClientSecret: "synthetic-client-secret",
      tripGraceDays: 2,
    };
    const provider = new oidc.Configuration(
      {
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      },
      config.googleClientId,
      { client_secret: config.googleClientSecret },
      oidc.ClientSecretPost(config.googleClientSecret),
    );

    const transaction = await buildGoogleAuthorizationTransaction(provider, config);
    expect(transaction.authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(transaction.authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(transaction.authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3100/api/auth/google/callback",
    );
    expect(transaction.authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(transaction.authorizationUrl.searchParams.get("scope")).toBe("openid email profile");
    expect(transaction.authorizationUrl.searchParams.get("scope")).not.toContain("calendar");
    expect(transaction.authorizationUrl.searchParams.get("state")).toBe(transaction.state);
    expect(transaction.authorizationUrl.searchParams.get("nonce")).toBe(transaction.nonce);
    expect(transaction.authorizationUrl.href).not.toContain(config.googleClientSecret);
  });

  it("uses the configured public callback origin behind a local reverse proxy", () => {
    const config: AuthConfig = {
      appBaseUrl: new URL("https://stardust-itinerary.chl-work.com"),
      allowedOrigins: new Set(["https://stardust-itinerary.chl-work.com"]),
      authSecret: "a".repeat(32),
      databaseUrl: "postgresql://local/test",
      googleClientId: "synthetic-client-id",
      googleClientSecret: "synthetic-client-secret",
      tripGraceDays: 2,
    };
    const callback = canonicalizeGoogleCallbackUrl(
      config,
      new URL("http://127.0.0.1:3100/api/auth/google/callback?code=abc&state=xyz"),
    );
    expect(callback.href).toBe(
      "https://stardust-itinerary.chl-work.com/api/auth/google/callback?code=abc&state=xyz",
    );
  });
});
