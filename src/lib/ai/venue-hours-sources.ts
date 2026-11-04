import { containsPrivateIdentifier, sanitizePublicSourceUrl } from "@/lib/disruptions/privacy";

const publicArticleHosts = new Set(["the-chara.com", "www.the-chara.com"]);
const articleTrackingKeys = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "gclid", "fbclid", "msclkid", "tracking"]);

/** A WordPress post ID on this exact official endpoint is a public locator, not a booking token. */
export function sanitizeKnownPublicArticleSource(raw: string): string | null {
  try {
    if (raw.length > 2_000) return null;
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !publicArticleHosts.has(url.hostname) || url.pathname !== "/blog/") return null;
    const postIds = url.searchParams.getAll("p");
    if (postIds.length !== 1 || !/^[1-9]\d{0,6}$/u.test(postIds[0]!)) return null;
    for (const [key, value] of url.searchParams) {
      // Do not turn an account, preview, private or redirect URL into evidence
      // by silently removing its sensitive context. Only known tracking is disposable.
      if ((key !== "p" && !articleTrackingKeys.has(key)) || containsPrivateIdentifier(value)) return null;
    }
    url.search = "";
    url.searchParams.set("p", postIds[0]!);
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

/** Public restaurant IDs are not booking IDs. Keep this exception exact and local. */
export function sanitizeVenueHoursSource(raw: string): string | null {
  try {
    const url = new URL(raw);
    // Inspect the original query before generic redaction can erase a private
    // parameter or hide ambiguity between multiple article IDs.
    if (publicArticleHosts.has(url.hostname) && url.pathname === "/blog/" && url.search) {
      return sanitizeKnownPublicArticleSource(raw);
    }
  } catch { return null; }
  const strict = sanitizePublicSourceUrl(raw);
  if (strict) return strict;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !["tabelog.com", "www.tabelog.com"].includes(url.hostname)
      || !/^\/(?:(?:en|tw|cn|kr)\/)?[a-z][a-z0-9_-]*\/A\d{4}\/A\d{6}\/\d{8}\/?$/u.test(url.pathname)) return null;
    // Only the public venue landing page, never a review, account, reservation,
    // booking-management path, redirect or arbitrary long-number URL.
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
