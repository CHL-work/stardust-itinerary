import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { withOperatorAiCredential } from "@/lib/ai/credential-context";
import { readFlightDetails } from "@/lib/app/flight";
import { applyFlightStatusUpdate } from "@/lib/app/repository";
import { createCodexDisruptionProvider, DISRUPTION_MODEL, DISRUPTION_TIMEOUT_MS } from "@/lib/disruptions/provider";
import type { DisruptionProvider } from "@/lib/disruptions/types";
import { flightStatusPrompt, publicLookupText } from "@/lib/flights/prompt";
import { dueFlightCheckSlot, FLIGHT_CHECK_OFFSETS_MINUTES } from "@/lib/flights/schedule";
import { decideFlightStatusUpdate, flightStatusOutputSchema, parseFlightStatusOutput } from "@/lib/flights/status";

export const FLIGHT_STATUS_FEATURE = "flight_status";
const LEASE_MINUTES = 10;
const DEFAULT_MAX_CHECKS = 2;

export type FlightStatusMonitorSummary = { checked: number; updated: number; unchanged: number; unverified: number; failed: number };
export type RunFlightStatusOptions = { now?: Date; maxChecks?: number; provider?: DisruptionProvider };

type DueFlightRow = {
  trip_id: string;
  item_id: string;
  starts_at: Date;
  ends_at: Date | null;
  current_revision: number;
  flight: unknown;
  departure_location_name: string | null;
  destination_location_name: string | null;
  time_zone: string;
  slot_minutes: number;
};

/** Local "YYYY-MM-DD HH:mm" of an instant in a time zone. */
function localDateTime(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/**
 * Flight status checks run only in operator-sponsored trips with background checks on, so always on
 * the operator's keys (D-095). Each run handles a small bounded batch; the database decides what is due.
 */
export function runDueFlightStatusChecks(pool: Pool, options: RunFlightStatusOptions = {}): Promise<FlightStatusMonitorSummary> {
  return withOperatorAiCredential(() => runAsOperator(pool, options));
}

async function runAsOperator(pool: Pool, options: RunFlightStatusOptions): Promise<FlightStatusMonitorSummary> {
  const now = options.now ?? new Date();
  const maxChecks = Math.min(10, Math.max(1, Math.trunc(options.maxChecks ?? DEFAULT_MAX_CHECKS)));
  const summary: FlightStatusMonitorSummary = { checked: 0, updated: 0, unchanged: 0, unverified: 0, failed: 0 };
  // A check that never finished (a crashed run) gives up its slot; the next slot runs as usual.
  await pool.query(
    `UPDATE flight_status_checks SET status = 'failed', error_code = 'lease_expired', completed_at = $1
      WHERE status = 'running' AND lease_expires_at < $1`, [now]);
  const due = await pool.query<DueFlightRow>(
    `SELECT i.trip_id, i.id AS item_id, i.starts_at, i.ends_at, i.current_revision, i.flight,
            i.departure_location_name, i.destination_location_name, trip.time_zone, slot.minutes AS slot_minutes
       FROM itinerary_items i
       JOIN trips trip ON trip.id = i.trip_id
       JOIN trip_ai_settings ai_settings ON ai_settings.trip_id = trip.id
       JOIN trip_disruption_settings checks ON checks.trip_id = trip.id AND checks.enabled
       CROSS JOIN LATERAL (
         SELECT min(offset_minutes)::integer AS minutes
           FROM unnest($3::integer[]) AS offset_minutes
          WHERE i.starts_at - make_interval(mins => offset_minutes) <= $1
       ) slot
      WHERE i.item_type = 'transport' AND i.flight IS NOT NULL
        AND i.visibility = 'trip' AND i.status = 'planned'
        AND to_jsonb(i)->>'removed_at' IS NULL
        AND i.starts_at > $1 AND i.starts_at <= $1 + interval '24 hours'
        AND trip.deleted_at IS NULL
        AND COALESCE((to_jsonb(ai_settings)->>'host_subscription_enabled')::boolean, true)
        AND slot.minutes IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM flight_status_checks done
           WHERE done.trip_id = i.trip_id AND done.itinerary_item_id = i.id
             AND done.departure_at = i.starts_at AND done.slot_minutes = slot.minutes)
      ORDER BY i.starts_at, i.trip_id, i.id
      LIMIT $2`,
    [now, maxChecks, [...FLIGHT_CHECK_OFFSETS_MINUTES]],
  );
  const provider = options.provider ?? createCodexDisruptionProvider();
  for (const row of due.rows) {
    const outcome = await checkFlight(pool, provider, row, now);
    if (outcome === "skipped") continue;
    summary.checked += 1;
    if (outcome === "failed") summary.failed += 1;
    else if (outcome === "unverified") summary.unverified += 1;
    else if (outcome === "unchanged" || outcome === "stale") summary.unchanged += 1;
    else summary.updated += 1;
  }
  return summary;
}

async function finishCheck(pool: Pool, row: DueFlightRow, values: { status: "succeeded" | "failed"; outcome?: string; errorCode?: string }) {
  await pool.query(
    `UPDATE flight_status_checks SET status = $5, outcome = $6, error_code = $7, completed_at = CURRENT_TIMESTAMP
      WHERE trip_id = $1 AND itinerary_item_id = $2 AND departure_at = $3 AND slot_minutes = $4 AND status = 'running'`,
    [row.trip_id, row.item_id, row.starts_at, row.slot_minutes, values.status, values.outcome ?? null, values.errorCode ?? null]);
}

async function checkFlight(pool: Pool, provider: DisruptionProvider, row: DueFlightRow, now: Date) {
  const flight = readFlightDetails(row.flight);
  const claimed = await pool.query(
    `INSERT INTO flight_status_checks (trip_id, itinerary_item_id, departure_at, slot_minutes, status, lease_expires_at)
     VALUES ($1, $2, $3, $4, 'running', $5) ON CONFLICT DO NOTHING RETURNING 1`,
    [row.trip_id, row.item_id, row.starts_at, row.slot_minutes, new Date(now.getTime() + LEASE_MINUTES * 60_000)]);
  if (claimed.rowCount === 0) return "skipped" as const;
  if (!flight) {
    await finishCheck(pool, row, { status: "failed", errorCode: "invalid_flight" });
    return "failed" as const;
  }

  const plannedLocal = localDateTime(row.starts_at, row.time_zone);
  const prompt = flightStatusPrompt({
    flightNumber: flight.flightNumber,
    airline: publicLookupText(flight.airline, 80),
    departureAirport: publicLookupText(row.departure_location_name),
    arrivalAirport: publicLookupText(row.destination_location_name),
    plannedLocalDeparture: plannedLocal,
    timeZone: row.time_zone,
    now,
  });
  const requestId = randomUUID();
  await pool.query(
    `INSERT INTO ai_requests (
       trip_id, id, actor_member_id, actor_user_id, conversation_id, actor_role, initiator_kind, feature, prompt_text,
       requested_model, provider, transport, authentication_mode, billing_basis, status, created_at
     ) VALUES ($1,$2,NULL,NULL,NULL,'system','system',$3,$4,$5,'openai','codex_sdk','api_key','api','started',$6)`,
    [row.trip_id, requestId, FLIGHT_STATUS_FEATURE, prompt, DISRUPTION_MODEL, now]);
  await pool.query(
    `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
     VALUES ($1, $2, 1, 'request.started', $3::jsonb)`,
    [row.trip_id, requestId, JSON.stringify({ feature: FLIGHT_STATUS_FEATURE, model: DISRUPTION_MODEL, slotMinutes: row.slot_minutes })]);
  await pool.query(
    `UPDATE flight_status_checks SET ai_request_id = $5
      WHERE trip_id = $1 AND itinerary_item_id = $2 AND departure_at = $3 AND slot_minutes = $4`,
    [row.trip_id, row.item_id, row.starts_at, row.slot_minutes, requestId]);

  const started = Date.now();
  let providerResult;
  try {
    providerResult = await provider.check({ prompt, outputSchema: flightStatusOutputSchema, signal: AbortSignal.timeout(DISRUPTION_TIMEOUT_MS) });
  } catch (error) {
    const errorCode = error instanceof Error && error.name ? error.name.slice(0, 80) : "provider_failed";
    await pool.query(
      `UPDATE ai_requests SET status = 'failed', error_code = $3, latency_ms = $4, completed_at = GREATEST(CURRENT_TIMESTAMP, created_at)
        WHERE trip_id = $1 AND id = $2`, [row.trip_id, requestId, errorCode, Math.max(0, Date.now() - started)]);
    await finishCheck(pool, row, { status: "failed", errorCode: "provider_failed" });
    return "failed" as const;
  }

  const result = parseFlightStatusOutput(providerResult.rawOutput);
  const decision = result
    ? decideFlightStatusUpdate({ startsAt: row.starts_at.toISOString(), endsAt: row.ends_at?.toISOString() ?? null,
      localDate: plannedLocal.slice(0, 10), flight }, result)
    : { outcome: "unverified" as const, reason: "unparsed" as const };
  await pool.query(
    `UPDATE ai_requests
        SET status = 'succeeded', result_text = $3, effective_model = $4, input_tokens = $5, output_tokens = $6,
            cached_input_tokens = $7, latency_ms = $8, completed_at = GREATEST(CURRENT_TIMESTAMP, created_at)
      WHERE trip_id = $1 AND id = $2`,
    [row.trip_id, requestId, JSON.stringify({ result, outcome: decision.outcome }).slice(0, 20_000), providerResult.effectiveModel,
      providerResult.inputTokens, providerResult.outputTokens, providerResult.cachedInputTokens, Math.max(0, Date.now() - started)]);
  await pool.query(
    `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
     VALUES ($1, $2, 2, 'request.completed', $3::jsonb)`,
    [row.trip_id, requestId, JSON.stringify({ status: "succeeded", outcome: decision.outcome,
      reason: decision.outcome === "unverified" ? decision.reason : null, webSearchCount: providerResult.webSearchCount })]);

  if (decision.outcome === "unverified" || decision.outcome === "unchanged") {
    await finishCheck(pool, row, { status: "succeeded", outcome: decision.outcome });
    return decision.outcome;
  }
  const applied = await applyFlightStatusUpdate(pool, {
    tripId: row.trip_id, itemId: row.item_id, expectedRevision: row.current_revision, expectedStartsAt: row.starts_at.toISOString(),
    decision, checkedAt: now,
  });
  await finishCheck(pool, row, { status: "succeeded", outcome: applied ? decision.outcome : "stale" });
  if (applied && decision.outcome === "schedule") {
    // The new departure's current slot is this check, so the next one follows the new time.
    const nextSlot = dueFlightCheckSlot(new Date(decision.startsAt), now);
    if (nextSlot !== null) {
      await pool.query(
        `INSERT INTO flight_status_checks (trip_id, itinerary_item_id, departure_at, slot_minutes, status, outcome, ai_request_id,
           lease_expires_at, completed_at)
         VALUES ($1, $2, $3, $4, 'succeeded', 'schedule', $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`,
        [row.trip_id, row.item_id, decision.startsAt, nextSlot, requestId]);
    }
  }
  return applied ? decision.outcome : "stale" as const;
}
