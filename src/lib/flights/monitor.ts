import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { withOperatorAiCredential } from "@/lib/ai/credential-context";
import { createRoutineCheckProvider } from "@/lib/ai/routine-check-provider";
import { readFlightDetails } from "@/lib/app/flight";
import { readEventTimeZones } from "@/lib/app/event-time-zone-contract";
import { applyFlightStatusUpdate } from "@/lib/app/repository";
import { createCodexDisruptionProvider, DISRUPTION_TIMEOUT_MS } from "@/lib/disruptions/provider";
import type { DisruptionProvider } from "@/lib/disruptions/types";
import { flightStatusDepartureTime, flightStatusPrompt, publicLookupText } from "@/lib/flights/prompt";
import { dueFlightCheckSlot, FLIGHT_CHECK_OFFSETS_MINUTES } from "@/lib/flights/schedule";
import { decideFlightStatusUpdate, flightStatusOutputSchema, parseFlightStatusOutput } from "@/lib/flights/status";
import {
  payerFromRow, routinePayerParameters, routinePayerSql, routineRequestColumns, withRoutinePayerKey,
  type RoutineFunding, type RoutinePayer,
} from "@/lib/routine-checks/funding";

export const FLIGHT_STATUS_FEATURE = "flight_status";
const LEASE_MINUTES = 10;
const DEFAULT_MAX_CHECKS = 2;

export type FlightStatusMonitorSummary = { checked: number; updated: number; unchanged: number; unverified: number; failed: number };
export type RunFlightStatusOptions = {
  now?: Date; maxChecks?: number; provider?: DisruptionProvider;
  /** "member": unsponsored trips on a member's own key, run by the web server (JOB-094). Default "operator". */
  funding?: "operator" | "member";
  /** Tests replace a member's provider; production builds one from the member's model and effort. */
  memberProvider?: (payer: RoutinePayer) => DisruptionProvider;
};

type DueFlightRow = {
  trip_id: string;
  item_id: string;
  title: string;
  starts_at: Date;
  ends_at: Date | null;
  current_revision: number;
  flight: unknown;
  time_zones?: unknown;
  departure_location_name: string | null;
  departure_map_url?: string | null;
  destination_location_name: string | null;
  destination_map_url?: string | null;
  time_zone: string;
  slot_minutes: number;
  payer_member_id?: string;
  payer_user_id?: string;
  payer_model?: string;
  payer_effort?: string;
  payer_provider?: string;
};

/**
 * Flight status checks (D-095). The operator's keys pay in sponsored trips with background checks on,
 * from the background worker. With `funding: "member"`, the web server checks unsponsored trips on a
 * member's own key (JOB-094, D-106). Each run handles a small bounded batch; the database decides what is due.
 */
export function runDueFlightStatusChecks(pool: Pool, options: RunFlightStatusOptions = {}): Promise<FlightStatusMonitorSummary> {
  if (options.funding === "member") return runOnMemberKeys(pool, options);
  return withOperatorAiCredential(() => runAsOperator(pool, options));
}

function emptySummary(): FlightStatusMonitorSummary {
  return { checked: 0, updated: 0, unchanged: 0, unverified: 0, failed: 0 };
}

function tally(summary: FlightStatusMonitorSummary, outcome: Awaited<ReturnType<typeof checkFlight>>): void {
  if (outcome === "skipped") return;
  summary.checked += 1;
  if (outcome === "failed") summary.failed += 1;
  else if (outcome === "unverified") summary.unverified += 1;
  else if (outcome === "unchanged" || outcome === "stale") summary.unchanged += 1;
  else summary.updated += 1;
}

async function releaseStaleLeases(pool: Pool, now: Date): Promise<void> {
  // A check that never finished (a crashed run) gives up its slot; the next slot runs as usual.
  await pool.query(
    `UPDATE flight_status_checks SET status = 'failed', error_code = 'lease_expired', completed_at = $1
      WHERE status = 'running' AND lease_expires_at < $1`, [now]);
}

const DUE_FLIGHT_COLUMNS = `i.trip_id, i.id AS item_id, i.title, i.starts_at, i.ends_at, i.current_revision, i.flight,
            to_jsonb(i)->'time_zones' AS time_zones,
            i.departure_location_name, i.departure_map_url, i.destination_location_name, i.destination_map_url,
            trip.time_zone, slot.minutes AS slot_minutes`;

const DUE_SLOT = `CROSS JOIN LATERAL (
         SELECT min(offset_minutes)::integer AS minutes
           FROM unnest($3::integer[]) AS offset_minutes
          WHERE i.starts_at - make_interval(mins => offset_minutes) <= $1
       ) slot`;

const DUE_FLIGHT_CONDITIONS = `i.item_type = 'transport' AND i.flight IS NOT NULL
        AND i.visibility = 'trip' AND i.status = 'planned'
        AND to_jsonb(i)->>'removed_at' IS NULL
        AND i.starts_at > $1 AND i.starts_at <= $1 + interval '24 hours'
        AND trip.deleted_at IS NULL
        AND slot.minutes IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM flight_status_checks done
           WHERE done.trip_id = i.trip_id AND done.itinerary_item_id = i.id
             AND done.departure_at = i.starts_at AND done.slot_minutes = slot.minutes)`;

async function runAsOperator(pool: Pool, options: RunFlightStatusOptions): Promise<FlightStatusMonitorSummary> {
  const now = options.now ?? new Date();
  const maxChecks = Math.min(10, Math.max(1, Math.trunc(options.maxChecks ?? DEFAULT_MAX_CHECKS)));
  const summary = emptySummary();
  await releaseStaleLeases(pool, now);
  const due = await pool.query<DueFlightRow>(
    `SELECT ${DUE_FLIGHT_COLUMNS}
       FROM itinerary_items i
       JOIN trips trip ON trip.id = i.trip_id
       JOIN trip_ai_settings ai_settings ON ai_settings.trip_id = trip.id
       JOIN trip_disruption_settings checks ON checks.trip_id = trip.id AND checks.enabled
       ${DUE_SLOT}
      WHERE ${DUE_FLIGHT_CONDITIONS}
        AND COALESCE((to_jsonb(ai_settings)->>'host_subscription_enabled')::boolean, true)
      ORDER BY i.starts_at, i.trip_id, i.id
      LIMIT $2`,
    [now, maxChecks, [...FLIGHT_CHECK_OFFSETS_MINUTES]],
  );
  const provider = options.provider ?? createCodexDisruptionProvider();
  for (const row of due.rows) tally(summary, await checkFlight(pool, provider, row, now, { kind: "operator" }));
  return summary;
}

/**
 * Unsponsored trips whose routine checks a member pays for. Only the web server runs this: it is the only
 * workload allowed to decrypt members' keys. The trip's background-check switch governs the operator's
 * checks; here the paying member's own opt-in takes its place.
 */
async function runOnMemberKeys(pool: Pool, options: RunFlightStatusOptions): Promise<FlightStatusMonitorSummary> {
  const now = options.now ?? new Date();
  const maxChecks = Math.min(10, Math.max(1, Math.trunc(options.maxChecks ?? DEFAULT_MAX_CHECKS)));
  const summary = emptySummary();
  await releaseStaleLeases(pool, now);
  const [models, providers] = routinePayerParameters();
  const due = await pool.query<DueFlightRow>(
    `SELECT ${DUE_FLIGHT_COLUMNS}, payer.member_id AS payer_member_id, payer.user_id AS payer_user_id,
            payer.model AS payer_model, payer.effort AS payer_effort, payer.provider AS payer_provider
       FROM itinerary_items i
       JOIN trips trip ON trip.id = i.trip_id
       JOIN trip_ai_settings ai_settings ON ai_settings.trip_id = trip.id
       ${DUE_SLOT}
       CROSS JOIN LATERAL (${routinePayerSql("trip.id", 4, 5)}) payer
      WHERE ${DUE_FLIGHT_CONDITIONS}
        AND NOT COALESCE((to_jsonb(ai_settings)->>'host_subscription_enabled')::boolean, true)
      ORDER BY i.starts_at, i.trip_id, i.id
      LIMIT $2`,
    [now, maxChecks, [...FLIGHT_CHECK_OFFSETS_MINUTES], models, providers],
  );
  for (const row of due.rows) {
    const payer = payerFromRow(row.payer_member_id && row.payer_user_id && row.payer_model && row.payer_effort && row.payer_provider
      ? { member_id: row.payer_member_id, user_id: row.payer_user_id, model: row.payer_model, effort: row.payer_effort, provider: row.payer_provider }
      : undefined);
    if (!payer) continue;
    const provider = options.memberProvider?.(payer) ?? createRoutineCheckProvider({ model: payer.model, effort: payer.effort });
    // A key that no longer opens skips the flight unclaimed; the next run tries again.
    const ran = await withRoutinePayerKey(pool, payer, () => checkFlight(pool, provider, row, now, { kind: "member", payer }));
    if (ran) tally(summary, ran.value);
  }
  return summary;
}

async function finishCheck(pool: Pool, row: DueFlightRow, values: { status: "succeeded" | "failed"; outcome?: string; errorCode?: string }) {
  await pool.query(
    `UPDATE flight_status_checks SET status = $5, outcome = $6, error_code = $7, completed_at = CURRENT_TIMESTAMP
      WHERE trip_id = $1 AND itinerary_item_id = $2 AND departure_at = $3 AND slot_minutes = $4 AND status = 'running'`,
    [row.trip_id, row.item_id, row.starts_at, row.slot_minutes, values.status, values.outcome ?? null, values.errorCode ?? null]);
}

async function checkFlight(pool: Pool, provider: DisruptionProvider, row: DueFlightRow, now: Date, funding: RoutineFunding) {
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

  // Title, saved map evidence and zone metadata are local resolver inputs, never sent to the provider.
  const departureTime = flightStatusDepartureTime({ itemType: "transport", title: row.title, flight,
    timeZones: readEventTimeZones(row.time_zones),
    departureLocationName: row.departure_location_name, departureMapUrl: row.departure_map_url,
    destinationLocationName: row.destination_location_name, destinationMapUrl: row.destination_map_url }, row.starts_at, row.time_zone);
  const prompt = flightStatusPrompt({
    flightNumber: flight.flightNumber,
    airline: publicLookupText(flight.airline, 80),
    departureAirport: publicLookupText(row.departure_location_name),
    arrivalAirport: publicLookupText(row.destination_location_name),
    ...departureTime,
    now,
  });
  const requestId = randomUUID();
  const paid = routineRequestColumns(funding);
  await pool.query(
    `INSERT INTO ai_requests (
       trip_id, id, actor_member_id, actor_user_id, conversation_id, actor_role, initiator_kind, feature, prompt_text,
       requested_model, provider, transport, authentication_mode, billing_basis, status, created_at,
       credential_source, credential_member_id
     ) VALUES ($1,$2,NULL,NULL,NULL,'system','system',$3,$4,$5,$7,$8,'api_key','api','started',$6,$9,$10)`,
    [row.trip_id, requestId, FLIGHT_STATUS_FEATURE, prompt, paid.model, now, paid.provider, paid.transport,
      paid.credentialSource, paid.credentialMemberId]);
  await pool.query(
    `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload)
     VALUES ($1, $2, 1, 'request.started', $3::jsonb)`,
    [row.trip_id, requestId, JSON.stringify({ feature: FLIGHT_STATUS_FEATURE, model: paid.model, effort: paid.effort,
      funding: funding.kind, slotMinutes: row.slot_minutes })]);
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
      localDate: departureTime.plannedLocalDeparture.slice(0, 10), flight }, result)
    : { outcome: "unverified" as const, reason: "unparsed" as const };
  await pool.query(
    `UPDATE ai_requests
        SET status = 'succeeded', result_text = $3, effective_model = $4, input_tokens = $5, output_tokens = $6,
            cached_input_tokens = $7, latency_ms = $8, web_search_count = $9, completed_at = GREATEST(CURRENT_TIMESTAMP, created_at)
      WHERE trip_id = $1 AND id = $2`,
    [row.trip_id, requestId, JSON.stringify({ result, outcome: decision.outcome }).slice(0, 20_000), providerResult.effectiveModel,
      providerResult.inputTokens, providerResult.outputTokens, providerResult.cachedInputTokens, Math.max(0, Date.now() - started),
      Math.min(10_000, Math.max(0, Math.trunc(providerResult.webSearchCount)))]);
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
