import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { AppConflictError, AppForbiddenError, AppNotFoundError, appendAudit, applyPermittedChangeRequestWithClient,
  createChangeRequestWithClient, getMemberPermissions, inTransaction } from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { getCalendarAccessToken, type GoogleEvent } from "./repository";
import { calendarImportInputSchema, type CalendarImportExisting, type CalendarImportInput, type CalendarImportPreview,
  type CalendarImportResult, type CalendarSource } from "./import-contracts";
import { calendarDateMidnight, calendarSourceDigest, createCalendarImportToken, normalizeCalendarImportSource,
  verifyCalendarImportToken, type CalendarPreviewClaims } from "./import-source";
import { verifyCalendarLocationToken } from "./location-search-token";
import { calendarFallbackTimeZones } from "./event-time-zones";

type Queryable = Pick<Pool | PoolClient, "query">;
type Context = { accountSubject: string; generation: string; timeZone: string; startsOn: string; endsOn: string };
export class CalendarImportError extends AppConflictError {
  constructor(public readonly code: "CALENDAR_IMPORT_RECONNECT" | "CALENDAR_IMPORT_STALE" | "CALENDAR_IMPORT_INVALID" | "CALENDAR_IMPORT_UNAVAILABLE") {
    super(code); this.name = "CalendarImportError";
  }
}

async function importContext(client: PoolClient, session: AuthenticatedSession, tripId: string): Promise<Context> {
  if (session.tripId !== tripId) throw new AppForbiddenError("This trip is not available.");
  await lockCurrentTripActor(client, session);
  const permissions = await getMemberPermissions(client, tripId, session.memberId);
  if (!permissions.canSyncCalendar || !permissions.canEditItinerary) throw new AppForbiddenError("Calendar import is disabled for this member.");
  const readiness = await client.query<{ ready: boolean }>("SELECT to_regclass('calendar_import_receipts') IS NOT NULL AS ready");
  if (!readiness.rows[0]?.ready) throw new CalendarImportError("CALENDAR_IMPORT_UNAVAILABLE");
  const result = await client.query<{ account_subject: string | null; connection_generation: string | null; time_zone: string; starts_on: string; ends_on: string }>(
    `SELECT cc.account_subject, cc.connection_generation, t.time_zone, t.starts_on::text, t.ends_on::text
       FROM trips t JOIN calendar_connections cc ON cc.trip_id = t.id AND cc.member_id = $2 AND cc.provider = 'google_calendar'
      WHERE t.id = $1 FOR UPDATE OF cc`, [tripId, session.memberId]);
  const row = result.rows[0];
  if (!row?.account_subject || !row.connection_generation) throw new CalendarImportError("CALENDAR_IMPORT_RECONNECT");
  return { accountSubject: row.account_subject, generation: row.connection_generation, timeZone: row.time_zone, startsOn: row.starts_on, endsOn: row.ends_on };
}

async function existingImport(client: Queryable, session: AuthenticatedSession, account: string, eventId: string): Promise<CalendarImportExisting | null> {
  const result = await client.query<{ change_request_id: string; status: string; invalidated_at: string | null; proposal_revision: number; itinerary_item_id: string | null }>(
    `SELECT r.change_request_id, cr.status, cr.invalidated_at, cr.proposal_revision, r.itinerary_item_id
       FROM calendar_import_receipts r JOIN change_requests cr ON cr.trip_id = r.trip_id AND cr.id = r.change_request_id
      WHERE r.trip_id = $1 AND r.member_id = $2 AND r.app_user_id = $3 AND r.account_subject = $4
        AND r.calendar_id = 'primary' AND r.provider_event_id = $5`,
    [session.tripId, session.memberId, session.userId, account, eventId]);
  const row = result.rows[0];
  if (!row) return null;
  return { requestId: row.change_request_id, status: row.invalidated_at || !["pending", "rejected", "approved"].includes(row.status)
    ? "invalidated" : row.status as CalendarImportExisting["status"], proposalRevision: row.proposal_revision, itemId: row.itinerary_item_id };
}

async function fetchSource(pool: Pool, config: AuthConfig, session: AuthenticatedSession, context: Context, eventId: string): Promise<{ source: CalendarSource; etag: string | null; digest: string }> {
  const accessToken = await getCalendarAccessToken(pool, config, session, context);
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?fields=id,summary,location,status,etag,start,end`, {
    method: "GET", headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new CalendarImportError(response.status === 401 || response.status === 403 ? "CALENDAR_IMPORT_RECONNECT" : "CALENDAR_IMPORT_UNAVAILABLE");
  try {
    const event = await response.json() as GoogleEvent;
    const source = normalizeCalendarImportSource(event, eventId, context.timeZone);
    const etag = typeof event.etag === "string" ? event.etag : null;
    return { source, etag, digest: calendarSourceDigest(source, etag) };
  } catch { throw new CalendarImportError("CALENDAR_IMPORT_INVALID"); }
}

function assertSourceInTrip(source: CalendarSource, context: Context): void {
  const exclusiveEnd = new Date(`${context.endsOn}T00:00:00Z`); exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
  const end = calendarDateMidnight(exclusiveEnd.toISOString().slice(0, 10), context.timeZone);
  if (Date.parse(source.startsAt) < Date.parse(calendarDateMidnight(context.startsOn, context.timeZone))
      || Date.parse(source.startsAt) >= Date.parse(end) || Date.parse(source.endsAt) > Date.parse(end)) {
    throw new CalendarImportError("CALENDAR_IMPORT_INVALID");
  }
}
function assertConnection(context: Context, claims: CalendarPreviewClaims): void {
  if (context.accountSubject !== claims.accountSubject || context.generation !== claims.generation || context.timeZone !== claims.timeZone) {
    throw new CalendarImportError("CALENDAR_IMPORT_STALE");
  }
}

export async function previewCalendarImport(pool: Pool, config: AuthConfig, session: AuthenticatedSession, tripId: string, eventId: string): Promise<CalendarImportPreview> {
  if (!z.string().min(5).max(1024).regex(/^[A-Za-z0-9_-]+$/).safeParse(eventId).success) throw new CalendarImportError("CALENDAR_IMPORT_INVALID");
  const context = await inTransaction(pool, (client) => importContext(client, session, tripId));
  const fetched = await fetchSource(pool, config, session, context, eventId);
  assertSourceInTrip(fetched.source, context);
  return inTransaction(pool, async (client) => {
    const current = await importContext(client, session, tripId);
    if (JSON.stringify(current) !== JSON.stringify(context)) throw new CalendarImportError("CALENDAR_IMPORT_STALE");
    const expiresAt = Date.now() + 10 * 60_000;
    const previewToken = createCalendarImportToken(config.authSecret, { version: 1, tripId, memberId: session.memberId, userId: session.userId,
      accountSubject: context.accountSubject, generation: context.generation, timeZone: context.timeZone, ...fetched, expiresAt });
    return { previewToken, expiresAt: new Date(expiresAt).toISOString(), source: fetched.source,
      existing: await existingImport(client, session, context.accountSubject, eventId) };
  });
}

export async function commitCalendarImport(pool: Pool, config: AuthConfig, session: AuthenticatedSession, tripId: string, input: CalendarImportInput): Promise<CalendarImportResult> {
  const parsed = calendarImportInputSchema.parse(input);
  let claims: CalendarPreviewClaims;
  try { claims = verifyCalendarImportToken(config.authSecret, session, parsed.previewToken); }
  catch { throw new CalendarImportError("CALENDAR_IMPORT_STALE"); }
  const initial = await inTransaction(pool, async (client) => {
    const context = await importContext(client, session, tripId);
    // A durable reservation is authoritative on an uncertain retry, including reconnects to the same account.
    if (context.accountSubject !== claims.accountSubject) throw new CalendarImportError("CALENDAR_IMPORT_STALE");
    const existing = await existingImport(client, session, claims.accountSubject, claims.source.eventId);
    if (!existing) assertConnection(context, claims);
    return { context, existing };
  });
  if (initial.existing) return { ...initial.existing, replayed: true };
  const fetched = await fetchSource(pool, config, session, initial.context, claims.source.eventId);
  if (fetched.digest !== claims.digest) throw new CalendarImportError("CALENDAR_IMPORT_STALE");
  return inTransaction(pool, async (client) => {
    const context = await importContext(client, session, tripId);
    if (context.accountSubject !== claims.accountSubject) throw new CalendarImportError("CALENDAR_IMPORT_STALE");
    const existing = await existingImport(client, session, claims.accountSubject, claims.source.eventId);
    if (existing) return { ...existing, replayed: true };
    assertConnection(context, claims); assertSourceInTrip(fetched.source, context);
    const linked = await client.query(`SELECT 1 FROM calendar_event_links WHERE trip_id = $1 AND member_id = $2
      AND provider = 'google_calendar' AND calendar_id = 'primary' AND provider_event_id = $3
      AND (account_subject = $4 OR account_subject IS NULL)`, [tripId, session.memberId, claims.source.eventId, claims.accountSubject]);
    if (linked.rowCount) throw new CalendarImportError("CALENDAR_IMPORT_STALE");
    const source = fetched.source;
    const day = await client.query<{ id: string }>(`SELECT d.id FROM trip_days d JOIN trips t ON t.id = d.trip_id
      WHERE d.trip_id = $1 AND d.day_date = ($2::timestamptz AT TIME ZONE $3)::date
        AND d.day_date BETWEEN t.starts_on AND t.ends_on`,
      [tripId, source.startsAt, context.timeZone]);
    if (!day.rows[0]) throw new AppNotFoundError("Calendar source date is not in this trip.");
    const locationName = parsed.locationName !== undefined ? parsed.locationName : source.location;
    const mapUrl = parsed.mapUrl ?? null;
    if (parsed.aiReceiptToken) verifyCalendarLocationToken(parsed.aiReceiptToken, config.authSecret, session, { locationName, mapUrl });
    const requestId = randomUUID();
    await createChangeRequestWithClient(client, session, tripId, { entityType: "itinerary_item", operation: "create", source: parsed.aiReceiptToken ? "ai" : "import",
      reason: "Imported from personal Google Calendar", patch: { tripDayId: day.rows[0].id, title: source.title, itemType: parsed.itemType ?? "activity",
        startsAt: source.startsAt, endsAt: source.endsAt, locationName, mapUrl, visibility: parsed.visibility ?? "private",
        ...(source.timeZones && locationName === source.location
          ? { timeZones: calendarFallbackTimeZones(locationName, source.timeZones, mapUrl) } : {}),
        viewerMemberIds: parsed.visibility === "trip" ? [] : parsed.viewerMemberIds ?? [], status: "planned" } }, requestId);
    await client.query(`INSERT INTO calendar_import_receipts (id, trip_id, member_id, app_user_id, account_subject, calendar_id, provider_event_id,
      connection_generation, change_request_id, source_etag, source_digest, source_snapshot) VALUES ($1,$2,$3,$4,$5,'primary',$6,$7,$8,$9,$10,$11::jsonb)`,
    [randomUUID(), tripId, session.memberId, session.userId, claims.accountSubject, source.eventId, claims.generation, requestId,
      fetched.etag, fetched.digest, JSON.stringify(source)]);
    await appendAudit(client, { tripId, actorMemberId: session.memberId, entityType: "change_request", entityId: requestId,
      action: "calendar_imported", metadata: { provider: "google_calendar", allDay: source.allDay, aiAssisted: Boolean(parsed.aiReceiptToken) } });
    const permissions = await getMemberPermissions(client, tripId, session.memberId);
    if (!parsed.aiReceiptToken && (session.role === "owner" || !permissions.itineraryRequiresApproval)) {
      await applyPermittedChangeRequestWithClient(client, session, tripId, requestId);
    }
    const result = await existingImport(client, session, claims.accountSubject, source.eventId);
    if (!result) throw new AppConflictError("Calendar import could not be recorded.");
    return { ...result, replayed: false };
  });
}
