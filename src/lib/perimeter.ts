/**
 * The project perimeter: a rectangle enclosing everything the project has
 * placed, with a margin.
 *
 * It is derived, not drawn. A group's study area is "wherever our material
 * turned out to be", and deriving it means the perimeter cannot fall out of
 * date - place a point outside it and the rectangle grows to include it. The
 * cost of that choice is that it cannot be a *claim* the group makes ahead of
 * the fieldwork; if that is wanted, it becomes a stored shape instead.
 */

export type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Polygon"; coordinates: [number, number][][] };

/** Ring of a closed rectangle, in GeoJSON order (first point repeated last). */
export type PerimeterRing = [number, number][];

/**
 * Margin around the content, as a share of the content's own size. Ten per
 * cent reads as "a bit larger" at any scale, where a fixed distance in metres
 * would swallow a single street and disappear around a whole city.
 */
const PADDING_RATIO = 0.1;

/**
 * Smallest half-width and half-height, in degrees, for the padded box.
 *
 * A project with one item - or several at one address - has a content box of
 * zero size, and a proportional margin around nothing is still nothing. This
 * is roughly 55m at the equator and less east-west as latitude rises, which
 * is a legible rectangle rather than a dot.
 */
const MIN_HALF_SPAN = 0.0005;

function positions(geometry: Geometry): [number, number][] {
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "LineString":
      return geometry.coordinates;
    case "Polygon":
      return geometry.coordinates.flat();
  }
}

/**
 * Returns the padded rectangle around every geometry given, or null when there
 * is nothing to enclose.
 *
 * Coordinates are treated as a flat plane. Over a project that fits on foot -
 * which is what this course does - the error against a true geodesic box is
 * far below the width of the line that draws it.
 */
export function projectPerimeter(
  geometries: Geometry[]
): PerimeterRing | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let found = false;

  for (const geometry of geometries) {
    for (const [lng, lat] of positions(geometry)) {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      found = true;
    }
  }

  if (!found) return null;

  const padX = Math.max((east - west) * PADDING_RATIO, MIN_HALF_SPAN);
  const padY = Math.max((north - south) * PADDING_RATIO, MIN_HALF_SPAN);

  const w = west - padX;
  const e = east + padX;
  // Clamped: a project near a pole would otherwise pad past the end of the
  // world, and MapLibre draws nothing at all for a latitude beyond 90.
  const s = Math.max(south - padY, -90);
  const n = Math.min(north + padY, 90);

  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}
