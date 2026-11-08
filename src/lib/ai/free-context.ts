/**
 * The keyless provider may retain prompts. Project only the trip-wide planning
 * facts a user expects from choosing Free; never spread a database object here.
 * This is data minimization, not authorization: callers must first obtain the
 * current viewer-authorized context and retain the original for write checks.
 */
type DataRecord = Record<string, unknown>;

const tripFields = ["id", "destinationName", "timeZone", "currency", "startsOn", "endsOn"] as const;
const timeFields = ["nowUtc", "timeZone", "tripLocalDate", "tomorrowLocalDate", "tripLocalTime", "tripLocalWeekday", "planningReferenceDate"] as const;
const eventFields = [
  "id", "tripDayId", "revision", "title", "itemType", "startsAt", "endsAt", "locationName", "visibility",
  "departureLocationName", "destinationLocationName", "status", "isLocked",
] as const;
const flightFields = ["flightNumber", "airline", "departureTerminal", "departureGate", "arrivalTerminal", "departureTimeZone", "arrivalTimeZone"] as const;
const pendingFields = ["requestId", "proposalRevision", "operation", "targetItemId", "createdByMemberId", "hasLinkedExpense"] as const;

function record(value: unknown): DataRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as DataRecord : {};
}

function rows(value: unknown): DataRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

/** Unexpected nested fields cannot hitch a ride in an otherwise allowed slot. */
function scalarFields(source: DataRecord, keys: readonly string[]): DataRecord {
  const output: DataRecord = {};
  for (const key of keys) {
    const value = source[key];
    if (value === null || typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))) output[key] = value;
  }
  return output;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function nameIsMentioned(name: string, request: string): boolean {
  const value = normalized(name);
  if (!value || value.length > 160) return false;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  // Latin names must not match inside another word (Ann / planning). CJK names
  // naturally touch surrounding words, for example a one-character nickname.
  const prefix = /^[\p{Script=Latin}\p{N}_]/u.test(value) ? "(?<![\\p{L}\\p{N}_])" : "";
  const suffix = /[\p{Script=Latin}\p{N}_]$/u.test(value) ? "(?![\\p{L}\\p{N}_])" : "";
  return new RegExp(`${prefix}${escaped}${suffix}`, "u").test(request);
}

function eventProjection(value: DataRecord): DataRecord {
  const output = scalarFields(value, eventFields);
  if (value.flight === null) output.flight = null;
  else if (value.flight && typeof value.flight === "object" && !Array.isArray(value.flight)) {
    output.flight = scalarFields(record(value.flight), flightFields);
  }
  return output;
}

/**
 * `prompt` may include already-approved free-lane draft submissions for resolving
 * a follow-up payer name. Never pass a paid conversation, its checkpoint, or
 * saved personal instructions as the name-disclosure basis.
 */
export function safeFreePlanningContext(context: unknown, prompt: string): DataRecord {
  const source = record(context);
  const request = normalized(prompt);
  const itinerary = rows(source.itinerary).filter((item) => item.visibility === "trip").map(eventProjection);
  const publicItemIds = new Set(itinerary.map((item) => item.id).filter((id): id is string => typeof id === "string"));
  const pendingItinerary = rows(source.pendingItinerary).filter((item) => {
    if (record(item.patch).visibility !== "trip") return false;
    // A proposal-only reviewer can see a private target's pending widening.
    // Do not export that private base through an apparently trip-wide update.
    return item.operation === "create" ? item.targetItemId == null
      : item.operation === "update" && typeof item.targetItemId === "string" && publicItemIds.has(item.targetItemId);
  }).map((item) => ({ ...scalarFields(item, pendingFields), patch: eventProjection(record(item.patch)) }));

  const audienceDirectory = rows(source.audienceDirectory).filter((member) =>
    typeof member.id === "string" && member.id.length > 0
      && (member.status === undefined || member.status === "active" || member.status === "invited"),
  ).map((member, index) => ({
    ...scalarFields(member, ["id", "role", "status"]),
    displayName: typeof member.displayName === "string" && nameIsMentioned(member.displayName, request)
      ? member.displayName : `Member ${index + 1}`,
  }));

  return {
    trip: scalarFields(record(source.trip), tripFields),
    actor: source.actor === null ? null : scalarFields(record(source.actor), ["memberId", "role"]),
    currentTime: scalarFields(record(source.currentTime), timeFields),
    days: rows(source.days).map((day) => scalarFields(day, ["id", "date"])),
    audienceDirectory,
    itinerary,
    pendingItinerary,
    pendingItineraryTruncated: source.pendingItineraryTruncated === true,
    currentRequest: { imageCount: 0 },
    freeContextNotice: "Private events, notes, URLs, saved instructions and existing expenses are not included. Unmentioned member names are aliases; ask for a name when a participant is unclear.",
  };
}
