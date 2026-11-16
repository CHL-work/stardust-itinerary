import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { singleDestination, type TripDestination } from "@/lib/app/trip-destinations";

/**
 * Reads and writes a trip's destination list (JOB-098, D-110). Kept apart from the main repository so the
 * planner and Calendar can read it without loading (or, in tests, mocking) the whole repository.
 */
type Queryable = Pick<Pool | PoolClient, "query">;

/** Migration 0070 adds the list; older schemas (and their tests) keep one destination. */
export async function tripDestinationsAvailable(client: Queryable): Promise<boolean> {
  const result = await client.query<{ present: boolean }>("SELECT to_regclass('public.trip_destinations') IS NOT NULL AS present");
  return result.rows[0]?.present === true;
}

/** The trip's destinations in order, or its single destination where none are stored. */
export async function readTripDestinations(client: Queryable, tripId: string, fallback: { name: string; timeZone: string }): Promise<TripDestination[]> {
  if (!await tripDestinationsAvailable(client)) return singleDestination(fallback.name, fallback.timeZone);
  const result = await client.query<{ name: string; time_zone: string; starts_on: string | null; ends_on: string | null }>(
    "SELECT name, time_zone, starts_on::text, ends_on::text FROM trip_destinations WHERE trip_id = $1 ORDER BY position", [tripId]);
  return result.rows.length
    ? result.rows.map((row) => ({ name: row.name, timeZone: row.time_zone, startsOn: row.starts_on, endsOn: row.ends_on }))
    : singleDestination(fallback.name, fallback.timeZone);
}

/** Replaces the whole list in one statement pair; callers hold the trip lock. */
export async function replaceTripDestinations(client: Queryable, tripId: string, destinations: readonly TripDestination[]): Promise<void> {
  if (!await tripDestinationsAvailable(client)) return;
  await client.query("DELETE FROM trip_destinations WHERE trip_id = $1", [tripId]);
  await client.query(
    `INSERT INTO trip_destinations (trip_id, id, position, name, time_zone, starts_on, ends_on)
     SELECT $1, generated.id, generated.position, generated.name, generated.time_zone, generated.starts_on, generated.ends_on
       FROM unnest($2::uuid[], $3::smallint[], $4::text[], $5::text[], $6::date[], $7::date[])
         AS generated(id, position, name, time_zone, starts_on, ends_on)`,
    [tripId, destinations.map(() => randomUUID()), destinations.map((_, index) => index), destinations.map((item) => item.name),
      destinations.map((item) => item.timeZone), destinations.map((item) => item.startsOn), destinations.map((item) => item.endsOn)],
  );
}
