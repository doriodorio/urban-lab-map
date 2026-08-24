"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { gps as exifGps } from "exifr";

type Layer = { id: string; name: string; color: string | null };
type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Polygon"; coordinates: [number, number][][] };
type Item = {
  id: string;
  layer_id: string | null;
  type: string;
  title: string | null;
  body: string | null;
  attribution: string | null;
  tags: string[] | null;
  date_start: string | null;
  media: { url: string; type: string }[] | null;
  geometry: Geometry;
};
type Project = {
  id: string;
  name: string;
  base_map_image_url: string | null;
  base_map_bounds: [[number, number], [number, number]] | null;
};
type ItemLink = {
  id: string;
  item_a: string;
  item_b: string;
  note: string | null;
};

type ActionResult = { error?: string; success?: boolean };
type BoundAction = (
  prevState: ActionResult,
  formData: FormData
) => Promise<ActionResult>;

const MAP_STYLES: { id: string; label: string; tiles: string[]; maxzoom?: number }[] = [
  {
    id: "osm",
    label: "Streets",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
  },
  {
    id: "light",
    label: "Light (minimal)",
    tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],
  },
  {
    id: "dark",
    label: "Dark",
    tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
  },
  {
    id: "satellite",
    label: "Satellite",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    maxzoom: 19,
  },
  {
    id: "terrain",
    label: "Terrain",
    tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
    maxzoom: 17,
  },
];

// Combined upfront so it stays accurate regardless of which style is active -
// the base source's attribution string isn't dynamically updatable via
// setTiles(), only its tile URLs are.
const COMBINED_ATTRIBUTION =
  "&copy; OpenStreetMap contributors, &copy; CARTO, &copy; OpenTopoMap (SRTM), Esri World Imagery";

function buildBaseStyle(styleId: string): maplibregl.StyleSpecification {
  const style = MAP_STYLES.find((s) => s.id === styleId) ?? MAP_STYLES[0];
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: style.tiles,
        tileSize: 256,
        maxzoom: style.maxzoom,
        attribution: COMBINED_ATTRIBUTION,
      },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

const DEFAULT_CENTER: [number, number] = [34.78, 32.07]; // Tel Aviv-ish, reasonable default for Bezalel

// Idempotent: safe to call from multiple effects regardless of ordering, so
// nothing that needs these sources ever silently no-ops because it ran
// before whichever effect happened to create them first.
function ensureShapeLayers(map: maplibregl.Map) {
  if (!map.getSource("item-lines")) {
    map.addSource("item-lines", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "item-lines-layer",
      type: "line",
      source: "item-lines",
      paint: { "line-color": ["get", "color"], "line-width": 3 },
    });
  }

  if (!map.getSource("item-polygons")) {
    map.addSource("item-polygons", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "item-polygons-fill",
      type: "fill",
      source: "item-polygons",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.25 },
    });
    map.addLayer({
      id: "item-polygons-outline",
      type: "line",
      source: "item-polygons",
      paint: { "line-color": ["get", "color"], "line-width": 2 },
    });
  }

  if (!map.getSource("draw-preview")) {
    map.addSource("draw-preview", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "draw-preview-layer",
      type: "line",
      source: "draw-preview",
      paint: {
        "line-color": "#111",
        "line-width": 2,
        "line-dasharray": [2, 2],
      },
    });
  }
}
const UNASSIGNED_COLOR = "#737373";

const TYPE_OPTIONS: { value: string; label: string; bodyLabel: string }[] = [
  { value: "text", label: "Text / Note", bodyLabel: "Notes, reflection…" },
  { value: "quote", label: "Quote", bodyLabel: "The quoted text" },
  { value: "interview", label: "Interview", bodyLabel: "Transcript (full or excerpt)" },
  { value: "document", label: "Document / Citation", bodyLabel: "Description" },
  { value: "data", label: "Data", bodyLabel: "A stat, number, or short data note" },
  { value: "image", label: "Image", bodyLabel: "Caption" },
  { value: "composite", label: "Composite (mixed)", bodyLabel: "Notes" },
];

function bodyLabelFor(type: string) {
  return TYPE_OPTIONS.find((t) => t.value === type)?.bodyLabel ?? "Notes";
}

// Searches the text a researcher would actually recall: title, body, the
// attribution (interviewee, source, citation), and tags.
function matchesQuery(item: Item, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [
    item.title,
    item.body,
    item.attribution,
    ...(item.tags ?? []),
    TYPE_OPTIONS.find((t) => t.value === item.type)?.label,
  ].some((field) => field?.toLowerCase().includes(q));
}

function isVisible(
  item: Item,
  hiddenLayerIds: Set<string>,
  activeTags: Set<string>,
  dateFrom: string | null,
  dateTo: string | null,
  query: string
) {
  if (hiddenLayerIds.has(item.layer_id ?? "unassigned")) return false;
  if (activeTags.size > 0 && !(item.tags ?? []).some((t) => activeTags.has(t))) {
    return false;
  }
  if (item.date_start) {
    if (dateFrom && item.date_start < dateFrom) return false;
    if (dateTo && item.date_start > dateTo) return false;
  }
  if (!matchesQuery(item, query)) return false;
  return true;
}

// A link's other end, resolved against the live items. Soft-deleted items
// drop out here rather than rendering as a dead entry; restoring one brings
// its links back with it.
function linkedItemsFor(itemId: string, links: ItemLink[], items: Item[]) {
  return links
    .filter((l) => l.item_a === itemId || l.item_b === itemId)
    .map((l) => ({
      link: l,
      other: items.find(
        (i) => i.id === (l.item_a === itemId ? l.item_b : l.item_a)
      ),
    }))
    .filter((x): x is { link: ItemLink; other: Item } => Boolean(x.other));
}

function centroid(geometry: Geometry): [number, number] {
  if (geometry.type === "Point") return geometry.coordinates;
  const ring =
    geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.coordinates[0];
  const sum = ring.reduce<[number, number]>(
    (acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat],
    [0, 0]
  );
  return [sum[0] / ring.length, sum[1] / ring.length];
}

type DrawMode = "point" | "line" | "polygon" | null;

export function MapEditor({
  project,
  layers,
  items,
  deletedItems,
  links,
  createLayerAction,
  deleteLayerAction,
  createItemAction,
  deleteItemAction,
  restoreItemAction,
  updateItemLayerAction,
  updateItemTagsAction,
  createItemLinkAction,
  deleteItemLinkAction,
  setBaseMapAction,
  clearBaseMapAction,
}: {
  project: Project;
  layers: Layer[];
  items: Item[];
  deletedItems: (Item & { deleted_at: string | null })[];
  links: ItemLink[];
  createLayerAction: BoundAction;
  deleteLayerAction: (layerId: string) => Promise<ActionResult>;
  createItemAction: BoundAction;
  deleteItemAction: (itemId: string) => Promise<ActionResult>;
  restoreItemAction: (itemId: string) => Promise<ActionResult>;
  updateItemLayerAction: (
    itemId: string,
    layerId: string | null
  ) => Promise<ActionResult>;
  updateItemTagsAction: (
    itemId: string,
    tags: string[]
  ) => Promise<ActionResult>;
  createItemLinkAction: (
    itemId: string,
    otherItemId: string,
    note: string | null
  ) => Promise<ActionResult>;
  deleteItemLinkAction: (linkId: string) => Promise<ActionResult>;
  setBaseMapAction: BoundAction;
  clearBaseMapAction: () => Promise<ActionResult>;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  // Tracks which layers are *hidden* rather than which are shown, so a layer
  // created after mount is visible by default - seeding a "visible" set from
  // `layers` would only run once and leave every new layer switched off.
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(new Set());
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [pendingGeometry, setPendingGeometry] = useState<Geometry | null>(
    null
  );

  // Held as an id and resolved against the current `items` on every render.
  // Storing the object itself would freeze a snapshot: marker click listeners
  // are attached once per marker and would keep handing back the item as it
  // looked when the marker was created, so edits made through the detail
  // panel wouldn't show up on reopening it.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;
  const [panel, setPanel] = useState<
    "layers" | "filters" | "basemap" | "trash" | null
  >("layers");
  const [mapStyleId, setMapStyleId] = useState(MAP_STYLES[0].id);

  const layerColor = (layerId: string | null) =>
    layers.find((l) => l.id === layerId)?.color || UNASSIGNED_COLOR;

  // Initialize map once.
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    // Turbopack doesn't correctly bundle MapLibre's internal worker script,
    // which silently breaks all GeoJSON-backed rendering (lines/polygons) -
    // point markers still work since they're plain DOM elements that never
    // touch the worker. Point at MapLibre's prebuilt worker bundle served as
    // a static file instead (both maplibre-gl-worker.mjs and the
    // maplibre-gl-shared.mjs it imports live in public/, copied from
    // node_modules/maplibre-gl/dist/ - re-copy both after any maplibre-gl
    // version upgrade).
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: buildBaseStyle(mapStyleId),
      center: DEFAULT_CENTER,
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    const markers = markersRef.current;

    return () => {
      map.remove();
      mapRef.current = null;
      // map.remove() destroys the markers' DOM along with the map, but the
      // ref would still hold them. The marker effect treats a cache hit as
      // "already on the map" and skips addTo(), so leaving stale entries here
      // means every existing item silently fails to render on the next map -
      // in dev that's StrictMode's remount, in production it's navigating
      // away and back. Only items created after that point would appear.
      markers.clear();
    };
    // Only the style picked at mount matters here - later changes go
    // through the dedicated setTiles() effect below, not a re-init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the base layer's tile URLs when the user picks a different style.
  // Uses setTiles() rather than map.setStyle() so our own sources/layers
  // (items, draw preview, base-map overlay) never get torn down.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const style = MAP_STYLES.find((s) => s.id === mapStyleId) ?? MAP_STYLES[0];
    const apply = () => {
      const source = map.getSource("base") as maplibregl.RasterTileSource | undefined;
      source?.setTiles(style.tiles);
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [mapStyleId]);

  // Custom base-map image overlay.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyOverlay = () => {
      if (map.getLayer("base-map-overlay")) map.removeLayer("base-map-overlay");
      if (map.getSource("base-map-overlay")) map.removeSource("base-map-overlay");

      if (!project.base_map_image_url || !project.base_map_bounds) return;

      const [[north, west], [south, east]] = project.base_map_bounds;
      map.addSource("base-map-overlay", {
        type: "image",
        url: project.base_map_image_url,
        coordinates: [
          [west, north],
          [east, north],
          [east, south],
          [west, south],
        ],
      });
      // Insert *below* the item shape layers. addLayer() appends to the top of
      // the stack by default, so re-applying an overlay on an already-open map
      // would otherwise paint it over every line and polygon item.
      ensureShapeLayers(map);
      map.addLayer(
        {
          id: "base-map-overlay",
          type: "raster",
          source: "base-map-overlay",
          paint: { "raster-opacity": 0.85 },
        },
        "item-lines-layer"
      );
    };

    if (map.isStyleLoaded()) applyOverlay();
    else map.once("load", applyOverlay);
  }, [project.base_map_image_url, project.base_map_bounds]);

  // Set up shape sources/layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.isStyleLoaded()) ensureShapeLayers(map);
    else map.once("load", () => ensureShapeLayers(map));
  }, []);

  // Click-to-place / draw-vertex handling.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (drawMode === "point") {
        setPendingGeometry({
          type: "Point",
          coordinates: [e.lngLat.lng, e.lngLat.lat],
        });
        setDrawMode(null);
      } else if (drawMode === "line" || drawMode === "polygon") {
        setDrawPoints((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat]]);
      }
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [drawMode]);

  // Feature click handlers for line/polygon items (set up once shapes exist).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onFeatureClick = (
      e: maplibregl.MapLayerMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }
    ) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") setSelectedItemId(id);
    };

    const showPointer = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const clearPointer = () => {
      map.getCanvas().style.cursor = "";
    };

    const attach = () => {
      ensureShapeLayers(map);
      map.on("click", "item-lines-layer", onFeatureClick);
      map.on("click", "item-polygons-fill", onFeatureClick);
      map.on("mouseenter", "item-lines-layer", showPointer);
      map.on("mouseleave", "item-lines-layer", clearPointer);
      map.on("mouseenter", "item-polygons-fill", showPointer);
      map.on("mouseleave", "item-polygons-fill", clearPointer);
    };

    if (map.isStyleLoaded()) attach();
    else map.once("load", attach);

    return () => {
      map.off("click", "item-lines-layer", onFeatureClick);
      map.off("click", "item-polygons-fill", onFeatureClick);
      map.off("mouseenter", "item-lines-layer", showPointer);
      map.off("mouseleave", "item-lines-layer", clearPointer);
      map.off("mouseenter", "item-polygons-fill", showPointer);
      map.off("mouseleave", "item-polygons-fill", clearPointer);
    };
    // Runs once: the handlers only close over setState, never over `items`,
    // so there's nothing to re-bind when items change (and re-running would
    // re-register the hover handlers on every edit).
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      map.getCanvas().style.cursor = drawMode ? "crosshair" : "";
    }
  }, [drawMode]);

  // Draw-in-progress / pending-item preview. Stays visible continuously
  // from the first click through to the item actually being created -
  // otherwise the shape flashes away the instant "Finish" is clicked (drawing
  // state clears) and only reappears once the new item round-trips through
  // the database, which reads as a glitch.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let previewCoords: [number, number][] | null = null;
    if (pendingGeometry?.type === "LineString") {
      previewCoords = pendingGeometry.coordinates;
    } else if (pendingGeometry?.type === "Polygon") {
      previewCoords = pendingGeometry.coordinates[0];
    } else if (drawPoints.length > 1) {
      previewCoords = drawPoints;
    }

    const update = () => {
      ensureShapeLayers(map);
      const source = map.getSource("draw-preview") as maplibregl.GeoJSONSource;
      source.setData({
        type: "FeatureCollection",
        features: previewCoords
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: previewCoords },
              },
            ]
          : [],
      });
    };

    if (map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [drawPoints, pendingGeometry]);

  // Render point-item markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const pointItems = items.filter(
      (i): i is Item & { geometry: { type: "Point"; coordinates: [number, number] } } =>
        i.geometry.type === "Point"
    );
    const existingIds = new Set(pointItems.map((i) => i.id));
    for (const [id, marker] of markersRef.current) {
      if (!existingIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const item of pointItems) {
      const visible = isVisible(item, hiddenLayerIds, activeTags, dateFrom, dateTo, query);
      let marker = markersRef.current.get(item.id);

      if (!marker) {
        const el = document.createElement("button");
        el.type = "button";
        el.style.width = "16px";
        el.style.height = "16px";
        el.style.borderRadius = "50%";
        el.style.border = "2px solid white";
        el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.3)";
        el.style.cursor = "pointer";
        // Capturing the id (stable) rather than the item object (a per-render
        // snapshot) keeps this listener correct for the marker's whole life -
        // it's attached once, on creation, and never re-bound.
        const itemId = item.id;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          setSelectedItemId(itemId);
        });

        marker = new maplibregl.Marker({ element: el })
          .setLngLat(item.geometry.coordinates)
          .addTo(map);
        markersRef.current.set(item.id, marker);
      }

      const el = marker.getElement();
      el.style.background = layerColor(item.layer_id);
      el.style.display = visible ? "block" : "none";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hiddenLayerIds, activeTags, dateFrom, dateTo, query, layers]);

  // Render line/polygon items.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      ensureShapeLayers(map);
      const lineSource = map.getSource("item-lines") as maplibregl.GeoJSONSource;
      const polySource = map.getSource("item-polygons") as maplibregl.GeoJSONSource;

      const lineFeatures: GeoJSON.Feature[] = [];
      const polyFeatures: GeoJSON.Feature[] = [];

      for (const item of items) {
        const visible = isVisible(item, hiddenLayerIds, activeTags, dateFrom, dateTo, query);
        if (!visible) continue;

        const color = layerColor(item.layer_id);
        if (item.geometry.type === "LineString") {
          lineFeatures.push({
            type: "Feature",
            properties: { id: item.id, color },
            geometry: item.geometry,
          });
        } else if (item.geometry.type === "Polygon") {
          polyFeatures.push({
            type: "Feature",
            properties: { id: item.id, color },
            geometry: item.geometry,
          });
        }
      }

      lineSource.setData({ type: "FeatureCollection", features: lineFeatures });
      polySource.setData({ type: "FeatureCollection", features: polyFeatures });
    };

    if (map.isStyleLoaded()) update();
    else map.once("load", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hiddenLayerIds, activeTags, dateFrom, dateTo, query, layers]);

  // Marker for a pending new Point item.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pendingGeometry || pendingGeometry.type !== "Point") return;

    const el = document.createElement("div");
    el.style.width = "16px";
    el.style.height = "16px";
    el.style.borderRadius = "50%";
    el.style.border = "2px dashed #111";
    el.style.background = "rgba(0,0,0,0.1)";

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(pendingGeometry.coordinates)
      .addTo(map);

    return () => {
      marker.remove();
    };
  }, [pendingGeometry]);

  function toggleLayer(id: string) {
    setHiddenLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleItems = items.filter((i) =>
    isVisible(i, hiddenLayerIds, activeTags, dateFrom, dateTo, query)
  );

  // Select an item and bring it into view - used by search results and by
  // following a link, where the target is often off-screen.
  function focusItem(item: Item) {
    setSelectedItemId(item.id);
    mapRef.current?.easeTo({ center: centroid(item.geometry), duration: 600 });
  }

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function toggleDrawMode(mode: DrawMode) {
    if (drawMode === mode) {
      setDrawMode(null);
      setDrawPoints([]);
    } else {
      setDrawMode(mode);
      setDrawPoints([]);
    }
  }

  function finishDrawing() {
    if (drawMode === "line" && drawPoints.length >= 2) {
      setPendingGeometry({ type: "LineString", coordinates: drawPoints });
    } else if (drawMode === "polygon" && drawPoints.length >= 3) {
      setPendingGeometry({
        type: "Polygon",
        coordinates: [[...drawPoints, drawPoints[0]]],
      });
    }
    setDrawMode(null);
    setDrawPoints([]);
  }

  const minPointsMet =
    (drawMode === "line" && drawPoints.length >= 2) ||
    (drawMode === "polygon" && drawPoints.length >= 3);

  return (
    <div className="flex h-screen w-full">
      <div className="relative flex-1">
        <div ref={mapContainer} className="h-full w-full" />

        <div className="absolute left-3 top-3 flex items-center gap-2 rounded bg-white/95 px-3 py-2 shadow">
          <Link href="/projects" className="text-sm text-neutral-500 underline">
            ← Workspace
          </Link>
          <span className="text-sm font-medium">{project.name}</span>
          <Link
            href={`/projects/${project.id}/settings`}
            className="text-sm text-neutral-500 underline"
          >
            Settings
          </Link>
          <select
            value={mapStyleId}
            onChange={(e) => setMapStyleId(e.target.value)}
            className="rounded border border-neutral-300 px-1.5 py-1 text-sm"
          >
            {MAP_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="absolute bottom-3 left-3 flex flex-col gap-2">
          {(drawMode === "line" || drawMode === "polygon") &&
            drawPoints.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={finishDrawing}
                  disabled={!minPointsMet}
                  className="rounded bg-black px-3 py-2 text-sm font-medium text-white shadow disabled:opacity-50"
                >
                  Finish ({drawPoints.length} points)
                </button>
                <button
                  onClick={() => toggleDrawMode(drawMode)}
                  className="rounded bg-white px-3 py-2 text-sm font-medium text-black shadow"
                >
                  Cancel
                </button>
              </div>
            )}
          <div className="flex gap-2">
            <button
              onClick={() => toggleDrawMode("point")}
              className={`rounded px-3 py-2 text-sm font-medium shadow ${
                drawMode === "point" ? "bg-black text-white" : "bg-white text-black"
              }`}
            >
              {drawMode === "point" ? "Click the map…" : "+ Point"}
            </button>
            <button
              onClick={() => toggleDrawMode("line")}
              className={`rounded px-3 py-2 text-sm font-medium shadow ${
                drawMode === "line" ? "bg-black text-white" : "bg-white text-black"
              }`}
            >
              + Line
            </button>
            <button
              onClick={() => toggleDrawMode("polygon")}
              className={`rounded px-3 py-2 text-sm font-medium shadow ${
                drawMode === "polygon" ? "bg-black text-white" : "bg-white text-black"
              }`}
            >
              + Polygon
            </button>
          </div>
        </div>
      </div>

      <aside className="flex w-80 flex-col overflow-y-auto border-l border-neutral-200 bg-white">
        {/* Search sits above the tabs rather than inside Filters: it's reached
            constantly, and shouldn't cost a tab switch to get to. */}
        <SearchBox
          query={query}
          onQueryChange={setQuery}
          results={visibleItems}
          totalCount={items.length}
          onSelectResult={focusItem}
        />

        <div className="flex border-b border-neutral-200 text-sm">
          <button
            onClick={() => setPanel("layers")}
            className={`flex-1 py-2 ${panel === "layers" ? "font-semibold" : "text-neutral-400"}`}
          >
            Layers
          </button>
          <button
            onClick={() => setPanel("filters")}
            className={`flex-1 py-2 ${panel === "filters" ? "font-semibold" : "text-neutral-400"}`}
          >
            Filters
          </button>
          <button
            onClick={() => setPanel("basemap")}
            className={`flex-1 py-2 ${panel === "basemap" ? "font-semibold" : "text-neutral-400"}`}
          >
            Base map
          </button>
          <button
            onClick={() => setPanel("trash")}
            className={`flex-1 py-2 ${panel === "trash" ? "font-semibold" : "text-neutral-400"}`}
          >
            Trash
            {deletedItems.length > 0 && ` (${deletedItems.length})`}
          </button>
        </div>

        {panel === "layers" && (
          <LayerPanel
            layers={layers}
            hiddenLayerIds={hiddenLayerIds}
            onToggle={toggleLayer}
            createLayerAction={createLayerAction}
            deleteLayerAction={deleteLayerAction}
          />
        )}

        {panel === "filters" && (
          <FiltersPanel
            items={items}
            activeTags={activeTags}
            onToggleTag={toggleTag}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
          />
        )}

        {panel === "basemap" && (
          <BaseMapPanel
            project={project}
            setBaseMapAction={setBaseMapAction}
            clearBaseMapAction={clearBaseMapAction}
          />
        )}

        {panel === "trash" && (
          <TrashPanel
            deletedItems={deletedItems}
            restoreItemAction={restoreItemAction}
          />
        )}

        {pendingGeometry && (
          <NewItemForm
            geometry={pendingGeometry}
            onGeometryChange={setPendingGeometry}
            layers={layers}
            createItemAction={createItemAction}
            onDone={() => setPendingGeometry(null)}
            onCancel={() => setPendingGeometry(null)}
          />
        )}

        {selectedItem && (
          <ItemDetail
            // Remount per item: the panel seeds its layer/tag inputs from
            // props in useState initializers, which would otherwise carry the
            // previous item's values over when switching between markers.
            key={selectedItem.id}
            item={selectedItem}
            layers={layers}
            allItems={items}
            linked={linkedItemsFor(selectedItem.id, links, items)}
            deleteItemAction={deleteItemAction}
            updateItemLayerAction={updateItemLayerAction}
            updateItemTagsAction={updateItemTagsAction}
            createItemLinkAction={createItemLinkAction}
            deleteItemLinkAction={deleteItemLinkAction}
            onFollowLink={focusItem}
            onClose={() => setSelectedItemId(null)}
          />
        )}
      </aside>
    </div>
  );
}

function LayerPanel({
  layers,
  hiddenLayerIds,
  onToggle,
  createLayerAction,
  deleteLayerAction,
}: {
  layers: Layer[];
  hiddenLayerIds: Set<string>;
  onToggle: (id: string) => void;
  createLayerAction: BoundAction;
  deleteLayerAction: (layerId: string) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(createLayerAction, {});

  return (
    <div className="flex flex-col gap-3 p-4">
      <ul className="flex flex-col gap-2">
        {layers.map((layer) => (
          <li key={layer.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!hiddenLayerIds.has(layer.id)}
              onChange={() => onToggle(layer.id)}
            />
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: layer.color ?? UNASSIGNED_COLOR }}
            />
            <span className="flex-1">{layer.name}</span>
            <form
              action={async () => {
                await deleteLayerAction(layer.id);
              }}
              onSubmit={(e) => {
                if (
                  !confirm(
                    `Delete the layer "${layer.name}"? Its items are kept, but they'll no longer belong to any layer. This can't be undone.`
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              <button
                type="submit"
                className="text-xs text-neutral-400 underline hover:text-red-600"
              >
                Delete
              </button>
            </form>
          </li>
        ))}
        {layers.length === 0 && (
          <li className="text-sm text-neutral-400">No layers yet.</li>
        )}
      </ul>

      <form action={formAction} className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          New layer
        </p>
        <div className="flex gap-2">
          <input
            type="color"
            name="color"
            defaultValue="#3b82f6"
            className="h-9 w-9 rounded border border-neutral-300"
          />
          <input
            type="text"
            name="name"
            required
            placeholder="e.g. Interviews"
            className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add layer"}
        </button>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      </form>
    </div>
  );
}

function SearchBox({
  query,
  onQueryChange,
  results,
  totalCount,
  onSelectResult,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  results: Item[];
  totalCount: number;
  onSelectResult: (item: Item) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-neutral-200 p-3">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search title, text, source, tag…"
          className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
      </div>

      {/* Only takes up space once there's something to show - an always-open
          result list would push the panels below it off-screen. */}
      {query && (
        <>
          <p className="text-xs text-neutral-400">
            {results.length} of {totalCount} shown on the map
          </p>
          <ul className="flex max-h-64 flex-col overflow-y-auto">
            {results.slice(0, 50).map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => onSelectResult(item)}
                  className="w-full truncate py-1 text-left text-sm text-blue-600 underline"
                >
                  {item.title || "Untitled"}
                </button>
              </li>
            ))}
          </ul>
          {results.length === 0 && (
            <p className="text-sm text-neutral-400">No matches.</p>
          )}
          {results.length > 50 && (
            <p className="text-xs text-neutral-400">
              Showing the first 50 — narrow the search to see more.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function TrashPanel({
  deletedItems,
  restoreItemAction,
}: {
  deletedItems: (Item & { deleted_at: string | null })[];
  restoreItemAction: (itemId: string) => Promise<ActionResult>;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs text-neutral-500">
        Deleted items are kept here rather than destroyed, so a mistaken
        delete can be undone by anyone in the project.
      </p>

      {deletedItems.length === 0 && (
        <p className="text-sm text-neutral-400">Nothing deleted.</p>
      )}

      <ul className="flex flex-col gap-3">
        {deletedItems.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-1 border-b border-neutral-100 pb-3"
          >
            <span className="text-sm font-medium">
              {item.title || "Untitled"}
            </span>
            <span className="text-xs text-neutral-400">
              {TYPE_OPTIONS.find((t) => t.value === item.type)?.label ??
                item.type}
              {item.deleted_at &&
                ` · deleted ${new Date(item.deleted_at).toLocaleDateString()}`}
            </span>
            <form
              action={async () => {
                await restoreItemAction(item.id);
              }}
            >
              <button
                type="submit"
                className="text-xs text-blue-600 underline"
              >
                Restore
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FiltersPanel({
  items,
  activeTags,
  onToggleTag,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: {
  items: Item[];
  activeTags: Set<string>;
  onToggleTag: (tag: string) => void;
  dateFrom: string | null;
  dateTo: string | null;
  onDateFromChange: (v: string | null) => void;
  onDateToChange: (v: string | null) => void;
}) {
  const allTags = Array.from(
    new Set(items.flatMap((i) => i.tags ?? []))
  ).sort();

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Tags
        </p>
        {allTags.length === 0 && (
          <p className="text-sm text-neutral-400">No tags yet.</p>
        )}
        <ul className="flex flex-col gap-1">
          {allTags.map((tag) => (
            <li key={tag} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={activeTags.has(tag)}
                onChange={() => onToggleTag(tag)}
              />
              <span>{tag}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Timeline
        </p>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          From
          <input
            type="date"
            value={dateFrom ?? ""}
            onChange={(e) => onDateFromChange(e.target.value || null)}
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          To
          <input
            type="date"
            value={dateTo ?? ""}
            onChange={(e) => onDateToChange(e.target.value || null)}
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => {
              onDateFromChange(null);
              onDateToChange(null);
            }}
            className="self-start text-xs text-neutral-400 underline"
          >
            Clear
          </button>
        )}
        <p className="text-xs text-neutral-400">
          Items without a date are always shown.
        </p>
      </div>
    </div>
  );
}

function geometryLabel(geometry: Geometry) {
  if (geometry.type === "Point") {
    return `${geometry.coordinates[1].toFixed(5)}, ${geometry.coordinates[0].toFixed(5)}`;
  }
  if (geometry.type === "LineString") {
    return `Line — ${geometry.coordinates.length} points`;
  }
  return `Polygon — ${geometry.coordinates[0].length - 1} points`;
}

function NewItemForm({
  geometry,
  onGeometryChange,
  layers,
  createItemAction,
  onDone,
  onCancel,
}: {
  geometry: Geometry;
  onGeometryChange: (geometry: Geometry) => void;
  layers: Layer[];
  createItemAction: BoundAction;
  onDone: () => void;
  onCancel: () => void;
}) {
  const wrappedAction: BoundAction = async (prevState, formData) => {
    const result = await createItemAction(prevState, formData);
    if (result.success) onDone();
    return result;
  };
  const [state, formAction, pending] = useActionState(wrappedAction, {});
  const [type, setType] = useState("text");
  const [photoCoords, setPhotoCoords] = useState<[number, number] | null>(
    null
  );
  const [checkingExif, setCheckingExif] = useState(false);
  const [exifChecked, setExifChecked] = useState(false);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPhotoCoords(null);
    setExifChecked(false);
    if (!file) return;

    setCheckingExif(true);
    try {
      const gps = await exifGps(file);
      if (gps) setPhotoCoords([gps.longitude, gps.latitude]);
    } catch {
      // No GPS data, or not a format exifr can read.
    } finally {
      setCheckingExif(false);
      setExifChecked(true);
    }
  }

  const photoCoordsDiffer =
    geometry.type === "Point" &&
    photoCoords &&
    (photoCoords[0] !== geometry.coordinates[0] ||
      photoCoords[1] !== geometry.coordinates[1]);

  const showImage = type === "image" || type === "composite";
  const showMedia = type === "interview" || type === "document" || type === "composite";
  const showAttribution = type !== "text" && type !== "data";

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 border-t border-neutral-200 p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        New item — {geometryLabel(geometry)}
      </p>
      <input type="hidden" name="geometry" value={JSON.stringify(geometry)} />
      <input type="hidden" name="type" value={type} />

      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
      >
        {TYPE_OPTIONS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <input
        type="text"
        name="title"
        required
        placeholder="Title"
        className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <textarea
        name="body"
        rows={3}
        placeholder={bodyLabelFor(type)}
        className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />
      {showAttribution && (
        <input
          type="text"
          name="attribution"
          placeholder="Attribution (interviewee, source, citation…)"
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
      )}
      <input
        type="text"
        name="tags"
        placeholder="Tags, comma separated"
        className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Date
        <input
          type="date"
          name="date_start"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        />
      </label>
      <select
        name="layer_id"
        className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        defaultValue=""
      >
        <option value="">No layer</option>
        {layers.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      {showImage && (
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Image
          <input
            type="file"
            name="image"
            accept="image/*"
            className="text-sm"
            onChange={handleImageChange}
          />
        </label>
      )}
      {showMedia && (
        <>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Audio / video / document file
            <input
              type="file"
              name="media_file"
              accept="audio/*,video/*,application/pdf"
              className="text-sm"
            />
          </label>
          <input
            type="text"
            name="media_url"
            placeholder="or paste a link (YouTube, Vimeo, SoundCloud…)"
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </>
      )}

      {checkingExif && (
        <p className="text-xs text-neutral-400">Checking photo for GPS data…</p>
      )}
      {exifChecked && !checkingExif && !photoCoords && showImage && (
        <p className="text-xs text-neutral-400">
          No location data found in this photo.
        </p>
      )}
      {photoCoordsDiffer && (
        <div className="flex items-center justify-between rounded bg-blue-50 px-2 py-1.5 text-xs text-blue-800">
          <span>
            📍 Photo taken at {photoCoords[1].toFixed(5)},{" "}
            {photoCoords[0].toFixed(5)}
          </span>
          <button
            type="button"
            onClick={() =>
              onGeometryChange({ type: "Point", coordinates: photoCoords })
            }
            className="font-medium underline"
          >
            Use this location
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add item"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-sm text-neutral-500"
        >
          Cancel
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function ItemDetail({
  item,
  layers,
  allItems,
  linked,
  deleteItemAction,
  updateItemLayerAction,
  updateItemTagsAction,
  createItemLinkAction,
  deleteItemLinkAction,
  onFollowLink,
  onClose,
}: {
  item: Item;
  layers: Layer[];
  allItems: Item[];
  linked: { link: ItemLink; other: Item }[];
  deleteItemAction: (itemId: string) => Promise<ActionResult>;
  updateItemLayerAction: (
    itemId: string,
    layerId: string | null
  ) => Promise<ActionResult>;
  updateItemTagsAction: (
    itemId: string,
    tags: string[]
  ) => Promise<ActionResult>;
  createItemLinkAction: (
    itemId: string,
    otherItemId: string,
    note: string | null
  ) => Promise<ActionResult>;
  deleteItemLinkAction: (linkId: string) => Promise<ActionResult>;
  onFollowLink: (item: Item) => void;
  onClose: () => void;
}) {
  const [layerId, setLayerId] = useState(item.layer_id ?? "");
  const [savingLayer, setSavingLayer] = useState(false);
  const [tagsInput, setTagsInput] = useState((item.tags ?? []).join(", "));
  const [linkTarget, setLinkTarget] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const alreadyLinked = new Set(linked.map((l) => l.other.id));
  const linkCandidates = allItems.filter(
    (i) => i.id !== item.id && !alreadyLinked.has(i.id)
  );

  async function handleCreateLink() {
    setLinking(true);
    setLinkError(null);
    const result = await createItemLinkAction(
      item.id,
      linkTarget,
      linkNote || null
    );
    setLinking(false);
    if (result.error) {
      setLinkError(result.error);
    } else {
      setLinkTarget("");
      setLinkNote("");
    }
  }

  async function handleLayerChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setLayerId(value);
    setSavingLayer(true);
    await updateItemLayerAction(item.id, value || null);
    setSavingLayer(false);
  }

  async function handleTagsBlur() {
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await updateItemTagsAction(item.id, tags);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-neutral-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <select
          value={layerId}
          onChange={handleLayerChange}
          disabled={savingLayer}
          className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs uppercase tracking-wide text-neutral-500"
        >
          <option value="">No layer</option>
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button onClick={onClose} className="text-sm text-neutral-400">
          ✕
        </button>
      </div>

      <span className="w-fit rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
        {TYPE_OPTIONS.find((t) => t.value === item.type)?.label ?? item.type}
      </span>

      <h3 className="text-base font-medium">{item.title}</h3>

      {item.attribution && (
        <p className="text-sm italic text-neutral-500">— {item.attribution}</p>
      )}

      {item.media?.map((m, i) => {
        if (m.type === "image") {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={m.url} alt={item.title ?? ""} className="rounded" />
          );
        }
        if (m.type === "audio") {
          return <audio key={i} controls src={m.url} className="w-full" />;
        }
        if (m.type === "video") {
          return (
            <video key={i} controls src={m.url} className="w-full rounded" />
          );
        }
        return (
          <a
            key={i}
            href={m.url}
            target="_blank"
            rel="noreferrer"
            className="break-all text-sm text-blue-600 underline"
          >
            {m.url}
          </a>
        );
      })}

      {item.body && (
        <p className="whitespace-pre-wrap text-sm text-neutral-700">
          {item.body}
        </p>
      )}

      {item.date_start && (
        <p className="text-xs text-neutral-400">{item.date_start}</p>
      )}

      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Tags
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          onBlur={handleTagsBlur}
          placeholder="comma, separated, tags"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        />
      </label>

      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Linked items
        </p>

        {linked.length === 0 && (
          <p className="text-sm text-neutral-400">
            Not linked to anything yet.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {linked.map(({ link, other }) => (
            <li key={link.id} className="flex flex-col gap-0.5">
              <div className="flex items-start justify-between gap-2">
                <button
                  onClick={() => onFollowLink(other)}
                  className="flex-1 text-left text-sm text-blue-600 underline"
                >
                  {other.title || "Untitled"}
                </button>
                <form
                  action={async () => {
                    await deleteItemLinkAction(link.id);
                  }}
                >
                  <button
                    type="submit"
                    className="text-xs text-neutral-400 underline hover:text-red-600"
                  >
                    Unlink
                  </button>
                </form>
              </div>
              {link.note && (
                <span className="text-xs text-neutral-500">{link.note}</span>
              )}
            </li>
          ))}
        </ul>

        {linkCandidates.length > 0 && (
          <div className="flex flex-col gap-2 pt-1">
            <select
              value={linkTarget}
              onChange={(e) => setLinkTarget(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">Link to…</option>
              {linkCandidates.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title || "Untitled"}
                </option>
              ))}
            </select>
            {linkTarget && (
              <>
                <input
                  type="text"
                  value={linkNote}
                  onChange={(e) => setLinkNote(e.target.value)}
                  placeholder="How are they related? (optional)"
                  className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                />
                <button
                  onClick={handleCreateLink}
                  disabled={linking}
                  className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {linking ? "Linking…" : "Add link"}
                </button>
              </>
            )}
            {linkError && (
              <p className="text-sm text-red-600">{linkError}</p>
            )}
          </div>
        )}
      </div>

      <form
        action={async () => {
          await deleteItemAction(item.id);
          onClose();
        }}
        onSubmit={(e) => {
          if (
            !confirm(
              `Delete "${item.title || "this item"}"? You can restore it from the Trash panel.`
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <button type="submit" className="text-sm text-red-600 underline">
          Delete item
        </button>
      </form>
    </div>
  );
}

function BaseMapPanel({
  project,
  setBaseMapAction,
  clearBaseMapAction,
}: {
  project: Project;
  setBaseMapAction: BoundAction;
  clearBaseMapAction: () => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(setBaseMapAction, {});

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs text-neutral-500">
        Overlay a custom (e.g. historical) map image, positioned by its
        corner coordinates. It renders on top of the standard base map.
      </p>

      {project.base_map_image_url && (
        <form
          action={async () => {
            await clearBaseMapAction();
          }}
        >
          <button
            type="submit"
            className="text-sm text-red-600 underline"
          >
            Remove current overlay
          </button>
        </form>
      )}

      <form action={formAction} className="flex flex-col gap-2">
        <input type="file" name="image" accept="image/*" required className="text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            North (lat)
            <input
              name="north"
              type="number"
              step="any"
              required
              className="rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            South (lat)
            <input
              name="south"
              type="number"
              step="any"
              required
              className="rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            West (lng)
            <input
              name="west"
              type="number"
              step="any"
              required
              className="rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            East (lng)
            <input
              name="east"
              type="number"
              step="any"
              required
              className="rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Uploading…" : "Set base map"}
        </button>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      </form>
    </div>
  );
}
