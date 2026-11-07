import type { ItineraryPatch } from "@/lib/app/types";
import type { Locale } from "@/lib/i18n";
import { localizedCatalog, type BaseCatalogs } from "@/lib/locale-packs";
import { instantDateInTimeZone } from "@/lib/ai/relative-date";
import { containsReservationSecret } from "@/lib/ai/reservation-secrets";
import { containsPrivateIdentifier } from "@/lib/disruptions/privacy";
import { sanitizeVenueHoursSource } from "@/lib/ai/venue-hours-sources";

export const VENUE_HOURS_MAX_TARGETS = 4;
export const VENUE_HOURS_BUDGET_MS = 60_000;
export const VENUE_HOURS_MIN_BUDGET_MS = 30_000;

export type VenueHoursCandidate = {
  proposalIndex: number;
  key: string;
  venueName: string;
  date: string | null;
  timeZone: string;
  startsAt: string | null;
  endsAt: string | null;
  public: boolean;
};
type EventState = Pick<ItineraryPatch, "itemType" | "locationName" | "startsAt" | "endsAt" | "visibility" | "tripDayId">;
type Prepared = { proposal: { entityType: string; action: string; entityId: string | null }; patch: unknown };
function localDate(instant: string, timeZone: string): string | null {
  try { return instantDateInTimeZone(instant, timeZone); } catch { return null; }
}
export type VenueHoursContext = {
  timeZone: string;
  days: readonly { id: string; date: string }[];
  itinerary: readonly (EventState & { id: string })[];
  pendingItinerary: readonly { requestId: string; patch: EventState }[];
};

/** Resolve only already-validated proposals; never treat pending IDs as canonical IDs. */
export function venueHoursCandidates(prepared: readonly Prepared[], context: VenueHoursContext): VenueHoursCandidate[] {
  const candidates: VenueHoursCandidate[] = [];
  for (const [proposalIndex, entry] of prepared.entries()) {
    const { proposal } = entry;
    if (proposal.entityType !== "itinerary_item" || !["create", "update", "update_pending", "restore"].includes(proposal.action)) continue;
    const patch = entry.patch as ItineraryPatch;
    const base = proposal.action === "update_pending"
      ? context.pendingItinerary.find((item) => item.requestId === proposal.entityId)?.patch
      : context.itinerary.find((item) => item.id === proposal.entityId);
    if (["update", "update_pending"].includes(proposal.action)
      && !(["itemType", "locationName", "mapUrl", "startsAt", "endsAt", "tripDayId", "visibility"] as const)
        .some((key) => Object.hasOwn(patch, key) && patch[key] !== (base as ItineraryPatch | undefined)?.[key])) continue;
    const effective = { ...base, ...patch };
    // A multi-night hotel stay is not a restaurant visit; check-in rules need a different contract.
    if (!effective.locationName?.trim() || !["meal", "activity"].includes(effective.itemType ?? "")) continue;
    const startsAt = effective.startsAt ?? null;
    const date = startsAt ? localDate(startsAt, context.timeZone)
      : context.days.find((day) => day.id === effective.tripDayId)?.date ?? null;
    candidates.push({ proposalIndex, key: `V${candidates.length + 1}`, venueName: effective.locationName.trim(),
      date, timeZone: context.timeZone, startsAt, endsAt: effective.endsAt ?? null,
      // Privacy narrowing/widening must not send the previous private venue to an unsolicited lookup.
      public: effective.visibility === "trip" && (!base || base.visibility === "trip") });
  }
  return candidates;
}

export function safeVenueHoursTarget(candidate: VenueHoursCandidate, memberNames: readonly string[] = []): boolean {
  const name = candidate.venueName.normalize("NFKC");
  if (!candidate.public || !candidate.startsAt || !candidate.date || name.length < 2 || name.length > 240
    || containsPrivateIdentifier(name) || containsReservationSecret(name)
    || /[\r\n\u0000-\u001f]|https?:|(?:my|our|his|her)\s+(?:home|house|apartment)|私人|屋企|自宅/iu.test(name)) return false;
  return !memberNames.some((member) => {
    const normalized = member.normalize("NFKC").trim().toLocaleLowerCase();
    return normalized.length >= 2 && name.toLocaleLowerCase().includes(normalized);
  });
}

export type VenueHoursStatus = "closed" | "outside_hours" | "last_admission" | "unverified" | "published_hours";
export const venueHoursUnverifiedReasons = ["not_checked", "user_disabled", "privacy_blocked", "not_public_or_timed",
  "budget_exhausted", "target_limit", "timeout", "failed", "missing_search", "insufficient_evidence"] as const;
export type VenueHoursUnverifiedReason = typeof venueHoursUnverifiedReasons[number];
export type VenueHoursAssessment = {
  proposalIndex: number; key: string; venueName: string; date: string | null; status: VenueHoursStatus; sources: string[];
  unverifiedReason?: VenueHoursUnverifiedReason;
};
export type VenueHoursAssessmentOptions = {
  unverifiedReason?: VenueHoursUnverifiedReason;
  unverifiedReasons?: ReadonlyMap<string, VenueHoursUnverifiedReason>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function instant(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const parsed = Date.parse(value);
  // Explicit offset and an actually possible civil date; Date.parse alone rolls February 30 forward.
  const date = value.slice(0, 10);
  if (!Number.isFinite(parsed) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
  return parsed;
}

/** The model extracts public evidence; integer instant comparisons, identity binding and fallback are local. */
export function assessVenueHours(
  candidates: readonly VenueHoursCandidate[], raw: unknown, searchPerformed: boolean,
  researchedKeys: ReadonlySet<string> = new Set(candidates.map((candidate) => candidate.key)),
  options: VenueHoursAssessmentOptions = {},
): VenueHoursAssessment[] {
  const rows = Array.isArray(raw) && raw.length <= VENUE_HOURS_MAX_TARGETS ? raw.map(record) : [];
  const validEnvelope = rows.every((row) => row && researchedKeys.has(String(row.key)))
    && new Set(rows.map((row) => row?.key)).size === rows.length;
  return candidates.map((candidate) => {
    const result: VenueHoursAssessment = { proposalIndex: candidate.proposalIndex, key: candidate.key,
      venueName: candidate.venueName, date: candidate.date, status: "unverified", sources: [] };
    const unverified = (): VenueHoursAssessment => {
      const supplied = options.unverifiedReasons?.get(candidate.key) ?? options.unverifiedReason;
      const inferred = !candidate.public ? "privacy_blocked" : !candidate.date || !candidate.startsAt ? "not_public_or_timed"
        : !searchPerformed ? "missing_search" : "insufficient_evidence";
      return { ...result, unverifiedReason: supplied && venueHoursUnverifiedReasons.includes(supplied) ? supplied : inferred };
    };
    if (!searchPerformed || !validEnvelope || !researchedKeys.has(candidate.key) || !candidate.public
      || !candidate.date || !/^\d{4}-\d{2}-\d{2}$/u.test(candidate.date)
      || localDate(`${candidate.date}T00:00:00Z`, "UTC") !== candidate.date) return unverified();
    const row = rows.find((row) => row?.key === candidate.key);
    if (!row || row.venueName !== candidate.venueName || row.date !== candidate.date
      || row.timeZone !== candidate.timeZone || !Array.isArray(row.sources)
      || !row.sources.length || row.sources.length > 5 || !Array.isArray(row.intervals) || row.intervals.length > 6) return unverified();
    const sources = [...new Set(row.sources.map((source) => typeof source === "string" ? sanitizeVenueHoursSource(source) : null)
      .filter((source): source is string => source !== null))];
    if (!sources.length) return unverified();
    if (row.status === "closed" && row.intervals.length === 0) return { ...result, status: "closed", sources: sources as string[] };
    if (row.status !== "hours_found" || !row.intervals.length || !candidate.startsAt) return unverified();
    const start = instant(candidate.startsAt), end = candidate.endsAt ? instant(candidate.endsAt) : start;
    if (start === null || end === null || end < start) return unverified();
    const intervals: Array<{ open: number; close: number; last: number | null }> = [];
    for (const rawInterval of row.intervals) {
      const interval = record(rawInterval);
      if (!interval) return unverified();
      const open = instant(interval.opensAt), close = instant(interval.closesAt);
      const last = interval.lastAdmissionAt === null ? null : instant(interval.lastAdmissionAt);
      if (open === null || close === null || close <= open || close - open > 48 * 60 * 60 * 1000
        || !Object.hasOwn(interval, "lastAdmissionAt") || (interval.lastAdmissionAt !== null && last === null)
        || (last !== null && (last < open || last > close))) return unverified();
      // Reject intervals for another day. Overnight service may open the previous day.
      const previousDay = new Date(Date.parse(`${candidate.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const openingDay = localDate(String(interval.opensAt), candidate.timeZone);
      const closingDay = localDate(new Date(close - 1).toISOString(), candidate.timeZone);
      if (openingDay !== candidate.date && !(openingDay === previousDay && closingDay === candidate.date)) return unverified();
      intervals.push({ open, close, last });
    }
    intervals.sort((a, b) => a.open - b.open);
    if (intervals.some((interval, index) => index > 0 && interval.open < intervals[index - 1]!.close)) return unverified();
    const arrivalWindow = intervals.find((interval) => start >= interval.open && start < interval.close);
    const status: VenueHoursStatus = !arrivalWindow ? "outside_hours"
      : arrivalWindow.last !== null && start >= arrivalWindow.last ? "last_admission"
        : end > arrivalWindow.close ? "outside_hours" : "published_hours";
    return { ...result, status, sources: sources as string[] };
  });
}

export const venueHoursMessages: BaseCatalogs<Record<VenueHoursStatus, string>> = {
  en: {
    closed: "Published hours list this venue as closed on the planned date. Change the slot or confirm directly before visiting.",
    outside_hours: "The planned visit is outside the published opening periods or extends past closing. Review the time before visiting.",
    last_admission: "The planned arrival is at or after the published last-order/admission cutoff. Choose an earlier time or confirm directly.",
    unverified: "Opening hours for this visit remain unverified.",
    published_hours: "This slot fits published hours; same-day changes, seats and reservations are not confirmed.",
  },
  "zh-HK": {
    closed: "公布資料顯示此地點在預定日期休息。請調整時段，或出發前直接向店家確認。",
    outside_hours: "預定活動不在公布的營業時段內，或會超過關門時間。出發前請檢查時間。",
    last_admission: "預定到達時間已達或超過公布的最後落單／入場時間。請提早到達，或直接向店家確認。",
    unverified: "這次到訪的營業時間仍未核實。",
    published_hours: "此時段符合公布的營業時間；當日變動、座位及預約仍未確認。",
  },
  "ja-JP": {
    closed: "公表情報では訪問予定日は休業日です。日時を変更するか、訪問前に店舗へ直接確認してください。",
    outside_hours: "訪問予定は公表の営業時間外、または閉店時刻を超えます。訪問前に時間を見直してください。",
    last_admission: "到着予定は公表のラストオーダー・最終入場時刻以降です。早めるか、店舗へ直接確認してください。",
    unverified: "この訪問日時の営業時間は未確認です。",
    published_hours: "公表の営業時間には収まっています。当日の変更、空席、予約は未確認です。",
  },
};

export const venueHoursUnverifiedMessages: BaseCatalogs<Record<VenueHoursUnverifiedReason, string>> = {
  en: {
    not_checked: "Opening hours were not checked for this visit.",
    user_disabled: "Hours were not checked because web search was disabled for this request.",
    privacy_blocked: "Hours were not checked to protect private trip information.",
    not_public_or_timed: "Hours were not checked because a public venue or planned visit time was missing.",
    budget_exhausted: "Hours were not checked because there was not enough time left for a lookup.",
    target_limit: "This visit was outside the locations checked in this request.",
    timeout: "The hours lookup did not finish in time.",
    failed: "The hours lookup could not be completed.",
    missing_search: "No web-search evidence was available to verify these hours.",
    insufficient_evidence: "Available information did not confirm opening hours for this date and time.",
  },
  "zh-HK": {
    not_checked: "這次到訪尚未查詢營業時間。",
    user_disabled: "此請求已停用網上搜尋，因此未有查詢營業時間。",
    privacy_blocked: "為保護旅程的私人資料，未有查詢營業時間。",
    not_public_or_timed: "缺少公開地點或預定到訪時間，因此未有查詢營業時間。",
    budget_exhausted: "此請求餘下時間不足，未有查詢營業時間。",
    target_limit: "這次到訪不在此請求已查詢的地點範圍內。",
    timeout: "營業時間查詢未能在限時內完成。",
    failed: "營業時間查詢未能完成。",
    missing_search: "未有可用的網上搜尋資料核實營業時間。",
    insufficient_evidence: "現有資料未能確認此日期及時段的營業時間。",
  },
  "ja-JP": {
    not_checked: "この訪問の営業時間はまだ調べていません。",
    user_disabled: "このリクエストではウェブ検索を無効にしているため、営業時間は調べていません。",
    privacy_blocked: "旅行の非公開情報を保護するため、営業時間は調べていません。",
    not_public_or_timed: "公開の施設情報または訪問予定時刻がないため、営業時間は調べていません。",
    budget_exhausted: "検索に必要な時間が残っていなかったため、営業時間は調べていません。",
    target_limit: "この訪問先は、今回調べた施設の範囲外でした。",
    timeout: "営業時間の検索が制限時間内に完了しませんでした。",
    failed: "営業時間の検索を完了できませんでした。",
    missing_search: "営業時間の確認に使えるウェブ検索の情報がありませんでした。",
    insufficient_evidence: "得られた情報では、この日時の営業時間を確認できませんでした。",
  },
};

export function venueHoursNotice(assessment: VenueHoursAssessment, locale: Locale): string {
  const statusText = localizedCatalog(locale, "venueHours", venueHoursMessages);
  const unverifiedText = localizedCatalog(locale, "venueHoursUnverified", venueHoursUnverifiedMessages);
  const isConflict = ["closed", "outside_hours", "last_admission"].includes(assessment.status);
  const reason = assessment.unverifiedReason;
  const text = assessment.status === "unverified" && reason && Object.hasOwn(unverifiedText, reason)
    ? unverifiedText[reason] : statusText[assessment.status];
  return `${isConflict ? "⚠" : "ℹ"} ${assessment.venueName.slice(0, 240)}${assessment.date ? ` (${assessment.date})` : ""}: ${text}`;
}
