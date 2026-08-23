"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Layer = { id: string; name: string; color: string | null };
type Item = {
  id: string;
  layer_id: string | null;
  title: string | null;
  body: string | null;
  media: { url: string; type: string }[] | null;
  geometry: { type: string; coordinates: [number, number] };
};
type Project = {
  id: string;
  name: string;
  base_map_image_url: string | null;
  base_map_bounds: [[number, number], [number, number]] | null;
};

type ActionResult = { error?: string; success?: boolean };
type BoundAction = (
  prevState: ActionResult,
  formData: FormData
) => Promise<ActionResult>;

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const DEFAULT_CENTER: [number, number] = [34.78, 32.07]; // Tel Aviv-ish, reasonable default for Bezalel
const UNASSIGNED_COLOR = "#737373";

export function MapEditor({
  project,
  layers,
  items,
  createLayerAction,
  deleteLayerAction,
  createItemAction,
  deleteItemAction,
  setBaseMapAction,
  clearBaseMapAction,
}: {
  project: Project;
  layers: Layer[];
  items: Item[];
  createLayerAction: BoundAction;
  deleteLayerAction: (layerId: string) => Promise<ActionResult>;
  createItemAction: BoundAction;
  deleteItemAction: (itemId: string) => Promise<ActionResult>;
  setBaseMapAction: BoundAction;
  clearBaseMapAction: () => Promise<ActionResult>;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const [activeLayerIds, setActiveLayerIds] = useState<Set<string>>(
    new Set(layers.map((l) => l.id).concat("unassigned"))
  );
  const [placing, setPlacing] = useState(false);
  const [pendingCoords, setPendingCoords] = useState<[number, number] | null>(
    null
  );
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [panel, setPanel] = useState<"layers" | "basemap" | null>("layers");

  const layerColor = (layerId: string | null) =>
    layers.find((l) => l.id === layerId)?.color || UNASSIGNED_COLOR;

  // Initialize map once.
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: OSM_STYLE,
      center: DEFAULT_CENTER,
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

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
      map.addLayer({
        id: "base-map-overlay",
        type: "raster",
        source: "base-map-overlay",
        paint: { "raster-opacity": 0.85 },
      });
    };

    if (map.isStyleLoaded()) applyOverlay();
    else map.once("load", applyOverlay);
  }, [project.base_map_image_url, project.base_map_bounds]);

  // Click-to-place handling.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (!placing) return;
      setPendingCoords([e.lngLat.lng, e.lngLat.lat]);
      setPlacing(false);
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [placing]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      map.getCanvas().style.cursor = placing ? "crosshair" : "";
    }
  }, [placing]);

  // Render item markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existingIds = new Set(items.map((i) => i.id));
    for (const [id, marker] of markersRef.current) {
      if (!existingIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const item of items) {
      const visible = activeLayerIds.has(item.layer_id ?? "unassigned");
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
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          setSelectedItem(item);
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
  }, [items, activeLayerIds, layers]);

  // Marker for a pending new-item placement.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pendingCoords) return;

    const el = document.createElement("div");
    el.style.width = "16px";
    el.style.height = "16px";
    el.style.borderRadius = "50%";
    el.style.border = "2px dashed #111";
    el.style.background = "rgba(0,0,0,0.1)";

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(pendingCoords)
      .addTo(map);

    return () => {
      marker.remove();
    };
  }, [pendingCoords]);

  function toggleLayer(id: string) {
    setActiveLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
        </div>

        <div className="absolute bottom-3 left-3 flex gap-2">
          <button
            onClick={() => setPlacing((p) => !p)}
            className={`rounded px-3 py-2 text-sm font-medium shadow ${
              placing ? "bg-black text-white" : "bg-white text-black"
            }`}
          >
            {placing ? "Click the map to place…" : "+ Add item"}
          </button>
        </div>
      </div>

      <aside className="flex w-80 flex-col overflow-y-auto border-l border-neutral-200 bg-white">
        <div className="flex border-b border-neutral-200 text-sm">
          <button
            onClick={() => setPanel("layers")}
            className={`flex-1 py-2 ${panel === "layers" ? "font-semibold" : "text-neutral-400"}`}
          >
            Layers
          </button>
          <button
            onClick={() => setPanel("basemap")}
            className={`flex-1 py-2 ${panel === "basemap" ? "font-semibold" : "text-neutral-400"}`}
          >
            Base map
          </button>
        </div>

        {panel === "layers" && (
          <LayerPanel
            layers={layers}
            activeLayerIds={activeLayerIds}
            onToggle={toggleLayer}
            createLayerAction={createLayerAction}
            deleteLayerAction={deleteLayerAction}
          />
        )}

        {panel === "basemap" && (
          <BaseMapPanel
            project={project}
            setBaseMapAction={setBaseMapAction}
            clearBaseMapAction={clearBaseMapAction}
          />
        )}

        {pendingCoords && (
          <NewItemForm
            coords={pendingCoords}
            layers={layers}
            createItemAction={createItemAction}
            onDone={() => setPendingCoords(null)}
            onCancel={() => setPendingCoords(null)}
          />
        )}

        {selectedItem && (
          <ItemDetail
            item={selectedItem}
            layerName={
              layers.find((l) => l.id === selectedItem.layer_id)?.name ?? null
            }
            deleteItemAction={deleteItemAction}
            onClose={() => setSelectedItem(null)}
          />
        )}
      </aside>
    </div>
  );
}

function LayerPanel({
  layers,
  activeLayerIds,
  onToggle,
  createLayerAction,
  deleteLayerAction,
}: {
  layers: Layer[];
  activeLayerIds: Set<string>;
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
              checked={activeLayerIds.has(layer.id)}
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

function NewItemForm({
  coords,
  layers,
  createItemAction,
  onDone,
  onCancel,
}: {
  coords: [number, number];
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

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 border-t border-neutral-200 p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        New item — {coords[1].toFixed(5)}, {coords[0].toFixed(5)}
      </p>
      <input type="hidden" name="lng" value={coords[0]} />
      <input type="hidden" name="lat" value={coords[1]} />

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
        placeholder="Notes, quote, reflection…"
        className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />
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
      <input type="file" name="image" accept="image/*" className="text-sm" />

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
  layerName,
  deleteItemAction,
  onClose,
}: {
  item: Item;
  layerName: string | null;
  deleteItemAction: (itemId: string) => Promise<ActionResult>;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-neutral-200 p-4">
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {layerName ?? "No layer"}
        </p>
        <button onClick={onClose} className="text-sm text-neutral-400">
          ✕
        </button>
      </div>
      <h3 className="text-base font-medium">{item.title}</h3>
      {item.media?.[0]?.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.media[0].url}
          alt={item.title ?? ""}
          className="rounded"
        />
      )}
      {item.body && (
        <p className="whitespace-pre-wrap text-sm text-neutral-700">
          {item.body}
        </p>
      )}
      <form
        action={async () => {
          await deleteItemAction(item.id);
          onClose();
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
