import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { withOperatorAiCredential } from "@/lib/ai/credential-context";
import { buildDisruptionPromptBatches } from "@/lib/disruptions/prompt";
import {
  createCodexDisruptionProvider,
  DISRUPTION_MODEL,
  DisruptionProviderCleanupError,
  DisruptionProviderInvocationError,
  DisruptionProviderToolError,
  DISRUPTION_TIMEOUT_MS,
} from "@/lib/disruptions/provider";
import {
  sanitizePublicSourceUrl,
  sanitizePublicText,
  sanitizeSearchQueries,
} from "@/lib/disruptions/privacy";
import { disruptionOutputSchema, parseDisruptionOutput } from "@/lib/disruptions/schema";
import { assessDisruptionEligibility, DISRUPTION_QUALIFICATION_POLICY_VERSION } from "@/lib/disruptions/eligibility";
import type {
  DisruptionAlert,
  DisruptionCandidate,
  DisruptionMonitorSummary,
  DisruptionProviderResult,
  RunDisruptionMonitorOptions,
} from "@/lib/disruptions/types";

const DEFAULT_MAX_TRIPS = 8;
const DEFAULT_MAX_CANDIDATES_PER_BATCH = 4;
const DEFAULT_MAX_CANDIDATES_PER_RUN = 4;
const DEFAULT_MAX_RUN_DURATION_MS = 10 * 60_000;
const MAX_LOOKAHEAD_HOURS = 168;
const BACKLOG_WAKE_MINUTES = 5;
const FUTURE_EVENT_INTERVAL_MINUTES = 1_440;
const MIN_RETRY_MINUTES = 5;
const MAX_TRANSIENT_PROVIDER_RETRIES_PER_RUN = 1;
const PROVIDER_FINALIZATION_RESERVE_MS = 5_000;
const WARNING_STALE_GRACE_MINUTES = 10;
const MAX_SCHEDULER_INTERVAL_MINUTES = 1_440;
const MAX_WARNING_FRESHNESS_MINUTES = MAX_SCHEDULER_INTERVAL_MINUTES + WARNING_STALE_GRACE_MINUTES;

type DueTripRow = {
  trip_id: string;
  time_zone: string;
  interval_minutes: number;
  lookahead_hours: number;
  scheduled_for: Date | string;
};

type CandidateRow = {
  trip_id: string;
  id: string;
  current_revision: number;
  title: string;
  item_type: string;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  location_name: string | null;
  departure_location_name: string | null;
  destination_location_name: string | null;
  check_scope: "current_day" | "future_day";
  current_state: "possible" | "confirmed" | null;
  current_reason_code: DisruptionAlert["reasonCode"] | null;
  current_severity: DisruptionAlert["severity"] | null;
  current_detail: string | null;
  current_source_urls: unknown;
  current_evidence_fingerprint: string | null;
};

type CurrentWarningRow = {
  observation_id: string;
  itinerary_item_id: string;
  item_revision: number;
  state: "possible" | "confirmed" | "resolved";
  reason_code: DisruptionAlert["reasonCode"];
  severity: DisruptionAlert["severity"];
  detail: string;
  source_urls: unknown;
  evidence_fingerprint: string;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  qualification_policy_version: number;
};

type ClaimedTrip = {
  client: PoolClient;
  tripId: string;
  runId: string;
  scheduledFor: Date;
  timeZone: string;
  intervalMinutes: number;
  lookaheadHours: number;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function nullableDate(value: Date | string | null): Date | null {
  return value === null ? null : asDate(value);
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value!));
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name && error.name !== "Error") {
    return sanitizePublicText(error.name, 120) || "DISRUPTION_ERROR";
  }
  return "DISRUPTION_ERROR";
}

type ProviderFailureClassification = {
  code:
    | "DISRUPTION_PROVIDER_AUTH"
    | "DISRUPTION_PROVIDER_CLEANUP"
    | "DISRUPTION_PROVIDER_CONFIGURATION"
    | "DISRUPTION_PROVIDER_ERROR"
    | "DISRUPTION_PROVIDER_RATE_LIMIT"
    | "DISRUPTION_PROVIDER_TOOL"
    | "DISRUPTION_PROVIDER_TIMEOUT"
    | "DISRUPTION_PROVIDER_UNAVAILABLE";
  retryable: boolean;
};

function providerFailureProperty(error: unknown, key: string): unknown {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
  return Reflect.get(error, key);
}

function classifyProviderFailure(error: unknown, signal: AbortSignal): ProviderFailureClassification {
  if (error instanceof DisruptionProviderCleanupError) {
    return { code: "DISRUPTION_PROVIDER_CLEANUP", retryable: false };
  }
  // Checked by type before any message matching: its text must never read as a provider sign-in failure.
  if (error instanceof DisruptionProviderToolError) {
    return { code: "DISRUPTION_PROVIDER_TOOL", retryable: false };
  }
  const invocationError = error instanceof DisruptionProviderInvocationError;
  const providerError = invocationError ? error.providerError : error;
  const name = providerError instanceof Error ? providerError.name : "";
  const message = providerError instanceof Error
    ? providerError.message.toLocaleLowerCase("en-US")
    : "";
  const statusValue = providerFailureProperty(providerError, "status")
    ?? providerFailureProperty(providerError, "statusCode");
  const status = typeof statusValue === "number" && Number.isInteger(statusValue) ? statusValue : null;
  const providerCodeValue = providerFailureProperty(providerError, "code");
  const providerCode = typeof providerCodeValue === "string"
    ? providerCodeValue.toLocaleUpperCase("en-US")
    : "";

  if (signal.aborted || name === "AbortError" || name === "TimeoutError"
      || providerCode === "ETIMEDOUT" || /\b(?:timed out|timeout)\b/u.test(message)) {
    return { code: "DISRUPTION_PROVIDER_TIMEOUT", retryable: true };
  }
  if (status === 401 || status === 403
      || /\b(?:unauthorized|forbidden|authentication|not authenticated|sign[ -]?in required)\b/u.test(message)) {
    return { code: "DISRUPTION_PROVIDER_AUTH", retryable: false };
  }
  if (status === 429 || /\b(?:rate limit|too many requests)\b/u.test(message)) {
    return { code: "DISRUPTION_PROVIDER_RATE_LIMIT", retryable: false };
  }
  if (providerCode === "ENOENT" || providerCode === "EACCES"
      || /\b(?:outputschema|unsupported platform|unsupported target|invalid configuration)\b/u.test(message)) {
    return { code: "DISRUPTION_PROVIDER_CONFIGURATION", retryable: false };
  }
  if ((status !== null && status >= 500)
      || ["ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"].includes(providerCode)
      || /\b(?:temporarily unavailable|service unavailable|connection reset|connection refused)\b/u.test(message)) {
    return { code: "DISRUPTION_PROVIDER_UNAVAILABLE", retryable: invocationError };
  }

  // The Codex SDK deliberately converts a provider turn failure into a plain
  // Error, losing its structured status. One bounded retry is safer than
  // treating every tagged turn failure as permanent. Untagged programming,
  // setup, and filesystem errors remain terminal.
  return { code: "DISRUPTION_PROVIDER_ERROR", retryable: invocationError };
}

function normalizedProviderError(classification: ProviderFailureClassification): Error {
  const error = new Error("The disruption provider call failed.");
  error.name = classification.code;
  return error;
}

function hasProviderRetryBudget(deadlineAtMs: number, monotonicNowMs: number): boolean {
  return deadlineAtMs - monotonicNowMs >= DISRUPTION_TIMEOUT_MS + PROVIDER_FINALIZATION_RESERVE_MS;
}

function safeFailureResult(rawOutput: string | null): string | null {
  if (!rawOutput) return null;
  return sanitizePublicText(rawOutput, 8_000) || null;
}

function fingerprint(alert: Pick<DisruptionAlert,
  "state" | "reasonCode" | "detail" | "sourceUrls" | "affectedFrom" | "affectedUntil">): string {
  return createHash("sha256").update(JSON.stringify({
    state: alert.state,
    reasonCode: alert.reasonCode,
    detail: sanitizePublicText(alert.detail, 800).normalize("NFKC").toLocaleLowerCase("en-US"),
    sourceUrls: [...alert.sourceUrls].sort(),
    affectedFrom: alert.affectedFrom,
    affectedUntil: alert.affectedUntil,
  })).digest("hex");
}

function currentWarningFreshnessMinutes(providerMinutes: number, intervalMinutes: number): number {
  const schedulerFloor = Math.min(
    MAX_WARNING_FRESHNESS_MINUTES,
    Math.max(1, intervalMinutes) + WARNING_STALE_GRACE_MINUTES,
  );
  return Math.min(
    MAX_WARNING_FRESHNESS_MINUTES,
    Math.max(providerMinutes, schedulerFloor),
  );
}

function selectCandidatesForRun(
  candidates: readonly DisruptionCandidate[],
  maximum: number,
): DisruptionCandidate[] {
  // SQL orders work by the timestamp at which each event became due. This
  // keeps daily future checks from starving behind recurring current-day work.
  // One bounded prefix per wake still avoids sequential provider calls.
  return candidates.slice(0, maximum);
}

function remainingProviderTimeoutMs(deadlineAtMs: number, monotonicNowMs: number): number {
  const remaining = Math.floor(
    deadlineAtMs - monotonicNowMs - PROVIDER_FINALIZATION_RESERVE_MS,
  );
  if (remaining <= 0) {
    const error = new Error("The disruption monitor reached its run deadline.");
    error.name = "DisruptionRunDeadlineError";
    throw error;
  }
  return Math.min(DISRUPTION_TIMEOUT_MS, remaining);
}

function sourceHostnames(sourceUrls: readonly string[]): Set<string> {
  return new Set(sourceUrls.flatMap((value) => {
    const sanitized = sanitizePublicSourceUrl(value);
    return sanitized ? [new URL(sanitized).hostname.toLocaleLowerCase("en-US")] : [];
  }));
}

function alertEvidenceMatchesCandidate(
  alert: DisruptionAlert,
  candidate: DisruptionCandidate,
): boolean {
  const eventStart = candidate.startsAt ?? candidate.endsAt;
  const eventEnd = candidate.endsAt ?? candidate.startsAt;
  const affectedFrom = alert.affectedFrom ? new Date(alert.affectedFrom) : null;
  const affectedUntil = alert.affectedUntil ? new Date(alert.affectedUntil) : null;
  if (eventStart && affectedUntil && affectedUntil.getTime() < eventStart.getTime()) return false;
  if (eventEnd && affectedFrom && affectedFrom.getTime() > eventEnd.getTime()) return false;

  if (alert.state === "resolved") {
    if (!candidate.currentWarning || candidate.currentWarning.reasonCode !== alert.reasonCode) return false;
    const previousHosts = sourceHostnames(candidate.currentWarning.sourceUrls);
    const resolutionHosts = sourceHostnames(alert.sourceUrls);
    if (![...resolutionHosts].some((host) => previousHosts.has(host))) return false;
  }
  return true;
}

async function claimNextDueTrip(pool: Pool, now: Date): Promise<ClaimedTrip | null> {
  const client = await pool.connect();
  let advisoryLockHeld = false;
  let advisoryLockTripId: string | null = null;
  try {
    await client.query("BEGIN");
    const result = await client.query<DueTripRow>(
      `SELECT settings.trip_id, trip.time_zone, settings.interval_minutes,
              LEAST(settings.lookahead_hours, $2::integer) AS lookahead_hours,
              settings.next_due_at AS scheduled_for
         FROM trip_disruption_settings settings
         JOIN trips trip ON trip.id = settings.trip_id
         JOIN trip_ai_settings ai_settings ON ai_settings.trip_id = trip.id
        WHERE settings.enabled
          AND trip.deleted_at IS NULL
          AND COALESCE((to_jsonb(ai_settings)->>'host_subscription_enabled')::boolean, true)
          AND settings.next_due_at <= $1
          AND trip.ends_on >= ($1::timestamptz AT TIME ZONE trip.time_zone)::date
          AND trip.starts_on <= (($1::timestamptz + interval '7 days') AT TIME ZONE trip.time_zone)::date
          AND EXISTS (
            SELECT 1
              FROM itinerary_items candidate
              JOIN trip_days candidate_day
                ON candidate_day.trip_id = candidate.trip_id
               AND candidate_day.id = candidate.trip_day_id
              LEFT JOIN event_disruption_check_state check_state
                ON check_state.trip_id = candidate.trip_id
               AND check_state.itinerary_item_id = candidate.id
              CROSS JOIN LATERAL (
                SELECT
                  (($1::timestamptz AT TIME ZONE trip.time_zone)::date::timestamp
                    AT TIME ZONE trip.time_zone) AS current_day_start,
                  (((($1::timestamptz AT TIME ZONE trip.time_zone)::date + 1)::timestamp)
                    AT TIME ZONE trip.time_zone) AS next_day_start
              ) day_window
              CROSS JOIN LATERAL (
                SELECT
                  COALESCE(
                    candidate.starts_at, candidate.ends_at,
                    candidate_day.day_date::timestamp AT TIME ZONE trip.time_zone
                  ) AS effective_starts_at,
                  COALESCE(
                    candidate.ends_at, candidate.starts_at,
                    ((candidate_day.day_date + 1)::timestamp AT TIME ZONE trip.time_zone)
                      - interval '1 millisecond'
                  ) AS effective_ends_at
              ) timing
              CROSS JOIN LATERAL (
                SELECT CASE
                  WHEN timing.effective_starts_at < day_window.next_day_start
                   AND timing.effective_ends_at >= day_window.current_day_start
                    THEN 'current_day'
                  ELSE 'future_day'
                END AS check_scope
              ) event_scope
              CROSS JOIN LATERAL (
                SELECT CASE
                  WHEN check_state.itinerary_item_id IS NULL THEN candidate.created_at
                  WHEN check_state.item_revision <> candidate.current_revision THEN candidate.updated_at
                  WHEN check_state.check_scope <> event_scope.check_scope THEN check_state.last_checked_at
                  WHEN event_scope.check_scope = 'current_day'
                    THEN check_state.last_checked_at
                      + make_interval(mins => settings.interval_minutes)
                  ELSE check_state.last_checked_at + interval '1 day'
                END AS due_at
              ) event_schedule
             WHERE candidate.trip_id = settings.trip_id
               AND candidate.visibility = 'trip'
               AND candidate.status = 'planned'
               AND to_jsonb(candidate)->>'removed_at' IS NULL
               AND timing.effective_ends_at >= $1
               AND timing.effective_starts_at <= $1::timestamptz
                        + make_interval(hours => LEAST(settings.lookahead_hours, $2::integer))
               AND event_schedule.due_at <= $1
          )
        ORDER BY settings.next_due_at, settings.trip_id
        LIMIT 1
        FOR UPDATE OF settings SKIP LOCKED
        FOR KEY SHARE OF trip SKIP LOCKED`,
      [now, MAX_LOOKAHEAD_HOURS],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      client.release();
      return null;
    }

    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
      [`stardust-disruption:${row.trip_id}`],
    );
    advisoryLockHeld = lock.rows[0]?.locked === true;
    advisoryLockTripId = advisoryLockHeld ? row.trip_id : null;
    if (!advisoryLockHeld) {
      await client.query("ROLLBACK");
      client.release();
      return null;
    }

    const abandoned = await client.query<{ id: string; ai_request_id: string | null }>(
      `UPDATE disruption_monitor_runs
          SET status = 'failed', error_code = 'WORKER_INTERRUPTED', completed_at = $2
        WHERE trip_id = $1 AND status = 'running'
      RETURNING id, ai_request_id`,
      [row.trip_id, now],
    );
    const linkedRequestIds = abandoned.rows
      .map((run) => run.ai_request_id)
      .filter((id): id is string => Boolean(id));
    const abandonedRunIds = abandoned.rows.map((run) => run.id);
    if (abandonedRunIds.length > 0) {
      const interruptedRequests = await client.query<{ id: string }>(
        `UPDATE ai_requests
            SET status = 'failed', error_code = 'WORKER_INTERRUPTED',
                error_message = 'Disruption worker stopped before completion.', completed_at = $3
          WHERE trip_id = $1
            AND status = 'started'
            AND (
              id = ANY($2::uuid[])
              OR EXISTS (
                SELECT 1
                  FROM ai_request_events event
                 WHERE event.trip_id = ai_requests.trip_id
                   AND event.ai_request_id = ai_requests.id
                   AND event.event_type = 'request.started'
                   AND event.payload->>'monitorRunId' = ANY($4::text[])
              )
            )
        RETURNING id`,
        [row.trip_id, linkedRequestIds, now, abandonedRunIds],
      );
      const interruptedRequestIds = interruptedRequests.rows.map((request) => request.id);
      if (interruptedRequestIds.length > 0) {
        await client.query(
          `INSERT INTO ai_request_events (
             trip_id, ai_request_id, sequence, event_type, payload, created_at
           )
           SELECT $1, interrupted.request_id,
                  COALESCE((SELECT max(event.sequence) + 1
                              FROM ai_request_events event
                             WHERE event.trip_id = $1
                               AND event.ai_request_id = interrupted.request_id), 1),
                  'request.failed', '{"errorCode":"WORKER_INTERRUPTED"}'::jsonb, $3
             FROM unnest($2::uuid[]) AS interrupted(request_id)`,
          [row.trip_id, interruptedRequestIds, now],
        );
      }
    }

    const runId = randomUUID();
    await client.query(
      `INSERT INTO disruption_monitor_runs (
         trip_id, id, scheduled_for, status, candidate_count, web_search_count, started_at
       ) VALUES ($1,$2,$3,'running',0,0,$4)`,
      [row.trip_id, runId, row.scheduled_for, now],
    );
    await client.query(
      `UPDATE trip_disruption_settings
          SET last_attempt_at = $2,
              next_due_at = $2::timestamptz + make_interval(mins => $3::integer),
              updated_at = $2
        WHERE trip_id = $1`,
      [row.trip_id, now, BACKLOG_WAKE_MINUTES],
    );
    await client.query("COMMIT");
    return {
      client,
      tripId: row.trip_id,
      runId,
      scheduledFor: asDate(row.scheduled_for),
      timeZone: row.time_zone,
      intervalMinutes: Number(row.interval_minutes),
      lookaheadHours: Number(row.lookahead_hours),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (advisoryLockHeld && advisoryLockTripId) {
      await client.query(
        `SELECT pg_advisory_unlock(hashtextextended($1, 0))`,
        [`stardust-disruption:${advisoryLockTripId}`],
      ).catch(() => undefined);
    }
    client.release();
    throw error;
  }
}

async function releaseClaim(claim: ClaimedTrip): Promise<void> {
  try {
    await claim.client.query(
      `SELECT pg_advisory_unlock(hashtextextended($1, 0))`,
      [`stardust-disruption:${claim.tripId}`],
    );
  } finally {
    claim.client.release();
  }
}

async function loadCandidates(
  client: PoolClient,
  claim: ClaimedTrip,
  now: Date,
): Promise<DisruptionCandidate[]> {
  const horizon = new Date(now.getTime() + Math.min(claim.lookaheadHours, MAX_LOOKAHEAD_HOURS) * 60 * 60 * 1_000);
  const result = await client.query<CandidateRow>(
    `SELECT i.trip_id, i.id, i.current_revision, i.title, i.item_type,
            timing.effective_starts_at AS starts_at,
            timing.effective_ends_at AS ends_at,
            i.location_name,
            i.departure_location_name, i.destination_location_name,
            event_scope.check_scope,
            current.state AS current_state,
            current.reason_code AS current_reason_code,
            current.severity AS current_severity,
            current.detail AS current_detail,
            current.source_urls AS current_source_urls,
            current.evidence_fingerprint AS current_evidence_fingerprint
       FROM itinerary_items i
       JOIN trip_days td
         ON td.trip_id = i.trip_id AND td.id = i.trip_day_id
       JOIN trips trip ON trip.id = i.trip_id
       CROSS JOIN LATERAL (
         SELECT
           (($2::timestamptz AT TIME ZONE trip.time_zone)::date::timestamp
             AT TIME ZONE trip.time_zone) AS current_day_start,
           (((($2::timestamptz AT TIME ZONE trip.time_zone)::date + 1)::timestamp)
             AT TIME ZONE trip.time_zone) AS next_day_start
       ) day_window
       CROSS JOIN LATERAL (
         SELECT
           COALESCE(
             i.starts_at, i.ends_at,
             td.day_date::timestamp AT TIME ZONE trip.time_zone
           ) AS effective_starts_at,
           COALESCE(
             i.ends_at, i.starts_at,
             ((td.day_date + 1)::timestamp AT TIME ZONE trip.time_zone)
               - interval '1 millisecond'
           ) AS effective_ends_at
       ) timing
       CROSS JOIN LATERAL (
         SELECT CASE
           WHEN timing.effective_starts_at < day_window.next_day_start
            AND timing.effective_ends_at >= day_window.current_day_start
             THEN 'current_day'
           ELSE 'future_day'
         END AS check_scope
       ) event_scope
       LEFT JOIN event_disruption_current current
         ON current.trip_id = i.trip_id
        AND current.itinerary_item_id = i.id
        AND current.item_revision = i.current_revision
        AND current.state = 'confirmed'
        AND current.severity IN ('warning', 'critical')
        AND current.stale_after > $2
        AND EXISTS (
          SELECT 1 FROM event_disruption_observations qualified
           WHERE qualified.trip_id = current.trip_id
             AND qualified.id = current.observation_id
             AND qualified.itinerary_item_id = current.itinerary_item_id
             AND COALESCE(to_jsonb(qualified)->>'qualification_policy_version', '0') = '${DISRUPTION_QUALIFICATION_POLICY_VERSION}'
        )
       LEFT JOIN event_disruption_check_state check_state
         ON check_state.trip_id = i.trip_id
        AND check_state.itinerary_item_id = i.id
       CROSS JOIN LATERAL (
         SELECT CASE
           WHEN check_state.itinerary_item_id IS NULL THEN i.created_at
           WHEN check_state.item_revision <> i.current_revision THEN i.updated_at
           WHEN check_state.check_scope <> event_scope.check_scope THEN check_state.last_checked_at
           WHEN event_scope.check_scope = 'current_day'
             THEN check_state.last_checked_at + make_interval(mins => $4::integer)
           ELSE check_state.last_checked_at + interval '1 day'
         END AS due_at
       ) event_schedule
      WHERE i.trip_id = $1
        AND i.visibility = 'trip'
        AND i.status = 'planned'
        AND to_jsonb(i)->>'removed_at' IS NULL
        AND timing.effective_ends_at >= $2
        AND timing.effective_starts_at <= $3
        AND event_schedule.due_at <= $2
      ORDER BY event_schedule.due_at,
               timing.effective_starts_at, i.id`,
    [claim.tripId, now, horizon, claim.intervalMinutes],
  );
  return result.rows.map((row) => ({
    tripId: row.trip_id,
    itemId: row.id,
    revision: Number(row.current_revision),
    title: row.title,
    itemType: row.item_type,
    startsAt: nullableDate(row.starts_at),
    endsAt: nullableDate(row.ends_at),
    locationName: row.location_name,
    departureLocationName: row.departure_location_name,
    destinationLocationName: row.destination_location_name,
    checkScope: row.check_scope,
    currentWarning: row.current_state && row.current_reason_code && row.current_severity
      && row.current_detail && row.current_evidence_fingerprint
      ? {
          state: row.current_state,
          reasonCode: row.current_reason_code,
          severity: row.current_severity,
          detail: sanitizePublicText(row.current_detail, 800),
          sourceUrls: asSourceArray(row.current_source_urls),
          evidenceFingerprint: row.current_evidence_fingerprint,
        }
      : null,
  }));
}

async function completeSkipped(claim: ClaimedTrip, now: Date): Promise<void> {
  await claim.client.query("BEGIN");
  try {
    await claim.client.query(
      `UPDATE disruption_monitor_runs
          SET status = 'skipped', candidate_count = 0, completed_at = $3
        WHERE trip_id = $1 AND id = $2`,
      [claim.tripId, claim.runId, now],
    );
    await claim.client.query(
      `UPDATE trip_disruption_settings
          SET last_success_at = $2, last_error_code = NULL,
              next_due_at = $2::timestamptz + make_interval(mins => $3::integer), updated_at = $2
        WHERE trip_id = $1`,
      [claim.tripId, now, BACKLOG_WAKE_MINUTES],
    );
    await claim.client.query("COMMIT");
  } catch (error) {
    await claim.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function startAiRequest(
  claim: ClaimedTrip,
  prompt: string,
  batchCandidateCount: number,
  totalCandidateCount: number,
  batchIndex: number,
  batchCount: number,
  now: Date,
): Promise<string> {
  const requestId = randomUUID();
  await claim.client.query("BEGIN");
  try {
    await claim.client.query(
      `INSERT INTO ai_requests (
         trip_id, id, actor_member_id, actor_user_id, conversation_id, actor_role,
         initiator_kind, feature, prompt_text, requested_model, provider, transport,
         authentication_mode, billing_basis, status, created_at
       ) VALUES (
         $1,$2,NULL,NULL,NULL,'system','system','disruption_monitor',$3,$4,
         'openai','codex_sdk','api_key','api','started',$5
       )`,
      [claim.tripId, requestId, prompt, DISRUPTION_MODEL, now],
    );
    await claim.client.query(
      `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload, created_at)
       VALUES ($1,$2,1,'request.started',$3::jsonb,$4)`,
      [claim.tripId, requestId, JSON.stringify({
        feature: "disruption_monitor",
        model: DISRUPTION_MODEL,
        reasoningEffort: "medium",
        webSearchMode: "live",
        monitorRunId: claim.runId,
        batchCandidateCount,
        totalCandidateCount,
        batchIndex,
        batchCount,
      }), now],
    );
    await claim.client.query(
      `UPDATE disruption_monitor_runs
          SET candidate_count = $3, ai_request_id = COALESCE(ai_request_id, $4)
        WHERE trip_id = $1 AND id = $2`,
      [claim.tripId, claim.runId, totalCandidateCount, requestId],
    );
    await claim.client.query("COMMIT");
    return requestId;
  } catch (error) {
    await claim.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function sourceUrlsFromAlerts(alerts: readonly DisruptionAlert[]): string[] {
  return [...new Set(alerts.flatMap((alert) => alert.sourceUrls))].slice(0, 20);
}

function asSourceArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map(sanitizePublicSourceUrl)
    .filter((item): item is string => Boolean(item));
}

async function recordSuccessfulAiRequest(input: {
  claim: ClaimedTrip;
  requestId: string;
  eventSequenceStart: number;
  alerts: readonly DisruptionAlert[];
  suppressedAlerts: readonly { eventKey: string; reason: string }[];
  providerResult: DisruptionProviderResult;
  webSearchQueries: readonly string[];
  startedMs: number;
  completedAt: Date;
}): Promise<void> {
  const { claim } = input;
  await claim.client.query("BEGIN");
  try {
    const queries = sanitizeSearchQueries(input.webSearchQueries);
    const urls = sourceUrlsFromAlerts(input.alerts);
    // Retain parsed claims for owner audit even when they are deliberately
    // suppressed from the public warning projection. Suppression is not resolution.
    const acceptedAlertCount = input.alerts.length - input.suppressedAlerts.length;
    const qualification = {
      qualificationPolicyVersion: DISRUPTION_QUALIFICATION_POLICY_VERSION,
      suppressedAlerts: input.suppressedAlerts,
    };
    const resultText = JSON.stringify({ alerts: input.alerts, ...qualification });
    await claim.client.query(
      `UPDATE ai_requests
          SET result_text = $3, effective_model = $4, status = 'succeeded',
              input_tokens = $5, output_tokens = $6, cached_input_tokens = $7,
              latency_ms = $8, completed_at = $9
        WHERE trip_id = $1 AND id = $2`,
      [claim.tripId, input.requestId, resultText, input.providerResult.effectiveModel,
        input.providerResult.inputTokens, input.providerResult.outputTokens,
        input.providerResult.cachedInputTokens,
        Math.max(0, Date.now() - input.startedMs), input.completedAt],
    );
    await claim.client.query(
      `INSERT INTO ai_request_events (trip_id, ai_request_id, sequence, event_type, payload, created_at)
       VALUES
         ($1,$2,$3,'web.search.completed',$6::jsonb,$8),
         ($1,$2,$4,'provider.response.parsed',$7::jsonb,$8),
         ($1,$2,$5,'request.completed',$9::jsonb,$8)`,
      [claim.tripId, input.requestId,
        input.eventSequenceStart, input.eventSequenceStart + 1, input.eventSequenceStart + 2,
        JSON.stringify({
          provider: "openai",
          required: true,
          searched: true,
          toolCount: input.providerResult.webSearchCount,
          queryCount: queries.length,
          queries,
          sourceDomains: [...new Set(urls.map((url) => new URL(url).hostname))],
          sourceUrls: urls,
        }),
        JSON.stringify({
          alertCount: input.alerts.length,
          acceptedAlertCount,
          ...qualification,
          inputTokens: input.providerResult.inputTokens,
          outputTokens: input.providerResult.outputTokens,
          cachedInputTokens: input.providerResult.cachedInputTokens,
        }), input.completedAt,
        JSON.stringify({ status: "succeeded", acceptedAlertCount,
          suppressedAlertCount: input.suppressedAlerts.length,
          qualificationPolicyVersion: DISRUPTION_QUALIFICATION_POLICY_VERSION })],
    );
    await claim.client.query("COMMIT");
  } catch (error) {
    await claim.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function recordProviderRetry(input: {
  claim: ClaimedTrip;
  requestId: string;
  sequence: number;
  errorCode: ProviderFailureClassification["code"];
  createdAt: Date;
}): Promise<void> {
  await input.claim.client.query(
    `INSERT INTO ai_request_events (
       trip_id, ai_request_id, sequence, event_type, payload, created_at
     ) VALUES ($1,$2,$3,'provider.retry.scheduled',$4::jsonb,$5)`,
    [input.claim.tripId, input.requestId, input.sequence, JSON.stringify({
      attempt: 2,
      errorCode: input.errorCode,
      priorAttemptUsageAvailable: false,
      retryLimitScope: "run",
    }), input.createdAt],
  );
}

type CheckedCandidate = {
  candidate: DisruptionCandidate;
  alert: DisruptionAlert | null;
};

async function persistLocalizations(
  client: PoolClient, tripId: string, observationId: string, itemId: string, alert: DisruptionAlert,
): Promise<void> {
  if (!alert.localizedDetails) return;
  await client.query(
    `INSERT INTO event_disruption_localizations (trip_id, observation_id, itinerary_item_id, details, origin)
     VALUES ($1,$2,$3,$4::jsonb,'monitor')
     ON CONFLICT (trip_id, observation_id) DO NOTHING`,
    [tripId, observationId, itemId, JSON.stringify(alert.localizedDetails)],
  );
}

async function persistSuccessfulBatch(input: {
  claim: ClaimedTrip;
  checked: readonly CheckedCandidate[];
  completedAt: Date;
}): Promise<number> {
  const { claim } = input;
  await claim.client.query("BEGIN");
  try {
    const itemIds = input.checked.map((item) => item.candidate.itemId);
    const revisions = await claim.client.query<{
      id: string;
      current_revision: number;
      status: string;
      visibility: string;
    }>(
      `SELECT id, current_revision, status, visibility
         FROM itinerary_items
        WHERE trip_id = $1 AND id = ANY($2::uuid[])
          AND to_jsonb(itinerary_items)->>'removed_at' IS NULL
        FOR SHARE`,
      [claim.tripId, itemIds],
    );
    const currentRevisions = new Map(revisions.rows.map((row) => [row.id, row]));
    const currentWarnings = await claim.client.query<CurrentWarningRow>(
      `SELECT current.observation_id, current.itinerary_item_id, current.item_revision,
              current.state, current.reason_code, current.severity, current.detail,
              current.source_urls, current.evidence_fingerprint, current.first_seen_at, current.last_seen_at,
              qualified.qualification_policy_version
         FROM event_disruption_current current
         JOIN event_disruption_observations qualified
           ON qualified.trip_id = current.trip_id
          AND qualified.id = current.observation_id
          AND qualified.itinerary_item_id = current.itinerary_item_id
        WHERE current.trip_id = $1 AND current.itinerary_item_id = ANY($2::uuid[])
        FOR UPDATE OF current`,
      [claim.tripId, itemIds],
    );
    const previousByItem = new Map(currentWarnings.rows.map((row) => [row.itinerary_item_id, row]));
    let observationsWritten = 0;

    for (const checked of input.checked) {
      const { candidate, alert } = checked;
      const current = currentRevisions.get(candidate.itemId);
      if (!current || Number(current.current_revision) !== candidate.revision
          || current.status !== "planned" || current.visibility !== "trip") {
        continue;
      }
      await claim.client.query(
        `INSERT INTO event_disruption_check_state (
           trip_id, itinerary_item_id, item_revision, check_scope,
           last_checked_at, monitor_run_id
         ) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (trip_id, itinerary_item_id) DO UPDATE SET
           item_revision = EXCLUDED.item_revision,
           check_scope = EXCLUDED.check_scope,
           last_checked_at = EXCLUDED.last_checked_at,
           monitor_run_id = EXCLUDED.monitor_run_id`,
        [claim.tripId, candidate.itemId, candidate.revision, candidate.checkScope,
          input.completedAt, claim.runId],
      );
      if (!alert) continue;
      const previous = previousByItem.get(candidate.itemId);
      if (alert.state === "resolved") {
        if (!candidate.currentWarning || !previous
            || previous.state === "resolved"
            || previous.qualification_policy_version !== DISRUPTION_QUALIFICATION_POLICY_VERSION
            || previous.item_revision !== candidate.revision
            || previous.reason_code !== alert.reasonCode
            || previous.evidence_fingerprint !== candidate.currentWarning.evidenceFingerprint) {
          continue;
        }
      }

      const evidenceFingerprint = fingerprint(alert);
      const validUntil = new Date(input.completedAt.getTime() + alert.validForMinutes * 60 * 1_000);
      const cadenceMinutes = candidate.checkScope === "current_day"
        ? claim.intervalMinutes
        : FUTURE_EVENT_INTERVAL_MINUTES;
      const staleAfter = new Date(input.completedAt.getTime()
        + currentWarningFreshnessMinutes(alert.validForMinutes, cadenceMinutes) * 60 * 1_000);
      if (alert.state !== "resolved" && previous
          && previous.qualification_policy_version === DISRUPTION_QUALIFICATION_POLICY_VERSION
          && previous.state === alert.state
          && previous.severity === alert.severity
          && previous.item_revision === candidate.revision
          && previous.evidence_fingerprint === evidenceFingerprint) {
        await persistLocalizations(claim.client, claim.tripId, previous.observation_id, candidate.itemId, alert);
        await claim.client.query(
          `UPDATE event_disruption_current
              SET last_seen_at = $3, checked_at = $3, stale_after = $4
            WHERE trip_id = $1 AND itinerary_item_id = $2`,
          [claim.tripId, candidate.itemId, input.completedAt, staleAfter],
        );
        continue;
      }

      const observationId = randomUUID();
      const firstSeenAt = previous && previous.state !== "resolved"
        && previous.item_revision === candidate.revision
        && previous.reason_code === alert.reasonCode
        ? asDate(previous.first_seen_at)
        : input.completedAt;
      await claim.client.query(
        `INSERT INTO event_disruption_observations (
           trip_id, id, itinerary_item_id, monitor_run_id, item_revision, state,
           reason_code, severity, detail, source_urls, evidence_fingerprint,
           affected_from, affected_until, observed_at, valid_until, qualification_policy_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16)`,
        [claim.tripId, observationId, candidate.itemId, claim.runId, candidate.revision,
          alert.state, alert.reasonCode, alert.severity, alert.detail,
          JSON.stringify(alert.sourceUrls), evidenceFingerprint, alert.affectedFrom,
          alert.affectedUntil, input.completedAt, validUntil, DISRUPTION_QUALIFICATION_POLICY_VERSION],
      );
      await persistLocalizations(claim.client, claim.tripId, observationId, candidate.itemId, alert);
      if (alert.state === "resolved" && previous) {
        await claim.client.query(
          `UPDATE event_disruption_current
              SET observation_id = $3, state = 'resolved', reason_code = $4,
                  severity = $5, detail = $6, source_urls = $7::jsonb,
                  evidence_fingerprint = $8, checked_at = $9, stale_after = $10
            WHERE trip_id = $1 AND itinerary_item_id = $2`,
          [claim.tripId, candidate.itemId, observationId, alert.reasonCode, alert.severity,
            alert.detail, JSON.stringify(alert.sourceUrls), evidenceFingerprint,
            input.completedAt, staleAfter],
        );
      } else {
        await claim.client.query(
          `INSERT INTO event_disruption_current (
             trip_id, itinerary_item_id, observation_id, item_revision, state,
             reason_code, severity, detail, source_urls, evidence_fingerprint,
             first_seen_at, last_seen_at, checked_at, stale_after
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$12,$13)
           ON CONFLICT (trip_id, itinerary_item_id) DO UPDATE SET
             observation_id = EXCLUDED.observation_id,
             item_revision = EXCLUDED.item_revision,
             state = EXCLUDED.state,
             reason_code = EXCLUDED.reason_code,
             severity = EXCLUDED.severity,
             detail = EXCLUDED.detail,
             source_urls = EXCLUDED.source_urls,
             evidence_fingerprint = EXCLUDED.evidence_fingerprint,
             first_seen_at = EXCLUDED.first_seen_at,
             last_seen_at = EXCLUDED.last_seen_at,
             checked_at = EXCLUDED.checked_at,
             stale_after = EXCLUDED.stale_after`,
          [claim.tripId, candidate.itemId, observationId, candidate.revision, alert.state,
            alert.reasonCode, alert.severity, alert.detail, JSON.stringify(alert.sourceUrls),
            evidenceFingerprint, firstSeenAt, input.completedAt, staleAfter],
        );
      }
      observationsWritten += 1;
    }

    await claim.client.query("COMMIT");
    return observationsWritten;
  } catch (error) {
    await claim.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function completeSuccessfulRun(input: {
  claim: ClaimedTrip;
  candidateCount: number;
  webSearchCount: number;
  completedAt: Date;
}): Promise<void> {
  const { claim } = input;
  await claim.client.query("BEGIN");
  try {
    await claim.client.query(
      `UPDATE disruption_monitor_runs
          SET status = 'succeeded', candidate_count = $3,
              web_search_count = $4, completed_at = $5
        WHERE trip_id = $1 AND id = $2`,
      [claim.tripId, claim.runId, input.candidateCount, input.webSearchCount, input.completedAt],
    );
    await claim.client.query(
      `UPDATE trip_disruption_settings
          SET last_success_at = $2, last_error_code = NULL,
              next_due_at = $2::timestamptz + make_interval(mins => $3::integer), updated_at = $2
        WHERE trip_id = $1`,
      [claim.tripId, input.completedAt, BACKLOG_WAKE_MINUTES],
    );
    await claim.client.query("COMMIT");
  } catch (error) {
    await claim.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function persistFailedCheck(input: {
  claim: ClaimedTrip;
  requestId: string | null;
  eventSequenceStart: number;
  rawOutput: string | null;
  webSearchQueries: readonly string[];
  requestWebSearchCount: number;
  runWebSearchCount: number;
  effectiveModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  startedMs: number;
  completedAt: Date;
  error: unknown;
}): Promise<void> {
  const { claim } = input;
  const code = errorCode(input.error);
  await claim.client.query("BEGIN");
  try {
    const recent = await claim.client.query<{ status: string }>(
      `SELECT status
         FROM disruption_monitor_runs
        WHERE trip_id = $1 AND id <> $2
        ORDER BY scheduled_for DESC
        LIMIT 6`,
      [claim.tripId, claim.runId],
    );
    let previousConsecutiveFailures = 0;
    for (const row of recent.rows) {
      if (row.status !== "failed") break;
      previousConsecutiveFailures += 1;
    }
    const retryMinutes = Math.min(
      claim.intervalMinutes,
      MIN_RETRY_MINUTES * (2 ** Math.min(previousConsecutiveFailures, 5)),
    );
    const queries = sanitizeSearchQueries(input.webSearchQueries);

    if (input.requestId) {
      await claim.client.query(
        `UPDATE ai_requests
            SET result_text = $3, effective_model = $4, status = 'failed',
                input_tokens = $5, output_tokens = $6, cached_input_tokens = $7,
                latency_ms = $8, error_code = $9,
                error_message = 'Disruption provider call failed.', completed_at = $10
          WHERE trip_id = $1 AND id = $2`,
        [claim.tripId, input.requestId, safeFailureResult(input.rawOutput), input.effectiveModel,
          input.inputTokens, input.outputTokens, input.cachedInputTokens,
          Math.max(0, Date.now() - input.startedMs), code, input.completedAt],
      );
      const webSearchSequence = input.eventSequenceStart;
      const failureSequence = input.eventSequenceStart + 1;
      if (input.requestWebSearchCount > 0) {
        await claim.client.query(
          `INSERT INTO ai_request_events (
             trip_id, ai_request_id, sequence, event_type, payload, created_at
           ) VALUES ($1,$2,$3,'web.search.completed',$4::jsonb,$5)`,
          [claim.tripId, input.requestId, webSearchSequence, JSON.stringify({
            provider: "openai",
            required: true,
            searched: true,
            toolCount: input.requestWebSearchCount,
            queryCount: queries.length,
            queries,
          }), input.completedAt],
        );
      } else {
        await claim.client.query(
          `INSERT INTO ai_request_events (
             trip_id, ai_request_id, sequence, event_type, payload, created_at
           ) VALUES ($1,$2,$3,'web.search.missing',$4::jsonb,$5)`,
          [claim.tripId, input.requestId, webSearchSequence, JSON.stringify({
            provider: "openai",
            required: true,
            searched: false,
          }), input.completedAt],
        );
      }
      await claim.client.query(
        `INSERT INTO ai_request_events (
           trip_id, ai_request_id, sequence, event_type, payload, created_at
         ) VALUES ($1,$2,$3,'request.failed',$4::jsonb,$5)`,
        [claim.tripId, input.requestId, failureSequence, JSON.stringify({ errorCode: code }), input.completedAt],
      );
    }
    await claim.client.query(
      `UPDATE disruption_monitor_runs
          SET status = 'failed', web_search_count = $3, error_code = $4, completed_at = $5
        WHERE trip_id = $1 AND id = $2`,
      [claim.tripId, claim.runId, input.runWebSearchCount, code, input.completedAt],
    );
    await claim.client.query(
      `UPDATE trip_disruption_settings
          SET last_error_code = $2,
              next_due_at = $3::timestamptz + make_interval(mins => $4::integer), updated_at = $3
        WHERE trip_id = $1`,
      [claim.tripId, code, input.completedAt, retryMinutes],
    );
    await claim.client.query("COMMIT");
  } catch (error) {
    await claim.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function processClaim(
  claim: ClaimedTrip,
  options: Required<Pick<RunDisruptionMonitorOptions,
    "provider" | "maxCandidatesPerBatch" | "maxCandidatesPerRun">> & { deadlineAtMs: number },
  now: Date,
): Promise<{ status: "succeeded" | "failed" | "skipped"; observations: number }> {
  let requestId: string | null = null;
  let requestPending = false;
  let rawOutput: string | null = null;
  let webSearchQueries: string[] = [];
  let requestWebSearchCount = 0;
  let effectiveModel: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cachedInputTokens: number | null = null;
  let requestStartedMs = Date.now();
  let requestEventSequence = 2;
  let runWebSearchCount = 0;
  let observationsWritten = 0;
  let providerRetriesRemaining = MAX_TRANSIENT_PROVIDER_RETRIES_PER_RUN;
  try {
    const availableCandidates = await loadCandidates(claim.client, claim, now);
    if (availableCandidates.length === 0) {
      await completeSkipped(claim, now);
      return { status: "skipped", observations: 0 };
    }
    const candidates = selectCandidatesForRun(
      availableCandidates,
      options.maxCandidatesPerRun,
    );
    const batches = buildDisruptionPromptBatches(
      claim.timeZone,
      now,
      candidates,
      options.maxCandidatesPerBatch,
    );
    const checked: CheckedCandidate[] = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex]!;
      requestId = null;
      requestPending = false;
      rawOutput = null;
      webSearchQueries = [];
      requestWebSearchCount = 0;
      effectiveModel = null;
      inputTokens = null;
      outputTokens = null;
      cachedInputTokens = null;
      requestStartedMs = Date.now();
      requestEventSequence = 2;
      requestId = await startAiRequest(
        claim,
        batch.prompt,
        batch.candidates.length,
        candidates.length,
        batchIndex + 1,
        batches.length,
        new Date(),
      );
      requestPending = true;
      let result: DisruptionProviderResult;
      while (true) {
        const signal = AbortSignal.timeout(
          remainingProviderTimeoutMs(options.deadlineAtMs, performance.now()),
        );
        try {
          result = await options.provider.check({
            prompt: batch.prompt,
            outputSchema: disruptionOutputSchema,
            signal,
          });
          break;
        } catch (error) {
          const failure = classifyProviderFailure(error, signal);
          if (!failure.retryable || providerRetriesRemaining < 1
              || !hasProviderRetryBudget(options.deadlineAtMs, performance.now())) {
            throw normalizedProviderError(failure);
          }
          await recordProviderRetry({
            claim,
            requestId,
            sequence: requestEventSequence,
            errorCode: failure.code,
            createdAt: new Date(),
          });
          requestEventSequence += 1;
          providerRetriesRemaining -= 1;
        }
      }
      rawOutput = result.rawOutput;
      webSearchQueries = sanitizeSearchQueries(result.webSearchQueries);
      requestWebSearchCount = Number.isInteger(result.webSearchCount) && result.webSearchCount > 0
        ? Math.min(result.webSearchCount, 10_000)
        : 0;
      runWebSearchCount += requestWebSearchCount;
      effectiveModel = result.effectiveModel;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      cachedInputTokens = result.cachedInputTokens;
      if (requestWebSearchCount < 1) {
        const missingSearchError = new Error("A hosted web search item is required for disruption results.");
        missingSearchError.name = "MissingWebSearchEvidenceError";
        throw missingSearchError;
      }
      const allowedKeys = new Set(batch.publicCandidates.map((candidate) => candidate.key));
      const alerts = parseDisruptionOutput(rawOutput, allowedKeys);
      const acceptedAlerts: DisruptionAlert[] = [];
      const suppressedAlerts: Array<{ eventKey: string; reason: string }> = [];
      for (const alert of alerts) {
        const eventIndex = Number.parseInt(alert.eventKey.slice(1), 10) - 1;
        const candidate = batch.candidates[eventIndex];
        const publicCandidate = batch.publicCandidates[eventIndex];
        if (!candidate || !publicCandidate) throw new Error("The disruption response referenced an unknown event key.");
        if (alert.state === "resolved") {
          if (!alertEvidenceMatchesCandidate(alert, candidate)) {
            const invalidEvidence = new Error("A resolved disruption must match the current warning, source host, and event time.");
            invalidEvidence.name = "InvalidResolutionEvidenceError";
            throw invalidEvidence;
          }
        } else {
          const eligibility = assessDisruptionEligibility(alert, publicCandidate, now);
          if (!eligibility.eligible || !alertEvidenceMatchesCandidate(alert, candidate)) {
            suppressedAlerts.push({ eventKey: alert.eventKey,
              reason: eligibility.eligible ? "event_time_mismatch" : eligibility.reason });
            continue;
          }
        }
        acceptedAlerts.push(alert);
      }
      await recordSuccessfulAiRequest({
        claim,
        requestId,
        eventSequenceStart: requestEventSequence,
        alerts,
        suppressedAlerts,
        providerResult: result,
        webSearchQueries,
        startedMs: requestStartedMs,
        completedAt: new Date(),
      });
      requestPending = false;
      const alertsByKey = new Map(acceptedAlerts.map((alert) => [alert.eventKey, alert]));
      const checkedBatch = batch.candidates.map((candidate, index) => ({
        candidate,
        alert: alertsByKey.get(`E${index + 1}`) ?? null,
      }));
      checked.push(...checkedBatch);
      observationsWritten += await persistSuccessfulBatch({
        claim,
        checked: checkedBatch,
        completedAt: new Date(),
      });
    }

    await completeSuccessfulRun({
      claim,
      candidateCount: checked.length,
      webSearchCount: runWebSearchCount,
      completedAt: new Date(),
    });
    return { status: "succeeded", observations: observationsWritten };
  } catch (error) {
    await persistFailedCheck({
      claim,
      requestId: requestPending ? requestId : null,
      eventSequenceStart: requestEventSequence,
      rawOutput,
      webSearchQueries,
      requestWebSearchCount,
      runWebSearchCount,
      effectiveModel,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      startedMs: requestStartedMs,
      completedAt: new Date(),
      error,
    });
    return { status: "failed", observations: observationsWritten };
  }
}

async function finalizeUnhandledClaimFailure(
  claim: ClaimedTrip,
  completedAt: Date,
): Promise<void> {
  await claim.client.query("BEGIN");
  try {
    const failedRun = await claim.client.query(
      `UPDATE disruption_monitor_runs
          SET status = 'failed', error_code = 'WORKER_INTERNAL_FAILURE', completed_at = $3
        WHERE trip_id = $1 AND id = $2 AND status = 'running'`,
      [claim.tripId, claim.runId, completedAt],
    );
    if ((failedRun.rowCount ?? 0) > 0) {
      const interruptedRequests = await claim.client.query<{ id: string }>(
        `UPDATE ai_requests request
            SET status = 'failed', error_code = 'WORKER_INTERNAL_FAILURE',
                error_message = 'Disruption worker stopped before completion.', completed_at = $2
          WHERE request.trip_id = $1
            AND request.status = 'started'
            AND EXISTS (
              SELECT 1
                FROM ai_request_events event
               WHERE event.trip_id = request.trip_id
                 AND event.ai_request_id = request.id
                 AND event.event_type = 'request.started'
                 AND event.payload->>'monitorRunId' = $3
            )
        RETURNING request.id`,
        [claim.tripId, completedAt, claim.runId],
      );
      if (interruptedRequests.rows.length > 0) {
        await claim.client.query(
          `INSERT INTO ai_request_events (
             trip_id, ai_request_id, sequence, event_type, payload, created_at
           )
           SELECT $1, failed.request_id,
                  COALESCE((SELECT max(event.sequence) + 1
                              FROM ai_request_events event
                             WHERE event.trip_id = $1
                               AND event.ai_request_id = failed.request_id), 1),
                  'request.failed',
                  '{"errorCode":"WORKER_INTERNAL_FAILURE"}'::jsonb, $3
             FROM unnest($2::uuid[]) AS failed(request_id)`,
          [claim.tripId, interruptedRequests.rows.map((request) => request.id), completedAt],
        );
      }
      await claim.client.query(
        `UPDATE trip_disruption_settings
            SET last_error_code = 'WORKER_INTERNAL_FAILURE',
                next_due_at = $2::timestamptz + make_interval(mins => $3::integer),
                updated_at = $2
          WHERE trip_id = $1`,
        [claim.tripId, completedAt, MIN_RETRY_MINUTES],
      );
    }
    await claim.client.query("COMMIT");
  } catch (error) {
    await claim.client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** Background checks run only in operator-sponsored trips, so always on the operator's keys. */
export function runDueDisruptionMonitors(
  pool: Pool,
  options: RunDisruptionMonitorOptions = {},
): Promise<DisruptionMonitorSummary> {
  return withOperatorAiCredential(() => runDueDisruptionMonitorsAsOperator(pool, options));
}

async function runDueDisruptionMonitorsAsOperator(
  pool: Pool,
  options: RunDisruptionMonitorOptions,
): Promise<DisruptionMonitorSummary> {
  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("A valid monitor time is required.");
  const maxTrips = boundedInteger(options.maxTrips, DEFAULT_MAX_TRIPS, 1, 50);
  const maxCandidatesPerBatch = boundedInteger(
    options.maxCandidatesPerBatch,
    DEFAULT_MAX_CANDIDATES_PER_BATCH,
    1,
    DEFAULT_MAX_CANDIDATES_PER_BATCH,
  );
  const maxCandidatesPerRun = boundedInteger(
    options.maxCandidatesPerRun,
    DEFAULT_MAX_CANDIDATES_PER_RUN,
    1,
    maxCandidatesPerBatch,
  );
  const maxRunDurationMs = boundedInteger(
    options.maxRunDurationMs,
    DEFAULT_MAX_RUN_DURATION_MS,
    1_000,
    15 * 60_000,
  );
  const deadlineAtMs = performance.now() + maxRunDurationMs;
  const provider = options.provider ?? createCodexDisruptionProvider();
  const summary: DisruptionMonitorSummary = {
    claimedTrips: 0,
    succeededTrips: 0,
    failedTrips: 0,
    skippedTrips: 0,
    observationsWritten: 0,
  };

  for (let index = 0; index < maxTrips; index += 1) {
    if (performance.now() >= deadlineAtMs) break;
    const claim = await claimNextDueTrip(pool, now);
    if (!claim) break;
    summary.claimedTrips += 1;
    try {
      const outcome = await processClaim(
        claim,
        { provider, maxCandidatesPerBatch, maxCandidatesPerRun, deadlineAtMs },
        now,
      );
      if (outcome.status === "succeeded") summary.succeededTrips += 1;
      if (outcome.status === "failed") summary.failedTrips += 1;
      if (outcome.status === "skipped") summary.skippedTrips += 1;
      summary.observationsWritten += outcome.observations;
    } catch {
      await finalizeUnhandledClaimFailure(claim, new Date());
      summary.failedTrips += 1;
    } finally {
      await releaseClaim(claim);
    }
  }
  return summary;
}

export const disruptionMonitorInternals = {
  alertEvidenceMatchesCandidate,
  classifyProviderFailure,
  currentWarningFreshnessMinutes,
  fingerprint,
  hasProviderRetryBudget,
  remainingProviderTimeoutMs,
  selectCandidatesForRun,
};
