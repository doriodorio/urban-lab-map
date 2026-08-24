"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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
type Thread = { id: string; name: string; description: string | null };
type ThreadItem = {
  thread_id: string;
  item_id: string;
  order_index: number;
  narration: string | null;
};

const UNASSIGNED_COLOR = "#737373";
const DEFAULT_CENTER: [number, number] = [34.78, 32.07];

const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
    },
  },
  layers: [{ id: "base", type: "raster", source: "base" }],
};

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
  const [mode, setMode] = useState<"tour" | "explore">(
    firstThread ? "tour" : "explore"
  );
  const [threadId, setThreadId] = useState<string | null>(
    firstThread?.id ?? null
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(new Set());
  // Lifted out of ExplorePanel so the map narrows along with the result list -
  // matching the editor, where searching is what makes a dense map readable.
  const [query, setQuery] = useState("");

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

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: BASE_STYLE,
      center: DEFAULT_CENTER,
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    const markers = markersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
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
  }, [project.base_map_image_url, project.base_map_bounds]);

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
        el.style.width = "16px";
        el.style.height = "16px";
        el.style.borderRadius = "50%";
        el.style.border = "2px solid white";
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
      el.style.background = layerColor(item.layer_id);
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
  }, [items, hiddenLayerIds, query, mode, layers]);

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

        <div className="absolute left-3 top-3 max-w-[70%] rounded bg-white/95 px-3 py-2 shadow">
          <p className="text-sm font-medium">{project.name}</p>
          {project.description && (
            <p className="text-xs text-neutral-500">{project.description}</p>
          )}
        </div>
      </div>

      <aside className="flex max-h-[45vh] w-full flex-col overflow-y-auto border-t border-neutral-200 bg-white md:max-h-none md:w-96 md:border-l md:border-t-0">
        {threads.length > 0 && (
          <div className="flex border-b border-neutral-200 text-sm">
            <button
              onClick={() => setMode("tour")}
              className={`flex-1 py-2 ${mode === "tour" ? "font-semibold" : "text-neutral-400"}`}
            >
              Guided tour
            </button>
            <button
              onClick={() => setMode("explore")}
              className={`flex-1 py-2 ${mode === "explore" ? "font-semibold" : "text-neutral-400"}`}
            >
              Explore
            </button>
          </div>
        )}

        {mode === "tour" && (
          <TourPanel
            threads={threads}
            threadId={threadId}
            onThreadChange={(id) => {
              setThreadId(id);
              setStepIndex(0);
            }}
            steps={steps}
            stepIndex={stepIndex}
            onStepChange={setStepIndex}
          />
        )}

        {mode === "explore" && (
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

        {selectedItem && (
          <ItemCard
            item={selectedItem}
            narration={currentStep?.narration ?? null}
            layerName={
              layers.find((l) => l.id === selectedItem.layer_id)?.name ?? null
            }
          />
        )}
      </aside>
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
    <div className="flex flex-col gap-3 border-b border-neutral-200 p-4">
      {threads.length > 1 && (
        <select
          value={threadId ?? ""}
          onChange={(e) => onThreadChange(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
        >
          {threads.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}

      {thread && threads.length <= 1 && (
        <p className="text-sm font-medium">{thread.name}</p>
      )}
      {thread?.description && (
        <p className="text-xs text-neutral-500">{thread.description}</p>
      )}

      {steps.length === 0 ? (
        <p className="text-sm text-neutral-400">
          This tour has no stops yet.
        </p>
      ) : (
        <>
          <p className="text-xs text-neutral-400">
            Stop {stepIndex + 1} of {steps.length}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onStepChange(stepIndex - 1)}
              disabled={stepIndex === 0}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              onClick={() => onStepChange(stepIndex + 1)}
              disabled={stepIndex >= steps.length - 1}
              className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Next →
            </button>
          </div>
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
  return (
    <div className="flex flex-col gap-4 border-b border-neutral-200 p-4">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search this map…"
        className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />

      {layers.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Layers
          </p>
          {layers.map((layer) => (
            <label key={layer.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!hiddenLayerIds.has(layer.id)}
                onChange={() => onToggleLayer(layer.id)}
              />
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: layer.color ?? UNASSIGNED_COLOR }}
              />
              {layer.name}
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-xs text-neutral-400">{results.length} items</p>
        <ul className="flex max-h-64 flex-col overflow-y-auto">
          {results.slice(0, 100).map((item) => (
            <li key={item.id}>
              <button
                onClick={() => onSelect(item)}
                className="w-full truncate py-1 text-left text-sm text-blue-600 underline"
              >
                {item.title || "Untitled"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ItemCard({
  item,
  narration,
  layerName,
}: {
  item: Item;
  narration: string | null;
  layerName: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 p-4">
      {narration && (
        <p className="rounded bg-neutral-100 p-2 text-sm text-neutral-700">
          {narration}
        </p>
      )}

      {layerName && (
        <p className="text-xs uppercase tracking-wide text-neutral-400">
          {layerName}
        </p>
      )}

      <h2 className="text-base font-medium">{item.title || "Untitled"}</h2>

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
          return <video key={i} controls src={m.url} className="w-full rounded" />;
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

      {item.tags && item.tags.length > 0 && (
        <p className="text-xs text-neutral-400">{item.tags.join(" · ")}</p>
      )}
    </div>
  );
}
