import { z } from "zod";
import { canonicalTripTimeZone } from "@/lib/app/trip-time-zone";
import type { FlightDetails } from "@/lib/app/flight";

const zone = z.string().trim().min(1).max(80)
  .refine(value => canonicalTripTimeZone(value) !== null, "Use a named IANA time zone.").nullable().optional();

/** Optional explicit corrections; automatic location evidence is resolved without changing records. */
export const eventTimeZonesSchema = z.object({ start: zone, end: zone }).strict();
export type EventTimeZones = { start?: string | null; end?: string | null };

export function readEventTimeZones(value: unknown): EventTimeZones | null {
  const parsed = eventTimeZonesSchema.safeParse(value);
  if (!parsed.success) return null;
  return Object.fromEntries(Object.entries(parsed.data)
    .map(([key, value]) => [key, value ? canonicalTripTimeZone(value) : null]));
}

type ZoneLocation = {
  itemType?: string;
  timeZones?: EventTimeZones | null;
  locationName?: string | null;
  mapUrl?: string | null;
  departureLocationName?: string | null;
  departureMapUrl?: string | null;
  destinationLocationName?: string | null;
  destinationMapUrl?: string | null;
};

type FlightZoneLocation = ZoneLocation & { flight?: FlightDetails | null };

/** Old flight overrides must not survive a moved airport or an explicit generic Auto selection. */
export function resolveLegacyFlightTimeZonesPatch(patch: FlightZoneLocation, current?: FlightZoneLocation): FlightDetails | null {
  if ((patch.itemType ?? current?.itemType ?? "activity") !== "transport") return null;
  const flight = patch.flight !== undefined ? patch.flight : current?.flight;
  if (!flight) return null;
  const next = { ...flight };
  const changed = (key: keyof Omit<ZoneLocation, "timeZones" | "itemType">) =>
    patch[key] !== undefined && patch[key] !== current?.[key];
  const startReset = changed("departureLocationName") || changed("departureMapUrl")
    || patch.timeZones === null || patch.timeZones?.start !== undefined;
  const endReset = changed("destinationLocationName") || changed("destinationMapUrl") || changed("locationName") || changed("mapUrl")
    || patch.timeZones === null || patch.timeZones?.end !== undefined;
  if (startReset && patch.flight?.departureTimeZone === undefined && next.departureTimeZone !== undefined) next.departureTimeZone = null;
  if (endReset && patch.flight?.arrivalTimeZone === undefined && next.arrivalTimeZone !== undefined) next.arrivalTimeZone = null;
  return next;
}

/** Do not silently carry a manually pinned zone to a different place. Instants never change here. */
export function resolveEventTimeZonesPatch(patch: ZoneLocation, current?: ZoneLocation): EventTimeZones | null {
  const transport = (patch.itemType ?? current?.itemType ?? "activity") === "transport";
  if (patch.timeZones !== undefined) {
    const explicit = patch.timeZones === null ? null : readEventTimeZones(eventTimeZonesSchema.parse(patch.timeZones));
    return explicit && !transport ? { start: explicit.start ?? null } : explicit;
  }
  const stored = readEventTimeZones(current?.timeZones);
  if (!stored) return null;
  if (current?.itemType && (current.itemType === "transport") !== transport) return null;
  const changed = (key: keyof Omit<ZoneLocation, "timeZones" | "itemType">) =>
    patch[key] !== undefined && patch[key] !== current?.[key];
  if (!transport) return changed("locationName") || changed("mapUrl") ? null : { start: stored.start ?? null };
  return {
    start: changed("departureLocationName") || changed("departureMapUrl") ? null : stored.start ?? null,
    end: changed("destinationLocationName") || changed("destinationMapUrl") || changed("locationName") || changed("mapUrl")
      ? null : stored.end ?? null,
  };
}
