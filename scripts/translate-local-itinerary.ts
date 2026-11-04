import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { z } from "zod";

import { applyPermittedChangeRequest, createChangeRequest } from "../src/lib/app/repository";
import type { AuthenticatedSession } from "../src/lib/auth/repository";
import {
  assertLocalPostgresUrl,
  assertLoopbackServerAddress,
  assertSelectedTripsComplete,
  parseItineraryTranslationPlan,
  prepareTripTranslations,
  type CurrentItineraryItem,
  type PlannedItineraryTranslation,
} from "../src/lib/maintenance/translate-itinerary";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment variables may already be provided by the caller.
}

type OwnerRow = {
  trip_id: string;
  trip_name: string;
  member_id: string;
  user_id: string;
  display_name: string;
};

type ItineraryRow = {
  id: string;
  day_date: string;
  current_revision: number;
  title: string;
  location_name: string | null;
  notes: string | null;
  map_url: string | null;
  visible_to_owner: boolean;
};

type PreparedTrip = {
  tripId: string;
  session: AuthenticatedSession;
  updates: PlannedItineraryTranslation[];
};

const localPlanPath = path.resolve("database/fixtures/local-itinerary-cantonese-plan.ts");

async function loadIgnoredLocalPlan(): Promise<unknown> {
  try {
    await access(localPlanPath);
  } catch {
    throw new Error("The ignored local Cantonese translation catalog is missing.");
  }
  const localModule = await import(pathToFileURL(localPlanPath).href) as Record<string, unknown>;
  if (!("CANTONESE_ITINERARY_TRANSLATION_PLAN" in localModule)) {
    throw new Error("The ignored local Cantonese translation catalog has no plan export.");
  }
  return localModule.CANTONESE_ITINERARY_TRANSLATION_PLAN;
}

function createMaintenanceSession(owner: OwnerRow): AuthenticatedSession {
  const expiry = new Date(Date.now() + 60 * 60 * 1_000);
  return {
    sessionId: "local-itinerary-translation",
    tripId: owner.trip_id,
    memberId: owner.member_id,
    userId: owner.user_id,
    role: "owner",
    expiresAt: expiry,
    absoluteExpiresAt: expiry,
    displayName: owner.display_name,
    issuer: "local-maintenance",
    subject: "local-maintenance",
    generation: 1,
  };
}

function matchesContent(
  row: { title: string; location_name: string | null; notes: string | null },
  expected: PlannedItineraryTranslation["after"],
): boolean {
  return row.title === expected.title
    && row.location_name === expected.locationName
    && row.notes === expected.notes;
}

async function verifyAppliedTranslation(
  pool: Pool,
  tripId: string,
  actorMemberId: string,
  requestId: string,
  update: PlannedItineraryTranslation,
  appliedRevision: number,
): Promise<void> {
  const result = await pool.query<{
    title: string;
    location_name: string | null;
    notes: string | null;
    map_url: string | null;
    current_revision: number;
    request_status: string;
    applied_revision: number | null;
    snapshot: Record<string, unknown>;
    has_requested_audit: boolean;
    has_update_audit: boolean;
  }>(
    `SELECT i.title, i.location_name, i.notes, i.map_url, i.current_revision,
            cr.status AS request_status, cr.applied_revision, ir.snapshot,
            EXISTS (
              SELECT 1 FROM audit_events ae
               WHERE ae.trip_id = i.trip_id
                 AND ae.entity_type = 'change_request'
                 AND ae.entity_id = cr.id
                 AND ae.action = 'requested'
            ) AS has_requested_audit,
            EXISTS (
              SELECT 1 FROM audit_events ae
               WHERE ae.trip_id = i.trip_id
                 AND ae.entity_type = 'itinerary_item'
                 AND ae.entity_id = i.id
                 AND ae.action = 'update'
                 AND ae.actor_member_id = $4
                 AND ae.metadata ->> 'changeRequestId' = cr.id::text
            ) AS has_update_audit
       FROM itinerary_items i
       JOIN change_requests cr
         ON cr.trip_id = i.trip_id AND cr.id = $3 AND cr.entity_id = i.id
       JOIN itinerary_revisions ir
         ON ir.trip_id = i.trip_id AND ir.itinerary_item_id = i.id
        AND ir.revision = $5
      WHERE i.trip_id = $1 AND i.id = $2`,
    [tripId, update.itemId, requestId, actorMemberId, appliedRevision],
  );
  const row = result.rows[0];
  if (!row
      || row.current_revision !== appliedRevision
      || row.request_status !== "approved"
      || row.applied_revision !== appliedRevision
      || !row.has_requested_audit
      || !row.has_update_audit
      || !matchesContent(row, update.after)
      || row.map_url !== update.originalMapUrl
      || row.snapshot.title !== update.after.title
      || row.snapshot.locationName !== update.after.locationName
      || row.snapshot.notes !== update.after.notes
      || row.snapshot.mapUrl !== update.originalMapUrl) {
    throw new Error("Post-update revision, audit, content, or map-link verification failed.");
  }
}

async function main(): Promise<void> {
  const argumentsSet = new Set(process.argv.slice(2));
  const allowedArguments = new Set(["--apply", "--confirm-local-data"]);
  if ([...argumentsSet].some((argument) => !allowedArguments.has(argument))) {
    throw new Error("Supported options are --apply and --confirm-local-data.");
  }
  const apply = argumentsSet.has("--apply");
  if (apply && !argumentsSet.has("--confirm-local-data")) {
    throw new Error("--apply also requires --confirm-local-data.");
  }
  if (!apply && argumentsSet.has("--confirm-local-data")) {
    throw new Error("--confirm-local-data is only valid together with --apply.");
  }

  const connectionString = process.env.DATABASE_DIRECT_URL;
  if (!connectionString) {
    throw new Error("DATABASE_DIRECT_URL is required from ignored local configuration.");
  }
  const parsedDatabaseUrl = assertLocalPostgresUrl(connectionString);
  const expectedDatabaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, ""));
  const plan = parseItineraryTranslationPlan(await loadIgnoredLocalPlan());
  const pool = new Pool({ connectionString, max: 2 });
  try {
    const serverResult = await pool.query<{
      database_name: string;
      server_address: string | null;
      configured_addresses: string;
      configured_port: number;
    }>(
      `SELECT current_database() AS database_name,
              inet_server_addr()::text AS server_address,
              current_setting('listen_addresses') AS configured_addresses,
              current_setting('port')::integer AS configured_port`,
    );
    const server = serverResult.rows[0];
    if (!server || server.database_name !== expectedDatabaseName) {
      throw new Error("The connected database name did not match DATABASE_DIRECT_URL.");
    }
    const expectedPort = Number(parsedDatabaseUrl.port || 5432);
    if (server.configured_port !== expectedPort) {
      throw new Error("The connected PostgreSQL port did not match DATABASE_DIRECT_URL.");
    }
    assertLoopbackServerAddress(server.server_address, server.configured_addresses);

    const ownerResult = await pool.query<OwnerRow>(
      `SELECT t.id AS trip_id, t.name AS trip_name, tm.id AS member_id,
              tm.user_id, tm.display_name
         FROM trips t
         JOIN trip_members tm
           ON tm.trip_id = t.id AND tm.role = 'owner'
          AND tm.status = 'active' AND tm.user_id IS NOT NULL
        WHERE t.name = ANY($1::text[])
        ORDER BY t.name`,
      [plan.exactTripNames],
    );
    assertSelectedTripsComplete(
      plan,
      ownerResult.rows.map((owner) => ({ name: owner.trip_name })),
    );

    const preparedTrips: PreparedTrip[] = [];
    for (const owner of ownerResult.rows) {
      const catalogTrip = plan.trips.find((trip) => trip.name === owner.trip_name);
      if (!catalogTrip) throw new Error("An allowed trip was missing from the translation catalog.");
      const itemResult = await pool.query<ItineraryRow>(
        `SELECT i.id, td.day_date::text, i.current_revision, i.title, i.location_name, i.notes, i.map_url,
                app_member_can_view_itinerary_item(i.trip_id, i.id, $2) AS visible_to_owner
           FROM itinerary_items i
           JOIN trip_days td ON td.trip_id = i.trip_id AND td.id = i.trip_day_id
          WHERE i.trip_id = $1
          ORDER BY i.trip_day_id, i.starts_at NULLS LAST, i.id`,
        [owner.trip_id, owner.member_id],
      );
      const currentItems: CurrentItineraryItem[] = itemResult.rows.map((item) => ({
        id: item.id,
        dayDate: item.day_date,
        currentRevision: Number(item.current_revision),
        title: item.title,
        locationName: item.location_name,
        notes: item.notes,
        mapUrl: item.map_url,
        visibleToOwner: item.visible_to_owner,
      }));
      preparedTrips.push({
        tripId: owner.trip_id,
        session: createMaintenanceSession(owner),
        updates: prepareTripTranslations(catalogTrip, currentItems),
      });
    }

    const preparedItemCount = preparedTrips.reduce((total, trip) => total + trip.updates.length, 0);
    const updates = preparedTrips.flatMap((trip) => trip.updates.filter((update) => update.changed));
    if (preparedItemCount !== plan.expectedItemCount) {
      throw new Error("The live item count did not match the complete translation catalog.");
    }

    if (!apply) {
      console.log(
        `Local-only dry run passed: ${preparedTrips.length} trips, ${preparedItemCount} items, `
        + `${updates.length} updates, ${preparedItemCount - updates.length} already Cantonese. No data changed.`,
      );
      return;
    }

    const reason = "Local maintenance: translate test itinerary content to Cantonese (catalog v1)";
    let appliedCount = 0;
    for (const trip of preparedTrips) {
      for (const update of trip.updates.filter((candidate) => candidate.changed)) {
        const created = await createChangeRequest(pool, trip.session, trip.tripId, {
          entityType: "itinerary_item",
          entityId: update.itemId,
          operation: "update",
          baseRevision: update.baseRevision,
          patch: {
            title: update.after.title,
            locationName: update.after.locationName,
            notes: update.after.notes,
          },
          reason,
          source: "owner",
        });
        const applied = await applyPermittedChangeRequest(
          pool,
          trip.session,
          trip.tripId,
          created.id,
        );
        if (applied.revision !== update.baseRevision + 1) {
          throw new Error("The applied itinerary revision was not consecutive.");
        }
        await verifyAppliedTranslation(
          pool,
          trip.tripId,
          trip.session.memberId,
          created.id,
          update,
          applied.revision,
        );
        appliedCount += 1;
      }
    }
    console.log(
      `Local translation completed: ${preparedTrips.length} trips, ${preparedItemCount} items, `
      + `${appliedCount} applied, ${preparedItemCount - appliedCount} already Cantonese.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const safeConfigurationError = error instanceof Error && (
    error.message.startsWith("DATABASE_DIRECT_URL")
    || error.message.startsWith("Supported options")
    || error.message.startsWith("--apply")
    || error.message.startsWith("--confirm-local-data")
    || error.message.includes("local-only")
    || error.message.includes("loopback")
    || error.message.includes("dedicated local application database")
    || error.message.startsWith("The ignored local Cantonese translation catalog")
  );
  const message = error instanceof z.ZodError
    ? "The ignored local Cantonese translation catalog is incomplete or invalid."
    : safeConfigurationError
      ? (error as Error).message
      : "Local itinerary translation stopped because preflight or post-update verification failed.";
  console.error(message);
  process.exitCode = 1;
});
