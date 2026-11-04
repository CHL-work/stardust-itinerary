import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

export function createOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashOpaqueToken(secret: string, purpose: string, token: string): Buffer {
  return createHmac("sha256", secret).update(`${purpose}\0${token}`, "utf8").digest();
}

export function hashRateLimitKey(secret: string, scope: string, key: string): Buffer {
  return hashOpaqueToken(secret, `rate-limit:${scope}`, key);
}

export function createDeviceLabel(userAgent: string | null): string {
  if (!userAgent) {
    return "Unknown browser";
  }

  const browser = userAgent.match(/(Edg|Chrome|Firefox|Safari)\/(\d+)/);
  const platform = userAgent.match(/Windows|Android|iPhone|iPad|Macintosh|Linux/);
  const browserName = browser?.[1] === "Edg" ? "Edge" : browser?.[1];
  return [browserName && `${browserName} ${browser?.[2]}`, platform?.[0]]
    .filter(Boolean)
    .join(" · ") || "Browser session";
}

export function constantTimeSecretMatches(expected: string, actual: string): boolean {
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

export function isOpaqueToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function buildClaimUrl(appBaseUrl: URL, rawToken: string): string {
  const claimUrl = new URL("/claim", appBaseUrl);
  claimUrl.hash = `token=${rawToken}`;
  return claimUrl.href;
}

export function buildJoinUrl(appBaseUrl: URL, rawToken: string): string {
  const joinUrl = new URL("/join", appBaseUrl);
  joinUrl.hash = `token=${rawToken}`;
  return joinUrl.href;
}
