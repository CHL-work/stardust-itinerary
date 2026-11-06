import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

/**
 * Daily counters for the operator's admin page (JOB-069): one number per UTC day and metric, and
 * optionally per account. Counts only, never content, addresses or keys. Metrics in use:
 *
 * - `public_signup`: a new account from public Google sign-up (also what the daily cap counts);
 * - `guest_created`: a guest account started;
 * - `rate_limited:<scope>`: an attempt refused by a rate limit, a daily trip limit or the feedback
 *   limit, with the account when the attempt had one.
 *
 * Databases from before migration 0059 have no table; recording is then skipped, so a caller's
 * transaction is never aborted by a missing relation.
 */
export async function recordDailyCount(client: Queryable, metric: string, userId: string | null = null): Promise<void> {
  const table = await client.query<{ present: boolean }>("SELECT to_regclass('public.platform_daily_counts') IS NOT NULL AS present");
  if (!table.rows[0]?.present) return;
  await client.query(
    `INSERT INTO platform_daily_counts (day, metric, user_id, count)
     VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, $1, $2, 1)
     ON CONFLICT ON CONSTRAINT platform_daily_counts_key DO UPDATE SET count = platform_daily_counts.count + 1`,
    [metric, userId],
  );
}

/** Best effort, outside any transaction: a counter must never turn a refusal into a server error. */
export async function recordRefusal(client: Queryable, scope: string, userId: string | null = null): Promise<void> {
  await recordDailyCount(client, `rate_limited:${scope}`, userId).catch((error: unknown) => {
    console.warn("A refusal could not be counted", { scope, error: error instanceof Error ? error.name : "unknown" });
  });
}
