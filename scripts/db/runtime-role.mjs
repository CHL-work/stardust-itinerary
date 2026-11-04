// Ensure the least-privilege runtime role named in DATABASE_URL exists and holds exactly the
// application grants. Runs as the migration administrator (DATABASE_DIRECT_URL) after migrations.
// When both URLs use the same user (a simple self-hosted setup), there is nothing to do.
import pg from "pg";

const roleNamePattern = /^[a-z_][a-z0-9_]{0,62}$/u;

export function runtimeRoleFromEnvironment(env = process.env) {
  if (!env.DATABASE_DIRECT_URL || !env.DATABASE_URL) {
    throw new Error("DATABASE_DIRECT_URL and DATABASE_URL are required");
  }
  const admin = new URL(env.DATABASE_DIRECT_URL);
  const runtime = new URL(env.DATABASE_URL);
  const name = decodeURIComponent(runtime.username);
  if (!name || name === decodeURIComponent(admin.username)) return null;
  if (!roleNamePattern.test(name)) throw new Error("Runtime role name is not a plain lowercase identifier");
  const password = decodeURIComponent(runtime.password);
  if (password.length < 24) throw new Error("Runtime role password must be at least 24 characters");
  return { name, password };
}

export function grantStatements(client, roleName, database) {
  const role = client.escapeIdentifier(roleName);
  return [
    `GRANT CONNECT ON DATABASE ${client.escapeIdentifier(database)} TO ${role}`,
    "REVOKE CREATE ON SCHEMA public FROM PUBLIC",
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`,
    `DO $grant$ DECLARE item record; BEGIN
       FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'app_schema_migrations' LOOP
         EXECUTE format('GRANT INSERT, UPDATE, DELETE ON TABLE public.%I TO %I', item.tablename, ${client.escapeLiteral(roleName)});
       END LOOP;
     END $grant$`,
    `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.app_schema_migrations FROM ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`,
  ];
}

async function main() {
  const runtimeRole = runtimeRoleFromEnvironment();
  if (!runtimeRole) {
    console.log("Runtime uses the migration role; no separate runtime role to manage.");
    return;
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_DIRECT_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const database = (await client.query("SELECT current_database() AS name")).rows[0].name;
    const role = client.escapeIdentifier(runtimeRole.name);
    const password = client.escapeLiteral(runtimeRole.password);
    const existing = await client.query(
      "SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication FROM pg_roles WHERE rolname = $1",
      [runtimeRole.name],
    );
    if (existing.rowCount === 0) {
      await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${password} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    } else {
      const flags = existing.rows[0];
      if (flags.rolsuper || flags.rolcreatedb || flags.rolcreaterole || flags.rolbypassrls || flags.rolreplication) {
        throw new Error("Runtime role has elevated privileges; refusing to use it");
      }
      await client.query(`ALTER ROLE ${role} LOGIN PASSWORD ${password}`);
    }
    await client.query(`ALTER ROLE ${role} SET search_path = public, pg_catalog`);
    for (const statement of grantStatements(client, runtimeRole.name, database)) await client.query(statement);
    await client.query("COMMIT");
    console.log(`Runtime role ${runtimeRole.name} is current.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("runtime-role.mjs")) {
  await main();
}
