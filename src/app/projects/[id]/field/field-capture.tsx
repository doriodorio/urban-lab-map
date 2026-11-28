"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { initialStyle, DEFAULT_CENTER, DEFAULT_STYLE_ID } from "@/lib/base-maps";
import { ensureRtlTextSupport } from "@/lib/rtl-text";
import { useHere, MEASURED_WITHIN_METRES, type Fix } from "@/lib/here";
import { TYPE_OPTIONS } from "@/lib/item-types";
import { ProjectBar } from "@/components/project-bar";
import { preparePhoto } from "../photo-import";

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
  | {
      kind: "photo";
      file: File;
      url: string;
      /** Bytes the camera produced, before preparePhoto shrank it. */
      cameraBytes: number;
      /** The date the photograph says it was taken, if it says. */
      exifDate: string | null;
    }
  | { kind: "sound"; file: File; url: string; seconds: number }
  | { kind: "text"; body: string };

type Stage =
  | { at: "home" }
  | { at: "preparing" }
  | { at: "recording" }
  | { at: "micFailed"; reason: string }
  | { at: "writing" }
  | { at: "details"; capture: Capture };

/** A recording in progress, owned here so that nothing can leave it running. */
type Take = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: BlobPart[];
};

/** The item type each button starts from. Changeable on the details screen. */
const TYPE_FOR: Record<Capture["kind"], string> = {
  photo: "image",
  sound: "sound",
  text: "text",
};

/**
 * Why the microphone did not open, in terms of what to do about it.
 *
 * These failures need different things from the person and only one of them
 * is helped by pressing the button again, so they are not collapsed into "not
 * allowed" - which is what the first version of this screen said to
 * everybody, including the person whose microphone was simply busy.
 */
function describeMic(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "The microphone is busy — another app or tab has it. Close that, then try again.";
    case "SecurityError":
      return "This page is not on a secure connection, so the microphone cannot be used.";
    default:
      return "The microphone could not be started on this device.";
  }
}

/** Where the operating system keeps the browser's own microphone permission. */
function devicePath(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) {
    return "Settings → Apps → your browser → Permissions → Microphone";
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return "Settings → your browser → Microphone";
  }
  return "your system's privacy settings, under Microphone";
}

/**
 * Whether it is this site that is blocked, or the browser itself.
 *
 * "Not allowed" has two causes on a phone and they live in opposite places.
 * The site can be blocked, which is undone behind the icon in the address
 * bar. Or the browser app can be missing the permission at the level of the
 * operating system - and then no prompt is ever shown, the request simply
 * fails, and nothing in the address bar will help. That is the one that
 * actually happened here, and the screen used to send people to the padlock
 * for it, where there was nothing to find.
 *
 * The browser will say whether the SITE is blocked. It cannot see the
 * operating system's answer - so a refusal, in a page the browser does not
 * consider blocked, points at the layer above. That is an inference rather
 * than a reading, and the wording says "likely" because of it.
 *
 * Firefox and Safari decline the question entirely; there the person gets
 * both places to look.
 */
async function siteMicPermission(): Promise<PermissionState | null> {
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state;
  } catch {
    return null;
  }
}

async function diagnoseMic(error: unknown): Promise<string> {
  const name = error instanceof DOMException ? error.name : "";
  if (name !== "NotAllowedError" && name !== "PermissionDeniedError") {
    return describeMic(error);
  }

  const site = await siteMicPermission();

  if (site === "denied") {
    return "This site is blocked from using the microphone. Tap the icon beside the address, then Permissions → Microphone → Allow, and try again.";
  }
  if (site === null) {
    return `The microphone was refused. Two places decide this: the icon beside the address (Permissions → Microphone), and ${devicePath()}. If the second one is off, no prompt is ever shown here.`;
  }
  // 'prompt' or 'granted': the site is not the obstacle.
  return `This site is not blocked, so your browser itself most likely has no microphone permission on this device — and then nothing is ever asked here. Open ${devicePath()}, allow it, restart the browser, and try again.`;
}

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
function placementFor(
  fix: Fix | null,
  fromPhoto: boolean,
  moved: boolean
) {
  if (fix) {
    if (!fix.measured) return "surveyed";
    return moved ? "moved" : "device";
  }
  // The camera answered where the browser would not. Its GPS is a
  // measurement in the same sense a device reading is, and the vocabulary
  // already has a word for it.
  if (fromPhoto) return moved ? "moved" : "photo";
  return "unplaced";
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
  const takeRef = useRef<Take | null>(null);

  const [stage, setStage] = useState<Stage>({ at: "home" });
  const [fix, setFix] = useState<Fix | null>(null);
  const [coords, setCoords] = useState<[number, number] | null>(null);
  /** Where the photograph's own GPS says it was taken, when it carries one. */
  const [photoCoords, setPhotoCoords] = useState<[number, number] | null>(null);
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
    setPhotoCoords(null);
    setMoved(false);
    locate();
  }, [clearError, locate]);

  /**
   * Put a photograph from the camera through the same pipeline the editor
   * uses, instead of uploading whatever the camera produced.
   *
   * This screen was sending the file up untouched, and it showed: the four
   * photographs taken through it came in at 1.4 to 2.4 MB, against about
   * 0.9 MB for the same kind of picture imported at a desk - one of them the
   * second largest object in the whole bucket. Since this screen is where
   * fieldwork will now arrive from, that was the leak.
   *
   * preparePhoto scales to the long edge the project settled on, bakes in the
   * EXIF orientation so portrait photographs are not stored on their side,
   * and converts HEIC - which Chrome and Firefox cannot display at all, so an
   * iPhone photograph uploaded raw is a broken image for most readers.
   *
   * It also reads the photograph's own GPS, and that is worth having here:
   * when the browser's geolocation has failed or is still thinking, the
   * camera may already know where it stood.
   *
   * If any of it fails the original is uploaded as it is. The capture is the
   * part that cannot be repeated; a large file is a far smaller loss than a
   * lost one.
   */
  const takePhoto = useCallback(
    async (file: File) => {
      setStage({ at: "preparing" });

      let ready: File = file;
      let exifDate: string | null = null;
      try {
        const prepared = await preparePhoto(file);
        ready = prepared.file;
        exifDate = prepared.date;
        if (prepared.coordinates) {
          const at = prepared.coordinates;
          setPhotoCoords(at);
          // Only where nothing better exists: a reading taken by pressing the
          // button belongs to this moment, and the photograph's may not.
          setCoords((current) => current ?? at);
        }
      } catch {
        // HEIC conversion is the one that throws. Upload the original.
      }

      setStage({
        at: "details",
        capture: {
          kind: "photo",
          file: ready,
          url: URL.createObjectURL(ready),
          cameraBytes: file.size,
          exifDate,
        },
      });
    },
    []
  );

  /** Hand the microphone back. Called on every way out of a recording. */
  const releaseMic = useCallback(() => {
    const take = takeRef.current;
    if (!take) return;
    if (take.recorder.state === "recording") {
      take.recorder.onstop = null;
      take.recorder.stop();
    }
    take.stream.getTracks().forEach((t) => t.stop());
    takeRef.current = null;
  }, []);

  /**
   * Ask for the microphone from inside the tap, and only then for the
   * position.
   *
   * Two reasons, both of them things that went wrong on a real phone. A
   * browser grants a permission prompt to a gesture, and the request used to
   * happen in an effect a render later, by which time the tap no longer
   * counted for it. And the position was requested in the same instant as the
   * microphone - a browser shows one permission prompt at a time and refuses
   * the second outright, so asking for both at once is asking to be refused.
   *
   * Recording also begins here rather than on the next screen, which is what
   * the first seconds of a passing bus are worth.
   */
  const startRecording = useCallback(async () => {
    setSavedTitle(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStage({
        at: "micFailed",
        reason: "This browser cannot record audio.",
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.start();
      takeRef.current = { recorder, stream, chunks };
      setStage({ at: "recording" });
      beginCapture();
    } catch (error) {
      setStage({ at: "micFailed", reason: await diagnoseMic(error) });
    }
  }, [beginCapture]);

  const finishRecording = useCallback(
    (seconds: number) => {
      const take = takeRef.current;
      if (!take || take.recorder.state !== "recording") return;

      take.recorder.onstop = () => {
        const type = take.recorder.mimeType || "audio/webm";
        const blob = new Blob(take.chunks, { type });
        // The extension matters: the upload names the stored object from it,
        // and a recording saved as .bin is one nothing will offer to play.
        const file = new File([blob], `recording.${extensionFor(type)}`, {
          type,
        });
        take.stream.getTracks().forEach((t) => t.stop());
        takeRef.current = null;
        setStage({
          at: "details",
          capture: {
            kind: "sound",
            file,
            url: URL.createObjectURL(blob),
            seconds,
          },
        });
      };
      take.recorder.stop();
    },
    []
  );

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

  // Leaving the page must never leave the microphone open.
  useEffect(() => releaseMic, [releaseMic]);

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

  const goHome = useCallback(() => {
    releaseMic();
    setStage((current) => {
      if (current.at === "details" && current.capture.kind !== "text") {
        URL.revokeObjectURL(current.capture.url);
      }
      return { at: "home" };
    });
    setFix(null);
    setCoords(null);
    setPhotoCoords(null);
    setMoved(false);
  }, [releaseMic]);

  const onSaved = useCallback(
    (title: string) => {
      goHome();
      setSavedTitle(title);
    },
    [goHome]
  );

  return (
    <div className="relative flex h-dvh w-full flex-col bg-paper">
      {/* The same bar as everywhere else in the project. The "Full map" link
          that used to sit here is the Map tab now, and the "In the field"
          label over the name is the underline under Field. */}
      <ProjectBar
        project={{ id: projectId, name: projectName }}
        view="field"
        className="shrink-0 border-b border-rule"
      />

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
          e.target.value = "";
          void takePhoto(file);
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
          onSound={startRecording}
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
          fromPhoto={photoCoords !== null}
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
          onDiscard={goHome}
        />
      )}

      {stage.at === "preparing" && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-paper px-6">
          <span
            aria-hidden
            className="h-4 w-4 animate-pulse rounded-full bg-ink/30"
          />
          <p className="text-[14px] text-ink-secondary">Preparing the photo…</p>
          <p className="max-w-xs text-center text-[12px] text-ink-muted">
            An iPhone photograph is converted here, which takes a few seconds
            the first time.
          </p>
        </div>
      )}

      {stage.at === "recording" && (
        <Recorder onStop={finishRecording} onCancel={goHome} />
      )}

      {stage.at === "micFailed" && (
        <MicFailed
          reason={stage.reason}
          onRetry={startRecording}
          onBack={goHome}
        />
      )}

      {stage.at === "writing" && (
        <Writer
          onDone={(body) =>
            setStage({ at: "details", capture: { kind: "text", body } })
          }
          onCancel={goHome}
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
 * The timer, and a way to stop.
 *
 * The microphone was obtained and the recorder started before this screen
 * existed, so there is no permission to wait for here and nothing that can
 * fail. All this does is count and stop.
 */
function Recorder({
  onStop,
  onCancel,
}: {
  onStop: (seconds: number) => void;
  onCancel: () => void;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-paper px-6">
      <div className="flex flex-col items-center gap-2">
        <span aria-hidden className="h-4 w-4 animate-pulse rounded-full bg-red-600" />
        <p className="display text-[40px] tabular-nums leading-none">
          {clock(seconds)}
        </p>
        <p className="text-[13px] text-ink-secondary">Recording</p>
      </div>
      <button
        type="button"
        onClick={() => onStop(seconds)}
        className="press w-full max-w-xs rounded-xl bg-ink px-5 py-4 text-[16px] font-medium text-paper"
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
    </div>
  );
}

/**
 * The microphone did not open, and what to do about it.
 *
 * With a way to try again. The first version of this screen told people to
 * change a setting and then offered them only a way back out, which meant
 * doing as it asked led nowhere.
 */
function MicFailed({
  reason,
  onRetry,
  onBack,
}: {
  reason: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-paper px-6">
      <p className="max-w-sm text-center text-[14px] leading-relaxed text-ink-secondary">
        {reason}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="press w-full max-w-xs rounded-xl bg-ink px-5 py-4 text-[16px] font-medium text-paper"
      >
        Try again
      </button>
      <button
        type="button"
        onClick={onBack}
        className="press text-[14px] text-ink-secondary underline"
      >
        Back
      </button>
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
  fromPhoto,
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
  fromPhoto: boolean;
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

  const placement = placementFor(fix, fromPhoto, moved);
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
    if (capture.kind === "photo") {
      form.set("image", capture.file);
      // The day the photograph says it was taken. Usually today, and worth
      // keeping for the times it is not - a picture taken on the walk and
      // filed that evening, or the next morning.
      if (capture.exifDate) form.set("date_start", capture.exifDate);
    }
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
        <div className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={capture.url}
            alt=""
            className="h-32 w-full rounded-lg object-cover"
          />
          {capture.file.size < capture.cameraBytes && (
            <p className="text-[12px] text-ink-secondary">
              {Math.round(capture.cameraBytes / 1024)} KB from the camera,{" "}
              {Math.round(capture.file.size / 1024)} KB stored.
            </p>
          )}
        </div>
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
        {placement === "photo" &&
          "Your browser could not place you, but the photograph's own GPS could. Recorded as a camera reading."}
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
