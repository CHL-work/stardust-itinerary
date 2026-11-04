import type { Pool } from "pg";

const SYNTHETIC_USER_ID = "00000000-0000-4000-8000-000000000001";
const SYNTHETIC_OPERATOR_EMAIL = "ai-eval-operator@example.test";
export const syntheticOperatorIdentity = {
  issuer: "https://accounts.google.com",
  subject: "synthetic-disposable-ai-eval-operator",
  emailHint: SYNTHETIC_OPERATOR_EMAIL,
} as const;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const evaluatorDatabase = /^stardust_test_ai_(?:reservation|reservation_clarification|search|auto|completion)_[a-z0-9_]+$/u;

function unsafeFixture(): never { throw new Error("Unsafe synthetic AI evaluator fixture."); }

/** Defense in depth after each evaluator's existing fresh-database checks. */
function guardTarget(connectionString: string): void {
  let target: URL;
  try { target = new URL(connectionString); } catch { unsafeFixture(); }
  let database: string;
  try { database = decodeURIComponent(target.pathname.slice(1)); } catch { unsafeFixture(); }
  if (!["postgres:", "postgresql:"].includes(target.protocol)
    || !loopbackHosts.has(target.hostname.toLowerCase()) || target.search || target.hash
    || database.length > 63 || !evaluatorDatabase.test(database)) unsafeFixture();
  for (const name of ["DATABASE_URL", "DATABASE_DIRECT_URL"] as const) {
    const value = process.env[name];
    if (!value) continue;
    let application: URL;
    try { application = new URL(value); } catch { continue; }
    let applicationDatabase: string;
    try { applicationDatabase = decodeURIComponent(application.pathname.slice(1)); } catch { continue; }
    if (loopbackHosts.has(application.hostname.toLowerCase())
      && (application.port || "5432") === (target.port || "5432")
      && applicationDatabase === database) unsafeFixture();
  }
}

/** Never call for app startup. This override exists only inside guarded evals. */
export async function withSyntheticAiOperator<T>(connectionString: string, work: () => Promise<T>): Promise<T> {
  guardTarget(connectionString);
  const previous = process.env.OWNER_GOOGLE_EMAIL;
  try {
    process.env.OWNER_GOOGLE_EMAIL = SYNTHETIC_OPERATOR_EMAIL;
    return await work();
  } finally {
    if (previous === undefined) delete process.env.OWNER_GOOGLE_EMAIL;
    else process.env.OWNER_GOOGLE_EMAIL = previous;
  }
}

/** Only the immutable demo fixture user may model a platform operator. */
export async function bindSyntheticAiOperator(pool: Pick<Pool, "query">, userId: string): Promise<void> {
  if (userId !== SYNTHETIC_USER_ID || process.env.OWNER_GOOGLE_EMAIL !== SYNTHETIC_OPERATOR_EMAIL) unsafeFixture();
  await pool.query(
    `INSERT INTO oidc_identities (issuer, subject, user_id, email_hint)
     VALUES ($1,$2,$3,$4)`,
    [syntheticOperatorIdentity.issuer, syntheticOperatorIdentity.subject, userId, SYNTHETIC_OPERATOR_EMAIL],
  );
}

/** Explicitly fund only the created synthetic trip; no broad settings update. */
export async function sponsorSyntheticAiTrip(pool: Pick<Pool, "query">, tripId: string, userId: string): Promise<void> {
  if (userId !== SYNTHETIC_USER_ID || process.env.OWNER_GOOGLE_EMAIL !== SYNTHETIC_OPERATOR_EMAIL
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(tripId)) unsafeFixture();
  const result = await pool.query(
    `UPDATE trip_ai_settings settings SET enabled = true, host_subscription_enabled = true
      WHERE settings.trip_id = $1 AND EXISTS (
        SELECT 1 FROM trip_members member JOIN oidc_identities identity ON identity.user_id = member.user_id
         WHERE member.trip_id = settings.trip_id AND member.user_id = $2
           AND member.role = 'owner' AND member.status = 'active'
           AND identity.issuer = $3 AND identity.subject = $4 AND identity.email_hint = $5
      )`,
    [tripId, userId, syntheticOperatorIdentity.issuer, syntheticOperatorIdentity.subject, SYNTHETIC_OPERATOR_EMAIL],
  );
  if (result.rowCount !== 1) unsafeFixture();
}
