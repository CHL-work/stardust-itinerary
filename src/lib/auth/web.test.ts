import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import type { AuthConfig } from "@/lib/auth/config";
import { requireSameOrigin } from "@/lib/auth/web";

const config: AuthConfig = {
  appBaseUrl: new URL("https://stardust-itinerary.chl-work.com"),
  allowedOrigins: new Set([
    "https://stardust-itinerary.chl-work.com",
    "http://localhost:3100",
    "http://127.0.0.1:3100",
  ]),
  authSecret: "a".repeat(32),
  databaseUrl: "postgresql://local/test",
  googleClientId: "synthetic-client-id",
  googleClientSecret: "synthetic-client-secret",
  tripGraceDays: 2,
};

describe("same-origin protection", () => {
  it("accepts the canonical tunnel and explicit local testing origins", () => {
    for (const origin of config.allowedOrigins) {
      const request = new NextRequest(`${origin}/api/test`, { headers: { origin } });
      expect(() => requireSameOrigin(request, config)).not.toThrow();
    }
  });

  it("rejects an origin outside the configured allowlist", () => {
    const request = new NextRequest("https://stardust-itinerary.chl-work.com/api/test", {
      headers: { origin: "https://example.invalid" },
    });
    expect(() => requireSameOrigin(request, config)).toThrow("The request origin is not allowed.");
  });
});
