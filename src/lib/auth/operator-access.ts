import type { PoolClient } from "pg";

/** Server configuration plus stored verified Google identity, never a trip role. */
export async function isPlatformOperator(
  client: Pick<PoolClient,"query">, userId: string,
): Promise<boolean> {
  const email = process.env.OWNER_GOOGLE_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return false;
  const result = await client.query(
    `SELECT 1 FROM oidc_identities WHERE user_id = $1
       AND issuer = 'https://accounts.google.com' AND lower(email_hint) = $2`,
    [userId,email],
  );
  return result.rows.length > 0;
}
