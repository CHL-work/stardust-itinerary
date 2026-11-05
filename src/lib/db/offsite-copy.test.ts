import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  STALE_UNVERIFIED_MS,
  clientConfig,
  copyCreatedAt,
  copyDatabaseName,
  copyMarker,
  countMismatches,
  isSourceDatabase,
  isVerifiedComment,
  offsiteOptions,
  planAfterCopy,
  planBeforeCopy,
  targetConnection,
  targetEnvironment,
  toolEnvironment,
  toolFailure,
  // @ts-expect-error The operator script is plain JavaScript without type declarations.
} from "../../../scripts/db/offsite-copy.mjs";

type Copy = { name: string; createdAt: Date; verified: boolean; bytes: number };

const MB = 1024 * 1024;
const at = (iso: string) => new Date(iso);
const copy = (iso: string, verified: boolean, bytes = 20 * MB): Copy => ({
  name: copyDatabaseName("stardust", at(iso)),
  createdAt: at(iso),
  verified,
  bytes,
});
// Synthetic credentials only.
const offsiteUrl = "postgresql://copy_owner:synthetic-password@db.example.test/maintenance?sslmode=require&channel_binding=require";

describe("off-site copy names", () => {
  it("encode the UTC start time and sort by age", () => {
    expect(copyDatabaseName("stardust", at("2026-11-05T19:00:12.345Z"))).toBe("stardust_20261105_190012");
    expect(copyDatabaseName("stardust", at("2026-11-05T19:00:12Z")) < copyDatabaseName("stardust", at("2026-11-06T01:00:00Z"))).toBe(true);
  });

  it("are recognised only for the configured prefix and a real time", () => {
    expect(copyCreatedAt("stardust", "stardust_20261105_190012")).toEqual(at("2026-11-05T19:00:12Z"));
    for (const name of ["neondb", "stardust", "stardust_20261105", "stardust_20261305_190012", "stardust_20261105_250000", "other_20261105_190012", "stardust_20261105_190012_old"]) {
      expect(copyCreatedAt("stardust", name)).toBeNull();
    }
  });

  it("mark only verified copies", () => {
    const marker = copyMarker({ tables: 52, rows: "1234" });
    expect(isVerifiedComment(marker)).toBe(true);
    expect(JSON.parse(marker.slice(marker.indexOf("{")))).toEqual({ tables: 52, rows: "1234" });
    expect(isVerifiedComment(null)).toBe(false);
    expect(isVerifiedComment("restored by hand")).toBe(false);
  });
});

describe("off-site copy options", () => {
  it("default to three copies within 500 MB", () => {
    expect(offsiteOptions({})).toEqual({ prefix: "stardust", keep: 3, budgetBytes: 500 * MB });
    expect(offsiteOptions({ STARDUST_OFFSITE_KEEP: "7", STARDUST_OFFSITE_MAX_MB: "900", STARDUST_OFFSITE_PREFIX: "trips" }))
      .toEqual({ prefix: "trips", keep: 7, budgetBytes: 900 * MB });
  });

  it("refuse values that could drop other databases or exceed the limits", () => {
    for (const env of [
      { STARDUST_OFFSITE_KEEP: "0" },
      { STARDUST_OFFSITE_KEEP: "15" },
      { STARDUST_OFFSITE_KEEP: "two" },
      { STARDUST_OFFSITE_MAX_MB: "5" },
      { STARDUST_OFFSITE_MAX_MB: "-1" },
      { STARDUST_OFFSITE_PREFIX: "Stardust" },
      { STARDUST_OFFSITE_PREFIX: "star_dust" },
      { STARDUST_OFFSITE_PREFIX: "a%" },
    ]) {
      expect(() => offsiteOptions(env)).toThrow();
    }
  });
});

describe("off-site copy retention", () => {
  const now = at("2026-11-06T19:00:00Z");

  it("keeps everything when the new copy fits the budget", () => {
    const copies = [copy("2026-11-04T19:00:00Z", true), copy("2026-11-05T19:00:00Z", true)];
    expect(planBeforeCopy(copies, { sourceBytes: 20 * MB, budgetBytes: 500 * MB, now })).toEqual({ drop: [], fits: true });
  });

  it("drops interrupted runs only once they are two hours old", () => {
    const stale = copy(new Date(now.getTime() - STALE_UNVERIFIED_MS).toISOString(), false);
    const running = copy(new Date(now.getTime() - STALE_UNVERIFIED_MS + 60_000).toISOString(), false);
    expect(planBeforeCopy([stale, running], { sourceBytes: 20 * MB, budgetBytes: 500 * MB, now }).drop).toEqual([stale.name]);
  });

  it("makes room by dropping the oldest verified copies, but never the newest", () => {
    const copies = [copy("2026-11-03T19:00:00Z", true, 40 * MB), copy("2026-11-05T19:00:00Z", true, 40 * MB), copy("2026-11-04T19:00:00Z", true, 40 * MB)];
    expect(planBeforeCopy(copies, { sourceBytes: 40 * MB, budgetBytes: 100 * MB, now }))
      .toEqual({ drop: [copies[0].name, copies[2].name], fits: true });
  });

  it("drops nothing verified when even the newest copy leaves no room", () => {
    const stale = copy("2026-11-06T10:00:00Z", false, 5 * MB);
    const copies = [copy("2026-11-04T19:00:00Z", true, 40 * MB), copy("2026-11-05T19:00:00Z", true, 40 * MB), stale];
    expect(planBeforeCopy(copies, { sourceBytes: 70 * MB, budgetBytes: 100 * MB, now })).toEqual({ drop: [stale.name], fits: false });
  });

  it("keeps the newest verified copies after a run and ignores unverified ones", () => {
    const copies = [
      copy("2026-11-02T19:00:00Z", true),
      copy("2026-11-06T19:00:00Z", true),
      copy("2026-11-03T19:00:00Z", true),
      copy("2026-11-05T19:00:00Z", false),
      copy("2026-11-04T19:00:00Z", true),
    ];
    expect(planAfterCopy(copies, { keep: 3 })).toEqual([copies[0].name]);
    expect(planAfterCopy(copies, { keep: 1 })).toEqual([copies[4].name, copies[2].name, copies[0].name]);
    expect(planAfterCopy(copies, { keep: 14 })).toEqual([]);
  });
});

describe("the off-site connection", () => {
  it("always verifies TLS off loopback, even when the URL says require", () => {
    const target = targetConnection(offsiteUrl);
    expect(target).toMatchObject({ host: "db.example.test", port: 5432, user: "copy_owner", database: "maintenance", tls: true, channelBinding: true });
    expect(clientConfig(target, "stardust_20261105_190012")).toMatchObject({
      database: "stardust_20261105_190012",
      ssl: { rejectUnauthorized: true, servername: "db.example.test" },
      enableChannelBinding: true,
    });
    const env = targetEnvironment(target, "stardust_20261105_190012", { PATH: "/usr/bin" });
    expect(env).toMatchObject({ PGSSLMODE: "verify-full", PGSSLROOTCERT: "system", PGCHANNELBINDING: "require", PGDATABASE: "stardust_20261105_190012", PATH: "/usr/bin" });
    expect(targetEnvironment(target, "x", {}, "/etc/ssl/bundle.pem").PGSSLROOTCERT).toBe("/etc/ssl/bundle.pem");
  });

  it("allows plain connections only to a loopback test server", () => {
    expect(targetConnection("postgresql://copy_owner:synthetic@127.0.0.1:5433/maintenance?sslmode=disable").tls).toBe(false);
    expect(() => targetConnection("postgresql://copy_owner:synthetic@db.example.test/maintenance?sslmode=disable")).toThrow(/TLS/u);
    expect(() => targetConnection("postgresql://copy_owner:synthetic@db.example.test/maintenance?sslmode=sometimes")).toThrow(/sslmode/u);
  });

  it("needs a complete postgresql URL", () => {
    for (const value of ["not a url", "https://db.example.test/maintenance", "postgresql://copy_owner@db.example.test/maintenance", "postgresql://copy_owner:synthetic@db.example.test/"]) {
      expect(() => targetConnection(value)).toThrow();
    }
  });

  it("refuses the source database itself", () => {
    const target = targetConnection("postgresql://copy_owner:synthetic@db.example.test:5432/stardust");
    expect(isSourceDatabase(target, "postgresql://postgres:synthetic@db.example.test/stardust")).toBe(true);
    expect(isSourceDatabase(target, "postgresql://postgres:synthetic@stardust-db:5432/stardust")).toBe(false);
    expect(isSourceDatabase(target, "postgresql://postgres:synthetic@db.example.test/other")).toBe(false);
  });

  it("gives the PostgreSQL tools neither side's credentials from the environment", () => {
    const env = toolEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/stardust",
      DATABASE_DIRECT_URL: "postgresql://postgres:synthetic@stardust-db/stardust",
      STARDUST_OFFSITE_DATABASE_URL: offsiteUrl,
      PGPASSWORD: "synthetic",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/stardust" });
  });
});

describe("tool failures", () => {
  it("keep only the first line, which never quotes the failing command or row", () => {
    const error = new Error("pg_restore exited with 1: pg_restore: error: could not execute query: ERROR:  relation \"trips\" already exists\nCommand was: CREATE TABLE public.trips (\n    name text NOT NULL");
    expect(toolFailure("the restore", error).message).toBe("the restore failed: pg_restore exited with 1: pg_restore: error: could not execute query: ERROR:  relation \"trips\" already exists");
  });
});

describe("the copy check", () => {
  it("reports missing tables and different counts", () => {
    expect(countMismatches({ "public.trips": "3", "public.members": "9" }, { "public.trips": "3", "public.members": "9", "neon.extra": "1" })).toEqual([]);
    expect(countMismatches({ "public.trips": "3", "public.members": "9" }, { "public.trips": "2" })).toEqual([
      "public.trips: 3 in the source, 2 in the copy",
      "public.members: 9 in the source, missing in the copy",
    ]);
  });
});

describe("the off-site copy job", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");

  it("runs as its own identity, reaches only the database, DNS and PostgreSQL's public port", () => {
    const cronjobs = read("deploy/k8s/base/cronjobs.yaml");
    const job = cronjobs.slice(cronjobs.indexOf("name: stardust-offsite-copy"), cronjobs.indexOf("name: stardust-guest-purge"));
    expect(job).toContain("serviceAccountName: stardust-offsite-copy");
    expect(job).toContain('args: ["offsite-copy"]');
    expect(job).toContain("secretName: stardust-offsite-env");
    expect(job).not.toMatch(/stardust-app-env|stardust-ai-env|stardust-credential-env|stardust-feedback-env/u);
    const policies = read("deploy/k8s/base/networkpolicies.yaml");
    const egress = policies.slice(policies.indexOf("name: offsite-copy-egress"));
    expect(egress).toContain("- 169.254.0.0/16");
    expect(egress).toMatch(/cidr: 0\.0\.0\.0\/0[\s\S]*port: 5432/u);
    expect(egress).not.toMatch(/port: 443/u);
    expect(policies).toMatch(/values: \[[^\]]*"offsite-copy"[^\]]*\]/u);
    expect(read("deploy/container/entrypoint.sh")).toContain("exec node $env_flags scripts/db/offsite-copy.mjs");
  });

  it("is the only workload granted the off-site connection", () => {
    const infra = read("infra/main.tf");
    expect(infra).toMatch(/"stardust-offsite-env"\s+= \["stardust-offsite-copy"\]/u);
    expect(read("deploy/k8s/overlays/gke/patches/workers-secrets.yaml")).toContain("secretProviderClass: stardust-offsite-env");
  });
});
