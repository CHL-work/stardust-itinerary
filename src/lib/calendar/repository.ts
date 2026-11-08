import { createHash, randomUUID } from "node:crypto";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { resolveFlightPresentation } from "@/lib/app/flight-presentation";

import {
  AppConflictError,
  AppForbiddenError,
  AppNotFoundError,
  appendAudit,
  getMemberPermissions,
  inTransaction,
} from "@/lib/app/repository";
import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { decryptCalendarToken, encryptCalendarToken } from "@/lib/calendar/tokens";
import { googleCalendarScope, type GoogleCalendarTokens } from "@/lib/calendar/google-auth";
import { findCalendarConflicts } from "@/lib/domain/calendar-conflicts";
import type { CalendarImportState } from "./import-contracts";

const refreshedTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  scope: z.string().optional(),
});

export type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  transparency?: string;
  eventType?: string;
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  htmlLink?: string;
  etag?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
};

export type CalendarSyncAction = "created" | "updated" | "recreated";

type CalendarEventBody = {
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string } | { date: string };
  end: { dateTime: string; timeZone: string } | { date: string };
  extendedProperties: { private: Record<string, string> };
};

type GoogleEventSyncResult = {
  remote: GoogleEvent;
  action: CalendarSyncAction;
};

type Queryable = Pick<Pool | PoolClient, "query">;

const googleEventsResponseSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).default([]),
  nextPageToken: z.string().optional(),
});

const googleErrorResponseSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    errors: z.array(z.object({ reason: z.string().optional() }).passthrough()).optional(),
  }).optional(),
});

const googleTokenErrorResponseSchema = z.object({
  error: z.string().optional(),
}).passthrough();

export class GoogleCalendarRequestError extends AppConflictError {
  connectionGeneration?: string | null;
  constructor(message: string, public readonly status: number, public readonly reason: string | null) {
    super(message);
    this.name = "GoogleCalendarRequestError";
  }
}

export function createGoogleCalendarError(status: number, body: unknown): GoogleCalendarRequestError {
  const parsed = googleErrorResponseSchema.safeParse(body);
  const reason = parsed.success ? parsed.data.error?.errors?.find((item) => item.reason)?.reason ?? null : null;
  if (reason === "accessNotConfigured") {
    return new GoogleCalendarRequestError(
      "Google Calendar API is disabled for this OAuth project. Enable Google Calendar API in Google Cloud Console, wait a few minutes, then refresh.",
      status,
      reason,
    );
  }
  if (reason === "insufficientPermissions" || status === 401) {
    return new GoogleCalendarRequestError(
      "Google Calendar permission is missing or expired. Reconnect Google Calendar and grant Calendar event access.",
      status,
      reason,
    );
  }
  if (reason === "dailyLimitExceeded" || reason === "userRateLimitExceeded" || reason === "rateLimitExceeded") {
    return new GoogleCalendarRequestError(
      "Google Calendar temporarily rejected the request because its API limit was reached. Wait briefly, then retry.",
      status,
      reason,
    );
  }
  return new GoogleCalendarRequestError(`Google Calendar returned status ${status}.`, status, reason);
}

function calendarFailureMetadata(error: unknown): Record<string, unknown> {
  return error instanceof GoogleCalendarRequestError
    ? { provider: "google_calendar", status: error.status, reason: error.reason }
    : { provider: "google_calendar", error: error instanceof Error ? error.name : "UNKNOWN" };
}

function assertTrip(session: AuthenticatedSession, tripId: string): void {
  if (session.tripId !== tripId) throw new AppForbiddenError("This trip is not available.");
}

export async function storeCalendarConnection(
  pool: Pool,
  config: AuthConfig,
  session: AuthenticatedSession,
  tokens: GoogleCalendarTokens,
): Promise<void> {
  const scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? [googleCalendarScope];
  if (!scopes.includes(googleCalendarScope)) {
    throw new AppConflictError("Google did not grant Calendar event access. Reconnect and allow Calendar access.");
  }
  await inTransaction(pool, async (client) => {
    await lockCurrentTripActor(client, session);
    const permissions = await getMemberPermissions(client, session.tripId, session.memberId);
    if (!permissions.canSyncCalendar) throw new AppForbiddenError("Calendar access is disabled for this member.");
    const existing = await client.query<{ refresh_token_encrypted: string | null; account_subject: string | null }>(
      `SELECT refresh_token_encrypted, to_jsonb(calendar_connections)->>'account_subject' AS account_subject FROM calendar_connections
        WHERE trip_id = $1 AND member_id = $2 AND provider = 'google_calendar' FOR UPDATE`,
      [session.tripId, session.memberId],
    );
    const refresh = tokens.refresh_token
      ? encryptCalendarToken(config.authSecret, tokens.refresh_token)
      : (existing.rows[0]?.account_subject ?? null) === (tokens.verified_account_subject ?? null)
        ? existing.rows[0]?.refresh_token_encrypted ?? null : null;
    if (!refresh) throw new AppConflictError("Google did not return offline access. Reconnect and grant Calendar access.");
    await client.query(
      `INSERT INTO calendar_connections (
         trip_id, member_id, access_token_encrypted, refresh_token_encrypted,
         token_expires_at, scopes, account_subject, connection_generation
       ) VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8)
       ON CONFLICT (trip_id, member_id, provider) DO UPDATE
         SET access_token_encrypted = EXCLUDED.access_token_encrypted,
             refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
             token_expires_at = EXCLUDED.token_expires_at,
             scopes = EXCLUDED.scopes,
             account_subject = EXCLUDED.account_subject,
             connection_generation = EXCLUDED.connection_generation,
             updated_at = CURRENT_TIMESTAMP`,
      [session.tripId, session.memberId,
        encryptCalendarToken(config.authSecret, tokens.access_token), refresh,
        new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000), scopes, tokens.verified_account_subject ?? null, randomUUID()],
    );
    await appendAudit(client, {
      tripId: session.tripId,
      actorMemberId: session.memberId,
      entityType: "calendar_connection",
      entityId: session.memberId,
      action: "connected",
      after: { provider: "google_calendar", scopes },
    });
  });
}

export async function getCalendarAccessToken(
  pool: Queryable,
  config: AuthConfig,
  session: AuthenticatedSession,
  expected?: { accountSubject: string; generation: string },
  onConnection?: (identity: { accountSubject: string | null; generation: string | null }) => void,
): Promise<string> {
  const result = await pool.query<{
    access_token_encrypted: string | null;
    refresh_token_encrypted: string | null;
    token_expires_at: Date | null;
    account_subject?: string | null;
    connection_generation?: string | null;
  }>(
    `SELECT access_token_encrypted, refresh_token_encrypted, token_expires_at,
            to_jsonb(calendar_connections)->>'account_subject' AS account_subject,
            to_jsonb(calendar_connections)->>'connection_generation' AS connection_generation
       FROM calendar_connections
      WHERE trip_id = $1 AND member_id = $2 AND provider = 'google_calendar'`,
    [session.tripId, session.memberId],
  );
  const connection = result.rows[0];
  if (!connection) throw new AppConflictError("Connect Google Calendar first.");
  if (expected && (connection.account_subject !== expected.accountSubject || connection.connection_generation !== expected.generation)) {
    throw new AppConflictError("Calendar connection changed. Reopen the import preview.");
  }
  onConnection?.({ accountSubject: connection.account_subject ?? null, generation: connection.connection_generation ?? null });
  if (
    connection.access_token_encrypted &&
    connection.token_expires_at &&
    connection.token_expires_at.getTime() > Date.now() + 60_000
  ) {
    return decryptCalendarToken(config.authSecret, connection.access_token_encrypted);
  }
  if (!connection.refresh_token_encrypted) throw new AppConflictError("Reconnect Google Calendar to restore offline access.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: decryptCalendarToken(config.authSecret, connection.refresh_token_encrypted),
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    const parsed = googleTokenErrorResponseSchema.safeParse(await response.json().catch(() => null));
    const reason = parsed.success ? parsed.data.error ?? null : null;
    if (reason === "invalid_grant" || response.status === 401) {
      const rejected = new GoogleCalendarRequestError(
        "Google Calendar access expired. Reconnect Google Calendar.",
        response.status,
        reason,
      );
      rejected.connectionGeneration = connection.connection_generation ?? null;
      throw rejected;
    }
    throw new GoogleCalendarRequestError(
      "Google Calendar could not refresh access. Wait briefly, then retry.",
      response.status,
      reason,
    );
  }
  const refreshed = refreshedTokenSchema.parse(await response.json());
  const updated = await pool.query(
    `UPDATE calendar_connections
        SET access_token_encrypted = $3, token_expires_at = $4,
            updated_at = CURRENT_TIMESTAMP
      WHERE trip_id = $1 AND member_id = $2 AND provider = 'google_calendar'
        AND to_jsonb(calendar_connections)->>'connection_generation' IS NOT DISTINCT FROM $5`,
    [session.tripId, session.memberId,
      encryptCalendarToken(config.authSecret, refreshed.access_token),
      new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000), connection.connection_generation ?? null],
  );
  if (updated.rowCount !== 1) throw new AppConflictError("Calendar connection changed. Retry with the current connection.");
  return refreshed.access_token;
}

function shouldInvalidateCalendarConnection(error: unknown): boolean {
  return error instanceof GoogleCalendarRequestError && (
    error.status === 401 ||
    error.reason === "invalid_grant" ||
    error.reason === "insufficientPermissions"
  );
}

async function invalidateRejectedCalendarConnection(
  pool: Pool,
  session: AuthenticatedSession,
  error: unknown,
): Promise<void> {
  if (!shouldInvalidateCalendarConnection(error)) return;
  // An unfenced late failure must never erase a newer successful reconnect.
  if (!(error instanceof GoogleCalendarRequestError) || error.connectionGeneration === undefined) return;
  const deleted = await pool.query(
    `DELETE FROM calendar_connections
      WHERE trip_id = $1 AND member_id = $2 AND provider = 'google_calendar'
        AND to_jsonb(calendar_connections)->>'connection_generation' IS NOT DISTINCT FROM $3`,
    [session.tripId, session.memberId, error.connectionGeneration],
  );
  if (!deleted.rowCount) return;
  await appendAudit(pool, {
    tripId: session.tripId,
    actorMemberId: session.memberId,
    entityType: "calendar_connection",
    entityId: session.memberId,
    action: "calendar_disconnected",
    metadata: {
      provider: "google_calendar",
      cause: "authorization_rejected",
      reason: error instanceof GoogleCalendarRequestError ? error.reason : null,
    },
  });
}

async function googleRequest<T>(accessToken: string, path: string, init?: RequestInit): Promise<{ status: number; value: T | null }> {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 404 || response.status === 409) return { status: response.status, value: null };
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw createGoogleCalendarError(response.status, errorBody);
  }
  return { status: response.status, value: await response.json() as T };
}

function eventTime(value?: { dateTime?: string; date?: string }): string | null {
  if (typeof value?.dateTime === "string" && value.dateTime) {
    const instant = new Date(value.dateTime);
    return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
  }
  if (typeof value?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
    const instant = new Date(`${value.date}T00:00:00Z`);
    if (Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value.date) {
      return instant.toISOString();
    }
  }
  return null;
}

/** A legacy NULL-account link is not proof of ownership after an account reconnect. */
export async function verifyLegacyCalendarLink(accessToken: string, eventId: string, tripId: string, itemId: string): Promise<void> {
  const remote = await googleRequest<GoogleEvent>(accessToken,
    `/calendars/primary/events/${encodeURIComponent(eventId)}?fields=id,extendedProperties`);
  if (remote.value?.id !== eventId || remote.value.extendedProperties?.private?.stardustTripId !== tripId
      || remote.value.extendedProperties?.private?.stardustItemId !== itemId) {
    throw new AppConflictError("This legacy Calendar link could not be verified for the connected account. No Calendar event was changed.");
  }
}

async function listCalendarStateInternal(
  pool: Pool,
  config: AuthConfig,
  session: AuthenticatedSession,
): Promise<Record<string, unknown>> {
  const permissions = await getMemberPermissions(pool, session.tripId, session.memberId);
  if (!permissions.canSyncCalendar) throw new AppForbiddenError("Calendar access is disabled for this member.");
  let connectionIdentity: { accountSubject: string | null; generation: string | null } | undefined;
  try {
  const accessToken = await getCalendarAccessToken(pool, config, session, undefined, (identity) => { connectionIdentity = identity; });
  const trip = await pool.query<{ starts_on: string; ends_on: string; calendar_imports_available?: boolean }>(
    `SELECT starts_on::text, ends_on::text,
            to_regclass('calendar_import_receipts') IS NOT NULL AS calendar_imports_available
       FROM trips WHERE id = $1`,
    [session.tripId],
  );
  if (!trip.rows[0]) throw new AppNotFoundError("Trip not found.");
  const accountSubject = connectionIdentity?.accountSubject ?? null;
  const timeMin = new Date(`${trip.rows[0].starts_on}T00:00:00Z`);
  timeMin.setUTCDate(timeMin.getUTCDate() - 1);
  const timeMax = new Date(`${trip.rows[0].ends_on}T00:00:00Z`);
  timeMax.setUTCDate(timeMax.getUTCDate() + 2);
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await googleRequest<unknown>(accessToken, `/calendars/primary/events?${query}`);
    const parsed = googleEventsResponseSchema.parse(response.value);
    events.push(...parsed.items as GoogleEvent[]);
    pageToken = parsed.nextPageToken;
  } while (pageToken);

  const [itemsResult, linksResult, removedItemsResult] = await Promise.all([
    pool.query<{
      id: string; title: string; item_type: string; location_name: string | null;
      starts_at: Date | null; ends_at: Date | null;
    }>(
      `SELECT id, title, item_type, starts_at, ends_at,
              CASE WHEN item_type = 'transport'
                   THEN COALESCE(destination_location_name, departure_location_name)
                   ELSE location_name END AS location_name
         FROM itinerary_items
        WHERE trip_id = $1 AND status <> 'cancelled'
          AND to_jsonb(itinerary_items)->>'removed_at' IS NULL
          AND app_member_can_view_itinerary_item(trip_id, id, $2)`,
      [session.tripId, session.memberId],
    ),
    pool.query<{ itinerary_item_id: string; provider_event_id: string }>(
      `SELECT itinerary_item_id, provider_event_id FROM calendar_event_links
        WHERE trip_id = $1 AND member_id = $2 AND provider = 'google_calendar'
          AND (to_jsonb(calendar_event_links)->>'account_subject' IS NULL OR to_jsonb(calendar_event_links)->>'account_subject' = $3)`,
      [session.tripId, session.memberId, accountSubject],
    ),
    pool.query<{ id: string }>(
      `SELECT removed_item.id FROM itinerary_items removed_item
        WHERE removed_item.trip_id = $1
          AND to_jsonb(removed_item)->>'removed_at' IS NOT NULL
          AND app_member_can_view_itinerary_item(removed_item.trip_id, removed_item.id, $2)`,
      [session.tripId, session.memberId],
    ),
  ]);
  const visibleItems = new Map(itemsResult.rows.map((item) => [item.id, item]));
  const removedItemIds = new Set(removedItemsResult.rows.map((item) => item.id));
  const removedProviderIds = new Set(linksResult.rows
    .filter((link) => removedItemIds.has(link.itinerary_item_id)).map((link) => link.provider_event_id));
  const visibleLinks = linksResult.rows.filter((link) => visibleItems.has(link.itinerary_item_id));
  const linked = new Map(visibleLinks.map((row) => [row.itinerary_item_id, row.provider_event_id]));
  const linkedItemByEvent = new Map(visibleLinks.map((row) => [row.provider_event_id, row.itinerary_item_id]));
  const receiptResult = trip.rows[0].calendar_imports_available && accountSubject
    ? await pool.query<{ provider_event_id: string; change_request_id: string; status: string; invalidated_at: string | null; proposal_revision: number; itinerary_item_id: string | null }>(
      `SELECT r.provider_event_id, r.change_request_id, cr.status, cr.invalidated_at, cr.proposal_revision, r.itinerary_item_id
         FROM calendar_import_receipts r JOIN change_requests cr ON cr.trip_id = r.trip_id AND cr.id = r.change_request_id
        WHERE r.trip_id = $1 AND r.member_id = $2 AND r.app_user_id = $3 AND r.account_subject = $4 AND r.calendar_id = 'primary'`,
      [session.tripId, session.memberId, session.userId, accountSubject]) : null;
  const imports = new Map<string, CalendarImportState>((receiptResult?.rows ?? []).map((row) => [row.provider_event_id, {
    requestId: row.change_request_id, status: row.invalidated_at || !["pending", "rejected", "approved"].includes(row.status)
      ? "invalidated" : row.status as CalendarImportState["status"], proposalRevision: row.proposal_revision,
    itemId: row.itinerary_item_id, canImport: false,
  }]));
  const normalized = events
    .filter((event) => event.status !== "cancelled")
    .filter((event) => !["pending", "approved"].includes(imports.get(event.id)?.status ?? ""))
    .filter((event) => {
      const properties = event.extendedProperties?.private;
      // Hide only a proven copy of an authorized removed event. This changes
      // the app projection, not the user's remote Calendar or unrelated items.
      return !removedProviderIds.has(event.id) && !(properties?.stardustTripId === session.tripId
        && typeof properties.stardustItemId === "string" && removedItemIds.has(properties.stardustItemId));
    })
    .map((event) => {
      const properties = event.extendedProperties?.private;
      const propertyItemId = properties?.stardustTripId === session.tripId
        && typeof properties.stardustItemId === "string"
        && visibleItems.has(properties.stardustItemId)
        ? properties.stardustItemId
        : null;
      const linkedItineraryItemId = linkedItemByEvent.get(event.id) ?? propertyItemId;
      const startsAt = eventTime(event.start);
      const endsAt = eventTime(event.end);
      const suppliedStart = event.start?.dateTime !== undefined || event.start?.date !== undefined;
      const suppliedEnd = event.end?.dateTime !== undefined || event.end?.date !== undefined;
      return {
        id: event.id,
        title: event.summary ?? "Busy",
        startsAt,
        endsAt,
        invalidTime: (suppliedStart && startsAt === null) || (suppliedEnd && endsAt === null),
        location: event.location ?? null,
        htmlLink: event.htmlLink ?? null,
        linkedItineraryItemId,
        itemType: linkedItineraryItemId ? visibleItems.get(linkedItineraryItemId)?.item_type : undefined,
        transparency: typeof event.transparency === "string" ? event.transparency : undefined,
        eventType: typeof event.eventType === "string" ? event.eventType : undefined,
        selfDeclined: Array.isArray(event.attendees)
          && event.attendees.some((attendee) => attendee?.self === true && attendee.responseStatus === "declined"),
        allDay: typeof event.start?.date === "string" && !event.start.dateTime,
        startDate: typeof event.start?.date === "string" && !event.start.dateTime ? event.start.date : null,
        endDateExclusive: typeof event.end?.date === "string" && !event.end.dateTime ? event.end.date : null,
        importState: imports.get(event.id),
      };
    });
  const itinerary = itemsResult.rows.map((item) => ({
    id: item.id,
    title: item.title,
    itemType: item.item_type,
    location: item.location_name,
    startsAt: item.starts_at?.toISOString() ?? null,
    endsAt: item.ends_at?.toISOString() ?? null,
  }));
  if (connectionIdentity?.generation) {
    const stillConnected = await pool.query(`SELECT 1 FROM calendar_connections WHERE trip_id = $1 AND member_id = $2
      AND provider = 'google_calendar' AND account_subject = $3 AND connection_generation = $4`,
      [session.tripId, session.memberId, connectionIdentity.accountSubject, connectionIdentity.generation]);
    if (stillConnected.rowCount !== 1) throw new AppConflictError("Calendar connection changed during refresh. Try again.");
  }
  return {
    events: normalized,
    conflicts: findCalendarConflicts(itinerary, normalized, linked),
  };
  } catch (error) {
    if (error instanceof GoogleCalendarRequestError && connectionIdentity) error.connectionGeneration = connectionIdentity.generation;
    throw error;
  }
}

export async function listCalendarState(
  pool: Pool,
  config: AuthConfig,
  session: AuthenticatedSession,
): Promise<Record<string, unknown>> {
  try {
    return await listCalendarStateInternal(pool, config, session);
  } catch (error) {
    await invalidateRejectedCalendarConnection(pool, session, error).catch(() => undefined);
    await appendAudit(pool, {
      tripId: session.tripId,
      actorMemberId: session.memberId,
      entityType: "calendar_connection",
      entityId: session.memberId,
      action: "calendar_read_failed",
      metadata: calendarFailureMetadata(error),
    }).catch(() => undefined);
    throw error;
  }
}

function deterministicEventId(tripId: string, memberId: string, itemId: string): string {
  return createHash("sha256").update(`${tripId}\0${memberId}\0${itemId}`).digest("hex").slice(0, 48);
}

function replacementEventId(deletedEventId: string): string {
  return createHash("sha256")
    .update(`stardust-calendar-recovery\0${deletedEventId}`)
    .digest("hex")
    .slice(0, 48);
}

async function withCalendarItemSyncLock<T>(
  pool: Pool,
  tripId: string,
  memberId: string,
  itemId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const lockKey = JSON.stringify(["google_calendar", tripId, memberId, itemId]);
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
    locked = true;
    return await work(client);
  } finally {
    let releaseError: Error | undefined;
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]);
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error("Failed to release Calendar sync lock.");
      }
    }
    client.release(releaseError);
  }
}

async function inClientTransaction<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function liveGoogleEvent(event: GoogleEvent | null): GoogleEvent | null {
  return event?.id && event.status !== "cancelled" ? event : null;
}

function isDeletedGoogleEvent(response: { status: number; value: GoogleEvent | null }): boolean {
  return response.status === 404 || response.value?.status === "cancelled";
}

function calendarReconciliationError(): AppConflictError {
  return new AppConflictError("Google Calendar returned an incomplete event during sync. Wait briefly, then retry.");
}

type CandidateSyncResult = GoogleEventSyncResult | { deleted: true };

async function syncGoogleEventCandidate(
  accessToken: string,
  eventId: string,
  eventBody: CalendarEventBody,
  options: {
    createWhenMissing: boolean;
    createdAction: CalendarSyncAction;
    existingAction: CalendarSyncAction;
  },
): Promise<CandidateSyncResult> {
  const existing = await googleRequest<GoogleEvent>(
    accessToken,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
  );
  if (liveGoogleEvent(existing.value)) {
    const updated = await googleRequest<GoogleEvent>(
      accessToken,
      `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
      { method: "PATCH", body: JSON.stringify(eventBody) },
    );
    const liveUpdated = liveGoogleEvent(updated.value);
    if (liveUpdated) {
      return { remote: liveUpdated, action: options.existingAction };
    }
    if (isDeletedGoogleEvent(updated)) return { deleted: true };
    throw calendarReconciliationError();
  }
  if (!isDeletedGoogleEvent(existing)) throw calendarReconciliationError();
  if (existing.value?.status === "cancelled" || !options.createWhenMissing) return { deleted: true };

  const created = await googleRequest<GoogleEvent>(
    accessToken,
    "/calendars/primary/events?sendUpdates=none",
    { method: "POST", body: JSON.stringify({ id: eventId, ...eventBody }) },
  );
  const liveCreated = liveGoogleEvent(created.value);
  if (liveCreated) {
    return { remote: liveCreated, action: options.createdAction };
  }
  if (created.status !== 409) {
    if (isDeletedGoogleEvent(created)) return { deleted: true };
    throw calendarReconciliationError();
  }

  // A concurrent retry can create the same deterministic successor between our
  // GET and POST. Re-read and reconcile that event instead of minting another.
  const raced = await googleRequest<GoogleEvent>(
    accessToken,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
  );
  if (!liveGoogleEvent(raced.value)) {
    if (isDeletedGoogleEvent(raced)) return { deleted: true };
    throw calendarReconciliationError();
  }
  const updated = await googleRequest<GoogleEvent>(
    accessToken,
    `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { method: "PATCH", body: JSON.stringify(eventBody) },
  );
  const liveUpdated = liveGoogleEvent(updated.value);
  if (liveUpdated) {
    return { remote: liveUpdated, action: options.existingAction };
  }
  if (isDeletedGoogleEvent(updated)) return { deleted: true };
  throw calendarReconciliationError();
}

export async function syncGoogleCalendarEvent(
  accessToken: string,
  initialEventId: string,
  linkedEventId: string | null,
  eventBody: CalendarEventBody,
): Promise<GoogleEventSyncResult> {
  const currentEventId = linkedEventId ?? initialEventId;
  const current = await syncGoogleEventCandidate(accessToken, currentEventId, eventBody, {
    createWhenMissing: linkedEventId === null,
    createdAction: "created",
    existingAction: "updated",
  });
  if (!("deleted" in current)) return current;

  // Google keeps deleted organizer events as cancelled tombstones. A stable
  // hash chain gives every tombstone exactly one successor, so retries also
  // converge after cross-process races or partial failures.
  let deletedEventId = currentEventId;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const successorId = replacementEventId(deletedEventId);
    const recovered = await syncGoogleEventCandidate(accessToken, successorId, eventBody, {
      createWhenMissing: true,
      createdAction: "recreated",
      existingAction: "recreated",
    });
    if (!("deleted" in recovered)) return recovered;
    deletedEventId = successorId;
  }
  throw new AppConflictError("Google Calendar kept rejecting replacement events. Wait briefly, then retry.");
}

async function syncItineraryItemToCalendarInternal(
  client: PoolClient,
  config: AuthConfig,
  session: AuthenticatedSession,
  tripId: string,
  itemId: string,
): Promise<{ itemId: string; eventId: string; htmlLink: string | null; action: CalendarSyncAction }> {
  assertTrip(session, tripId);
  const permissions = await getMemberPermissions(client, tripId, session.memberId);
  if (!permissions.canSyncCalendar) throw new AppForbiddenError("Calendar sync is disabled for this member.");
  const itemResult = await client.query<{
    id: string;
    title: string;
    item_type: string;
    starts_at: Date | null;
    ends_at: Date | null;
    location_name: string | null;
    departure_location_name: string | null;
    destination_location_name: string | null;
    notes: string | null;
    status: string;
    current_revision: number;
    time_zone: string;
    flight: unknown;
  }>(
    `SELECT i.id, i.title, i.item_type, i.starts_at, i.ends_at, i.location_name,
            i.departure_location_name, i.destination_location_name, i.notes,
            i.status, i.current_revision, t.time_zone, i.flight
       FROM itinerary_items i
       JOIN trips t ON t.id = i.trip_id
      WHERE i.trip_id = $1 AND i.id = $2
        AND to_jsonb(i)->>'removed_at' IS NULL
        AND app_member_can_view_itinerary_item(i.trip_id, i.id, $3)`,
    [tripId, itemId, session.memberId],
  );
  const item = itemResult.rows[0];
  if (!item) throw new AppNotFoundError("Plan item not found.");
  if (!item.starts_at) throw new AppConflictError("Set an event start time before adding it to Google Calendar.");
  let connectionIdentity: { accountSubject: string | null; generation: string | null } | undefined;
  const accessToken = await getCalendarAccessToken(client, config, session, undefined, (identity) => { connectionIdentity = identity; });
  const eventId = deterministicEventId(tripId, session.memberId, itemId);
  const linkResult = await client.query<{ provider_event_id: string; account_subject?: string | null; current_account_subject?: string | null; current_generation?: string | null }>(
    `SELECT provider_event_id, to_jsonb(calendar_event_links)->>'account_subject' AS account_subject,
            (SELECT to_jsonb(cc)->>'account_subject' FROM calendar_connections cc WHERE cc.trip_id = $1 AND cc.member_id = $3 AND cc.provider = 'google_calendar') AS current_account_subject,
            (SELECT to_jsonb(cc)->>'connection_generation' FROM calendar_connections cc WHERE cc.trip_id = $1 AND cc.member_id = $3 AND cc.provider = 'google_calendar') AS current_generation
       FROM calendar_event_links
      WHERE trip_id = $1 AND itinerary_item_id = $2 AND member_id = $3
        AND provider = 'google_calendar'`,
    [tripId, itemId, session.memberId],
  );
  const existingLink = linkResult.rows[0];
  if (existingLink?.account_subject && existingLink.account_subject !== connectionIdentity?.accountSubject) {
    throw new AppConflictError("This event is linked to a different Google Calendar account. Reconnect that account to update it.");
  }
  if (existingLink && !existingLink.account_subject && connectionIdentity?.accountSubject) {
    await verifyLegacyCalendarLink(accessToken, existingLink.provider_event_id, tripId, itemId);
  }
  const endsAt = item.ends_at ?? new Date(item.starts_at.getTime() + 60 * 60 * 1000);
  const transportRoute = item.item_type === "transport"
    ? item.departure_location_name && item.destination_location_name
      ? `Transport route: ${item.departure_location_name} → ${item.destination_location_name}`
      : item.departure_location_name
        ? `Transport departure: ${item.departure_location_name}`
        : item.destination_location_name
          ? `Transport destination: ${item.destination_location_name}`
          : null
    : null;
  if (item.item_type === "transport" && !transportRoute) {
    throw new AppConflictError("Set a departure or destination before adding this transport event to Google Calendar.");
  }
  const calendarLocation = item.item_type === "transport"
    ? item.destination_location_name ?? item.departure_location_name
    : item.location_name;
  const presentation = resolveFlightPresentation({ itemType: item.item_type, title: item.title, flight: item.flight,
    departureLocationName: item.departure_location_name, destinationLocationName: item.destination_location_name }, item.time_zone);
  const eventBody: CalendarEventBody = {
    summary: item.status === "cancelled" ? `[Cancelled] ${item.title}` : item.title,
    description: [
      transportRoute,
      item.notes,
      `Stardust Itinerary: ${new URL(`/en#item-${item.id}`, config.appBaseUrl).href}`,
    ].filter(Boolean).join("\n\n"),
    location: calendarLocation ?? undefined,
    start: { dateTime: item.starts_at.toISOString(), timeZone: presentation.departureTimeZone },
    end: { dateTime: endsAt.toISOString(), timeZone: presentation.arrivalTimeZone },
    extendedProperties: { private: { stardustTripId: tripId, stardustItemId: itemId } },
  };
  // Do not turn a source all-day event into an invented timed booking on explicit sync.
  if (existingLink?.account_subject) {
    const receipt = await client.query<{ source_snapshot: unknown }>(`SELECT source_snapshot FROM calendar_import_receipts
      WHERE trip_id = $1 AND itinerary_item_id = $2 AND member_id = $3 AND account_subject = $4`,
      [tripId, itemId, session.memberId, existingLink.account_subject]);
    const { calendarSourceMetadata } = await import("./import-source");
    const source = calendarSourceMetadata(receipt.rows[0]?.source_snapshot, item.starts_at.toISOString(), item.ends_at?.toISOString());
    if (source?.allDay && source.startDate && source.endDateExclusive) {
      eventBody.start = { date: source.startDate }; eventBody.end = { date: source.endDateExclusive };
    }
  }
  const { action, remote } = await syncGoogleCalendarEvent(
    accessToken,
    eventId,
    linkResult.rows[0]?.provider_event_id ?? null,
    eventBody,
  ).catch((error: unknown) => {
    if (error instanceof GoogleCalendarRequestError && connectionIdentity) error.connectionGeneration = connectionIdentity.generation;
    throw error;
  });
  await inClientTransaction(client, async () => {
    await lockCurrentTripActor(client, session);
    if (connectionIdentity?.accountSubject) {
      const stillConnected = await client.query(`SELECT 1 FROM calendar_connections WHERE trip_id = $1 AND member_id = $2
        AND provider = 'google_calendar' AND account_subject = $3 AND connection_generation = $4 FOR SHARE`,
        [tripId, session.memberId, connectionIdentity.accountSubject, connectionIdentity.generation]);
      if (stillConnected.rowCount !== 1) throw new AppConflictError("Calendar connection changed during sync. Retry with the current connection.");
    }
    // Network work happens outside the actor lock. A removal or edit during
    // Google sync must not mark the obsolete local event as synchronized.
    const current = await client.query(
      `SELECT 1 FROM itinerary_items i
        WHERE i.trip_id = $1 AND i.id = $2 AND i.current_revision = $3
          AND to_jsonb(i)->>'removed_at' IS NULL
          AND app_member_can_view_itinerary_item(i.trip_id, i.id, $4)
        FOR SHARE OF i`,
      [tripId, itemId, item.current_revision, session.memberId],
    );
    if (current.rowCount !== 1) throw new AppConflictError("The event changed during Calendar sync. Refresh the trip before trying again.");
    await client.query(
      `INSERT INTO calendar_event_links (
         trip_id, itinerary_item_id, member_id, calendar_id, provider_event_id,
         provider_etag, provider_html_link, last_synced_item_revision, sync_status${connectionIdentity?.accountSubject ? ", account_subject" : ""}
       ) VALUES ($1,$2,$3,'primary',$4,$5,$6,$7,'synced'${connectionIdentity?.accountSubject ? ",$8" : ""})
       ON CONFLICT (trip_id, itinerary_item_id, member_id, provider) DO UPDATE
         SET provider_event_id = EXCLUDED.provider_event_id,
             provider_etag = EXCLUDED.provider_etag,
             provider_html_link = EXCLUDED.provider_html_link,
             last_synced_item_revision = EXCLUDED.last_synced_item_revision,
             sync_status = 'synced', last_error_code = NULL,
             updated_at = CURRENT_TIMESTAMP${connectionIdentity?.accountSubject ? ", account_subject = EXCLUDED.account_subject" : ""}`,
      [tripId, itemId, session.memberId, remote.id, remote.etag ?? null,
        remote.htmlLink ?? null, item.current_revision, ...(connectionIdentity?.accountSubject ? [connectionIdentity.accountSubject] : [])],
    );
    await appendAudit(client, {
      tripId,
      actorMemberId: session.memberId,
      entityType: "calendar_event_link",
      entityId: itemId,
      action: `calendar_${action}`,
      after: { provider: "google_calendar", itemRevision: item.current_revision, eventId: remote.id },
    });
  });
  return { itemId, eventId: remote.id, htmlLink: remote.htmlLink ?? null, action };
}

export async function syncItineraryItemToCalendar(
  pool: Pool,
  config: AuthConfig,
  session: AuthenticatedSession,
  tripId: string,
  itemId: string,
): Promise<{ itemId: string; eventId: string; htmlLink: string | null; action: CalendarSyncAction }> {
  try {
    return await withCalendarItemSyncLock(
      pool,
      tripId,
      session.memberId,
      itemId,
      (client) => syncItineraryItemToCalendarInternal(client, config, session, tripId, itemId),
    );
  } catch (error) {
    await invalidateRejectedCalendarConnection(pool, session, error).catch(() => undefined);
    await appendAudit(pool, {
      tripId,
      actorMemberId: session.memberId,
      entityType: "calendar_event_link",
      entityId: itemId,
      action: "calendar_sync_failed",
      metadata: calendarFailureMetadata(error),
    }).catch(() => undefined);
    throw error;
  }
}

export async function syncAllItineraryItemsToCalendar(
  pool: Pool,
  config: AuthConfig,
  session: AuthenticatedSession,
  tripId: string,
): Promise<Array<{ itemId: string; eventId: string; htmlLink: string | null; action: CalendarSyncAction }>> {
  assertTrip(session, tripId);
  const items = await pool.query<{ id: string }>(
    `SELECT id FROM itinerary_items
      WHERE trip_id = $1 AND starts_at IS NOT NULL AND status <> 'cancelled'
        AND to_jsonb(itinerary_items)->>'removed_at' IS NULL
        AND app_member_can_view_itinerary_item(trip_id, id, $2)
      ORDER BY starts_at, id`,
    [tripId, session.memberId],
  );
  const results = [];
  for (const item of items.rows) {
    results.push(await syncItineraryItemToCalendar(pool, config, session, tripId, item.id));
  }
  return results;
}
