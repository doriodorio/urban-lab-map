"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { initialStyle, DEFAULT_CENTER, DEFAULT_STYLE_ID } from "@/lib/base-maps";
import { ensureRtlTextSupport } from "@/lib/rtl-text";
import { useHere, MEASURED_WITHIN_METRES, type Fix } from "@/lib/here";
import { TYPE_OPTIONS, FIELD_FIRST_TYPES } from "@/lib/item-types";

type Layer = { id: string; name: string; color: string | null };
type ActionResult = { error?: string; success?: boolean };
type BoundAction = (
  prevState: ActionResult,
  formData: FormData
) => Promise<ActionResult>;

/** Close enough that the map shows a street rather than a city. */
const STREET_ZOOM = 17;

/**
 * What this coordinate will claim, given how it was arrived at.
 *
 * The vocabulary is the project's own (see lib/placement.ts). The point of
 * this page is that it gets answered truthfully without putting a question to
 * somebody who is standing in traffic.
 *
 *   tight reading, untouched  -> 'device'   an instrument measured it
 *   tight reading, then moved -> 'moved'    the reading no longer vouches for
 *                                           the place, only for the material
 *   loose reading             -> 'surveyed' a person states they are here,
 *                                           which is true; the device just
 *                                           cannot say it to the metre
 *
 * A loose reading is never written as a measurement, however carefully it is
 * corrected afterwards. That is the one line this tool does not cross: a
 * coordinate recorded as measured has to have been measured.
 */
function placementFor(fix: Fix | null, moved: boolean) {
  if (!fix) return null;
  if (!fix.measured) return "surveyed";
  return moved ? "moved" : "device";
}

export function FieldCapture({
  projectId,
  projectName,
  styleId,
  layers,
  createItemAction,
}: {
  projectId: string;
  projectName: string;
  styleId: string | null;
  layers: Layer[];
  createItemAction: BoundAction;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  const [fix, setFix] = useState<Fix | null>(null);
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [moved, setMoved] = useState(false);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);

  const takeFix = useCallback((next: Fix) => {
    setFix(next);
    setCoords(next.coordinates);
    setMoved(false);
    setSavedTitle(null);
  }, []);

  const { locate, locating, error: fixError, clearError } = useHere(takeFix);

  // --- the map ------------------------------------------------------------
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    // The same worker and RTL setup as the editor: without the first, vector
    // tiles never render; without the second, Hebrew street names come out
    // backwards - and on a street-name map that is the whole map.
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
    ensureRtlTextSupport();

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: initialStyle(styleId ?? DEFAULT_STYLE_ID),
      center: DEFAULT_CENTER,
      zoom: 13,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [styleId]);

  // --- the pin ------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!coords) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (!markerRef.current) {
      // Draggable on purpose. A reading can land on the wrong side of a wall,
      // and the alternative to correcting it here is a point nobody trusts
      // and nobody can find again. Dragging is also what demotes the claim
      // from a measurement to a moved one, so the correction is recorded
      // rather than hidden.
      const marker = new maplibregl.Marker({ draggable: true, color: "#1f2933" })
        .setLngLat(coords)
        .addTo(map);
      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        setCoords([lng, lat]);
        setMoved(true);
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat(coords);
    }

    map.easeTo({ center: coords, zoom: Math.max(map.getZoom(), STREET_ZOOM) });
  }, [coords]);

  // --- saving -------------------------------------------------------------
  const [title, setTitle] = useState("");
  const [type, setType] = useState("image");
  const [showAllTypes, setShowAllTypes] = useState(false);

  const wrapped: BoundAction = async (prevState, formData) => {
    const result = await createItemAction(prevState, formData);
    if (result.success) {
      setSavedTitle((formData.get("title") as string) || "Saved");
      setFix(null);
      setCoords(null);
      setMoved(false);
      setTitle("");
    }
    return result;
  };
  const [state, formAction, pending] = useActionState(wrapped, {});

  const placement = placementFor(fix, moved);
  const bodyLabel =
    TYPE_OPTIONS.find((t) => t.value === type)?.bodyLabel ?? "Notes";
  const quickTypes = TYPE_OPTIONS.filter((t) =>
    FIELD_FIRST_TYPES.includes(t.value)
  );

  return (
    <div className="flex h-dvh w-full flex-col bg-paper">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-rule bg-card px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-ink-muted">
            In the field
          </p>
          <p className="display truncate text-[15px] leading-tight">
            {projectName}
          </p>
        </div>
        <Link
          href={`/projects/${projectId}`}
          className="press shrink-0 rounded-lg border border-rule px-3 py-1.5 text-[13px] text-ink-secondary"
        >
          Full map
        </Link>
      </header>

      <div ref={mapContainer} className="min-h-[34dvh] flex-1" />

      <div className="max-h-[62dvh] shrink-0 overflow-y-auto border-t border-rule bg-card">
        {!coords ? (
          <div className="mx-auto flex w-full max-w-lg flex-col gap-3 p-4">
            {savedTitle && (
              <p className="rounded-lg bg-ink/[0.05] px-3 py-2 text-[13px]">
                Saved &ldquo;{savedTitle}&rdquo;. It is on the project map now.
              </p>
            )}
            {fixError && (
              <p className="rounded-lg border border-rule px-3 py-2 text-[13px] text-ink-secondary">
                {fixError}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                clearError();
                locate();
              }}
              disabled={locating}
              className="press w-full rounded-xl bg-ink px-4 py-4 text-[16px] font-medium text-paper disabled:opacity-60"
            >
              {locating ? "Reading your position…" : "I am here"}
            </button>
            <p className="text-center text-[12px] text-ink-secondary">
              Outdoors it takes a few seconds. Everything else about this item
              can be filled in later, at a table.
            </p>
          </div>
        ) : (
          <form action={formAction} className="mx-auto flex w-full max-w-lg flex-col gap-3 p-4">
            <input
              type="hidden"
              name="geometry"
              value={JSON.stringify({ type: "Point", coordinates: coords })}
            />
            <input type="hidden" name="located_by" value={placement ?? ""} />

            {/* The honest line about this coordinate, in the words the archive
                will keep. Shown rather than asked: the device has already
                answered, and a question here would only invite a
                better-sounding answer. */}
            <p className="text-[12px] text-ink-secondary">
              {placement === "device" &&
                `Measured here, to within ${fix?.accuracy} m. Recorded as a device reading.`}
              {placement === "moved" &&
                `Measured to within ${fix?.accuracy} m, then moved by hand. Recorded as moved: the reading vouches for the material, not for the spot.`}
              {placement === "surveyed" &&
                `Your device is only sure to within ${fix?.accuracy} m, wider than the ${MEASURED_WITHIN_METRES} m this tool calls a measurement. Drag the pin onto the right spot. Recorded as a stated location, not a measured one.`}
            </p>

            <div className="flex flex-wrap gap-1.5">
              {quickTypes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={`press rounded-xl border px-3 py-2 text-[13px] ${
                    type === t.value
                      ? "border-ink bg-ink text-paper"
                      : "border-rule bg-card"
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowAllTypes((on) => !on)}
                className="press rounded-xl border border-rule px-3 py-2 text-[13px] text-ink-secondary"
              >
                {showAllTypes ? "Fewer" : "More…"}
              </button>
            </div>
            {showAllTypes ? (
              <select
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-[15px]"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            ) : (
              <input type="hidden" name="type" value={type} />
            )}

            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What is this? (required)"
              className="w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-[16px]"
            />

            <textarea
              name="body"
              rows={3}
              placeholder={bodyLabel}
              className="w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-[16px]"
            />

            {/* capture="environment" opens the back camera straight away
                rather than a file browser. On a phone that is the difference
                between recording what is in front of you and hunting through
                a gallery for it. */}
            <label className="press flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-rule px-3 py-3 text-[14px] text-ink-secondary">
              <input
                type="file"
                name="image"
                accept="image/*"
                capture="environment"
                className="sr-only"
              />
              Take a photo
            </label>

            {layers.length > 0 && (
              <select
                name="layer_id"
                defaultValue=""
                className="w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-[15px]"
              >
                <option value="">No layer</option>
                {layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}

            {state.error && (
              <p className="rounded-lg border border-rule px-3 py-2 text-[13px]">
                {state.error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setFix(null);
                  setCoords(null);
                  setMoved(false);
                }}
                className="press rounded-xl border border-rule px-4 py-3.5 text-[15px] text-ink-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !title.trim()}
                className="press flex-1 rounded-xl bg-ink px-4 py-3.5 text-[15px] font-medium text-paper disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save and keep walking"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
