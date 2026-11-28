"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TYPE_OPTIONS } from "@/lib/item-types";
import { preparePhoto } from "../photo-import";
import { linkHost } from "@/lib/embed";
import { IconConnect, IconOnMap, IconOffBoard } from "@/components/icons";
import { ProjectBar } from "@/components/project-bar";
import {
  cardHeight,
  findFreeSpot,
  DEFAULT_CARD_WIDTH as DEFAULT_WIDTH,
  type Box,
} from "@/lib/board-layout";
import type { CanvasSpot } from "./board-actions";

type Media = { url: string; type: string };
type Item = {
  id: string;
  title: string | null;
  type: string;
  body: string | null;
  attribution: string | null;
  media: Media[] | null;
  canvas: CanvasSpot | null;
  layer_id: string | null;
  geometry: unknown | null;
  located_by: string | null;
};
type ItemLink = {
  id: string;
  item_a: string;
  item_b: string;
  note: string | null;
};
type Layer = { id: string; name: string; color: string | null };
type Result = { error?: string; success?: boolean };

const MIN_SCALE = 0.15;
const MAX_SCALE = 2.5;

function typeLabel(type: string) {
  return TYPE_OPTIONS.find((t) => t.value === type)?.label ?? type;
}

/**
 * Where a connector should leave a card.
 *
 * The nearest point on the card's edge to the other end, so a line between
 * two cards meets both squarely instead of sprouting from a corner and
 * crossing the card it came from.
 */
function edgePoint(
  box: { x: number; y: number; w: number; h: number },
  towards: { x: number; y: number }
) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const scale = Math.min(
    Math.abs(dx) < 1e-6 ? Infinity : box.w / 2 / Math.abs(dx),
    Math.abs(dy) < 1e-6 ? Infinity : box.h / 2 / Math.abs(dy)
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function Board({
  projectId,
  projectName,
  items,
  links,
  layers,
  setItemCanvasAction,
  createBoardItemAction,
  createItemAction,
  createItemLinkAction,
  deleteItemLinkAction,
}: {
  projectId: string;
  projectName: string;
  items: Item[];
  links: ItemLink[];
  layers: Layer[];
  setItemCanvasAction: (
    projectId: string,
    itemId: string,
    spot: CanvasSpot | null
  ) => Promise<
    Result & {
      alsoPlaced?: { id: string; spot: CanvasSpot }[];
      truncated?: boolean;
    }
  >;
  createBoardItemAction: (
    projectId: string,
    input: {
      title: string;
      type: string;
      body: string | null;
      attribution: string | null;
      spot: CanvasSpot;
    }
  ) => Promise<Result & { id?: string }>;
  createItemAction: (
    projectId: string,
    prevState: Result,
    formData: FormData
  ) => Promise<Result>;
  createItemLinkAction: (
    projectId: string,
    itemId: string,
    otherItemId: string,
    note: string | null
  ) => Promise<Result>;
  deleteItemLinkAction: (projectId: string, linkId: string) => Promise<Result>;
}) {
  const router = useRouter();
  const surface = useRef<HTMLDivElement>(null);

  /**
   * Where every card is: the server's answer, with this session's unsaved
   * gestures laid over it.
   *
   * A card has to follow the finger at the frame rate, and a round trip per
   * pointer move would both lag and write hundreds of rows for one gesture.
   * So a drag writes here first and the row afterwards.
   *
   * Derived rather than copied once, which is the bug this replaces: seeding
   * a state variable from the props on first mount meant a card created on
   * the server existed in the database, came back in the next render, and was
   * invisible until the page was reloaded by hand - because the layer that
   * decides what is on the board had never heard of it.
   *
   * An override is dropped only when its save fails, so what is on screen
   * goes back to what is actually stored rather than quietly disagreeing with
   * it. Null means taken off the board.
   */
  const [overrides, setOverrides] = useState<Record<string, CanvasSpot | null>>(
    {}
  );
  const spots = useMemo(() => {
    const base: Record<string, CanvasSpot> = {};
    for (const item of items) {
      if (item.canvas) base[item.id] = item.canvas;
    }
    for (const [id, spot] of Object.entries(overrides)) {
      if (spot === null) delete base[id];
      else base[id] = spot;
    }
    return base;
  }, [items, overrides]);
  const [view, setView] = useState({ x: 120, y: 80, scale: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const onBoard = useMemo(
    () => items.filter((i) => spots[i.id]),
    [items, spots]
  );
  const offBoard = useMemo(
    () => items.filter((i) => !spots[i.id]),
    [items, spots]
  );
  const layerById = useMemo(
    () => new Map(layers.map((l) => [l.id, l])),
    [layers]
  );

  /**
   * Escape gets out of drawing a connection.
   *
   * It mattered less when the button said "Connect" and the way out was
   * obvious; now that it is a mark, the state is easier to enter by accident
   * and needs the exit every other tool uses. Clicking empty board still
   * cancels too.
   */
  useEffect(() => {
    if (!connectingFrom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setConnectingFrom(null);
      setPointer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connectingFrom]);

  /** What the board is already using, for finding a card somewhere clear. */
  const occupied = useMemo(
    (): Box[] =>
      onBoard.map((item) => {
        const spot = spots[item.id];
        return {
          x: spot.x,
          y: spot.y,
          w: spot.w,
          h: cardHeight(item, spot.w),
        };
      }),
    [onBoard, spots]
  );

  /** Screen pixels to board units. */
  const toBoard = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surface.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - view.x) / view.scale,
        y: (clientY - rect.top - view.y) / view.scale,
      };
    },
    [view]
  );

  const boxOf = useCallback(
    (id: string) => {
      const item = byId.get(id);
      const spot = spots[id];
      if (!item || !spot) return null;
      return { x: spot.x, y: spot.y, w: spot.w, h: cardHeight(item, spot.w) };
    },
    [byId, spots]
  );

  const save = useCallback(
    async (itemId: string, spot: CanvasSpot | null) => {
      const result = await setItemCanvasAction(projectId, itemId, spot);
      if (result.error) {
        setError(result.error);
        // Put the card back where it actually is, rather than leaving the
        // screen showing a move that did not happen.
        setOverrides((current) => {
          const next = { ...current };
          delete next[itemId];
          return next;
        });
        router.refresh();
      }
      return result;
    },
    [projectId, router, setItemCanvasAction]
  );

  // --- panning and zooming ------------------------------------------------
  const panFrom = useRef<{ x: number; y: number; vx: number; vy: number } | null>(
    null
  );

  const onSurfacePointerDown = (e: React.PointerEvent) => {
    // Only the background pans. A card handles its own pointer and stops the
    // event, so this never fires for one.
    if (e.button !== 0) return;
    setSelected(null);
    setConnectingFrom(null);
    panFrom.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onSurfacePointerMove = (e: React.PointerEvent) => {
    if (connectingFrom) setPointer(toBoard(e.clientX, e.clientY));
    const from = panFrom.current;
    if (!from) return;
    setView((v) => ({
      ...v,
      x: from.vx + (e.clientX - from.x),
      y: from.vy + (e.clientY - from.y),
    }));
  };

  const onSurfacePointerUp = () => {
    panFrom.current = null;
  };

  /** Zoom towards the cursor, so the thing under it stays under it. */
  const onWheel = (e: React.WheelEvent) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const ratio = scale / v.scale;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      return { scale, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
    });
  };

  // --- moving and resizing a card -----------------------------------------
  const dragFrom = useRef<{
    id: string;
    pointerX: number;
    pointerY: number;
    spot: CanvasSpot;
    mode: "move" | "resize";
  } | null>(null);

  const onCardPointerDown = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | "resize"
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const spot = spots[id];
    if (!spot) return;
    setSelected(id);
    dragFrom.current = {
      id,
      pointerX: e.clientX,
      pointerY: e.clientY,
      spot,
      mode,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onCardPointerMove = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    if (!from) return;
    e.stopPropagation();
    const dx = (e.clientX - from.pointerX) / view.scale;
    const dy = (e.clientY - from.pointerY) / view.scale;

    setOverrides((current) => ({
      ...current,
      [from.id]:
        from.mode === "move"
          ? { ...from.spot, x: Math.round(from.spot.x + dx), y: Math.round(from.spot.y + dy) }
          : {
              ...from.spot,
              w: Math.round(Math.min(1600, Math.max(140, from.spot.w + dx))),
            },
    }));
  };

  const onCardPointerUp = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    if (!from) return;
    e.stopPropagation();
    dragFrom.current = null;
    const spot = spots[from.id];
    // Nothing actually moved: a click to select should not write a row.
    if (spot && (spot.x !== from.spot.x || spot.y !== from.spot.y || spot.w !== from.spot.w)) {
      void save(from.id, spot);
    }
  };

  // --- connecting ----------------------------------------------------------
  const finishConnection = async (toId: string) => {
    const fromId = connectingFrom;
    setConnectingFrom(null);
    setPointer(null);
    if (!fromId || fromId === toId) return;

    const already = links.some(
      (l) =>
        (l.item_a === fromId && l.item_b === toId) ||
        (l.item_a === toId && l.item_b === fromId)
    );
    if (already) {
      setError("Those two are already connected.");
      return;
    }

    const result = await createItemLinkAction(projectId, fromId, toId, null);
    if (result.error) setError(result.error);
    else router.refresh();
  };

  const removeLink = async (linkId: string) => {
    const result = await deleteItemLinkAction(projectId, linkId);
    if (result.error) setError(result.error);
    else router.refresh();
  };

  /** A spot in the middle of what is currently on screen. */
  const spotInView = useCallback(
    (height = 180): CanvasSpot => {
      const rect = surface.current?.getBoundingClientRect();
      const centre = rect
        ? toBoard(rect.left + rect.width / 2, rect.top + rect.height / 3)
        : { x: 0, y: 0 };
      // Near the middle of what is on screen, but never on top of a card
      // that is already there: a card landing exactly under another one
      // looks like nothing happened.
      const free = findFreeSpot(occupied, {
        x: Math.round(centre.x - DEFAULT_WIDTH / 2),
        y: Math.round(centre.y),
        w: DEFAULT_WIDTH,
        h: height,
      });
      return { x: free.x, y: free.y, w: DEFAULT_WIDTH };
    },
    [toBoard, occupied]
  );

  // --- dropping things onto it --------------------------------------------
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * A name worth reading in a list, from a file or a URL.
   *
   * The filename without its extension, or the host, because a board of
   * cards called "IMG_4471" and "a1b2c3.pdf" is a board nobody can search.
   * It is only a starting point - the title is editable like any other.
   */
  const nameFor = (file: File) =>
    file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() ||
    "Untitled";

  /**
   * What was dropped, turned into an item of the right kind.
   *
   * Images go through preparePhoto, the same pipeline the camera and the
   * import panel use - scaled, HEIC converted, orientation baked in. One
   * upload path for the whole app means a photograph dropped here cannot
   * quietly be three times the size of the same photograph imported there,
   * which is exactly the drift that happened once already.
   *
   * Everything arrives unplaced. A file dragged onto a board is not a claim
   * that it was found anywhere, and the one thing this column must never do
   * is invent a location.
   */
  const dropOne = useCallback(
    async (payload: { file?: File; url?: string; text?: string }, spot: CanvasSpot) => {
      const form = new FormData();
      form.set("located_by", "unplaced");
      form.set("canvas", JSON.stringify(spot));

      if (payload.file) {
        const file = payload.file;
        form.set("title", nameFor(file));
        if (file.type.startsWith("image/")) {
          form.set("type", "image");
          try {
            const prepared = await preparePhoto(file);
            form.set("image", prepared.file);
          } catch {
            form.set("image", file);
          }
        } else if (file.type.startsWith("audio/")) {
          form.set("type", "sound");
          form.set("media_file", file);
        } else if (file.type.startsWith("video/")) {
          form.set("type", "video");
          form.set("media_file", file);
        } else {
          form.set("type", "document");
          form.set("media_file", file);
        }
      } else if (payload.url) {
        form.set("type", "link");
        form.set("title", linkHost(payload.url) ?? payload.url.slice(0, 60));
        form.set("media_url", payload.url);
        form.set("attribution", payload.url);
      } else if (payload.text) {
        const text = payload.text.trim();
        form.set("type", "text");
        // The first line names it; the whole thing is the note. A pasted
        // paragraph has no title of its own and inventing one from nowhere
        // would be worse than a truncated first line.
        form.set("title", text.split(/\r?\n/)[0].slice(0, 80) || "Note");
        form.set("body", text);
      } else {
        return;
      }

      const result = await createItemAction(projectId, {}, form);
      if (result.error) setError(result.error);
    },
    [createItemAction, projectId]
  );

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);

    const at = toBoard(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files];
    const uri = e.dataTransfer.getData("text/uri-list").trim();
    const text = e.dataTransfer.getData("text/plain").trim();

    const payloads: { file?: File; url?: string; text?: string }[] = files.length
      ? files.map((file) => ({ file }))
      : uri && /^https?:\/\//i.test(uri)
        ? [{ url: uri }]
        : text && /^https?:\/\//i.test(text)
          ? [{ url: text }]
          : text
            ? [{ text }]
            : [];

    if (!payloads.length) return;

    setBusy(
      payloads.length === 1 ? "Adding it…" : `Adding ${payloads.length} things…`
    );
    // In sequence, not at once: ten photographs through the resizer in
    // parallel is ten canvases of a phone camera's worth of pixels, which is
    // how a browser tab runs out of memory on a laptop.
    let i = 0;
    for (const payload of payloads) {
      await dropOne(payload, {
        // Cascaded, so a batch does not land as one card on top of another.
        x: Math.round(at.x - DEFAULT_WIDTH / 2 + i * 28),
        y: Math.round(at.y + i * 28),
        w: DEFAULT_WIDTH,
      });
      i += 1;
    }
    setBusy(null);
    router.refresh();
  };

  /**
   * Move the view so a set of cards is on screen together.
   *
   * Used when a card arrives with others attached: they are placed around
   * it, which can be outside what is currently in view, and "2 connected
   * cards came with it" is no use at all if the two are somewhere off the
   * left edge.
   */
  const frameOn = useCallback(
    (boxes: Box[]) => {
      const rect = surface.current?.getBoundingClientRect();
      if (!rect || !boxes.length) return;

      const left = Math.min(...boxes.map((b) => b.x));
      const top = Math.min(...boxes.map((b) => b.y));
      const right = Math.max(...boxes.map((b) => b.x + b.w));
      const bottom = Math.max(...boxes.map((b) => b.y + b.h));
      const pad = 60;

      const scale = Math.max(
        MIN_SCALE,
        Math.min(
          1,
          rect.width / (right - left + pad * 2),
          rect.height / (bottom - top + pad * 2)
        )
      );
      setView({
        scale,
        x: Math.round(rect.width / 2 - ((left + right) / 2) * scale),
        y: Math.round(rect.height / 2 - ((top + bottom) / 2) * scale),
      });
    },
    []
  );

  const pullIn = async (id: string) => {
    const item = byId.get(id);
    const spot = spotInView(item ? cardHeight(item, DEFAULT_WIDTH) : 180);
    setOverrides((current) => ({ ...current, [id]: spot }));
    setPicking(false);
    const result = await save(id, spot);

    /**
     * What came with it.
     *
     * Shown immediately rather than waiting for the reload, and announced:
     * several cards appearing from one tap is the behaviour that was asked
     * for, but unannounced it reads as a bug.
     */
    const also = result?.alsoPlaced ?? [];
    if (also.length) {
      setOverrides((current) => ({
        ...current,
        ...Object.fromEntries(also.map((c) => [c.id, c.spot])),
      }));
      setNotice(
        result?.truncated
          ? `${also.length} connected cards came with it — the near end of a longer chain.`
          : also.length === 1
            ? "A connected card came with it."
            : `${also.length} connected cards came with it.`
      );
      frameOn(
        [{ id, spot }, ...also].map((c) => {
          const card = byId.get(c.id);
          return {
            x: c.spot.x,
            y: c.spot.y,
            w: c.spot.w,
            h: card ? cardHeight(card, c.spot.w) : 180,
          };
        })
      );
    }
    router.refresh();
  };

  const takeOff = async (id: string) => {
    setOverrides((current) => ({ ...current, [id]: null }));
    setSelected(null);
    await save(id, null);
    router.refresh();
  };

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-paper">
      {/* The same bar as the map, so that the row of views is true on the
          page it points away from as well. What used to stand here - a "←
          Map" button and a "Board" label over the name - is what the Map tab
          and the underline under Board now say. */}
      <ProjectBar
        project={{ id: projectId, name: projectName }}
        view="board"
        className="z-20 shrink-0 border-b border-rule"
      >
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="press rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-paper"
        >
          New card
        </button>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="press rounded-lg border border-rule px-3 py-1.5 text-[13px]"
        >
          From the map ({offBoard.length})
        </button>
      </ProjectBar>

      {(error ?? notice) && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setNotice(null);
          }}
          className="z-20 border-b border-rule bg-card px-4 py-2 text-left text-[13px] text-ink-secondary"
        >
          {error ?? notice} — tap to dismiss
        </button>
      )}

      <div
        ref={surface}
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onSurfacePointerMove}
        onPointerUp={onSurfacePointerUp}
        onWheel={onWheel}
        onDragOver={(e) => {
          // Without preventDefault the browser navigates away to the file
          // instead, which loses the board and looks like a crash.
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dropping) setDropping(true);
        }}
        onDragLeave={(e) => {
          // Only when the pointer has actually left the surface, not when it
          // crosses from the background onto a card inside it.
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropping(false);
          }
        }}
        onDrop={onDrop}
        className={`relative flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing ${
          dropping ? "ring-2 ring-inset ring-ink/30" : ""
        }`}
        style={{
          // A grid that scales with the board, so zoom has something to read
          // against. Without it, panning an empty board feels like nothing is
          // happening.
          backgroundImage:
            "radial-gradient(circle, color-mix(in srgb, var(--ink) 12%, transparent) 1px, transparent 1px)",
          backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        {onBoard.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="display text-[18px]">Nothing on the board yet</p>
            <p className="max-w-sm text-[13px] leading-relaxed text-ink-secondary">
              This is where the material without a location lives — the
              articles, the terms, the comparisons. Make a card, or pull
              something in from the map to sit beside it.
            </p>
          </div>
        )}

        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          {/* Connections under the cards, so a line never covers a thumbnail
              and the cards stay the thing you click. */}
          <svg
            className="pointer-events-none absolute overflow-visible"
            style={{ left: 0, top: 0, width: 1, height: 1 }}
          >
            {links.map((link) => {
              const a = boxOf(link.item_a);
              const b = boxOf(link.item_b);
              if (!a || !b) return null;
              const from = edgePoint(a, {
                x: b.x + b.w / 2,
                y: b.y + b.h / 2,
              });
              const to = edgePoint(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
              const mx = (from.x + to.x) / 2;
              const my = (from.y + to.y) / 2;
              return (
                <g key={link.id}>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="var(--ink)"
                    strokeOpacity={0.35}
                    strokeWidth={2 / view.scale}
                  />
                  <circle
                    cx={mx}
                    cy={my}
                    r={9 / view.scale}
                    fill="var(--card)"
                    stroke="var(--rule)"
                    strokeWidth={1 / view.scale}
                    className="pointer-events-auto cursor-pointer"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => void removeLink(link.id)}
                  />
                  <text
                    x={mx}
                    y={my + 3.5 / view.scale}
                    textAnchor="middle"
                    fontSize={11 / view.scale}
                    fill="var(--ink-secondary)"
                    className="pointer-events-none select-none"
                  >
                    ✕
                  </text>
                </g>
              );
            })}

            {/* The line being drawn, following the pointer. */}
            {connectingFrom && pointer && boxOf(connectingFrom) && (
              <line
                x1={edgePoint(boxOf(connectingFrom)!, pointer).x}
                y1={edgePoint(boxOf(connectingFrom)!, pointer).y}
                x2={pointer.x}
                y2={pointer.y}
                stroke="var(--ink)"
                strokeOpacity={0.5}
                strokeDasharray={`${6 / view.scale} ${4 / view.scale}`}
                strokeWidth={2 / view.scale}
              />
            )}
          </svg>

          {onBoard.map((item) => {
            const spot = spots[item.id];
            const layer = item.layer_id ? layerById.get(item.layer_id) : null;
            const cover = item.media?.find((m) => m.type === "image");
            const isSelected = selected === item.id;
            const placed = item.geometry !== null;

            return (
              <div
                key={item.id}
                onPointerDown={(e) => {
                  if (connectingFrom) {
                    e.stopPropagation();
                    void finishConnection(item.id);
                    return;
                  }
                  onCardPointerDown(e, item.id, "move");
                }}
                onPointerMove={onCardPointerMove}
                onPointerUp={onCardPointerUp}
                className={`absolute flex cursor-grab flex-col overflow-hidden rounded-xl border bg-card shadow-sm active:cursor-grabbing ${
                  isSelected ? "border-ink" : "border-rule"
                } ${connectingFrom && connectingFrom !== item.id ? "ring-2 ring-ink/20" : ""}`}
                style={{ left: spot.x, top: spot.y, width: spot.w }}
              >
                <div className="flex items-center gap-1.5 border-b border-rule px-2.5 py-1.5">
                  {layer?.color && (
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: layer.color }}
                    />
                  )}
                  <span className="truncate text-[10px] uppercase tracking-wide text-ink-muted">
                    {typeLabel(item.type)}
                  </span>
                  {placed && (
                    <span
                      title="Also on the map"
                      className="ml-auto shrink-0 text-[10px] text-ink-muted"
                    >
                      on the map
                    </span>
                  )}
                </div>

                {cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cover.url}
                    alt=""
                    draggable={false}
                    className="w-full object-cover"
                    style={{ height: Math.round(spot.w * 0.62) }}
                  />
                )}

                {/* dir="auto" on each piece, not on the card: a board here
                    holds a Hebrew note beside an English citation, and a
                    direction chosen once for the whole card puts one of them
                    the wrong way round - trailing punctuation jumping to the
                    far side of the line is how it shows. Each text takes its
                    direction from its own first strong character. */}
                <div className="flex flex-col gap-1 px-2.5 py-2">
                  <p dir="auto" className="display text-[15px] leading-tight">
                    {item.title || "Untitled"}
                  </p>
                  {item.body && (
                    <div className="max-h-[220px] overflow-hidden text-[12px] leading-relaxed text-ink-secondary">
                      {/* Line by line, for two reasons that turned up in the
                          same card. A note typed as "Entrainment" and then a
                          Hebrew definition is one block whose first strong
                          character is Latin, so dir="auto" on the whole thing
                          lays the Hebrew out left to right. And a paragraph
                          holds its newlines as spaces, so a note written in
                          lines arrived as one run-on sentence. */}
                      {item.body.split(/\r?\n/).map((line, n) => (
                        <p key={n} dir="auto" className={line.trim() ? "" : "h-2"}>
                          {line}
                        </p>
                      ))}
                    </div>
                  )}
                  {item.attribution && (
                    <p dir="auto" className="truncate text-[11px] text-ink-muted">
                      {item.attribution}
                    </p>
                  )}
                </div>

                {isSelected && (
                  /* Marks rather than words. Three labelled buttons under
                     every selected card drew more attention than the card,
                     and on a board the material is supposed to be the loud
                     thing. The words survive in `title` and `aria-label`. */
                  <div className="flex items-center gap-0.5 border-t border-rule px-1.5 py-1">
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        setConnectingFrom(item.id);
                        setSelected(null);
                      }}
                      className="press grid size-7 place-items-center rounded-md text-ink-secondary hover:bg-paper hover:text-ink"
                      title="Connect this to another card"
                      aria-label="Connect this to another card"
                    >
                      <IconConnect />
                    </button>
                    <Link
                      href={`/projects/${projectId}?item=${item.id}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="press grid size-7 place-items-center rounded-md text-ink-secondary hover:bg-paper hover:text-ink"
                      title="Open this on the map"
                      aria-label="Open this on the map"
                    >
                      <IconOnMap />
                    </Link>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => void takeOff(item.id)}
                      className="press ml-auto grid size-7 place-items-center rounded-md text-ink-muted hover:bg-paper hover:text-ink"
                      title="Take it off the board. The item itself stays in the project."
                      aria-label="Take it off the board. The item itself stays in the project."
                    >
                      <IconOffBoard />
                    </button>
                  </div>
                )}

                {/* Resize handle. Bottom right, where every other tool puts
                    it, and it only widens: the height follows the content. */}
                <div
                  onPointerDown={(e) => onCardPointerDown(e, item.id, "resize")}
                  onPointerMove={onCardPointerMove}
                  onPointerUp={onCardPointerUp}
                  className="absolute bottom-0 right-0 h-4 w-4 cursor-ew-resize"
                  style={{
                    background:
                      "linear-gradient(135deg, transparent 50%, color-mix(in srgb, var(--ink) 25%, transparent) 50%)",
                  }}
                />
              </div>
            );
          })}
        </div>

        {connectingFrom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <p className="rounded-full border border-rule bg-card px-4 py-2 text-[13px] shadow-sm">
              Tap the card to connect it to — or tap the background to stop.
            </p>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-rule bg-card px-2 py-1 text-[11px] text-ink-muted">
          {Math.round(view.scale * 100)}%
        </div>

        {(dropping || busy) && (
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
            <p className="rounded-full border border-rule bg-card px-4 py-2 text-[13px] shadow-sm">
              {busy ??
                "Drop it anywhere — photographs, PDFs, recordings, or a link"}
            </p>
          </div>
        )}
      </div>

      {picking && (
        <Picker
          items={offBoard}
          onPick={(id) => void pullIn(id)}
          onClose={() => setPicking(false)}
        />
      )}

      {composing && (
        <Composer
          onCancel={() => setComposing(false)}
          onCreate={async (input) => {
            const spot = spotInView();
            const result = await createBoardItemAction(projectId, {
              ...input,
              spot,
            });
            if (result.error) {
              setError(result.error);
              return;
            }
            setComposing(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * Pulling something in from the map.
 *
 * Deliberately a search rather than a wall of everything: a project with
 * three hundred photographs would otherwise open a picker nobody can read,
 * and the reason to pull a photograph onto the board is almost always that
 * you have one particular one in mind.
 */
function Picker({
  items,
  onPick,
  onClose,
}: {
  items: Item[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const matches = items
    .filter((i) =>
      query.trim()
        ? `${i.title ?? ""} ${i.body ?? ""} ${i.attribution ?? ""}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        : true
    )
    .slice(0, 60);

  return (
    <Sheet title="Pull something in" onClose={onClose}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the project…"
        className="w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-[15px]"
      />
      <ul className="flex flex-col divide-y divide-rule">
        {matches.map((item) => {
          const cover = item.media?.find((m) => m.type === "image");
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onPick(item.id)}
                className="press flex w-full items-center gap-3 py-2 text-left"
              >
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cover.url}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="h-10 w-10 shrink-0 rounded bg-ink/[0.06]" />
                )}
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-[14px]">
                    {item.title || "Untitled"}
                  </span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {typeLabel(item.type)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {matches.length === 0 && (
          <li className="py-3 text-[13px] text-ink-secondary">
            Nothing matches. Everything else in the project is already on the
            board.
          </li>
        )}
      </ul>
    </Sheet>
  );
}

/**
 * A new card.
 *
 * The three kinds that went to the whiteboard instead of here - a source, a
 * term, a note - are the ones offered first. Everything the project can hold
 * is still in the list below them.
 */
function Composer({
  onCreate,
  onCancel,
}: {
  onCreate: (input: {
    title: string;
    type: string;
    body: string | null;
    attribution: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attribution, setAttribution] = useState("");
  const [type, setType] = useState("document");
  const [saving, setSaving] = useState(false);

  const quick = [
    { value: "document", label: "Source" },
    { value: "text", label: "Term / note" },
    { value: "quote", label: "Quote" },
  ];

  return (
    <Sheet title="New card" onClose={onCancel}>
      <div className="flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button
            key={q.value}
            type="button"
            onClick={() => setType(q.value)}
            className={`press rounded-xl border px-3 py-2 text-[13px] ${
              type === q.value
                ? "border-ink bg-ink text-paper"
                : "border-rule bg-card"
            }`}
          >
            {q.label}
          </button>
        ))}
      </div>

      <input
        autoFocus
        dir="auto"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (required)"
        className="w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-[16px]"
      />
      <textarea
        dir="auto"
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What it says, and why it matters here…"
        className="w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-[15px]"
      />
      <input
        dir="auto"
        value={attribution}
        onChange={(e) => setAttribution(e.target.value)}
        placeholder="Author, publication, year, link…"
        className="w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-[15px]"
      />
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

      <p className="text-[12px] text-ink-secondary">
        Saved without a location, which is the truth about an article. It can
        be put on the map later if it turns out to belong somewhere.
      </p>

      <button
        type="button"
        disabled={saving || !title.trim()}
        onClick={async () => {
          setSaving(true);
          await onCreate({
            title,
            type,
            body: body || null,
            attribution: attribution || null,
          });
          setSaving(false);
        }}
        className="press rounded-xl bg-ink px-4 py-3 text-[15px] font-medium text-paper disabled:opacity-60"
      >
        {saving ? "Saving…" : "Put it on the board"}
      </button>
    </Sheet>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-ink/20 sm:items-center">
      <div className="flex max-h-[80dvh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-t-2xl border border-rule bg-card p-4 sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <p className="display text-[16px]">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="press rounded-lg border border-rule px-3 py-1.5 text-[13px] text-ink-secondary"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
