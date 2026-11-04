import { describe, expect, it } from "vitest";
import { chooseMapViewport, projectMapPoint, type MapCoordinate, type MapViewport } from "./geometry";

const origin: MapViewport = { center: { lat: 0, lng: 0 }, zoom: 1, width: 640, height: 400 };

function expectFitted(points: MapCoordinate[]) {
  const viewport = chooseMapViewport(points)!;
  expect(viewport).not.toBeNull();
  for (const point of points) {
    const position = projectMapPoint(point, viewport)!;
    expect(position.xPercent).toBeGreaterThanOrEqual(96 / 640 * 100 - 1e-8);
    expect(position.xPercent).toBeLessThanOrEqual(544 / 640 * 100 + 1e-8);
    expect(position.yPercent).toBeGreaterThanOrEqual(112 / 400 * 100 - 1e-8);
    expect(position.yPercent).toBeLessThanOrEqual(336 / 400 * 100 + 1e-8);
  }
  return viewport;
}

describe("chooseMapViewport", () => {
  it("does not invent a destination when no valid coordinates exist", () => {
    expect(chooseMapViewport([])).toBeNull();
    expect(chooseMapViewport([{ lat: NaN, lng: 0 }, { lat: 0, lng: Infinity }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }])).toBeNull();
  });

  it("uses a bounded close-up for one point and reserves bottom attribution space", () => {
    const point = { lat: 35, lng: 139 };
    const viewport = expectFitted([point]);
    expect(viewport).toMatchObject({ zoom: 16, width: 640, height: 400 });
    expect(projectMapPoint(point, viewport)!.xPercent).toBeCloseTo(50, 7);
    expect(projectMapPoint(point, viewport)!.yPercent).toBeCloseTo(56, 7);
  });

  it("fits several nearby points at the largest integer zoom allowed by padding", () => {
    const points = [{ lat: 35.60, lng: 139.65 }, { lat: 35.70, lng: 139.80 }, { lat: 35.66, lng: 139.72 }];
    const viewport = expectFitted(points);
    expect(viewport.zoom).toBeGreaterThanOrEqual(10);
    const tighter = { ...viewport, zoom: viewport.zoom + 1 };
    expect(points.some((point) => {
      const projected = projectMapPoint(point, tighter)!;
      return projected.xPercent < 15 || projected.xPercent > 85 || projected.yPercent < 28 || projected.yPercent > 84;
    })).toBe(true);
  });

  it("fits the short arc across the international date line", () => {
    const points = [{ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 }];
    const viewport = expectFitted(points);
    expect(Math.abs(viewport.center.lng)).toBeCloseTo(180, 8);
    expect(viewport.zoom).toBeGreaterThan(8);
    expect(projectMapPoint(points[0]!, viewport)!.xPercent).toBeLessThan(50);
    expect(projectMapPoint(points[1]!, viewport)!.xPercent).toBeGreaterThan(50);
  });

  it("treats -180 and +180 as the same longitude", () => {
    const viewport = expectFitted([{ lat: 0, lng: -180 }, { lat: 0, lng: 180 }]);
    expect(viewport.zoom).toBe(16);
    expect(projectMapPoint({ lat: 0, lng: -180 }, viewport)).toEqual(projectMapPoint({ lat: 0, lng: 180 }, viewport));
  });

  it("keeps world-spanning and isolated polar coordinates finite and inside the padded map", () => {
    const viewport = expectFitted([
      { lat: 80, lng: -135 }, { lat: -80, lng: -45 }, { lat: 60, lng: 45 }, { lat: -60, lng: 135 },
    ]);
    expect(viewport.zoom).toBe(0);
    expectFitted([{ lat: 90, lng: 0 }]);
    expectFitted([{ lat: -90, lng: 0 }]);
  });

  it("returns no map when opposite polar extremes cannot fit without obscuring controls or attribution", () => {
    expect(chooseMapViewport([{ lat: 90, lng: 0 }, { lat: -90, lng: 0 }])).toBeNull();
  });

  it("keeps 44px-tall and 76px-wide badges inside a 264px phone preview", () => {
    const points = [{ lat: 35.6, lng: 139.65 }, { lat: 35.7, lng: 139.8 }, { lat: 35.66, lng: 139.72 }];
    const viewport = expectFitted(points);
    const phoneWidth = 264;
    const phoneHeight = phoneWidth * viewport.height / viewport.width;
    for (const point of points) {
      const position = projectMapPoint(point, viewport)!;
      const anchorX = position.xPercent / 100 * phoneWidth;
      const anchorY = position.yPercent / 100 * phoneHeight;
      expect(anchorX - 76 / 2).toBeGreaterThanOrEqual(0);
      expect(anchorX + 76 / 2).toBeLessThanOrEqual(phoneWidth);
      expect(anchorY - 44).toBeGreaterThanOrEqual(0);
      expect(phoneHeight - anchorY).toBeGreaterThanOrEqual(64 / 640 * phoneWidth);
    }
  });

  it("is independent of input order and does not mutate its input", () => {
    const points = [{ lat: 5, lng: -178 }, { lat: 3, lng: 176 }, { lat: 7, lng: 179 }];
    const before = structuredClone(points);
    expect(chooseMapViewport(points)).toEqual(chooseMapViewport([...points].reverse()));
    expect(points).toEqual(before);
  });

  it("ignores invalid coordinates without changing the valid fit", () => {
    const valid = [{ lat: 10, lng: 20 }];
    expect(chooseMapViewport([...valid, { lat: NaN, lng: 0 }])).toEqual(chooseMapViewport(valid));
  });

  it("fits a deterministic latitude/longitude grid and repeated coordinates", () => {
    const points = [-80, -40, 0, 40, 80].flatMap((lat) => [-175, -90, 0, 90, 175].map((lng) => ({ lat, lng })));
    expectFitted(points);
    const repeated = [{ lat: 35, lng: 139 }, { lat: 35, lng: 139 }];
    const viewport = expectFitted(repeated);
    expect(projectMapPoint(repeated[0]!, viewport)).toEqual(projectMapPoint(repeated[1]!, viewport));
  });
});

describe("projectMapPoint", () => {
  it("places the viewport center in the image center", () => {
    expect(projectMapPoint({ lat: 0, lng: 0 }, origin)).toEqual({ xPercent: 50, yPercent: 50 });
  });

  it("uses east/right and north/up Web Mercator axes", () => {
    const east = projectMapPoint({ lat: 0, lng: 90 }, origin)!;
    const north = projectMapPoint({ lat: 45, lng: 0 }, origin)!;
    expect(east).toEqual({ xPercent: 70, yPercent: 50 });
    expect(north.xPercent).toBe(50);
    expect(north.yPercent).toBeCloseTo(32.04480473, 6);
  });

  it("projects across the date line without jumping a whole world", () => {
    const viewport = { ...origin, center: { lat: 0, lng: 179 } };
    const result = projectMapPoint({ lat: 0, lng: -179 }, viewport)!;
    expect(result.xPercent).toBeGreaterThan(50);
    expect(result.xPercent).toBeLessThan(51);
  });

  it("does not clamp genuinely off-image positions onto a misleading border pin", () => {
    const result = projectMapPoint({ lat: 0, lng: 90 }, { ...origin, zoom: 10 })!;
    expect(result.xPercent).toBeGreaterThan(100);
  });

  it("rejects invalid coordinates and malformed viewports", () => {
    expect(projectMapPoint({ lat: 100, lng: 0 }, origin)).toBeNull();
    expect(projectMapPoint({ lat: 0, lng: NaN }, origin)).toBeNull();
    expect(projectMapPoint({ lat: 0, lng: 0 }, { ...origin, center: { lat: Infinity, lng: 0 } })).toBeNull();
    expect(projectMapPoint({ lat: 0, lng: 0 }, { ...origin, zoom: -1 })).toBeNull();
    expect(projectMapPoint({ lat: 0, lng: 0 }, { ...origin, zoom: 17 })).toBeNull();
    expect(projectMapPoint({ lat: 0, lng: 0 }, { ...origin, zoom: 1.5 })).toBeNull();
    expect(projectMapPoint({ lat: 0, lng: 0 }, { ...origin, width: 0 } as unknown as MapViewport)).toBeNull();
  });
});
