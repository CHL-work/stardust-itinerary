import { describe, expect, it } from "vitest";

import {
  canonicalizeItineraryLocationPatch,
  isTrustedGoogleMapsUrl,
  resolveItineraryLocationState,
  transportHasEndpoint,
} from "@/lib/app/transport";

describe("transport endpoint normalization", () => {
  it("maps a legacy transport location to its destination", () => {
    expect(resolveItineraryLocationState({
      itemType: "transport",
      locationName: "Tokyo Station",
      mapUrl: "https://maps.example.test/tokyo",
    })).toMatchObject({
      locationName: null,
      mapUrl: null,
      departureLocationName: null,
      destinationLocationName: "Tokyo Station",
      destinationMapUrl: "https://maps.example.test/tokyo",
    });
  });

  it("requires at least one named endpoint for transport", () => {
    expect(transportHasEndpoint(resolveItineraryLocationState({ itemType: "transport" }))).toBe(false);
    expect(transportHasEndpoint(resolveItineraryLocationState({
      itemType: "transport",
      departureLocationName: "Haneda Airport",
    }))).toBe(true);
  });

  it("merges partial updates without losing the other endpoint", () => {
    const current = resolveItineraryLocationState({
      itemType: "transport",
      departureLocationName: "Haneda Airport",
      destinationLocationName: "Tokyo Station",
    });
    expect(resolveItineraryLocationState({ departureLocationName: null }, current)).toMatchObject({
      itemType: "transport",
      departureLocationName: null,
      destinationLocationName: "Tokyo Station",
    });
  });

  it("clears a stale Maps URL when its location name changes", () => {
    const current = resolveItineraryLocationState({
      itemType: "transport",
      departureLocationName: "Haneda Airport",
      departureMapUrl: "https://maps.example.test/haneda",
    });
    expect(resolveItineraryLocationState({ departureLocationName: "Narita Airport" }, current))
      .toMatchObject({ departureLocationName: "Narita Airport", departureMapUrl: null });
  });

  it("clears route-only fields when an item becomes a regular event", () => {
    const current = resolveItineraryLocationState({
      itemType: "transport",
      destinationLocationName: "Tokyo Station",
      destinationMapUrl: "https://maps.example.test/tokyo",
    });
    expect(canonicalizeItineraryLocationPatch({ itemType: "activity" }, current)).toMatchObject({
      itemType: "activity",
      locationName: "Tokyo Station",
      mapUrl: "https://maps.example.test/tokyo",
      departureLocationName: null,
      destinationLocationName: null,
    });
  });

  it("accepts only HTTPS Google Maps endpoint links", () => {
    expect(isTrustedGoogleMapsUrl("https://www.google.com/maps/place/Tokyo")).toBe(true);
    expect(isTrustedGoogleMapsUrl("https://maps.google.co.jp/?q=Tokyo")).toBe(true);
    expect(isTrustedGoogleMapsUrl("https://maps.app.goo.gl/example")).toBe(true);
    expect(isTrustedGoogleMapsUrl("http://www.google.com/maps/place/Tokyo")).toBe(false);
    expect(isTrustedGoogleMapsUrl("javascript:alert(1)")).toBe(false);
    expect(isTrustedGoogleMapsUrl("https://example.test/google-maps")).toBe(false);
    expect(isTrustedGoogleMapsUrl("https://www.google.example/maps/place/Tokyo")).toBe(false);
  });
});
