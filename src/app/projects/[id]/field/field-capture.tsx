"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { initialStyle, DEFAULT_CENTER, DEFAULT_STYLE_ID } from "@/lib/base-maps";
import { ensureRtlTextSupport } from "@/lib/rtl-text";
import { useHere, MEASURED_WITHIN_METRES, type Fix } from "@/lib/here";
import { TYPE_OPTIONS } from "@/lib/item-types";

type Layer = { id: string; name: string; color: string | null };
type ActionResult = { error?: string; success?: boolean };
type BoundAction = (
  prevState: ActionResult,
  formData: FormData
) => Promise<ActionResult>;

/** Close enough that the map shows a street rather than a city. */
const STREET_ZOOM = 17;

/**
 * What was recorded, before anything has been said about it.
 *
 * The capture comes first and the describing comes second, because that is
 * the order the street happens in: the bus goes past once. A title and a
 * layer can be added while walking to the next thing, or at a table that
 * evening; the sound cannot.
 */
type Capture =
  | { kind: "photo"; file: File; url: string }
  | { kind: "sound"; file: File; url: string; seconds: number }
  | { kind: "text"; body: string };

type Stage =
  | { at: "home" }
  | { at: "recording" }
  | { at: "writing" }
  | { at: "details"; capture: Capture };

/** The item type each button starts from. Changeable on the details screen. */
const TYPE_FOR: Record<Capture["kind"], string> = {
  photo: "image",
  sound: "sound",
  text: "text",
};

/**
 * What this coordinate will claim, given how it was arrived at.
 *
 * The vocabulary is the project's own (see lib/placement.ts). The point of
 * this page is that it gets answered truthfully without putting a question to
 * somebody who is standing in traffic.
 *
 *   tight reading, untouched  -> 'device'    an instrument measured it
 *   tight reading, then moved -> 'moved'     the reading vouches for the
 *                                            material, not the spot
 *   loose reading             -> 'surveyed'  a person states they are here,
 *                                            which is true; the device just
 *                                            cannot say it to the metre
 *   no reading at all         -> 'unplaced'  nothing is invented. The item
 *                                            still exists and is drawn beside
 *                                            the map rather than on it.
 *
 * A loose reading is never written as a measurement, however carefully it is
 * corrected afterwards. That is the one line this tool does not cross: a
 * coordinate recorded as measured has to have been measured.
 */
function placementFor(fix: Fix | null, moved: boolean) {
  if (!fix) return "unplaced";
  if (!fix.measured) return "surveyed";
  return moved ? "moved" : "device";
}

function extensionFor(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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
  const cameraRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>({ at: "home" });
  const [fix, setFix] = useState<Fix | null>(null);
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [moved, setMoved] = useState(false);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);

  const takeFix = useCallback((next: Fix) => {
    setFix(next);
    setCoords(next.coordinates);
    setMoved(false);
  }, []);

  const { locate, locating, error: fixError, clearError } = useHere(takeFix);

  /**
   * Read the position at the moment the thing is captured, not when the form
   * is saved.
   *
   * Nobody presses a button called "where am I" while a bus goes past. The
   * reading is taken when the camera opens or the recorder starts, and it
   * resolves in the background during the seconds the capture takes - so by
   * the time there is a form to look at, the coordinate is usually already
   * there. Saving later from a bench two streets away still files the thing
   * where it was found.
   */
  const beginCapture = useCallback(() => {
    clearError();
    setSavedTitle(null);
    setFix(null);
    setCoords(null);
    setMoved(false);
    locate();
  }, [clearError, locate]);

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
      // Draggable on purpose. A reading lands on the wrong side of a wall
      // often enough, and the alternative to correcting it here is a point
      // nobody trusts and nobody can find again. Dragging is also what
      // demotes the claim from a measurement to a moved one, so the
      // correction is recorded rather than hidden.
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

  // The map was laid out behind a panel of a different height. Without this
  // it keeps the old size and the pin sits off-centre.
  useEffect(() => {
    mapRef.current?.resize();
  }, [stage]);

  const discard = useCallback(() => {
    setStage((current) => {
      if (current.at === "details" && current.capture.kind !== "text") {
        URL.revokeObjectURL(current.capture.url);
      }
      return { at: "home" };
    });
    setFix(null);
    setCoords(null);
    setMoved(false);
  }, []);

  const onSaved = useCallback((title: string) => {
    setStage((current) => {
      if (current.at === "details" && current.capture.kind !== "text") {
        URL.revokeObjectURL(current.capture.url);
      }
      return { at: "home" };
    });
    setSavedTitle(title);
    setFix(null);
    setCoords(null);
    setMoved(false);
  }, []);

  return (
    <div className="relative flex h-dvh w-full flex-col bg-paper">
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

      <div ref={mapContainer} className="min-h-[30dvh] flex-1" />

      {/* The camera is opened by the Photo button rather than being a visible
          control of its own. capture="environment" asks for the back camera
          directly instead of a file browser, which on a phone is the
          difference between recording what is in front of you and hunting
          through a gallery for it. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cancelling the camera fires this with nothing, and must leave the
          // screen exactly as it was.
          if (!file) return;
          setStage({
            at: "details",
            capture: { kind: "photo", file, url: URL.createObjectURL(file) },
          });
          e.target.value = "";
        }}
      />

      {stage.at === "home" && (
        <Home
          savedTitle={savedTitle}
          locating={locating}
          onPhoto={() => {
            beginCapture();
            cameraRef.current?.click();
          }}
          onSound={() => {
            beginCapture();
            setStage({ at: "recording" });
          }}
          onWrite={() => {
            beginCapture();
            setStage({ at: "writing" });
          }}
        />
      )}

      {stage.at === "details" && (
        <Details
          capture={stage.capture}
          layers={layers}
          fix={fix}
          coords={coords}
          moved={moved}
          locating={locating}
          fixError={fixError}
          onRetryFix={() => {
            clearError();
            locate();
          }}
          createItemAction={createItemAction}
          onSaved={onSaved}
          onDiscard={discard}
        />
      )}

      {stage.at === "recording" && (
        <Recorder
          onDone={(file, url, seconds) =>
            setStage({
              at: "details",
              capture: { kind: "sound", file, url, seconds },
            })
          }
          onCancel={discard}
        />
      )}

      {stage.at === "writing" && (
        <Writer
          onDone={(body) =>
            setStage({ at: "details", capture: { kind: "text", body } })
          }
          onCancel={discard}
        />
      )}
    </div>
  );
}

/**
 * The street's own screen: what can be recorded, and nothing about recording
 * it.
 *
 * Four things can be captured on foot and three of them are here; drawing a
 * line or an area needs two hands and a steady look at the map, so it stays
 * in the editor for now.
 */
function Home({
  savedTitle,
  locating,
  onPhoto,
  onSound,
  onWrite,
}: {
  savedTitle: string | null;
  locating: boolean;
  onPhoto: () => void;
  onSound: () => void;
  onWrite: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-lg shrink-0 flex-col gap-3 border-t border-rule bg-card p-4">
      {savedTitle && (
        <p className="rounded-lg bg-ink/[0.05] px-3 py-2 text-[13px]">
          Saved &ldquo;{savedTitle}&rdquo;. It is on the project map now.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <CaptureButton label="Photo" hint="Camera" onClick={onPhoto} />
        <CaptureButton label="Sound" hint="Record" onClick={onSound} />
        <CaptureButton label="Write" hint="A note" onClick={onWrite} />
      </div>
      <p className="text-center text-[12px] text-ink-secondary">
        {locating
          ? "Reading your position…"
          : "Your position is read while you record. Title, layer and the rest come after."}
      </p>
    </div>
  );
}

function CaptureButton({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex min-h-[72px] flex-col items-center justify-center gap-0.5 rounded-xl bg-ink px-2 py-3 text-paper"
    >
      <span className="text-[15px] font-medium">{label}</span>
      <span className="text-[11px] opacity-70">{hint}</span>
    </button>
  );
}

/**
 * Recording, and nothing else on the screen.
 *
 * It starts on its own. Reaching this screen is already the decision to
 * record, and a second button between that decision and the microphone costs
 * the first seconds of whatever was worth recording.
 */
function Recorder({
  onDone,
  onCancel,
}: {
  onDone: (file: File, url: string, seconds: number) => void;
  onCancel: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let abandoned = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (abandoned) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const recorder = new MediaRecorder(stream);
        recorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data.size) chunksRef.current.push(e.data);
        };
        recorder.start();
        setLive(true);
      } catch {
        // One message, because the three ways this fails need the same thing
        // from the person: permission, in the browser's own settings.
        setError(
          "This browser is not allowed to use the microphone. Allow it for this site, then try again."
        );
      }
    };

    void start();

    return () => {
      abandoned = true;
      // Always release the microphone. A recorder left running keeps the
      // phone's recording indicator lit, which is alarming and correct to be
      // alarmed about.
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!live) return;
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [live]);

  const stop = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;

    recorder.onstop = () => {
      const type = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      // The extension matters: the upload names the stored object from it,
      // and a recording saved as .bin is one nothing will offer to play.
      const file = new File([blob], `recording.${extensionFor(type)}`, {
        type,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onDone(file, URL.createObjectURL(blob), seconds);
    };
    recorder.stop();
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-paper px-6">
      {error ? (
        <>
          <p className="max-w-sm text-center text-[14px] text-ink-secondary">
            {error}
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="press rounded-xl border border-rule px-5 py-3 text-[15px]"
          >
            Back
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-2">
            <span
              aria-hidden
              className={`h-4 w-4 rounded-full ${
                live ? "animate-pulse bg-red-600" : "bg-ink/20"
              }`}
            />
            <p className="display text-[40px] tabular-nums leading-none">
              {clock(seconds)}
            </p>
            <p className="text-[13px] text-ink-secondary">
              {live ? "Recording" : "Asking for the microphone…"}
            </p>
          </div>
          <button
            type="button"
            onClick={stop}
            disabled={!live}
            className="press w-full max-w-xs rounded-xl bg-ink px-5 py-4 text-[16px] font-medium text-paper disabled:opacity-60"
          >
            Stop
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="press text-[14px] text-ink-secondary underline"
          >
            Throw it away
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A full screen to write on.
 *
 * The keyboard takes half a phone, so nothing else competes for the other
 * half - no map, no title field, no layer picker. Those come next.
 */
function Writer({
  onDone,
  onCancel,
}: {
  onDone: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-paper">
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="press text-[14px] text-ink-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onDone(body)}
          disabled={!body.trim()}
          className="press rounded-lg bg-ink px-4 py-2 text-[14px] font-medium text-paper disabled:opacity-60"
        >
          Done
        </button>
      </div>
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What is here, and what it is you are noticing…"
        className="flex-1 resize-none bg-paper px-4 py-4 text-[16px] leading-relaxed outline-none"
      />
    </div>
  );
}

/**
 * Everything that is said about the thing after it exists.
 *
 * Deliberately short. A title is the only required part, because an item
 * nobody can name in the list is lost whatever else is filled in, and
 * everything else here can be added at a table from the full editor.
 */
function Details({
  capture,
  layers,
  fix,
  coords,
  moved,
  locating,
  fixError,
  onRetryFix,
  createItemAction,
  onSaved,
  onDiscard,
}: {
  capture: Capture;
  layers: Layer[];
  fix: Fix | null;
  coords: [number, number] | null;
  moved: boolean;
  locating: boolean;
  fixError: string | null;
  onRetryFix: () => void;
  createItemAction: BoundAction;
  onSaved: (title: string) => void;
  onDiscard: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState(TYPE_FOR[capture.kind]);
  const [body, setBody] = useState(
    capture.kind === "text" ? capture.body : ""
  );
  const [layerId, setLayerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placement = placementFor(fix, moved);
  const bodyLabel =
    TYPE_OPTIONS.find((t) => t.value === type)?.bodyLabel ?? "Notes";

  const save = async () => {
    setSaving(true);
    setError(null);

    const form = new FormData();
    form.set("title", title.trim());
    form.set("type", type);
    form.set("body", body);
    form.set("layer_id", layerId);
    form.set("located_by", placement);
    // An unplaced item carries no coordinate at all - the absence is the
    // record, and the server refuses a geometry alongside it.
    if (coords && placement !== "unplaced") {
      form.set(
        "geometry",
        JSON.stringify({ type: "Point", coordinates: coords })
      );
    }
    if (capture.kind === "photo") form.set("image", capture.file);
    if (capture.kind === "sound") form.set("media_file", capture.file);

    const result = await createItemAction({}, form);
    if (result.success) {
      onSaved(title.trim());
    } else {
      setError(result.error ?? "Could not save this.");
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex max-h-[62dvh] w-full max-w-lg shrink-0 flex-col gap-3 overflow-y-auto border-t border-rule bg-card p-4">
      {/* What was captured, shown rather than described, so there is no doubt
          which recording is about to be filed. */}
      {capture.kind === "photo" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={capture.url}
          alt=""
          className="h-32 w-full rounded-lg object-cover"
        />
      )}
      {capture.kind === "sound" && (
        <div className="flex flex-col gap-1">
          <audio controls src={capture.url} className="w-full" />
          <p className="text-[12px] text-ink-secondary">
            {clock(capture.seconds)} recorded
          </p>
        </div>
      )}
      {capture.kind === "text" && (
        <p className="max-h-24 overflow-y-auto rounded-lg bg-ink/[0.04] px-3 py-2 text-[13px] leading-relaxed">
          {capture.body}
        </p>
      )}

      {/* The honest line about this coordinate, in the words the archive will
          keep. Shown rather than asked: the device has already answered, and
          a question here would only invite a better-sounding answer. */}
      <p className="text-[12px] text-ink-secondary">
        {placement === "device" &&
          `Measured here, to within ${fix?.accuracy} m. Recorded as a device reading.`}
        {placement === "moved" &&
          `Measured to within ${fix?.accuracy} m, then moved by hand. Recorded as moved: the reading vouches for the material, not for the spot.`}
        {placement === "surveyed" &&
          `Your device is only sure to within ${fix?.accuracy} m, wider than the ${MEASURED_WITHIN_METRES} m this tool calls a measurement. Drag the pin onto the right spot. Recorded as a stated location, not a measured one.`}
        {placement === "unplaced" &&
          (locating
            ? "Still reading your position…"
            : "No position yet. Saving now files this without a location — it will sit beside the map, not on it.")}
      </p>
      {placement === "unplaced" && !locating && (
        <div className="flex flex-col gap-1">
          {fixError && (
            <p className="text-[12px] text-ink-secondary">{fixError}</p>
          )}
          <button
            type="button"
            onClick={onRetryFix}
            className="press self-start rounded-lg border border-rule px-3 py-1.5 text-[13px]"
          >
            Try the position again
          </button>
        </div>
      )}

      <input
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What is this? (required)"
        className="w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-[16px]"
      />

      <textarea
        rows={capture.kind === "text" ? 4 : 2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={bodyLabel}
        className="w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-[16px]"
      />

      {/* The button already chose a type; this is for the times it chose the
          obvious one and the truth was a quote, a document, a smell. */}
      <select
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

      {layers.length > 0 && (
        <select
          value={layerId}
          onChange={(e) => setLayerId(e.target.value)}
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

      {error && (
        <p className="rounded-lg border border-rule px-3 py-2 text-[13px]">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={saving}
          className="press rounded-xl border border-rule px-4 py-3.5 text-[15px] text-ink-secondary"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !title.trim()}
          className="press flex-1 rounded-xl bg-ink px-4 py-3.5 text-[15px] font-medium text-paper disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save and keep walking"}
        </button>
      </div>
    </div>
  );
}
