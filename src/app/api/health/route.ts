import { getPool } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

const DATABASE_CHECK_TIMEOUT_MS = 2_500;
const HEALTH_RESULT_CACHE_MS = 2_000;

type CachedHealthResult = {
  checkedAt: number;
  ready: boolean;
};

type TimedQueryPool = {
  query: (config: { text: string; query_timeout: number }) => Promise<unknown>;
};

let cachedHealthResult: CachedHealthResult | null = null;
let healthCheckInFlight: Promise<boolean> | null = null;

async function queryDatabaseReadiness() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  const parsedUrl = new URL(databaseUrl);
  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }
  const pool = getPool({ databaseUrl }) as unknown as TimedQueryPool;
  await pool.query({ text: "SELECT 1", query_timeout: DATABASE_CHECK_TIMEOUT_MS });
  return true;
}

async function isDatabaseReady() {
  const now = Date.now();
  if (cachedHealthResult && now - cachedHealthResult.checkedAt < HEALTH_RESULT_CACHE_MS) {
    return cachedHealthResult.ready;
  }
  if (healthCheckInFlight) return healthCheckInFlight;

  healthCheckInFlight = (async () => {
    let ready = false;
    try {
      ready = await queryDatabaseReadiness();
    } catch {
      ready = false;
    }
    cachedHealthResult = { checkedAt: Date.now(), ready };
    return ready;
  })();

  try {
    return await healthCheckInFlight;
  } finally {
    healthCheckInFlight = null;
  }
}

export function resetHealthCheckCacheForTests() {
  cachedHealthResult = null;
  healthCheckInFlight = null;
}

export async function GET() {
  const databaseReady = await isDatabaseReady();

  return Response.json(
    {
      status: databaseReady ? "ok" : "degraded",
      service: "stardust-itinerary",
      version: "0.1.0",
      database: databaseReady ? "ready" : "unavailable",
    },
    {
      status: databaseReady ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
