/**
 * Where the operator publishes the instance's privacy notice (`PRIVACY_NOTICE_URL`), shown on the
 * sign-in page next to sign-in and guest mode. HTTPS only, without credentials; anything else is
 * treated as unset, so no link appears.
 */
export function privacyNoticeUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.PRIVACY_NOTICE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}
