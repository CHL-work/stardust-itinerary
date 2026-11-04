export type TimedCalendarEntry = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  itemType?: string;
  location?: string | null;
  transparency?: string;
  eventType?: string;
  selfDeclined?: boolean;
  allDay?: boolean;
  invalidTime?: boolean;
  /** Resolved by the server against this member's visible current-trip items. */
  linkedItineraryItemId?: string | null;
};

export type CalendarConflict = {
  itineraryItemId: string;
  itineraryTitle: string;
  calendarEventId: string;
  calendarTitle: string;
};

function interval(entry: TimedCalendarEntry): { start: number; end: number } | null {
  if (entry.invalidTime || !entry.startsAt) return null;
  const start = Date.parse(entry.startsAt);
  const end = entry.endsAt ? Date.parse(entry.endsAt) : start + 60 * 60 * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

const attendanceTitle = /\b(?:check[ -]?(?:in|out)|meeting|conference|dinner|lunch|breakfast|appointment|tour)\b|入住手續|退房|辦理入住|チェックイン|チェックアウト|晚餐|午餐|早餐|會議|会議|打合せ/iu;
const explicitStayTitle = /^(?:stay(?:ing)?\s+at\s+\S|(?:hotel|accommodation|lodging)\s+(?:stay|reservation|booking)\b)|(?:住宿|宿泊)\s*$/iu;

/** Lodging is a place available to stay, not continuous required attendance. */
function isBackground(entry: TimedCalendarEntry): boolean {
  if (entry.itemType === "lodging" || entry.itemType === "note") return true;
  if (entry.transparency === "transparent" || entry.selfDeclined
      || entry.eventType === "workingLocation" || entry.eventType === "birthday") return true;
  // Do not infer a different type for an explicitly typed activity or meal.
  if (entry.itemType) return false;
  const title = entry.title.normalize("NFKC").trim();
  return explicitStayTitle.test(title) && !attendanceTitle.test(title);
}

function normalizedPlace(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "");
}

function mealPlace(value: string): string {
  return normalizedPlace(value.normalize("NFKC").trim()
    .replace(/^(?:reservation|booking|breakfast|lunch|dinner|brunch)\s+(?:at|for)\s+/iu, "")
    .replace(/\s*(?:晚餐|午餐|早餐|宵夜|夕食|昼食|朝食|dinner|lunch|breakfast|brunch)\s*$/iu, ""));
}

function flightNumbers(title: string): Set<string> {
  return new Set(Array.from(title.normalize("NFKC").toUpperCase()
    .matchAll(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*0*(\d{1,4})\b/gu),
  (match) => `${match[1]}${Number(match[2])}`));
}

/** Only suppress obvious imported copies; unknown similarities stay visible. */
function isImportedCopy(item: TimedCalendarEntry, event: TimedCalendarEntry): boolean {
  if (event.linkedItineraryItemId || item.allDay || event.allDay || !item.startsAt || !event.startsAt) return false;
  const startDifference = Math.abs(Date.parse(item.startsAt) - Date.parse(event.startsAt));
  if (!Number.isFinite(startDifference) || startDifference > 5 * 60 * 1000) return false;
  if (item.itemType === "transport") {
    if (/\b(?:train|bus|ferry)\b|新幹線|新干线|鐵路|铁路|巴士|列車|列车/iu.test(item.title)
        || !/\b(?:flight|air|airways|airlines)\b|航空|航班|飛行機/iu.test(`${item.title} ${event.title}`)) return false;
    const itemFlights = flightNumbers(item.title);
    return Array.from(flightNumbers(event.title)).some((flight) => itemFlights.has(flight));
  }
  if (item.itemType !== "meal"
      || !/^(?:reservation|booking|breakfast|lunch|dinner|brunch)\s+(?:at|for)\s+/iu.test(event.title.trim())) return false;
  const providerPlace = mealPlace(event.title);
  // Short/generic labels cannot establish a restaurant identity.
  if (providerPlace.length < 4 || /^(?:restaurant|cafe|dinner|lunch|breakfast|meal|餐廳|餐厅)$/u.test(providerPlace)) return false;
  return providerPlace === mealPlace(item.title)
    || Boolean(item.location && providerPlace === normalizedPlace(item.location));
}

export function findCalendarConflicts(
  itinerary: readonly TimedCalendarEntry[],
  calendarEvents: readonly TimedCalendarEntry[],
  linkedProviderEventByItem: ReadonlyMap<string, string>,
): CalendarConflict[] {
  const conflicts: CalendarConflict[] = [];
  const visibleItems = new Map(itinerary.map((item) => [item.id, item]));
  const linkedItemByProviderEvent = new Map(Array.from(linkedProviderEventByItem,
    ([itemId, eventId]) => [eventId, itemId]));
  const candidates = calendarEvents.map((event) => {
    const linkedItem = visibleItems.get(event.linkedItineraryItemId
      ?? linkedItemByProviderEvent.get(event.id) ?? "");
    return {
      ...event,
      ...(linkedItem ? { itemType: linkedItem.itemType, linkedItineraryItemId: linkedItem.id } : {}),
    };
  }).filter((event) => !isBackground(event));
  const seen = new Set<string>();
  for (const item of itinerary) {
    if (isBackground(item)) continue;
    const itemInterval = interval(item);
    if (!itemInterval) continue;
    for (const event of candidates) {
      if (linkedProviderEventByItem.get(item.id) === event.id
          || event.linkedItineraryItemId === item.id || isImportedCopy(item, event)) continue;
      const eventInterval = interval(event);
      if (!eventInterval) continue;
      if (itemInterval.start < eventInterval.end && eventInterval.start < itemInterval.end) {
        // Deduplicate remote copies per itinerary item, retaining both sides of
        // different-item pairs so selected-day Overview never loses a warning.
        const key = JSON.stringify([item.id, event.linkedItineraryItemId ?? event.id]);
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          itineraryItemId: item.id,
          itineraryTitle: item.title,
          calendarEventId: event.id,
          calendarTitle: event.title,
        });
      }
    }
  }
  return conflicts;
}
