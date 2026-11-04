import { Pool, type PoolClient } from "pg";

import type { AuthConfig } from "@/lib/auth/config";

let pool: Pool | null = null;
let poolConnectionString: string | null = null;

export type DatabaseClient = Pick<PoolClient, "query">;

export function getPool(config: Pick<AuthConfig, "databaseUrl">): Pool {
  if (!pool || poolConnectionString !== config.databaseUrl) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    poolConnectionString = config.databaseUrl;
  }
  return pool;
}
