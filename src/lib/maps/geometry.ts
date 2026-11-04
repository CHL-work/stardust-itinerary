export type MapCoordinate = Readonly<{ lat: number; lng: number }>;

export type MapViewport = Readonly<{
  center: MapCoordinate;
  zoom: number;
  width: 640;
  height: 400;
}>;

export type MapPointPosition = Readonly<{ xPercent: number; yPercent: number }>;

const WIDTH = 640;
const HEIGHT = 400;
const TILE_SIZE = 256;
const MAX_ZOOM = 16;
const MAX_MERCATOR_LATITUDE = 85.0511287798066;
// At a 264px phone width, these logical-image margins still fit a 76px-wide
// badge with a 44px above-anchor height. Bottom attribution remains untouched.
const PADDING = { left: 96, right: 96, top: 112, bottom: 64 } as const;

function validCoordinate(point: MapCoordinate): boolean {
  return Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90
    && Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180;
}

function wrapUnit(value: number): number {
  return ((value % 1) + 1) % 1;
}

function worldPoint(point: MapCoordinate): { x: number; y: number } {
  const latitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, point.lat));
  const sine = Math.sin(latitude * Math.PI / 180);
  return {
    x: wrapUnit((point.lng + 180) / 360),
    y: Math.max(0, Math.min(1, 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI))),
  };
}

function coordinateAt(x: number, y: number): MapCoordinate {
  return {
    lng: wrapUnit(x) * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(1, y))))) * 180 / Math.PI,
  };
}

/** The complement of the largest empty longitude gap is the smallest arc. */
function longitudeBounds(xs: readonly number[]): { start: number; span: number } {
  const sorted = [...xs].sort((left, right) => left - right);
  let largestGap = -1;
  let start = sorted[0]!;
  sorted.forEach((value, index) => {
    const next = sorted[(index + 1) % sorted.length]! + (index === sorted.length - 1 ? 1 : 0);
    if (next - value > largestGap) {
      largestGap = next - value;
      start = wrapUnit(next);
    }
  });
  return { start, span: Math.max(0, 1 - largestGap) };
}

/**
 * Fits a fixed-size Web Mercator image without inventing a default destination.
 * The longitude fit follows the short arc across the international date line.
 * Coordinates at the poles are clamped to the Web Mercator world boundary.
 * A span that cannot fit at the provider's minimum zoom returns no viewport.
 */
export function chooseMapViewport(points: readonly MapCoordinate[]): MapViewport | null {
  const projected = points.filter(validCoordinate).map(worldPoint);
  if (!projected.length) return null;
  const horizontal = longitudeBounds(projected.map((point) => point.x));
  const minimumY = projected.reduce((minimum, point) => Math.min(minimum, point.y), 1);
  const maximumY = projected.reduce((maximum, point) => Math.max(maximum, point.y), 0);
  const usableWidth = WIDTH - PADDING.left - PADDING.right;
  const usableHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const fitZoom = (span: number, size: number) => span > 0
    ? Math.log2(size / (TILE_SIZE * span)) : MAX_ZOOM;
  const zoom = Math.min(MAX_ZOOM, Math.floor(Math.min(
    fitZoom(horizontal.span, usableWidth),
    fitZoom(maximumY - minimumY, usableHeight),
  )));
  if (zoom < 0) return null;
  const worldSize = TILE_SIZE * 2 ** zoom;
  const usableCenterY = PADDING.top + usableHeight / 2;
  const centerY = (minimumY + maximumY) / 2 + (HEIGHT / 2 - usableCenterY) / worldSize;
  return {
    center: coordinateAt(horizontal.start + horizontal.span / 2, centerY),
    zoom,
    width: WIDTH,
    height: HEIGHT,
  };
}

/** Percent positions remain correct when the fixed-aspect image is resized. */
export function projectMapPoint(point: MapCoordinate, viewport: MapViewport): MapPointPosition | null {
  if (!validCoordinate(point) || !validCoordinate(viewport.center)
    || !Number.isInteger(viewport.zoom) || viewport.zoom < 0 || viewport.zoom > MAX_ZOOM
    || viewport.width !== WIDTH || viewport.height !== HEIGHT) return null;
  const projected = worldPoint(point);
  const center = worldPoint(viewport.center);
  let deltaX = projected.x - center.x;
  if (deltaX > 0.5) deltaX -= 1;
  if (deltaX < -0.5) deltaX += 1;
  const worldSize = TILE_SIZE * 2 ** viewport.zoom;
  return {
    xPercent: 50 + deltaX * worldSize / WIDTH * 100,
    yPercent: 50 + (projected.y - center.y) * worldSize / HEIGHT * 100,
  };
}
