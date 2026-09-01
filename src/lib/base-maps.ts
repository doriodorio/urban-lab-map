import type * as maplibregl from "maplibre-gl";

/**
 * Base maps come in two kinds.
 *
 * Raster styles are pre-rendered images: simple, but each has a zoom ceiling,
 * and past it the map is an upscaled picture - fine for context, mushy for
 * reading a street name.
 *
 * Vector styles ship geometry and labels that are drawn in the browser, so
 * text stays sharp at any zoom. They're a whole style document rather than a
 * tile URL, which is why switching to one costs a full setStyle. OpenFreeMap
 * serves them from OSM data with no key and no usage cap, which is what makes
 * it usable for a class of students.
 *
 * Shared by the editor and the public viewer, so a published map offers the
 * same base maps it was arranged on.
 */
export type MapStyle =
  | { id: string; label: string; kind: "raster"; tiles: string[]; maxzoom?: number }
  | { id: string; label: string; kind: "vector"; url: string };

export const MAP_STYLES: MapStyle[] = [
  {
    id: "streets",
    label: "Streets (sharp)",
    kind: "vector",
    url: "https://tiles.openfreemap.org/styles/liberty",
  },
  {
    id: "minimal",
    label: "Minimal (sharp)",
    kind: "vector",
    url: "https://tiles.openfreemap.org/styles/positron",
  },
  {
    id: "osm",
    label: "OSM raster",
    kind: "raster",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
  },
  {
    id: "dark",
    label: "Dark",
    kind: "raster",
    tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
  },
  {
    id: "satellite",
    label: "Satellite",
    kind: "raster",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    maxzoom: 19,
  },
  {
    id: "terrain",
    label: "Terrain",
    kind: "raster",
    tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
    maxzoom: 17,
  },
];

export const DEFAULT_STYLE_ID = "streets";

// Only covers the raster sources. Vector styles carry their own attribution
// in the style document, which MapLibre picks up automatically.
export const RASTER_ATTRIBUTION =
  "&copy; OpenStreetMap contributors, &copy; CARTO, &copy; OpenTopoMap (SRTM), Esri World Imagery";

export function findStyle(styleId: string): MapStyle {
  return MAP_STYLES.find((s) => s.id === styleId) ?? MAP_STYLES[0];
}

export function buildRasterStyle(
  style: MapStyle
): maplibregl.StyleSpecification {
  if (style.kind !== "raster") throw new Error("not a raster style");
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: style.tiles,
        tileSize: 256,
        maxzoom: style.maxzoom,
        attribution: RASTER_ATTRIBUTION,
      },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

/**
 * The style a map should start on.
 *
 * Vector styles are a URL MapLibre fetches; raster ones are built here.
 */
export function initialStyle(
  styleId: string
): string | maplibregl.StyleSpecification {
  const style = findStyle(styleId);
  return style.kind === "vector" ? style.url : buildRasterStyle(style);
}
