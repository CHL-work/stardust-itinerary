import type { ItineraryPatch } from "@/lib/app/types";

export const transportEndpointRequiredMessage = "Enter a departure location or destination.";
export const transportMapUrlMessage = "Use an HTTPS Google Maps URL.";

const trustedGoogleMapsHosts = new Set([
  "google.com",
  "www.google.com",
  "maps.google.com",
  "google.co.jp",
  "www.google.co.jp",
  "maps.google.co.jp",
  "google.com.hk",
  "www.google.com.hk",
  "maps.google.com.hk",
  "google.com.tw",
  "www.google.com.tw",
  "maps.google.com.tw",
  "google.co.uk",
  "www.google.co.uk",
  "maps.google.co.uk",
]);

export type ItineraryLocationState = {
  itemType: NonNullable<ItineraryPatch["itemType"]>;
  locationName: string | null;
  mapUrl: string | null;
  departureLocationName: string | null;
  departureMapUrl: string | null;
  destinationLocationName: string | null;
  destinationMapUrl: string | null;
};

function valueOrCurrent<T>(next: T | undefined, current: T): T {
  return next === undefined ? current : next;
}

export function isTrustedGoogleMapsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "maps.app.goo.gl") return true;
    if (host === "goo.gl") return url.pathname === "/maps" || url.pathname.startsWith("/maps/");
    if (!trustedGoogleMapsHosts.has(host)) return false;
    if (host.startsWith("maps.")) return true;
    return url.pathname === "/maps" || url.pathname.startsWith("/maps/");
  } catch {
    return false;
  }
}

function mapForLocation(
  resolvedName: string | null,
  nextName: string | null | undefined,
  nextMapUrl: string | null | undefined,
  currentName: string | null,
  currentMapUrl: string | null,
): string | null {
  if (!resolvedName) return null;
  if (nextMapUrl !== undefined) return nextMapUrl;
  return nextName !== undefined && nextName !== currentName ? null : currentMapUrl;
}

export function transportHasEndpoint(input: Pick<
  ItineraryLocationState,
  "itemType" | "departureLocationName" | "destinationLocationName"
>): boolean {
  if (input.itemType !== "transport") return true;
  return Boolean(input.departureLocationName?.trim() || input.destinationLocationName?.trim());
}

/**
 * Resolve a partial itinerary patch into the one canonical location shape.
 * Generic locations belong to non-transport items; route endpoints belong to
 * transport items. Legacy transport patches that still send locationName/mapUrl
 * are interpreted as a destination.
 */
export function resolveItineraryLocationState(
  patch: ItineraryPatch,
  current?: Partial<ItineraryLocationState>,
): ItineraryLocationState {
  const currentType = current?.itemType ?? "activity";
  const itemType = patch.itemType ?? currentType;

  if (itemType === "transport") {
    const nextDestinationName = patch.destinationLocationName !== undefined
      ? patch.destinationLocationName
      : patch.locationName;
    const nextDestinationMapUrl = patch.destinationMapUrl !== undefined
      ? patch.destinationMapUrl
      : patch.mapUrl;
    const fallbackDestinationName = currentType === "transport"
      ? current?.destinationLocationName ?? null
      : current?.locationName ?? null;
    const fallbackDestinationMapUrl = currentType === "transport"
      ? current?.destinationMapUrl ?? null
      : current?.mapUrl ?? null;
    const departureLocationName = valueOrCurrent(
      patch.departureLocationName,
      currentType === "transport" ? current?.departureLocationName ?? null : null,
    );
    const currentDepartureLocationName = currentType === "transport"
      ? current?.departureLocationName ?? null
      : null;
    const currentDepartureMapUrl = currentType === "transport"
      ? current?.departureMapUrl ?? null
      : null;
    const destinationLocationName = valueOrCurrent(
      nextDestinationName,
      fallbackDestinationName,
    );
    return {
      itemType,
      locationName: null,
      mapUrl: null,
      departureLocationName,
      departureMapUrl: mapForLocation(
        departureLocationName,
        patch.departureLocationName,
        patch.departureMapUrl,
        currentDepartureLocationName,
        currentDepartureMapUrl,
      ),
      destinationLocationName,
      destinationMapUrl: mapForLocation(
        destinationLocationName,
        nextDestinationName,
        nextDestinationMapUrl,
        fallbackDestinationName,
        fallbackDestinationMapUrl,
      ),
    };
  }

  const fallbackLocationName = currentType === "transport"
    ? current?.destinationLocationName ?? current?.departureLocationName ?? null
    : current?.locationName ?? null;
  const fallbackMapUrl = currentType === "transport"
    ? current?.destinationMapUrl ?? current?.departureMapUrl ?? null
    : current?.mapUrl ?? null;
  const locationName = valueOrCurrent(patch.locationName, fallbackLocationName);
  return {
    itemType,
    locationName,
    mapUrl: patch.mapUrl !== undefined
      ? patch.mapUrl
      : patch.locationName !== undefined && patch.locationName !== fallbackLocationName
        ? null
        : fallbackMapUrl,
    departureLocationName: null,
    departureMapUrl: null,
    destinationLocationName: null,
    destinationMapUrl: null,
  };
}

export function canonicalizeItineraryLocationPatch(
  patch: ItineraryPatch,
  current?: Partial<ItineraryLocationState>,
): ItineraryPatch {
  const resolved = resolveItineraryLocationState(patch, current);
  return {
    ...patch,
    itemType: resolved.itemType,
    locationName: resolved.locationName,
    mapUrl: resolved.mapUrl,
    departureLocationName: resolved.departureLocationName,
    departureMapUrl: resolved.departureMapUrl,
    destinationLocationName: resolved.destinationLocationName,
    destinationMapUrl: resolved.destinationMapUrl,
  };
}
