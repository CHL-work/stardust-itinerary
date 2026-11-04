import { describe, expect, it } from "vitest";

import {
  buildClaimUrl,
  buildJoinUrl,
  constantTimeSecretMatches,
  createDeviceLabel,
  createOpaqueToken,
  hashOpaqueToken,
  isOpaqueToken,
} from "@/lib/auth/tokens";

describe("authentication token helpers", () => {
  it("creates 256-bit URL-safe opaque tokens and purpose-separated hashes", () => {
    const token = createOpaqueToken();

    expect(isOpaqueToken(token)).toBe(true);
    expect(hashOpaqueToken("a".repeat(32), "claim", token)).toHaveLength(32);
    expect(hashOpaqueToken("a".repeat(32), "claim", token)).not.toEqual(
      hashOpaqueToken("a".repeat(32), "session", token),
    );
  });

  it("compares bootstrap credentials without leaking length or prefix matches", () => {
    expect(constantTimeSecretMatches("owner-secret", "owner-secret")).toBe(true);
    expect(constantTimeSecretMatches("owner-secret", "owner-secrex")).toBe(false);
    expect(constantTimeSecretMatches("owner-secret", "short")).toBe(false);
  });

  it("reduces user agents to a non-identifying device label", () => {
    expect(
      createDeviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome 140 · Windows");
    expect(createDeviceLabel(null)).toBe("Unknown browser");
  });

  it("keeps claim tokens in the browser fragment instead of the request URL", () => {
    const token = createOpaqueToken();
    const claimUrl = buildClaimUrl(new URL("http://localhost:3100"), token);

    expect(claimUrl).toBe(`http://localhost:3100/claim#token=${token}`);
    expect(new URL(claimUrl).pathname).toBe("/claim");
    expect(new URL(claimUrl).search).toBe("");
  });

  it("keeps reusable join tokens in the browser fragment instead of the request URL", () => {
    const token = createOpaqueToken();
    const joinUrl = buildJoinUrl(new URL("https://trip.example.test"), token);

    expect(joinUrl).toBe(`https://trip.example.test/join#token=${token}`);
    expect(new URL(joinUrl).pathname).toBe("/join");
    expect(new URL(joinUrl).search).toBe("");
  });
});
