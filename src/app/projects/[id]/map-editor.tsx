"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { preparePhoto } from "./photo-import";

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
  created_by: string | null;
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
  memberNames,
  currentUserId,
  createLayerAction,
  deleteLayerAction,
  createItemAction,
  deleteItemAction,
  restoreItemAction,
  purgeItemAction,
  updateItemLayerAction,
  updateItemTagsAction,
  updateItemGeometryAction,
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
  memberNames: Record<string, string>;
  currentUserId: string;
  createLayerAction: BoundAction;
  deleteLayerAction: (layerId: string) => Promise<ActionResult>;
  createItemAction: BoundAction;
  deleteItemAction: (itemId: string) => Promise<ActionResult>;
  restoreItemAction: (itemId: string) => Promise<ActionResult>;
  purgeItemAction: (itemId: string) => Promise<ActionResult>;
  updateItemLayerAction: (
    itemId: string,
    layerId: string | null
  ) => Promise<ActionResult>;
  updateItemTagsAction: (
    itemId: string,
    tags: string[]
  ) => Promise<ActionResult>;
  updateItemGeometryAction: (
    itemId: string,
    lng: number,
    lat: number
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
  // Set while a drag is in flight so the render effect doesn't yank the
  // marker back to its stored position mid-gesture.
  const draggingRef = useRef(false);
  // The dragend handler is attached once per marker and would otherwise close
  // over the items from that render, so "where did this come from" could be
  // read off a stale snapshot and Undo would restore the wrong position.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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
    "layers" | "filters" | "import" | "basemap" | "trash" | null
  >("layers");
  const [mapStyleId, setMapStyleId] = useState(MAP_STYLES[0].id);

  // Remembers where a dragged item came from so the move can be undone.
  // There's no undo anywhere else in the app, and an accidental drag would
  // otherwise be unrecoverable - nobody records the original coordinates.
  const [lastMove, setLastMove] = useState<{
    itemId: string;
    from: [number, number];
  } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  async function handleMarkerDrop(itemId: string, lng: number, lat: number) {
    const before = itemsRef.current.find((i) => i.id === itemId);
    const from =
      before?.geometry.type === "Point"
        ? (before.geometry.coordinates as [number, number])
        : null;

    draggingRef.current = false;
    setMoveError(null);

    const result = await updateItemGeometryAction(itemId, lng, lat);
    if (result.error) {
      setMoveError(result.error);
      // Put it back: the save failed, so the stored position is unchanged.
      const marker = markersRef.current.get(itemId);
      if (marker && from) marker.setLngLat(from);
      return;
    }
    if (from) setLastMove({ itemId, from });
  }

  async function undoMove() {
    if (!lastMove) return;
    const { itemId, from } = lastMove;
    setLastMove(null);
    const result = await updateItemGeometryAction(itemId, from[0], from[1]);
    if (result.error) {
      setMoveError(result.error);
      return;
    }
    markersRef.current.get(itemId)?.setLngLat(from);
  }

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

  // Swap the base layer when the user picks a different style.
  //
  // The source is rebuilt rather than updated through setTiles(), because
  // setTiles only replaces the tile URLs - `maxzoom` keeps whatever the style
  // at mount declared. Since the page mounts on Streets (no ceiling, so 22),
  // switching to Terrain left the source asking opentopomap for z18-22 tiles
  // it doesn't serve: every one comes back empty and the map turns to blur
  // instead of overzooming the z17 tiles it has. Recreating the source is the
  // only way to change maxzoom through the public API.
  //
  // Only the base is touched - the item, draw-preview and overlay layers stay
  // put - and it's re-inserted underneath everything so it can't cover them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const style = MAP_STYLES.find((s) => s.id === mapStyleId) ?? MAP_STYLES[0];

    const apply = () => {
      const current = map.getSource("base") as
        | maplibregl.RasterTileSource
        | undefined;
      // Nothing to do on the first run: the mount style is already in place.
      if (current && current.tiles?.[0] === style.tiles[0]) return;

      if (map.getLayer("base")) map.removeLayer("base");
      if (map.getSource("base")) map.removeSource("base");

      map.addSource("base", {
        type: "raster",
        tiles: style.tiles,
        tileSize: 256,
        maxzoom: style.maxzoom,
        attribution: COMBINED_ATTRIBUTION,
      });

      const firstOtherLayer = map.getStyle().layers.find((l) => l.id !== "base");
      map.addLayer(
        { id: "base", type: "raster", source: "base" },
        firstOtherLayer?.id
      );
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

        marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat(item.geometry.coordinates)
          .addTo(map);

        marker.on("dragstart", () => {
          draggingRef.current = true;
        });
        marker.on("dragend", () => {
          const { lng, lat } = marker!.getLngLat();
          void handleMarkerDrop(itemId, lng, lat);
        });

        markersRef.current.set(item.id, marker);
      }

      const el = marker.getElement();
      el.style.background = layerColor(item.layer_id);
      el.style.display = visible ? "block" : "none";

      // Only the selected item can be dragged. Leaving every marker draggable
      // makes it far too easy to nudge someone else's item while panning, and
      // a moved item has no trace of where it used to be.
      const selected = item.id === selectedItemId;
      marker.setDraggable(selected);
      el.style.cursor = selected ? "move" : "pointer";
      el.style.outline = selected ? "2px solid #111" : "";
      el.style.outlineOffset = selected ? "2px" : "";

      // Keep the marker in step with the stored position: after a drag the
      // server round-trip returns fresh coordinates, and on a failed save
      // this snaps it back to where it actually still is.
      if (!marker.isDraggable() || !draggingRef.current) {
        const [lng, lat] = item.geometry.coordinates;
        const at = marker.getLngLat();
        if (at.lng !== lng || at.lat !== lat) marker.setLngLat([lng, lat]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hiddenLayerIds, activeTags, dateFrom, dateTo, query, layers, selectedItemId]);

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

        <div className="material material-edge absolute left-3 top-3 flex items-center gap-3 rounded-2xl px-3.5 py-2 backdrop-blur-xl backdrop-saturate-150">
          <Link
            href="/projects"
            className="press rounded-lg px-1 text-[13px] text-neutral-500 hover:text-neutral-900"
          >
            ← Workspace
          </Link>

          <span className="text-[15px] font-semibold leading-tight tracking-[-0.01em]">
            {project.name}
          </span>

          {/* A hairline groups the project's own destinations away from the
              way back out, so the bar reads as two things rather than five. */}
          <span aria-hidden className="h-4 w-px bg-neutral-900/15" />

          <Link
            href={`/projects/${project.id}/threads`}
            className="press rounded-lg px-1 text-[13px] text-neutral-500 hover:text-neutral-900"
          >
            Threads
          </Link>
          <Link
            href={`/projects/${project.id}/settings`}
            className="press rounded-lg px-1 text-[13px] text-neutral-500 hover:text-neutral-900"
          >
            Settings
          </Link>

          <select
            value={mapStyleId}
            onChange={(e) => setMapStyleId(e.target.value)}
            aria-label="Base map style"
            className="rounded-lg border border-neutral-300/70 bg-white/60 px-2 py-1 text-[13px] outline-none focus:border-neutral-400"
          >
            {MAP_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="absolute bottom-3 left-3 flex flex-col items-start gap-2">
          {/* Finish/Cancel appear above the tools, anchored to them, so the
              choice shows up next to the thing that raised it. */}
          {(drawMode === "line" || drawMode === "polygon") &&
            drawPoints.length > 0 && (
              <div className="material material-edge step-forward flex items-center gap-2 rounded-2xl p-1.5 backdrop-blur-xl backdrop-saturate-150">
                <button
                  onClick={finishDrawing}
                  disabled={!minPointsMet}
                  className="press rounded-xl bg-neutral-900 px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-35"
                >
                  Finish
                  <span className="ml-1.5 tabular-nums opacity-60">
                    {drawPoints.length}
                  </span>
                </button>
                <button
                  onClick={() => toggleDrawMode(drawMode)}
                  className="press rounded-xl px-3 py-1.5 text-[13px] text-neutral-600 hover:text-neutral-900"
                >
                  Cancel
                </button>
              </div>
            )}

          {/* One segmented control rather than three separate pills: they're
              mutually exclusive states of the same choice. */}
          <div className="material material-edge flex items-center gap-1 rounded-2xl p-1.5 backdrop-blur-xl backdrop-saturate-150">
            <DrawTool
              label="Point"
              active={drawMode === "point"}
              onClick={() => toggleDrawMode("point")}
            />
            <DrawTool
              label="Line"
              active={drawMode === "line"}
              onClick={() => toggleDrawMode("line")}
            />
            <DrawTool
              label="Region"
              active={drawMode === "polygon"}
              onClick={() => toggleDrawMode("polygon")}
            />
            {drawMode && (
              <span className="px-2 text-[12px] text-neutral-500">
                {drawMode === "point"
                  ? "Click the map"
                  : "Click to add points"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Widened from 320px: five tabs plus an item detail panel were fighting
          for the same strip, and "Base map" wrapped. */}
      <aside className="material-panel flex w-96 flex-col overflow-y-auto border-l border-neutral-900/[0.08] backdrop-blur-2xl backdrop-saturate-150">
        {/* Search sits above the tabs rather than inside Filters: it's reached
            constantly, and shouldn't cost a tab switch to get to. */}
        <SearchBox
          query={query}
          onQueryChange={setQuery}
          results={visibleItems}
          totalCount={items.length}
          onSelectResult={focusItem}
        />

        <div className="material sticky top-0 z-10 flex backdrop-blur-xl backdrop-saturate-150">
          <PanelTab
            label="Layers"
            active={panel === "layers"}
            onClick={() => setPanel("layers")}
          />
          <PanelTab
            label="Filters"
            active={panel === "filters"}
            onClick={() => setPanel("filters")}
          />
          <PanelTab
            label="Import"
            active={panel === "import"}
            onClick={() => setPanel("import")}
          />
          <PanelTab
            label="Base map"
            active={panel === "basemap"}
            onClick={() => setPanel("basemap")}
          />
          <PanelTab
            label="Trash"
            count={deletedItems.length}
            active={panel === "trash"}
            onClick={() => setPanel("trash")}
          />
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

        {panel === "import" && (
          <ImportPanel
            layers={layers}
            createItemAction={createItemAction}
            mapCenter={() => {
              const c = mapRef.current?.getCenter();
              return c ? ([c.lng, c.lat] as [number, number]) : DEFAULT_CENTER;
            }}
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
            purgeItemAction={purgeItemAction}
            currentUserId={currentUserId}
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
            memberNames={memberNames}
            canUndoMove={lastMove?.itemId === selectedItem.id}
            onUndoMove={undoMove}
            moveError={moveError}
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
      <ul className="-mx-2 flex flex-col">
        {layers.map((layer) => (
          <li
            key={layer.id}
            // Delete only surfaces on hover/focus-within: it sits next to a
            // control people toggle constantly, and shouldn't be equally
            // reachable by accident.
            className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-neutral-900/[0.04]"
          >
            <input
              type="checkbox"
              checked={!hiddenLayerIds.has(layer.id)}
              onChange={() => onToggle(layer.id)}
              className="accent-neutral-900"
            />
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
              style={{ background: layer.color ?? UNASSIGNED_COLOR }}
            />
            <span className="flex-1 truncate">{layer.name}</span>
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
                className="press rounded-md px-1.5 py-0.5 text-[12px] text-neutral-400 opacity-0 transition-opacity hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
              >
                Delete
              </button>
            </form>
          </li>
        ))}
        {layers.length === 0 && (
          <li className="px-2 text-[13px] text-neutral-400">No layers yet.</li>
        )}
      </ul>

      <form
        action={formAction}
        className="flex flex-col gap-2 border-t border-neutral-900/[0.08] pt-3"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-500">
          New layer
        </p>
        <div className="flex gap-2">
          <input
            type="color"
            name="color"
            defaultValue="#3b82f6"
            aria-label="Layer colour"
            className="h-9 w-9 cursor-pointer rounded-lg border border-neutral-300/70 bg-white/60 p-1"
          />
          <input
            type="text"
            name="name"
            required
            placeholder="e.g. Interviews"
            className="flex-1 rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="press self-start rounded-full bg-neutral-900 px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
        >
          {pending ? "Adding…" : "Add layer"}
        </button>
        {state?.error && (
          <p className="text-[13px] text-red-600">{state.error}</p>
        )}
      </form>
    </div>
  );
}

function DrawTool({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`press rounded-xl px-3.5 py-1.5 text-[13px] font-medium ${
        active
          ? "bg-neutral-900 text-white"
          : "text-neutral-700 hover:bg-neutral-900/[0.06]"
      }`}
    >
      {label}
    </button>
  );
}

function PanelTab({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`press relative flex-1 whitespace-nowrap px-1 py-2.5 text-[12px] ${
        active ? "font-semibold text-neutral-900" : "text-neutral-500"
      }`}
    >
      {label}
      {count ? (
        <span className="ml-1 rounded-full bg-neutral-900/10 px-1.5 py-0.5 text-[10px] tabular-nums">
          {count}
        </span>
      ) : null}
      {/* Indicator under the active tab instead of a full-width rule, so the
          bar stays a floating layer rather than a hard divider. */}
      <span
        aria-hidden
        className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-neutral-900 transition-opacity duration-200 ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
    </button>
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
          className="w-full rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
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

type ImportRow = {
  name: string;
  status: "waiting" | "reading" | "uploading" | "done" | "skipped" | "error";
  detail?: string;
  located?: boolean;
};

function ImportPanel({
  layers,
  createItemAction,
  mapCenter,
}: {
  layers: Layer[];
  createItemAction: BoundAction;
  mapCenter: () => [number, number];
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [layerId, setLayerId] = useState("");
  const [includeUnlocated, setIncludeUnlocated] = useState(true);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [running, setRunning] = useState(false);

  // Photos with no GPS all land wherever the map is centred. Stacking them on
  // the exact same point would make every marker but the top one impossible
  // to grab, so they're fanned out on a small spiral - close enough to read as
  // "these still need placing", far enough apart to drag individually.
  function spiralOffset(n: number, center: [number, number]): [number, number] {
    const golden = 2.399963;
    const radius = 0.00012 * Math.sqrt(n + 1);
    return [
      center[0] + radius * Math.cos(n * golden),
      center[1] + radius * Math.sin(n * golden),
    ];
  }

  async function runImport() {
    if (!files.length || running) return;
    setRunning(true);

    const center = mapCenter();
    let unlocatedCount = 0;
    const next: ImportRow[] = files.map((f) => ({
      name: f.name,
      status: "waiting",
    }));
    setRows([...next]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const update = (patch: Partial<ImportRow>) => {
        next[i] = { ...next[i], ...patch };
        setRows([...next]);
      };

      try {
        update({ status: "reading" });
        const prepared = await preparePhoto(file);

        if (!prepared.coordinates && !includeUnlocated) {
          update({ status: "skipped", detail: "no location" });
          continue;
        }

        const coordinates =
          prepared.coordinates ?? spiralOffset(unlocatedCount++, center);

        update({
          status: "uploading",
          located: Boolean(prepared.coordinates),
        });
        const notes = [
          prepared.converted ? "converted from HEIC" : null,
          prepared.resized ? "scaled to 2400px" : null,
        ].filter(Boolean);

        // Goes through the same server action as a hand-made item, so
        // validation, storage and authorship all behave identically.
        const form = new FormData();
        form.set("title", file.name.replace(/\.[^.]+$/, ""));
        form.set("type", "image");
        form.set("layer_id", layerId);
        form.set("geometry", JSON.stringify({ type: "Point", coordinates }));
        form.set("image", prepared.file);
        if (prepared.date) form.set("date_start", prepared.date);

        const result = await createItemAction({}, form);
        if (result.error) {
          update({ status: "error", detail: result.error });
        } else {
          update({
            status: "done",
            detail: [
              prepared.coordinates ? "placed from photo" : "needs placing",
              ...notes,
            ].join(" · "),
          });
        }
      } catch (e) {
        update({
          status: "error",
          detail: e instanceof Error ? e.message : "failed",
        });
      }
    }

    setRunning(false);
  }

  const done = rows.filter((r) => r.status === "done").length;
  const located = rows.filter((r) => r.located).length;
  const failed = rows.filter((r) => r.status === "error").length;

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs text-neutral-500">
        Add a folder of photos at once. Each becomes its own image item, placed
        from the photo&apos;s own GPS where it has any. HEIC files are converted
        to JPEG, since browsers can&apos;t display them.
      </p>

      <input
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        disabled={running}
        onChange={(e) => {
          setFiles(Array.from(e.target.files ?? []));
          setRows([]);
        }}
        className="text-sm"
      />

      <select
        value={layerId}
        onChange={(e) => setLayerId(e.target.value)}
        disabled={running}
        className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
      >
        <option value="">No layer</option>
        {layers.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      <label className="flex items-start gap-2 text-xs text-neutral-600">
        <input
          type="checkbox"
          checked={includeUnlocated}
          onChange={(e) => setIncludeUnlocated(e.target.checked)}
          disabled={running}
          className="mt-0.5"
        />
        <span>
          Also add photos with no GPS, near the middle of the current map view.
          They&apos;ll need dragging into place.
        </span>
      </label>

      <button
        onClick={runImport}
        disabled={running || files.length === 0}
        className="press self-start rounded-full bg-neutral-900 px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
      >
        {running
          ? `Importing… ${done + failed} of ${files.length}`
          : files.length
          ? `Import ${files.length} photo${files.length === 1 ? "" : "s"}`
          : "Choose photos first"}
      </button>

      {rows.length > 0 && (
        <>
          <p className="text-xs text-neutral-500">
            {done} added ({located} placed from GPS)
            {failed > 0 && `, ${failed} failed`}
          </p>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {rows.map((row, i) => (
              <li key={`${row.name}-${i}`} className="flex flex-col text-xs">
                <span className="truncate">
                  {row.status === "done"
                    ? "✓"
                    : row.status === "error"
                    ? "✕"
                    : row.status === "skipped"
                    ? "–"
                    : "…"}{" "}
                  {row.name}
                </span>
                {row.detail && (
                  <span
                    className={`pl-4 ${
                      row.status === "error"
                        ? "text-red-600"
                        : "text-neutral-400"
                    }`}
                  >
                    {row.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TrashPanel({
  deletedItems,
  restoreItemAction,
  purgeItemAction,
  currentUserId,
}: {
  deletedItems: (Item & { deleted_at: string | null })[];
  restoreItemAction: (itemId: string) => Promise<ActionResult>;
  purgeItemAction: (itemId: string) => Promise<ActionResult>;
  currentUserId: string;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs text-neutral-500">
        Deleted items are kept here indefinitely, so anyone in the project can
        undo a mistaken delete. Only the person who added an item can remove
        it for good.
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
            <div className="flex items-center gap-3">
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

              {/* Only the creator can purge - matches the RLS policy, so an
                  absent button and a blocked request agree with each other. */}
              {item.created_by === currentUserId && (
                <form
                  action={async () => {
                    await purgeItemAction(item.id);
                  }}
                  onSubmit={(e) => {
                    if (
                      !confirm(
                        `Permanently delete "${item.title || "this item"}"? This also removes any uploaded files and cannot be undone.`
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
                    Delete permanently
                  </button>
                </form>
              )}
            </div>
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
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-500">
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
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-500">
          Timeline
        </p>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          From
          <input
            type="date"
            value={dateFrom ?? ""}
            onChange={(e) => onDateFromChange(e.target.value || null)}
            className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          To
          <input
            type="date"
            value={dateTo ?? ""}
            onChange={(e) => onDateToChange(e.target.value || null)}
            className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
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
  const [photoNote, setPhotoNote] = useState<string | null>(null);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    setPhotoCoords(null);
    setExifChecked(false);
    setPhotoNote(null);
    if (!file) return;

    setCheckingExif(true);
    try {
      const prepared = await preparePhoto(file);
      if (prepared.coordinates) setPhotoCoords(prepared.coordinates);

      // Swap in the prepared file before submit. A HEIC can't be displayed by
      // any browser, and a full-resolution original is far larger than the
      // map ever needs - so whichever applies, the original shouldn't be what
      // gets uploaded.
      if (prepared.converted || prepared.resized) {
        const dt = new DataTransfer();
        dt.items.add(prepared.file);
        input.files = dt.files;
        setPhotoNote(
          [
            prepared.converted ? "Converted from HEIC so browsers can show it" : null,
            prepared.resized ? "scaled down to 2400px" : null,
          ]
            .filter(Boolean)
            .join(", ") + "."
        );
      }
    } catch {
      // Unreadable metadata or a failed conversion: leave the original file
      // in place rather than blocking the upload.
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
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-500">
        New item — {geometryLabel(geometry)}
      </p>
      <input type="hidden" name="geometry" value={JSON.stringify(geometry)} />
      <input type="hidden" name="type" value={type} />

      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
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
        className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
      />
      <textarea
        name="body"
        rows={3}
        placeholder={bodyLabelFor(type)}
        className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
      />
      {showAttribution && (
        <input
          type="text"
          name="attribution"
          placeholder="Attribution (interviewee, source, citation…)"
          className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
        />
      )}
      <input
        type="text"
        name="tags"
        placeholder="Tags, comma separated"
        className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
      />
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Date
        <input
          type="date"
          name="date_start"
          className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
        />
      </label>
      <select
        name="layer_id"
        className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
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
            className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
          />
        </>
      )}

      {checkingExif && (
        <p className="text-xs text-neutral-400">Reading photo…</p>
      )}
      {photoNote && !checkingExif && (
        <p className="text-xs text-neutral-500">{photoNote}</p>
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
          className="press self-start rounded-full bg-neutral-900 px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
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
  memberNames,
  canUndoMove,
  onUndoMove,
  moveError,
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
  memberNames: Record<string, string>;
  canUndoMove: boolean;
  onUndoMove: () => void;
  moveError: string | null;
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
  const [linkQuery, setLinkQuery] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const alreadyLinked = new Set(linked.map((l) => l.other.id));
  const linkCandidates = allItems.filter(
    (i) => i.id !== item.id && !alreadyLinked.has(i.id)
  );
  // Same matcher the map search uses, so "find the item I'm thinking of"
  // behaves identically in both places.
  const matchingCandidates = linkCandidates.filter((i) =>
    matchesQuery(i, linkQuery)
  );
  const selectedTarget = linkCandidates.find((i) => i.id === linkTarget);

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
      setLinkQuery("");
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
    <div className="step-forward flex flex-col gap-2.5 border-t border-neutral-900/[0.08] p-4">
      <div className="flex items-center justify-between gap-2">
        <select
          value={layerId}
          onChange={handleLayerChange}
          disabled={savingLayer}
          aria-label="Layer"
          className="flex-1 rounded-lg border border-neutral-300/70 bg-white/60 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-600 outline-none focus:border-neutral-400"
        >
          <option value="">No layer</option>
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          onClick={onClose}
          aria-label="Close"
          className="press rounded-full px-2 py-1 text-[13px] text-neutral-400 hover:bg-neutral-900/[0.06] hover:text-neutral-700"
        >
          ✕
        </button>
      </div>

      <span className="w-fit rounded-full bg-neutral-900/[0.06] px-2 py-0.5 text-[11px] text-neutral-600">
        {TYPE_OPTIONS.find((t) => t.value === item.type)?.label ?? item.type}
      </span>

      <h3 className="text-[18px] font-semibold leading-[1.15] tracking-[-0.02em]">
        {item.title}
      </h3>

      {item.attribution && (
        <p className="text-[13px] italic leading-snug text-neutral-500">
          — {item.attribution}
        </p>
      )}

      {item.media?.map((m, i) => {
        if (m.type === "image") {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={m.url}
              alt={item.title ?? ""}
              draggable={false}
              className="w-full rounded-xl shadow-sm"
            />
          );
        }
        if (m.type === "audio") {
          return <audio key={i} controls src={m.url} className="w-full" />;
        }
        if (m.type === "video") {
          return (
            <video key={i} controls src={m.url} className="w-full rounded-xl" />
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

      <p className="text-xs text-neutral-400">
        {item.created_by
          ? `Added by ${memberNames[item.created_by] ?? "a former member"}`
          : "Added before authorship was recorded"}
      </p>

      {item.geometry.type === "Point" ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-neutral-400">
            {item.geometry.coordinates[1].toFixed(5)},{" "}
            {item.geometry.coordinates[0].toFixed(5)} — drag its marker to move
            it
          </p>
          {canUndoMove && (
            <button
              onClick={onUndoMove}
              className="self-start text-xs text-blue-600 underline"
            >
              Undo move
            </button>
          )}
          {moveError && <p className="text-xs text-red-600">{moveError}</p>}
        </div>
      ) : (
        <p className="text-xs text-neutral-400">
          {item.geometry.type === "LineString" ? "Line" : "Region"} — drawn
          shapes can&apos;t be moved yet
        </p>
      )}

      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Tags
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          onBlur={handleTagsBlur}
          placeholder="comma, separated, tags"
          className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
        />
      </label>

      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-500">
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
            {selectedTarget ? (
              // Chosen: confirm what's being linked, and why.
              <div className="flex flex-col gap-2 rounded border border-neutral-200 p-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">
                    {selectedTarget.title || "Untitled"}
                  </span>
                  <button
                    onClick={() => {
                      setLinkTarget("");
                      setLinkError(null);
                    }}
                    className="text-xs text-neutral-400 underline"
                  >
                    Change
                  </button>
                </div>
                <input
                  type="text"
                  value={linkNote}
                  onChange={(e) => setLinkNote(e.target.value)}
                  placeholder="How are they related? (optional)"
                  className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
                />
                <button
                  onClick={handleCreateLink}
                  disabled={linking}
                  className="press self-start rounded-full bg-neutral-900 px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
                >
                  {linking ? "Linking…" : "Add link"}
                </button>
              </div>
            ) : (
              <>
                <input
                  type="search"
                  value={linkQuery}
                  onChange={(e) => setLinkQuery(e.target.value)}
                  placeholder="Link to… search by title, text, tag"
                  className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
                />
                <ul className="flex max-h-48 flex-col overflow-y-auto">
                  {matchingCandidates.slice(0, 30).map((i) => (
                    <li key={i.id}>
                      <button
                        onClick={() => {
                          setLinkTarget(i.id);
                          setLinkQuery("");
                        }}
                        className="w-full truncate py-1 text-left text-sm text-blue-600 underline"
                      >
                        {i.title || "Untitled"}
                      </button>
                    </li>
                  ))}
                </ul>
                {matchingCandidates.length === 0 && (
                  <p className="text-sm text-neutral-400">
                    No items match “{linkQuery}”.
                  </p>
                )}
                {matchingCandidates.length > 30 && (
                  <p className="text-xs text-neutral-400">
                    Showing the first 30 — keep typing to narrow.
                  </p>
                )}
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
              className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            South (lat)
            <input
              name="south"
              type="number"
              step="any"
              required
              className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            West (lng)
            <input
              name="west"
              type="number"
              step="any"
              required
              className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            East (lng)
            <input
              name="east"
              type="number"
              step="any"
              required
              className="rounded-lg border border-neutral-300/70 bg-white/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-neutral-400"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="press self-start rounded-full bg-neutral-900 px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
        >
          {pending ? "Uploading…" : "Set base map"}
        </button>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      </form>
    </div>
  );
}
