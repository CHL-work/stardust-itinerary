import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { AppConflictError, AppForbiddenError, AppInvalidInputError, AppNotFoundError, getAiPolicy, getMemberPermissions, inTransaction } from "@/lib/app/repository";
import { lockCurrentTripActor } from "@/lib/app/trip-authorization";
import { assertBoundUserAiIdle, CALENDAR_LOCATION_ACTIVE_WINDOW_MINUTES } from "@/lib/ai/conversation";
import { withOperatorAiCredential, withUserAiCredential } from "@/lib/ai/credential-context";
import { readAiCredentialSecret } from "@/lib/ai/credentials";
import { ownerModelRegistry } from "@/lib/app/types";
import type { AuthConfig } from "@/lib/auth/config";
import type { AuthenticatedSession } from "@/lib/auth/repository";
import { buildCalendarLocationPrompt, runCalendarLocationProvider, validateCalendarLocationSubject, type CalendarLocationProviderResult } from "./location-search-provider";
import { calendarLocationSearchInput, type CalendarLocationSearchInput, type CalendarLocationSearchResult } from "./location-search-types";
import { createCalendarLocationToken } from "./location-search-token";

const BUDGET_MS = 60_000;
type StoredResult = Omit<CalendarLocationSearchResult, "aiReceiptToken">;
type RequestRow = { id: string; status: string; request_payload_hash: string; response_json: StoredResult | null; stale: boolean };
const emptyResult = (requestId: string, status: CalendarLocationSearchResult["status"]): StoredResult =>
  ({ requestId, status, locationName: null, mapUrl: null, sources: [] });

async function authorize(client: PoolClient, session: AuthenticatedSession) {
  await lockCurrentTripActor(client, session);
  const permissions = await getMemberPermissions(client, session.tripId, session.memberId);
  if (!permissions.canEditItinerary || !permissions.canSyncCalendar) throw new AppForbiddenError("CALENDAR_IMPORT_FORBIDDEN");
}

async function readRequest(client: PoolClient, session: AuthenticatedSession, requestId: string) {
  return (await client.query<RequestRow>(
    `SELECT id, status, request_payload_hash, response_json,
       created_at <= CURRENT_TIMESTAMP - make_interval(mins => $5::integer) AS stale
       FROM ai_requests WHERE trip_id=$1 AND actor_member_id=$2 AND actor_user_id=$3
         AND client_request_id=$4 AND feature='calendar_location'`,
    [session.tripId, session.memberId, session.userId, requestId, CALENDAR_LOCATION_ACTIVE_WINDOW_MINUTES])).rows[0];
}

function deliver(config: AuthConfig, session: AuthenticatedSession, requestId: string, row: RequestRow): CalendarLocationSearchResult {
  const result = row.status === "succeeded" && row.response_json ? row.response_json
    : emptyResult(requestId, row.status === "started" && !row.stale ? "running" : "unavailable");
  return { ...result, aiReceiptToken: result.status === "found" && result.locationName && result.mapUrl
    ? createCalendarLocationToken(config.authSecret, session, { requestId: row.id, locationName: result.locationName, mapUrl: result.mapUrl }) : null };
}

export async function readCalendarLocationSearch(pool: Pool, config: AuthConfig, session: AuthenticatedSession, requestId: string) {
  return inTransaction(pool, async (client) => {
    await authorize(client, session);
    const row = await readRequest(client, session, requestId);
    if (!row) throw new AppNotFoundError("CALENDAR_LOCATION_NOT_FOUND");
    return deliver(config, session, requestId, row);
  });
}

/** Logs only the explicitly confirmed public query; Calendar private data never enters this service. */
export async function searchCalendarLocation(pool: Pool, config: AuthConfig, session: AuthenticatedSession, raw: CalendarLocationSearchInput): Promise<CalendarLocationSearchResult> {
  const input = calendarLocationSearchInput.parse(raw);
  let subject: string;
  try { subject = validateCalendarLocationSubject(input.subject); } catch { throw new AppInvalidInputError("CALENDAR_LOCATION_PUBLIC_VENUE_REQUIRED"); }
  const hash = createHash("sha256").update(JSON.stringify({ subject, locale: input.locale, consent: true })).digest("hex");
  const id = randomUUID();
  const admission = await inTransaction(pool, async (client) => {
    await authorize(client, session);
    const previous = await readRequest(client, session, input.requestId);
    if (previous) {
      if (previous.request_payload_hash !== hash) throw new AppConflictError("CALENDAR_LOCATION_REQUEST_CHANGED");
      return { kind: "replay" as const, result: deliver(config, session, input.requestId, previous) };
    }
    const policy = await getAiPolicy(client, session, undefined, { serializeMemberQuota: true });
    await assertBoundUserAiIdle(client, session.userId);
    const profile = ownerModelRegistry[policy.model];
    // The free guest model has no search tool; Calendar lookups need a keyed provider.
    if (profile.provider === "kilo") throw new AppForbiddenError("Calendar venue lookup needs an AI key.");
    // The requester's own key, or a trip owner's shared key (JOB-063), read server-side only.
    const keyOwnerId = policy.credentialSource === "own" ? session.userId
      : policy.credentialSource === "shared" ? policy.sponsor?.userId ?? null : null;
    const userCredential = keyOwnerId ? await readAiCredentialSecret(client, keyOwnerId, profile.provider) : null;
    if ((policy.credentialSource === "own" || policy.credentialSource === "shared") && !userCredential) {
      throw new AppForbiddenError("The saved API key for this provider is no longer available.");
    }
    const sponsorMemberId = policy.credentialSource === "shared" ? policy.sponsor?.memberId ?? null : null;
    await client.query(`INSERT INTO ai_requests (trip_id,id,actor_member_id,actor_user_id,actor_role,feature,
      prompt_text,requested_model,provider,transport,authentication_mode,billing_basis,client_request_id,request_payload_hash,credential_source
      ${sponsorMemberId ? ",credential_sponsor_member_id" : ""})
      VALUES ($1,$2,$3,$4,$5,'calendar_location',$6,$7,$8,$9,$10,'api',$11,$12,$13${sponsorMemberId ? ",$14" : ""})`,
    [session.tripId,id,session.memberId,session.userId,session.role,buildCalendarLocationPrompt(subject),policy.model,
      profile.provider,profile.transport,profile.authenticationMode,input.requestId,hash,policy.credentialSource,
      ...(sponsorMemberId ? [sponsorMemberId] : [])]);
    await client.query(`INSERT INTO ai_request_events (trip_id,ai_request_id,sequence,event_type,payload)
      VALUES ($1,$2,1,'calendar.location.started',$3::jsonb)`,
    [session.tripId,id,JSON.stringify({ publicSubject: subject, locale: input.locale, consent: true, model: policy.model })]);
    return { kind: "start" as const, model: policy.model, credentialSource: policy.credentialSource,
      credential: userCredential && (policy.credentialSource === "own" || policy.credentialSource === "shared")
        ? { source: policy.credentialSource, provider: profile.provider, ...userCredential } : null };
  });
  if (admission.kind === "replay") return admission.result;
  const controller = new AbortController();
  const started = Date.now();
  let directory: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let provider: CalendarLocationProviderResult | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "stardust-calendar-location-"));
    const lookup = () => runCalendarLocationProvider({ subject, model: admission.model, workDirectory: directory!, abortController: controller });
    // Funding follows the policy's choice, never elimination: only an operator-funded lookup uses the operator's keys.
    const work = admission.credentialSource === "operator" ? withOperatorAiCredential(lookup)
      : admission.credential ? withUserAiCredential(admission.credential, lookup)
        : Promise.reject(new Error("A user-funded Calendar lookup has no key."));
    provider = await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("CALENDAR_LOCATION_TIMEOUT")); }, BUDGET_MS);
    })]);
    clearTimeout(timer);
    const evidence = provider.evidence;
    const result = emptyResult(input.requestId, evidence.status);
    if (evidence.status === "found" && evidence.venueName && evidence.address) {
      result.locationName = `${evidence.venueName}, ${evidence.address}`;
      result.mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(result.locationName)}`;
      result.sources = evidence.sources.map((url) => ({ title: new URL(url).hostname, url }));
      if (result.locationName.length > 300 || result.mapUrl.length > 2000) Object.assign(result, emptyResult(input.requestId, "unverified"));
    }
    await inTransaction(pool, async (client) => {
      await authorize(client, session);
      const updated = await client.query(`UPDATE ai_requests SET status='succeeded', effective_model=requested_model,
        result_text=$5, response_json=$6::jsonb,input_tokens=$7,output_tokens=$8,cached_input_tokens=$9,
        latency_ms=$10,completed_at=CURRENT_TIMESTAMP
        WHERE trip_id=$1 AND id=$2 AND actor_member_id=$3 AND actor_user_id=$4 AND status='started'
          AND created_at > CURRENT_TIMESTAMP - make_interval(mins => $11::integer) RETURNING id`,
      [session.tripId,id,session.memberId,session.userId,JSON.stringify(evidence),JSON.stringify(result),
        provider!.inputTokens,provider!.outputTokens,provider!.cachedInputTokens,Date.now()-started,CALENDAR_LOCATION_ACTIVE_WINDOW_MINUTES]);
      if (updated.rowCount !== 1) throw new AppConflictError("CALENDAR_LOCATION_REQUEST_EXPIRED");
      await client.query(`INSERT INTO ai_request_events (trip_id,ai_request_id,sequence,event_type,payload)
        VALUES ($1,$2,2,'calendar.location.completed',$3::jsonb)`,
      [session.tripId,id,JSON.stringify({ status: result.status, queries: provider!.queries, sources: evidence.sources })]);
    });
    return { ...result, aiReceiptToken: result.status === "found" && result.locationName && result.mapUrl
      ? createCalendarLocationToken(config.authSecret, session, { requestId: id, locationName: result.locationName, mapUrl: result.mapUrl }) : null };
  } catch (error) {
    // Removal or revocation may have already terminalized the request. Never revive it.
    await inTransaction(pool, async (client) => {
      const updated = await client.query(`UPDATE ai_requests SET status='failed',error_code='CALENDAR_LOCATION_UNAVAILABLE',
        error_message='Public venue search could not be completed.', completed_at=CURRENT_TIMESTAMP,latency_ms=$5,
        input_tokens=$6,output_tokens=$7,cached_input_tokens=$8
        WHERE trip_id=$1 AND id=$2 AND actor_member_id=$3 AND actor_user_id=$4 AND status='started' RETURNING id`,
      [session.tripId,id,session.memberId,session.userId,Date.now()-started,provider?.inputTokens??null,provider?.outputTokens??null,provider?.cachedInputTokens??null]);
      if (updated.rowCount) await client.query(`INSERT INTO ai_request_events (trip_id,ai_request_id,sequence,event_type,payload)
        VALUES ($1,$2,2,'calendar.location.failed','{}'::jsonb)`, [session.tripId,id]);
    });
    if (error instanceof AppForbiddenError || error instanceof AppConflictError) throw error;
    return { ...emptyResult(input.requestId, "unavailable"), aiReceiptToken: null };
  } finally {
    clearTimeout(timer); controller.abort();
    // Exact fresh mkdtemp output only, never a caller-controlled path or workspace.
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
