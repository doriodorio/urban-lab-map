"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAP_STYLES,
  DEFAULT_STYLE_ID,
  findStyle,
  buildRasterStyle,
  initialStyle,
} from "@/lib/base-maps";
import { ensureRtlTextSupport } from "@/lib/rtl-text";
import { itemCategory, itemGroup, CATEGORIES } from "@/lib/categories";
import {
  projectPerimeter,
  ensurePerimeterLayers,
  perimeterFeatures,
} from "@/lib/perimeter";
import {
  MarginLabels,
  useMarginLabels,
  galleryImage,
  ItemMark,
  type GalleryEntry,
} from "@/components/margin-labels";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { toVideoEmbed, linkHost } from "@/lib/embed";

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
  /** "photo" when the point came off the photograph's own GPS. */
  located_by: string | null;
};
type Thread = { id: string; name: string; description: string | null };

/**
 * The stages a reader moves through, in order.
 *
 * Numbered, because the order is the argument: a visitor who lands on a map of
 * coloured dots has to work out what they are looking at, and one who reads a
 * statement first does not.
 */
type Stage = "statement" | "film" | "collection" | "tour";
type ThreadItem = {
  thread_id: string;
  item_id: string;
  order_index: number;
  narration: string | null;
};

const UNASSIGNED_COLOR = "#737373";
const DEFAULT_CENTER: [number, number] = [34.78, 32.07];

// Apple's projection from the Designing Fluid Interfaces sample code: where a
// flick would come to rest, given its release velocity. Deliberately the
// exponential-decay form, not the v²/2a textbook one - this is what makes a
// flick feel thrown rather than snapped.
function projectMomentum(velocity: number, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

// Past a boundary the surface resists progressively instead of stopping dead:
// a hard stop reads as frozen, resistance reads as "responsive, but there's
// nothing more this way".
function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (
    (overshoot * dimension * constant) /
    (dimension + constant * Math.abs(overshoot))
  );
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

function ensureShapeLayers(map: maplibregl.Map) {
  ensurePerimeterLayers(map);
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
}

export function PublicViewer({
  project,
  layers,
  items,
  threads,
  threadItems,
}: {
  project: {
    id: string;
    name: string;
    description: string | null;
    base_map_image_url: string | null;
    base_map_bounds: [[number, number], [number, number]] | null;
    base_map_style: string | null;
    statement: string | null;
    cover_image_url: string | null;
    doco_url: string | null;
  };
  layers: Layer[];
  items: Item[];
  threads: Thread[];
  threadItems: ThreadItem[];
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  // The brief makes the guided tour the default entry point, so a project
  // with a thread opens in tour mode; one without has nothing to play.
  const firstThread = threads[0] ?? null;
  // Yona's sequence: the argument for the project, then the film, then the
  // material grouped by where it came from, and only then the tour. A project
  // with no statement and no film starts at the collection, so nothing that
  // exists today gains an empty opening.
  const [stage, setStage] = useState<Stage>(
    project.statement || project.cover_image_url
      ? "statement"
      : project.doco_url
        ? "film"
        : "collection"
  );
  const [mode, setMode] = useState<"tour" | "explore">(
    firstThread ? "tour" : "explore"
  );
  const [threadId, setThreadId] = useState<string | null>(
    firstThread?.id ?? null
  );
  const [stepIndex, setStepIndex] = useState(0);
  // Which way the last step change travelled, so the incoming content enters
  // along the axis of the gesture that summoned it.
  const [stepDir, setStepDir] = useState<1 | -1>(1);
  // Live 1:1 offset while a swipe is in progress; null when not dragging, so
  // the settle transition only applies after release.
  const [dragX, setDragX] = useState<number | null>(null);
  const dragRef = useRef<{
    startX: number;
    width: number;
    history: { x: number; t: number }[];
  } | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(new Set());
  // Lifted out of ExplorePanel so the map narrows along with the result list -
  // matching the editor, where searching is what makes a dense map readable.
  const [query, setQuery] = useState("");
  const [galleryOn, setGalleryOn] = useState(false);
  // On by default: it tells a visitor what area this project covers before
  // they have read a single item.
  const [showPerimeter, setShowPerimeter] = useState(true);
  // Opens on the base map the project was arranged on. The picker stays, so a
  // reader can still switch - but the map they land on is the one the group
  // built.
  const [mapStyleId, setMapStyleId] = useState(
    project.base_map_style ?? DEFAULT_STYLE_ID
  );
  // Bumped whenever setStyle() replaces the whole style, which discards every
  // source and layer we added - the shape layers and the base-map overlay have
  // to be rebuilt against the new one.
  const [styleEpoch, setStyleEpoch] = useState(0);

  const itemById = new Map(items.map((i) => [i.id, i]));
  const steps = threadItems
    .filter((s) => s.thread_id === threadId)
    .sort((a, b) => a.order_index - b.order_index)
    .map((s) => ({ ...s, item: itemById.get(s.item_id) }))
    .filter((s): s is ThreadItem & { item: Item } => Boolean(s.item));

  const currentStep = mode === "tour" ? steps[stepIndex] : undefined;
  const selectedItem =
    mode === "tour"
      ? currentStep?.item
      : items.find((i) => i.id === selectedItemId);

  const layerColor = (layerId: string | null) =>
    layers.find((l) => l.id === layerId)?.color || UNASSIGNED_COLOR;

  function matchesQuery(item: Item) {
    if (!query) return true;
    const q = query.toLowerCase();
    return [item.title, item.body, item.attribution, ...(item.tags ?? [])].some(
      (f) => f?.toLowerCase().includes(q)
    );
  }

  // In tour mode every stop stays visible regardless of layer or search
  // filters - those belong to exploring, and shouldn't punch holes in a
  // narrated sequence.
  const visible = (item: Item) =>
    mode === "tour" ||
    (!hiddenLayerIds.has(item.layer_id ?? "unassigned") && matchesQuery(item));

  const exploreResults = items.filter(
    (i) => !hiddenLayerIds.has(i.layer_id ?? "unassigned") && matchesQuery(i)
  );

  // Built from every item, not the filtered set: the perimeter is the extent
  // of the project, and hiding a layer should not shrink the study area.
  const perimeter = showPerimeter
    ? projectPerimeter(items.map((i) => i.geometry))
    : null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      ensureShapeLayers(map);
      const source = map.getSource(
        "project-perimeter"
      ) as maplibregl.GeoJSONSource | undefined;
      source?.setData(perimeterFeatures(perimeter, project.name));
    };

    if (map.isStyleLoaded()) update();
    else map.once("load", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perimeter && perimeter.flat().join(","), project.name, styleEpoch]);

  // Gallery cards for whatever the map is currently showing. Built from the
  // same `visible` rule as the markers, so a card never points at a hidden
  // item - and laid out by the same hook the editor uses.
  const galleryEntries: GalleryEntry[] = items.filter(visible).map((item) => ({
    id: item.id,
    title: item.title || "Untitled",
    type: item.type,
    image: galleryImage(item.media),
    color: layerColor(item.layer_id),
    lngLat: centroid(item.geometry),
  }));
  const labels = useMarginLabels(mapRef, galleryEntries, galleryOn);

  // Only the stages this project actually has anything for.
  const stages: { id: Stage; label: string }[] = [
    ...(project.statement || project.cover_image_url
      ? [{ id: "statement" as const, label: "Statement" }]
      : []),
    ...(project.doco_url ? [{ id: "film" as const, label: "Film" }] : []),
    { id: "collection" as const, label: "Collection" },
    ...(threads.length > 0
      ? [{ id: "tour" as const, label: "Guided tour" }]
      : []),
  ];

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
    // Before the map exists: a vector style shapes Hebrew in the browser, and
    // without this the first labels render backwards.
    ensureRtlTextSupport();

    // Open on the project's extent, the same as the editor does: a visitor
    // should land on the project, not on a default point they have to find
    // their way from.
    const opening = projectPerimeter(items.map((i) => i.geometry));
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: initialStyle(project.base_map_style ?? DEFAULT_STYLE_ID),
      center: DEFAULT_CENTER,
      zoom: 12,
      ...(opening
        ? {
            bounds: [
              opening[0][0],
              opening[0][1],
              opening[2][0],
              opening[2][1],
            ] as [number, number, number, number],
            fitBoundsOptions: { padding: 24, maxZoom: 17 },
          }
        : {}),
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    const markers = markersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
    // Mount-once. The project's base map is read here as a starting style;
    // later changes to it belong to the switching effect below, which swaps
    // the style in place rather than rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Custom base-map overlay, kept under the item shapes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!project.base_map_image_url || !project.base_map_bounds) return;
      if (map.getLayer("base-map-overlay")) return;

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

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [project.base_map_image_url, project.base_map_bounds, styleEpoch]);

  // Base-map switching. A vector style is a whole style document, so it needs
  // a full setStyle() and everything we added has to be rebuilt afterwards -
  // hence styleEpoch, which the effects below depend on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const style = findStyle(mapStyleId);

    const apply = () => {
      map.setStyle(
        style.kind === "vector" ? style.url : buildRasterStyle(style)
      );
      map.once("idle", () => setStyleEpoch((e) => e + 1));
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [mapStyleId]);

  // Clicking bare map puts the open item away.
  //
  // Only while exploring: during the guided tour the panel is showing the
  // current stop, and clearing it would empty the tour under the reader's
  // hands rather than closing something they opened.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mode !== "explore") return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      // Asked directly rather than left to handler ordering - see the editor,
      // which does the same for the same reason. Markers are DOM siblings of
      // the canvas, so a click on one never reaches here.
      const shapeLayers = ["item-lines-layer", "item-polygons-fill"].filter(
        (id) => map.getLayer(id)
      );
      const onShape =
        shapeLayers.length > 0 &&
        map.queryRenderedFeatures(e.point, { layers: shapeLayers }).length > 0;

      if (!onShape) setSelectedItemId(null);
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [mode]);

  // Point markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const item of items) {
      if (item.geometry.type !== "Point") continue;
      let marker = markersRef.current.get(item.id);

      if (!marker) {
        const el = document.createElement("button");
        el.type = "button";
        // Filled circle: a photograph's own GPS put it here. Hollow circle:
        // it came from such a photograph and was then moved, so the picture is
        // still evidence while the position is someone's judgement. Square:
        // placed by hand, or a photograph with no GPS - which is also every
        // item recorded before this was tracked.
        const located = item.located_by;
        const round = located === "photo" || located === "moved";
        const size = round ? "16px" : "14px";
        el.style.width = size;
        el.style.height = size;
        el.style.borderRadius = round ? "50%" : "2px";
        el.style.border =
          located === "moved"
            ? `2px solid ${layerColor(item.layer_id)}`
            : "2px solid white";
        el.style.background =
          located === "moved" ? "#ffffff" : layerColor(item.layer_id);
        el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.3)";
        el.style.cursor = "pointer";
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
      // Re-applied on every render because a layer's colour can change under
      // it. A moved item keeps its colour in the ring rather than the fill, so
      // this has to respect the shape rather than paint over it.
      const moved = item.located_by === "moved";
      el.style.background = moved ? "#ffffff" : layerColor(item.layer_id);
      el.style.border = moved
        ? `2px solid ${layerColor(item.layer_id)}`
        : "2px solid white";
      el.style.display = visible(item) ? "block" : "none";
      // Highlight the current tour stop so the map matches the narration.
      el.style.transform =
        currentStep?.item.id === item.id
          ? `${el.style.transform.replace(/ scale\([^)]*\)/, "")} scale(1.6)`
          : el.style.transform.replace(/ scale\([^)]*\)/, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hiddenLayerIds, query, mode, currentStep?.item.id, layers]);

  // Line/polygon items.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      ensureShapeLayers(map);
      const lineSource = map.getSource("item-lines") as maplibregl.GeoJSONSource;
      const polySource = map.getSource(
        "item-polygons"
      ) as maplibregl.GeoJSONSource;

      const lineFeatures: GeoJSON.Feature[] = [];
      const polyFeatures: GeoJSON.Feature[] = [];

      for (const item of items) {
        if (!visible(item)) continue;
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
  }, [items, hiddenLayerIds, query, mode, layers, styleEpoch]);

  // Fly to the current tour stop.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentStep) return;
    map.easeTo({
      center: centroid(currentStep.item.geometry),
      zoom: Math.max(map.getZoom(), 14),
      duration: 800,
    });
  }, [currentStep]);

  function goToStep(next: number) {
    if (next < 0 || next >= steps.length) return;
    setStepDir(next > stepIndex ? 1 : -1);
    setStepIndex(next);
  }

  // Swipe between stops. Tracked continuously rather than through a
  // swipe-left-style recogniser, because a recogniser only reports a final
  // state and throws away the feedback during the gesture.
  function onStepPointerDown(e: React.PointerEvent) {
    if (steps.length < 2) return;
    // Let the user still select text and use controls inside the card.
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, audio, video")) {
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      width: (e.currentTarget as HTMLElement).offsetWidth || 320,
      history: [{ x: e.clientX, t: performance.now() }],
    };
  }

  function onStepPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;

    const raw = e.clientX - drag.startX;
    // Resist at the ends, where there is no next stop to reveal.
    const atStart = stepIndex === 0 && raw > 0;
    const atEnd = stepIndex === steps.length - 1 && raw < 0;
    const offset =
      atStart || atEnd ? rubberband(raw, drag.width) : raw;

    drag.history.push({ x: e.clientX, t: performance.now() });
    if (drag.history.length > 5) drag.history.shift();
    setDragX(offset);
  }

  function onStepPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    const offset = dragX ?? 0;
    const first = drag.history[0];
    const last = drag.history[drag.history.length - 1];
    const dt = Math.max(1, last.t - first.t);
    const velocity = ((last.x - first.x) / dt) * 1000; // px/s

    // Commit based on where the flick is going, not where the finger stopped.
    const projected = offset + projectMomentum(velocity);
    const threshold = drag.width * 0.25;

    setDragX(null);
    if (projected <= -threshold) goToStep(stepIndex + 1);
    else if (projected >= threshold) goToStep(stepIndex - 1);
  }

  function toggleLayer(id: string) {
    setHiddenLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex h-screen w-full flex-col md:flex-row">
      <div className="relative min-h-0 flex-1">
        <div ref={mapContainer} className="h-full w-full" />

        {galleryOn && (
          <MarginLabels
            labels={labels}
            onSelect={(id) => {
              // A card is a way into the item, so selecting one also leaves
              // the narrated tour - the reader has stepped off the path.
              setMode("explore");
              setSelectedItemId(id);
            }}
          />
        )}

        <select
          value={mapStyleId}
          onChange={(e) => setMapStyleId(e.target.value)}
          aria-label="Base map"
          className="absolute right-24 top-3 z-10 rounded-md border border-rule bg-card px-2 py-1.5 text-[12px] outline-none"
        >
          {MAP_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setShowPerimeter((on) => !on)}
          title="Outline the area this project covers"
          className={`press absolute right-44 top-3 z-10 rounded-md border border-rule px-3 py-1.5 text-[12px] font-medium ${
            showPerimeter ? "bg-ink text-white" : "bg-card text-ink"
          }`}
        >
          Perimeter
        </button>

        <button
          type="button"
          onClick={() => setGalleryOn((on) => !on)}
          title="Show items as thumbnails with their titles in the margins"
          className={`press absolute right-3 top-3 z-10 rounded-md border border-rule px-3 py-1.5 text-[12px] font-medium ${
            galleryOn ? "bg-ink text-white" : "bg-card text-ink"
          }`}
        >
          Gallery
        </button>

        <div className="absolute left-3 top-3 max-w-[70%] rounded-md border border-rule bg-card px-3.5 py-2.5">
          <p className="text-[15px] font-semibold leading-tight tracking-[-0.01em]">
            {project.name}
          </p>
          {project.description && (
            <p className="mt-0.5 text-[13px] leading-snug text-neutral-600">
              {project.description}
            </p>
          )}
        </div>
      </div>

      <aside className="flex max-h-[48vh] w-full flex-col overflow-y-auto border-rule bg-card md:max-h-none md:w-96 md:border-l">
        <nav className="sticky top-0 z-10 flex overflow-x-auto border-b border-rule bg-card">
          {stages.map((s, i) => (
            <StageTab
              key={s.id}
              index={i}
              label={s.label}
              active={stage === s.id}
              onClick={() => {
                setStage(s.id);
                // The tour and the free map are the same surface underneath;
                // which one the reader gets follows from the stage they chose.
                if (s.id === "tour") setMode("tour");
                if (s.id === "collection") setMode("explore");
              }}
            />
          ))}
        </nav>

        {stage === "statement" && (
          <StatementPanel
            name={project.name}
            statement={project.statement}
            coverImageUrl={project.cover_image_url}
            onContinue={
              stages[stages.findIndex((s) => s.id === "statement") + 1]
            }
            onGo={(id) => {
              setStage(id);
              if (id === "tour") setMode("tour");
              if (id === "collection") setMode("explore");
            }}
          />
        )}

        {stage === "film" && (
          <FilmPanel
            url={project.doco_url!}
            onContinue={stages[stages.findIndex((s) => s.id === "film") + 1]}
            onGo={(id) => {
              setStage(id);
              if (id === "tour") setMode("tour");
              if (id === "collection") setMode("explore");
            }}
          />
        )}

        {stage === "tour" && mode === "tour" && (
          <TourPanel
            threads={threads}
            threadId={threadId}
            onThreadChange={(id) => {
              setThreadId(id);
              setStepIndex(0);
            }}
            steps={steps}
            stepIndex={stepIndex}
            onStepChange={goToStep}
          />
        )}

        {stage === "collection" && (
          <ExplorePanel
            layers={layers}
            hiddenLayerIds={hiddenLayerIds}
            onToggleLayer={toggleLayer}
            query={query}
            onQueryChange={setQuery}
            results={exploreResults}
            onSelect={(item) => {
              setSelectedItemId(item.id);
              mapRef.current?.easeTo({
                center: centroid(item.geometry),
                duration: 600,
              });
            }}
          />
        )}

        {/* Only where an item is what the reader is looking at. During the
            statement and the film, a leftover selection - the tour's first
            stop, chosen before anyone asked for it - would sit under the
            opening as if it were part of it. */}
        {selectedItem && (stage === "collection" || stage === "tour") && (
          <div
            // The card tracks the finger 1:1 during a swipe, then settles.
            // Transition is off mid-gesture so the content stays glued to the
            // pointer rather than lagging behind it.
            onPointerDown={mode === "tour" ? onStepPointerDown : undefined}
            onPointerMove={mode === "tour" ? onStepPointerMove : undefined}
            onPointerUp={mode === "tour" ? onStepPointerUp : undefined}
            onPointerCancel={mode === "tour" ? onStepPointerUp : undefined}
            style={{
              transform: `translate3d(${dragX ?? 0}px, 0, 0)`,
              transition:
                dragX === null
                  ? "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)"
                  : "none",
              touchAction: mode === "tour" ? "pan-y" : undefined,
            }}
          >
            <ItemCard
              // Keyed by stop so each one animates in as its own thing.
              key={mode === "tour" ? `${threadId}-${stepIndex}` : selectedItem.id}
              className={
                mode === "tour"
                  ? stepDir === 1
                    ? "step-forward"
                    : "step-back"
                  : undefined
              }
              item={selectedItem}
              narration={currentStep?.narration ?? null}
              layerName={
                layers.find((l) => l.id === selectedItem.layer_id)?.name ?? null
              }
            />
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * Recognised videos play in place; anything else stays a link showing its
 * host. Only known video hosts are ever framed, so a published map can't be
 * used to embed an arbitrary page.
 */
function PublicEmbeddedLink({ url }: { url: string }) {
  const embed = toVideoEmbed(url);

  if (embed) {
    return (
      <div className="overflow-hidden rounded-md border border-rule bg-black/5">
        <iframe
          src={embed}
          title="Embedded video"
          allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="aspect-video w-full border-0"
        />
      </div>
    );
  }

  const host = linkHost(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="press flex flex-col gap-0.5 rounded-lg border border-rule bg-card px-2.5 py-2"
    >
      {host && (
        <span className="label">
          {host}
        </span>
      )}
      <span className="break-all text-[13px] text-blue-600 underline">
        {url}
      </span>
    </a>
  );
}

/** A numbered step in the sequence, in the catalog's own idiom. */
function StageTab({
  index,
  label,
  active,
  onClick,
}: {
  index: number;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`press relative shrink-0 px-4 py-3 text-left ${
        active ? "text-ink" : "text-ink-muted hover:text-ink-secondary"
      }`}
    >
      <span className="code mr-1.5 tabular-nums">
        {String(index).padStart(2, "0")}
      </span>
      <span className="text-[13px] font-medium">{label}</span>
      <span
        className={`absolute inset-x-3 bottom-0 h-0.5 bg-ink transition-opacity ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
    </button>
  );
}

/**
 * The opening: what this project is, before any of it is shown.
 *
 * Paragraphs are split on blank lines rather than rendered as markdown - the
 * field asks for up to two paragraphs of plain prose, and a full renderer
 * would invite formatting nobody asked for.
 */
function StatementPanel({
  name,
  statement,
  coverImageUrl,
  onContinue,
  onGo,
}: {
  name: string;
  statement: string | null;
  coverImageUrl: string | null;
  onContinue?: { id: Stage; label: string };
  onGo: (id: Stage) => void;
}) {
  const paragraphs = (statement ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-4">
      <h1 className="display text-[26px] leading-[1.1]">{name}</h1>

      {coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverImageUrl}
          alt=""
          className="w-full rounded-md border border-rule object-cover"
        />
      )}

      {paragraphs.map((paragraph, i) => (
        <p key={i} className="text-[14px] leading-relaxed text-ink-secondary">
          {paragraph}
        </p>
      ))}

      {onContinue && (
        <button
          onClick={() => onGo(onContinue.id)}
          className="press self-start rounded-md bg-ink px-4 py-1.5 text-[13px] font-medium text-white"
        >
          {onContinue.label} &rarr;
        </button>
      )}
    </div>
  );
}

/** The one-minute film. */
function FilmPanel({
  url,
  onContinue,
  onGo,
}: {
  url: string;
  onContinue?: { id: Stage; label: string };
  onGo: (id: Stage) => void;
}) {
  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-4">
      <p className="label">One minute on this project</p>
      <PublicEmbeddedLink url={url} />
      {onContinue && (
        <button
          onClick={() => onGo(onContinue.id)}
          className="press self-start rounded-md bg-ink px-4 py-1.5 text-[13px] font-medium text-white"
        >
          {onContinue.label} &rarr;
        </button>
      )}
    </div>
  );
}

function TourPanel({
  threads,
  threadId,
  onThreadChange,
  steps,
  stepIndex,
  onStepChange,
}: {
  threads: Thread[];
  threadId: string | null;
  onThreadChange: (id: string) => void;
  steps: (ThreadItem & { item: Item })[];
  stepIndex: number;
  onStepChange: (i: number) => void;
}) {
  const thread = threads.find((t) => t.id === threadId);

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3.5">
      {threads.length > 1 && (
        <select
          value={threadId ?? ""}
          onChange={(e) => onThreadChange(e.target.value)}
          className="rounded-lg border border-neutral-300/80 bg-white/70 px-2.5 py-2 text-[13px]"
        >
          {threads.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      {thread && threads.length <= 1 && (
        <p className="text-[15px] font-semibold leading-tight tracking-[-0.01em]">
          {thread.name}
        </p>
      )}
      {thread?.description && (
        <p className="text-[13px] leading-snug text-neutral-600">
          {thread.description}
        </p>
      )}

      {steps.length === 0 ? (
        <p className="text-[13px] text-neutral-500">This tour has no stops yet.</p>
      ) : (
        <>
          {/* Progress as position, not just a count - it shows how much is
              left without needing to be read. */}
          <div className="flex items-center gap-1" aria-hidden>
            {steps.map((s, i) => (
              <span
                key={s.item_id}
                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                  i <= stepIndex ? "bg-neutral-900" : "bg-neutral-900/15"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] tabular-nums text-neutral-500">
              {stepIndex + 1} of {steps.length}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => onStepChange(stepIndex - 1)}
                disabled={stepIndex === 0}
                aria-label="Previous stop"
                className="press rounded-md border border-rule bg-card px-3.5 py-1.5 text-[13px] disabled:opacity-35"
              >
                ←
              </button>
              <button
                onClick={() => onStepChange(stepIndex + 1)}
                disabled={stepIndex >= steps.length - 1}
                className="press rounded-md bg-ink px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-35"
              >
                Next
              </button>
            </div>
          </div>

          {steps.length > 1 && (
            <p className="text-[12px] text-ink-muted md:hidden">
              Swipe the card to move between stops
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ExplorePanel({
  layers,
  hiddenLayerIds,
  onToggleLayer,
  query,
  onQueryChange,
  results,
  onSelect,
}: {
  layers: Layer[];
  hiddenLayerIds: Set<string>;
  onToggleLayer: (id: string) => void;
  query: string;
  onQueryChange: (v: string) => void;
  results: Item[];
  onSelect: (item: Item) => void;
}) {
  // Titles or pictures. A list is the way to find a known item; a grid is the
  // way to see what kind of material a group actually gathered - and that is
  // the question a visitor arrives with, so pictures lead and the list is
  // there for anyone who already knows what they are after.
  const [view, setView] = useState<"list" | "grid">("grid");
  const layerColor = (layerId: string | null) =>
    layers.find((l) => l.id === layerId)?.color || UNASSIGNED_COLOR;

  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-3.5">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search this map…"
        className="rounded-lg border border-neutral-300/80 bg-white/70 px-3 py-2 text-[13px] outline-none focus:border-neutral-400"
      />

      {layers.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="label">
            Layers
          </p>
          {layers.map((layer) => (
            <label
              key={layer.id}
              className="flex cursor-pointer items-center gap-2.5 text-[13px]"
            >
              <input
                type="checkbox"
                checked={!hiddenLayerIds.has(layer.id)}
                onChange={() => onToggleLayer(layer.id)}
                className="accent-neutral-900"
              />
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                style={{ background: layer.color ?? UNASSIGNED_COLOR }}
              />
              {layer.name}
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-b border-rule pb-1.5">
        <p className="label">{results.length} items</p>
        <div className="flex gap-1">
          {(["list", "grid"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={`press label rounded px-2 py-0.5 ${
                view === option ? "bg-ink text-white" : "hover:text-ink"
              }`}
            >
              {option === "list" ? "List" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      {/* Theory and field, each broken into the kinds of material inside it.
          This is the answer to "what sort of work is this?", which a flat list
          of titles never gave. */}
      {CATEGORIES.map((category) => {
        const inCategory = results.filter(
          (item) => itemCategory(item) === category.id
        );
        if (inCategory.length === 0) return null;

        const groups = new Map<string, Item[]>();
        for (const item of inCategory) {
          const key = itemGroup(item);
          groups.set(key, [...(groups.get(key) ?? []), item]);
        }

        return (
          <div key={category.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between border-b border-rule pb-1">
              <p className="label">{category.label}</p>
              <span className="code tabular-nums">
                {String(inCategory.length).padStart(2, "0")}
              </span>
            </div>
            <p className="text-[11px] text-ink-muted">{category.blurb}</p>

            {[...groups.entries()].map(([groupName, groupItems]) => (
              <div key={groupName} className="flex flex-col">
                <p className="mt-1.5 text-[11px] font-medium text-ink-secondary">
                  {groupName} &middot; {groupItems.length}
                </p>
                {view === "list" ? (
                  <ul className="-mx-2 flex flex-col">
                    {groupItems.map((item) => (
                      <li key={item.id}>
                        <button
                          onClick={() => onSelect(item)}
                          className="press w-full truncate rounded-lg px-2 py-1.5 text-left text-[13px] text-neutral-800 hover:bg-neutral-900/[0.05]"
                        >
                          {item.title || "Untitled"}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    {groupItems.map((item) => {
                      const image = galleryImage(item.media);
                      const color = layerColor(item.layer_id);
                      return (
                        <button
                          key={item.id}
                          onClick={() => onSelect(item)}
                          title={item.title || "Untitled"}
                          className="press flex flex-col overflow-hidden border border-ink/50 bg-card text-left"
                        >
                          {/* Same plate as the map's gallery card - picture,
                              rule, caption - so an item looks the same object
                              wherever it is met. */}
                          {image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={image}
                              alt=""
                              className="aspect-square w-full object-cover"
                            />
                          ) : (
                            <span
                              className="flex aspect-square w-full items-center justify-center"
                              style={{ background: `${color}1f` }}
                            >
                              <ItemMark type={item.type} color={color} size={22} />
                            </span>
                          )}
                          <span
                            className="block w-full shrink-0"
                            style={{ height: 2, background: "rgba(0,0,0,0.8)" }}
                          />
                          <span className="truncate px-1 py-1 text-[10px] font-medium leading-none text-ink">
                            {item.title || "Untitled"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}

      {results.length === 0 && (
        <p className="text-[13px] text-ink-muted">Nothing matches.</p>
      )}
    </div>
  );
}

function ItemCard({
  item,
  narration,
  layerName,
  className,
}: {
  item: Item;
  narration: string | null;
  layerName: string | null;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-2.5 border-t border-rule px-4 pb-6 pt-4 ${className ?? ""}`}
    >
      {/* The guide's voice, set apart from the item's own content. */}
      {narration && (
        <p className="border-l-2 border-neutral-900/20 pl-3 text-[14px] leading-relaxed text-neutral-700">
          {narration}
        </p>
      )}

      {layerName && (
        <p className="label">
          {layerName}
        </p>
      )}

      {/* Larger text wants tighter tracking and leading; body stays near 0. */}
      <h2 className="text-[19px] font-semibold leading-[1.15] tracking-[-0.02em]">
        {item.title || "Untitled"}
      </h2>

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
              className="w-full rounded-md border border-rule"
            />
          );
        }
        if (m.type === "audio") {
          return <audio key={i} controls src={m.url} className="w-full" />;
        }
        if (m.type === "video") {
          return (
            <video key={i} controls src={m.url} className="w-full rounded-md" />
          );
        }
        return <PublicEmbeddedLink key={i} url={m.url} />;
      })}

      {item.body && (
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-700">
          {item.body}
        </p>
      )}

      {(item.date_start || (item.tags && item.tags.length > 0)) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {item.date_start && (
            <span className="text-[12px] tabular-nums text-neutral-500">
              {item.date_start}
            </span>
          )}
          {item.tags?.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-ink/[0.06] px-2 py-0.5 text-[11px] text-ink-secondary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
