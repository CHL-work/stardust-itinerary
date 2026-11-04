import { isIP } from "node:net";

const EMAIL_PATTERN = /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu;
const LONG_NUMBER_PATTERN = /\d{8,}/gu;

function decodeForInspection(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function containsPrivateIdentifier(value: string): boolean {
  const decoded = decodeForInspection(value);
  return /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/iu.test(decoded)
    || /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu.test(decoded)
    || /\d{8,}/u.test(decoded);
}

export function sanitizePublicText(value: string, maxLength = 500): string {
  return decodeForInspection(value)
    .replace(EMAIL_PATTERN, "[redacted]")
    .replace(UUID_PATTERN, "[redacted]")
    .replace(LONG_NUMBER_PATTERN, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function isPrivateReservationPath(pathname: string): boolean {
  const decoded = decodeForInspection(pathname);
  if (containsPrivateIdentifier(decoded)) return true;
  const reservation = /\/(?:reserv(?:e|es|ation|ations)|book(?:ing|ings)?|orders?|receipts?)(?:\/|$)/iu;
  const privateAction = /\/(?:complete|confirmation|confirm|manage|modify|cancel)(?:\/|$)/iu;
  return reservation.test(decoded) && privateAction.test(decoded);
}

export function sanitizePublicSourceUrl(rawValue: string): string | null {
  try {
    const url = new URL(rawValue);
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || isIP(hostname)) {
      return null;
    }
    if (url.username || url.password || isPrivateReservationPath(url.pathname)) return null;

    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const values = url.searchParams.getAll(key);
      if (/(?:^|_)(?:access_?token|auth|booking|code|confirmation|credential|key|order|receipt|reservation|secret|session|signature|state)(?:$|_)/iu.test(key)
          || values.some(containsPrivateIdentifier)) {
        url.searchParams.delete(key);
      }
    }
    const result = url.toString();
    return result.length <= 2_000 && !containsPrivateIdentifier(result) ? result : null;
  } catch {
    return null;
  }
}

export function sanitizeSearchQueries(values: readonly string[]): string[] {
  return [...new Set(values
    .map((value) => sanitizePublicText(value, 500))
    .filter(Boolean))]
    .slice(0, 10);
}
