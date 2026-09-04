"use client";

import { useEffect, useState } from "react";
import type * as maplibregl from "maplibre-gl";
import { videoThumbnail } from "@/lib/embed";

/**
 * The gallery view: every item visible on the map gets a card in the margins,
 * with a leader line back to its point.
 *
 * Shared by the editor and the public viewer. The two hold items in different
 * shapes, so the hook takes a normalised list - id, title, picture, colour and
 * position - and each caller maps its own items into it. Keeping one
 * implementation is what stops the published gallery drifting from the one it
 * was arranged in.
 */

// A card is a square picture, a rule, then the title underneath - so its
// width is the picture's and its height is picture plus caption.
export const LABEL_IMAGE_SIZE = 160;
const LABEL_CAPTION_HEIGHT = 30;
const LABEL_CARD_HEIGHT = LABEL_IMAGE_SIZE + LABEL_CAPTION_HEIGHT;
// Enough gap that neighbouring cards read as separate rather than as a strip.
const LABEL_ROW_HEIGHT = LABEL_CARD_HEIGHT + 10;
export const LABEL_MARGIN = LABEL_IMAGE_SIZE + 24;

/**
 * The picture that represents an item on a card: its own photo if it has one,
 * otherwise a video still, so link-and-video items aren't all reduced to
 * blank tiles. Anything left over falls through to the document mark.
 */
export function galleryImage(
  media: { url: string; type: string }[] | null | undefined
): string | null {
  const photo = media?.find((m) => m.type === "image")?.url;
  if (photo) return photo;
  for (const entry of media ?? []) {
    const still = videoThumbnail(entry.url);
    if (still) return still;
  }
  return null;
}

export type GalleryEntry = {
  id: string;
  title: string;
  /** Chooses the mark shown when there is no picture. */
  type: string;
  image: string | null;
  color: string;
  lngLat: [number, number];
};

export type LabelPlacement = {
  id: string;
  title: string;
  type: string;
  image: string | null;
  color: string;
  side: "left" | "right";
  pointX: number;
  pointY: number;
  labelY: number;
  labelX: number;
};

/**
 * How many cards fit down one side.
 *
 * At this card size the limit is the window, not a taste judgement, so it is
 * measured rather than fixed: a short window would otherwise stack cards on
 * top of each other, and a tall one would leave room going unused.
 */
function maxLabelsPerSide(height: number) {
  return Math.max(1, Math.floor(height / LABEL_ROW_HEIGHT));
}

/**
 * Place a column of cards down one margin.
 *
 * Each one wants to sit level with its own point; where two would collide the
 * lower one is pushed down, which is what makes the leader lines fan out
 * instead of converging into an unreadable bundle.
 */
function stackLabels(
  entries: Omit<LabelPlacement, "labelY" | "labelX">[],
  height: number,
  labelX: number
): LabelPlacement[] {
  const sorted = [...entries].sort((a, b) => a.pointY - b.pointY);
  const half = LABEL_ROW_HEIGHT / 2;

  let previousBottom = -Infinity;
  const laid = sorted.map((entry) => {
    const y = Math.max(entry.pointY, previousBottom + LABEL_ROW_HEIGHT);
    previousBottom = y;
    return { ...entry, labelY: y, labelX };
  });
  if (laid.length === 0) return laid;

  // Clamping each card to the bottom edge as it was laid out piled them on top
  // of each other down there. Instead the column keeps its spacing and slides
  // up as a whole, as far as the top edge allows.
  const overflow = laid[laid.length - 1].labelY + half - height;
  const shift = Math.min(
    Math.max(0, overflow),
    Math.max(0, laid[0].labelY - half)
  );
  return shift === 0
    ? laid
    : laid.map((l) => ({ ...l, labelY: l.labelY - shift }));
}

/**
 * Lay the margin cards out for whatever is currently on screen.
 *
 * Recomputed on every map move, so it's throttled to one pass per frame -
 * `move` fires far faster than React can usefully re-render, and each pass
 * projects every visible item.
 */
export function useMarginLabels(
  mapRef: { current: maplibregl.Map | null },
  entries: GalleryEntry[],
  enabled: boolean
): LabelPlacement[] {
  const [labels, setLabels] = useState<LabelPlacement[]>([]);

  // Only the identity of what's on screen matters to the layout, so this keeps
  // the effect from re-subscribing on every parent render.
  const signature = entries
    .map((e) => `${e.id}:${e.image ?? ""}:${e.color}`)
    .join("|");

  useEffect(() => {
    const map = mapRef.current;
    // Nothing to lay out when the view is off; the overlay isn't rendered then
    // either, so stale entries in state are never shown.
    if (!map || !enabled) {
      setLabels([]);
      return;
    }

    let frame = 0;
    const compute = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const canvas = map.getCanvas();
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        const onScreen = entries
          .map((entry) => ({ entry, point: map.project(entry.lngLat) }))
          // Only label what the reader can actually see; a leader line to a
          // point off the edge of the map points at nothing.
          .filter(
            ({ point }) =>
              point.x >= 0 &&
              point.x <= width &&
              point.y >= 0 &&
              point.y <= height
          );

        const sides = { left: [], right: [] } as Record<
          "left" | "right",
          Omit<LabelPlacement, "labelY" | "labelX">[]
        >;

        for (const { entry, point } of onScreen) {
          const side = point.x < width / 2 ? "left" : "right";
          sides[side].push({
            id: entry.id,
            title: entry.title,
            type: entry.type,
            image: entry.image,
            color: entry.color,
            side,
            pointX: point.x,
            pointY: point.y,
          });
        }

        // When there are too many, keep the ones nearest the vertical middle:
        // they're the ones a reader is most likely looking at.
        const cap = maxLabelsPerSide(height);
        const trim = (list: Omit<LabelPlacement, "labelY" | "labelX">[]) =>
          list.length <= cap
            ? list
            : [...list]
                .sort(
                  (a, b) =>
                    Math.abs(a.pointY - height / 2) -
                    Math.abs(b.pointY - height / 2)
                )
                .slice(0, cap);

        setLabels([
          ...stackLabels(trim(sides.left), height, LABEL_MARGIN),
          ...stackLabels(trim(sides.right), height, width - LABEL_MARGIN),
        ]);
      });
    };

    compute();
    map.on("move", compute);
    map.on("resize", compute);
    return () => {
      map.off("move", compute);
      map.off("resize", compute);
      cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature]);

  return labels;
}

/**
 * The mark shown where an item has no picture.
 *
 * A smell or a sound cannot be photographed, so those items will *usually*
 * have no picture - which makes this their normal appearance rather than a
 * fallback, and a page-with-a-turned-corner the wrong thing to show. Each
 * sense gets the organ that registers it; everything else keeps the document.
 *
 * All drawn on the same 24x24 grid in the same stroke weight, so a wall of
 * tiles reads as one set rather than as clip art.
 */
export function ItemMark({
  type,
  color,
  size = 20,
}: {
  type?: string;
  color: string;
  size?: number;
}) {
  const common = {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: color,
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (type === "sound") {
    // An ear: the outer helix, and the inner fold inside it.
    return (
      <svg {...common}>
        <path d="M6 10a6 6 0 0 1 12 0c0 2.5-1.5 3.6-2.8 4.6-1 .8-1.7 1.4-1.7 2.4a2.5 2.5 0 0 1-4.5 1.5" />
        <path d="M10 10.2a2.4 2.4 0 0 1 4.8 0c0 1.2-.7 1.9-1.5 2.5" />
      </svg>
    );
  }

  if (type === "smell") {
    // A nose in profile, filled, with scent reaching it.
    //
    // Drawn as a silhouette rather than an outline because a nose is a mass,
    // not a line: stroked versions of this read as a comma at any size below
    // about 40px. The two scent curves are what carry the meaning once the
    // nose itself is down to a few pixels - side by side against outline
    // versions, they were the difference between "smell" and "some hook".
    return (
      <svg {...common}>
        <path
          d="M14.2 5.5c.3 2.7 1 4.4 2.1 6.2.5.8.8 1.4.8 2 0 1.1-.8 1.7-2 1.7-.2 1.5-1.5 2.6-3.2 2.6-1.9 0-3.3-1.3-3.3-3 0-1.2.5-2.1 1.4-3.1 1.2-1.3 1.8-2.8 2-6.4z"
          fill={color}
          stroke="none"
        />
        <g strokeWidth={1.6}>
          <path d="M4.6 8.6c1.5-1 1.5-2.7 0-3.7" />
          <path d="M4.6 14.4c2.4-1.6 2.4-4.4 0-6" />
        </g>
      </svg>
    );
  }

  if (type === "touch") {
    // A fingerprint meeting a surface.
    //
    // The ridges alone read as an arch or a doorway; the line underneath is
    // what turns them into a finger pressing something, which is the whole
    // idea. Compared against a fingertip outline and against ridges with no
    // surface - this was the only one that survived being 22px wide.
    return (
      <svg {...common}>
        <path d="M6.5 12a5.5 5.5 0 0 1 11 0v2.5" />
        <path d="M9.5 12.2a2.5 2.5 0 0 1 5 0v3" />
        <path d="M12 11.8v5.6" />
        <path d="M5 20.5h14" />
      </svg>
    );
  }

  return <DocumentMark color={color} size={size} />;
}

/**
 * A page with a turned corner and a couple of ruled lines. Drawn in the
 * layer's own colour so an item with no picture still reads as belonging to
 * its layer at thumbnail size, where the only other cue would be the tile's
 * tint.
 */
export function DocumentMark({
  color,
  size = 20,
}: {
  color: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z" />
      <path d="M14 3v4.5h4.5" />
      <path d="M9 13h6M9 16.5h4" />
    </svg>
  );
}

export function MarginLabels({
  labels,
  onSelect,
}: {
  labels: LabelPlacement[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className="absolute inset-0 h-full w-full">
        {labels.map((l) => {
          // A short horizontal shoulder before the diagonal, so the line reads
          // as leaving the card rather than striking through it.
          const shoulder = l.side === "left" ? l.labelX + 10 : l.labelX - 10;
          return (
            <g key={l.id}>
              <path
                d={`M ${l.labelX} ${l.labelY} L ${shoulder} ${l.labelY} L ${l.pointX} ${l.pointY}`}
                fill="none"
                stroke={l.color}
                strokeWidth={1}
                strokeOpacity={0.5}
              />
              <circle cx={l.pointX} cy={l.pointY} r={2.5} fill={l.color} />
            </g>
          );
        })}
      </svg>

      {labels.map((l) => (
        <button
          key={l.id}
          data-card=""
          onClick={() => onSelect(l.id)}
          style={{
            top: l.labelY,
            [l.side]: 8,
            width: LABEL_IMAGE_SIZE,
            border: "1px solid rgba(0,0,0,0.5)",
          }}
          className="press pointer-events-auto absolute flex -translate-y-1/2 flex-col overflow-hidden bg-card text-left"
        >
          {l.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={l.image}
              alt=""
              draggable={false}
              style={{ height: LABEL_IMAGE_SIZE, width: LABEL_IMAGE_SIZE }}
              className="block object-cover"
            />
          ) : (
            // A document mark rather than an empty tile: an item with no
            // picture still has something to say, and a blank square reads as
            // a thumbnail that failed to load.
            <span
              className="flex items-center justify-center"
              style={{
                height: LABEL_IMAGE_SIZE,
                width: LABEL_IMAGE_SIZE,
                background: `${l.color}1f`,
              }}
            >
              <ItemMark type={l.type} color={l.color} size={40} />
            </span>
          )}
          {/* The rule is the card's whole structure - it separates picture from
              caption and squares the whole thing off. Kept near-black rather
              than the layer colour so every card rules the same way. */}
          <span
            className="block w-full shrink-0"
            style={{ height: 2, background: "rgba(0,0,0,0.8)" }}
          />
          <span
            className="flex items-center truncate px-2 text-[12px] font-medium leading-none text-ink"
            style={{ height: LABEL_CAPTION_HEIGHT }}
          >
            {l.title}
          </span>
        </button>
      ))}
    </div>
  );
}
