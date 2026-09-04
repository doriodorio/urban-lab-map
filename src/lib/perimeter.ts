import type * as maplibregl from "maplibre-gl";

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

/**
 * Adds the perimeter's source and layers to a map, if they aren't there yet.
 *
 * Shared so the editor and the published view draw the same box the same way -
 * and so the eventual map of many projects, where a reader sees nothing but
 * perimeters and their names, inherits it rather than reinventing it.
 */
export function ensurePerimeterLayers(map: maplibregl.Map) {
  if (map.getSource("project-perimeter")) return;

  map.addSource("project-perimeter", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "project-perimeter-line",
    type: "line",
    source: "project-perimeter",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "line-color": "#23282d",
      "line-width": 1.5,
      // Dashed so it reads as an annotation over the map rather than as a
      // feature of it - nothing on the ground marks this boundary.
      "line-dasharray": [4, 3],
    },
  });

  map.addLayer({
    id: "project-perimeter-label",
    type: "symbol",
    source: "project-perimeter",
    filter: ["==", ["geometry-type"], "Point"],
    layout: {
      "text-field": ["get", "name"],
      // Bold, and the OpenFreeMap glyph server carries it across Latin and
      // Hebrew - which is what these project names are written in. A regular
      // weight at this size disappeared into the street names underneath.
      "text-font": ["Noto Sans Bold"],
      "text-size": 14,
      "text-letter-spacing": 0.1,
      "text-transform": "uppercase",
      "text-anchor": "bottom",
      // Clear of the dashed edge, so the rule does not run through the
      // letters.
      "text-offset": [0, -0.6],
      // The name belongs to the box even where boxes overlap, which is the
      // normal case on a map of several projects.
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#23282d",
      // A halo rather than a plate: the name has to stay legible over
      // satellite imagery as well as paper-coloured streets.
      "text-halo-color": "#f8f9fa",
      // Wide enough to punch the name out of whatever it lands on - street
      // labels, satellite imagery, a dense city centre.
      "text-halo-width": 2.2,
    },
  });
}

/**
 * The perimeter as map data: the box itself, plus a point at the top edge
 * carrying the project name.
 */
export function perimeterFeatures(ring: PerimeterRing | null, name: string) {
  if (!ring) return { type: "FeatureCollection" as const, features: [] };

  const [[west, , ], [east], [, north]] = [ring[0], ring[1], ring[2]];
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Polygon" as const, coordinates: [ring] },
      },
      {
        type: "Feature" as const,
        properties: { name },
        // Centred on the top edge, so the name labels the box without sitting
        // on top of the material inside it.
        geometry: {
          type: "Point" as const,
          coordinates: [(west + east) / 2, north],
        },
      },
    ],
  };
}
