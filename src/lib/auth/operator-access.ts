import type { PoolClient } from "pg";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/**
 * The platform operator's Google emails from `OWNER_GOOGLE_EMAIL` (JOB-078): one email, or several
 * comma-separated accounts of the same person, lower-cased and without duplicates. Unset or blank
 * means no operator. Returns null when any entry is not an email, so a typo grants nobody.
 */
export function parseOperatorEmails(value: string | undefined): string[] | null {
  const emails = (value ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (emails.some((email) => !emailPattern.test(email))) return null;
  return [...new Set(emails)];
}

/** The configured operator emails; empty when unset or invalid. */
export function platformOperatorEmails(env: Record<string, string | undefined> = process.env): string[] {
  return parseOperatorEmails(env.OWNER_GOOGLE_EMAIL) ?? [];
}

/** Server configuration plus stored verified Google identity, never a trip role. */
export async function isPlatformOperator(
  client: Pick<PoolClient,"query">, userId: string,
): Promise<boolean> {
  const emails = platformOperatorEmails();
  if (emails.length === 0) return false;
  const result = await client.query(
    `SELECT 1 FROM oidc_identities WHERE user_id = $1
       AND issuer = 'https://accounts.google.com' AND lower(email_hint) = ANY($2::text[])`,
    [userId,emails],
  );
  return result.rows.length > 0;
}
