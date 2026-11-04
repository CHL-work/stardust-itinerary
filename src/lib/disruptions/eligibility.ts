import type { DisruptionAlert, PublicDisruptionCandidate } from "@/lib/disruptions/types";

export const DISRUPTION_QUALIFICATION_POLICY_VERSION = 1;
export const MINIMUM_MEANINGFUL_DELAY_MINUTES = 30;
const IMMINENT_EVENT_MS = 30 * 60_000;
const blockingEffects = new Set(["cancelled", "unavailable", "access_blocked"]);
const networkReasons = new Set(["transit_disruption", "road_disruption", "strike"]);

function normalizedWords(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function mentionsEntity(value: string, entity: string): boolean {
  const text = normalizedWords(value);
  const subject = normalizedWords(entity);
  // Avoid a one-character fragment or an arbitrary substring of a service name.
  if (subject.replace(/\s/gu, "").length < 2) return false;
  if (text === subject) return true;
  if (/^[\p{Script=Latin}\p{N} ]+$/u.test(subject) && subject.length < 4) return false;
  // Also require explicit boundaries for CJK names: a district fragment inside
  // a longer venue/service name is not an identity. Exact stored locations below
  // still support titles written without spaces around the complete venue name.
  return ` ${text} `.includes(` ${subject} `);
}

function leadingLocationName(value: string): string {
  // Only the leading display-name segment is a candidate identity. Later comma
  // segments and parenthetical annotations usually contain addresses/districts.
  return value.normalize("NFKC").split(/[,;、|\n([\]{}]/u, 1)[0].trim();
}

function locationIdentifiesEntity(value: string, entity: string): boolean {
  const subject = normalizedWords(entity);
  if (subject.replace(/\s/gu, "").length < 2) return false;
  return normalizedWords(value) === subject || normalizedWords(leadingLocationName(value)) === subject;
}

function endpointIdentity(value: string): string {
  return normalizedWords(leadingLocationName(value))
    .replace(/(?:\s+(?:(?:train|railway|railroad)\s+)?station|[駅站])$/u, "").trim();
}

function relevantTime(alert: DisruptionAlert, event: PublicDisruptionCandidate, now: Date): boolean {
  const start = Date.parse(event.startsAt ?? event.endsAt ?? "");
  const end = Date.parse(event.endsAt ?? event.startsAt ?? "");
  const from = Date.parse(alert.affectedFrom ?? "");
  const until = Date.parse(alert.affectedUntil ?? "");
  if (![start, end, from].every(Number.isFinite) || end < start) return false;
  if (Number.isFinite(until)) {
    if (until <= from) return false;
    // Known ends are exclusive. An event with no end is assessed at its known instant;
    // never invent a duration just to manufacture an overlap.
    return start === end ? start >= from && start < until : end > from && start < until;
  }
  // An explicit live, ongoing incident can affect a happening/imminent event without
  // an announced end. It is not evidence that the same problem persists tomorrow.
  const checkedAt = now.getTime();
  return alert.impactAssessment?.ongoing === true && Number.isFinite(checkedAt)
    && from <= checkedAt && start <= checkedAt + IMMINENT_EVENT_MS
    && end >= checkedAt && end >= from;
}

/** Fail closed on weak evidence without treating omission as recovery/resolution.
 * The model extracts evidence; this gate checks applicability, not source truth.
 * Resolutions must go through the worker's separate affirmative-evidence checks.
 */
export function assessDisruptionEligibility(
  alert: DisruptionAlert,
  event: PublicDisruptionCandidate,
  now: Date,
): { eligible: boolean; reason: string } {
  const reject = (reason: string) => ({ eligible: false, reason });
  if (alert.state !== "confirmed") return reject("not_confirmed");
  if (alert.severity !== "warning" && alert.severity !== "critical") return reject("not_warning_severity");
  const assessment = alert.impactAssessment;
  if (!assessment) return reject("missing_impact_assessment");
  if (assessment.confidence !== "high") return reject("insufficient_confidence");
  if (assessment.sourceAuthority !== "official" || !alert.sourceUrls.length
      || !assessment.evidenceSummary.trim()) return reject("insufficient_official_evidence");
  if (event.itemType === "note") return reject("not_attendance_event");
  if (assessment.match !== "exact_venue" && assessment.match !== "explicit_transport") {
    return reject("indirect_event_match");
  }
  if (networkReasons.has(alert.reasonCode)
      && (event.itemType !== "transport" || assessment.match !== "explicit_transport")) {
    return reject("unplanned_transport_route");
  }
  if (assessment.match === "explicit_transport" && event.itemType !== "transport") {
    return reject("unplanned_transport_route");
  }
  const entity = assessment.affectedEntity?.trim();
  if (!entity) return reject("affected_entity_not_in_event");
  // A title such as "Shibuya to Shinjuku" still names only endpoints, not the
  // affected service. A station suffix or address annotation cannot bypass this.
  if (assessment.match === "explicit_transport"
      && event.locations.some((location) => endpointIdentity(location) === endpointIdentity(entity))) {
    return reject("transport_entity_is_only_endpoint");
  }
  const entityMatches = mentionsEntity(event.title, entity)
    || (assessment.match === "exact_venue" && event.locations.some((location) => locationIdentifiesEntity(location, entity)));
  if (!entityMatches) {
    return reject("affected_entity_not_in_event");
  }
  const blocking = blockingEffects.has(assessment.effect);
  if (event.itemType === "lodging" && !blocking) return reject("non_blocking_lodging_notice");
  if (alert.reasonCode === "weather" && !blocking) return reject("weather_without_direct_blockage");
  if (alert.reasonCode === "access_change" && assessment.effect !== "access_blocked") {
    return reject("routine_access_change");
  }
  if (!blocking) {
    if (assessment.effect !== "delay" && assessment.effect !== "schedule_change") {
      return reject("no_meaningful_effect");
    }
    if (!Number.isInteger(assessment.minimumDelayMinutes)
        || assessment.minimumDelayMinutes! < MINIMUM_MEANINGFUL_DELAY_MINUTES) {
      return reject("delay_below_material_threshold");
    }
  }
  if (!relevantTime(alert, event, now)) return reject("no_supported_time_overlap");
  return { eligible: true, reason: "high_confidence_material_impact" };
}
