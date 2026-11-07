"use client";

import { useEffect, useState } from "react";
import type * as maplibregl from "maplibre-gl";
import type { PerimeterRing } from "@/lib/perimeter";

/**
 * The sources that have no place.
 *
 * Some material a group gathers is not anywhere: an article about urban
 * renewal, a planning report, a note on method. Until now the only way to
 * record one was to invent a coordinate for it, and an invented coordinate is
 * worse than no record at all, because nothing on the screen says it was
 * invented. Twelve articles dropped around one street read as twelve findings
 * standing in it.
 *
 * So they are kept with no coordinate, and drawn beside the map instead of on
 * it: a column stepping down from the outside of the perimeter's bottom-right
 * corner, in the order the group gathered them. That is the oldest convention
 * a map sheet has - the margin, where the legend and the sources have always
 * lived, and which nobody has ever read as part of the territory.
 *
 * Two rules hold it up.
 *
 * The column is laid out in screen pixels against the projected corner, not
 * at spaced coordinates. Coordinates would scatter the stack at every zoom,
 * and - because the perimeter is derived from the items - a stored position
 * at its corner would push the corner out, which would push the stack out
 * again.
 *
 * And the position is never written down. A row keeps a null geometry, so
 * anything else that opens this project - a GeoJSON export, QGIS - sees no
 * location, which is the truth. Writing the corner into the row would put a
 * tight cluster of points at one spot and call it evidence.
 */

export type MarginEntry = {
  id: string;
  title: string;
  color: string;
};

/** Side of the perimeter's corner, in pixels, and the step between marks. */
const GUTTER = 18;
const STEP = 22;
/** Below the corner, so the first mark clears the perimeter's own line. */
const DROP = 14;
/**
 * How much room the column needs to its right, and how close to any edge it
 * may come. A mark is left-aligned on its anchor with its title running out
 * from it, so the anchor needs a label's width of canvas ahead of it.
 */
const COLUMN_WIDTH = 188;
const EDGE = 8;
/** Half a mark's height: a mark is centred on its anchor, not hung below it. */
const HALF = 11;
/**
 * Kept clear at the foot of the canvas for the drawing tools. They sit in the
 * bottom-left, which the column no longer shares, but a label level with them
 * still reads as part of that row rather than as material.
 */
const TOOLBAR = 66;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

export type MarginSlot = MarginEntry & { x: number; y: number };

/**
 * Where each unplaced item sits on screen right now.
 *
 * Recomputed on every map move - the corner is a geographic point, so it
 * travels with the map even though the column's spacing does not. Throttled
 * to one pass per frame, like the gallery's own layout: `move` fires far
 * faster than React can usefully re-render.
 */
export function useMarginColumn(
  mapRef: { current: maplibregl.Map | null },
  entries: MarginEntry[],
  perimeter: PerimeterRing | null
): MarginSlot[] {
  const [slots, setSlots] = useState<MarginSlot[]>([]);

  const signature = entries.map((e) => `${e.id}:${e.color}`).join("|");
  const corner = perimeter ? `${perimeter[1][0]},${perimeter[1][1]}` : "";

  useEffect(() => {
    const map = mapRef.current;
    if (!map || entries.length === 0) {
      setSlots([]);
      return;
    }

    let frame = 0;
    const compute = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const canvas = map.getCanvas();
        // perimeter[1] is the ring's south-east corner: the rectangle is
        // built [SW, SE, NE, NW, SW]. The column hangs off the right-hand
        // side, which is the margin a Hebrew reader meets first, and which
        // leaves the bottom-left to the drawing tools.
        //
        // A project whose only material so far is unplaced has no perimeter
        // to hang off - and that is exactly the project where losing the
        // column would be worst, because nothing else is on the map either.
        // It falls back to the lower right of the view.
        const at = perimeter
          ? { x: map.project(perimeter[1]).x + GUTTER, y: map.project(perimeter[1]).y + DROP }
          : {
              x: canvas.clientWidth - COLUMN_WIDTH - 32,
              y: canvas.clientHeight - 60 - (entries.length - 1) * STEP,
            };

        // The corner is a geographic point, so nothing keeps it on screen -
        // and the usual case is the worst one. Opening a project fits the
        // view to its items, which leaves the perimeter filling the canvas
        // with no white space outside it to put a margin in, so the column
        // lands past the right edge and cannot even be clicked.
        //
        // So the corner is where the column wants to be, not where it has to
        // be: it is held inside the canvas, and when the corner leaves the
        // view the column stays at the edge rather than following it out.
        // Overlapping the map a little is a smaller lie than vanishing - the
        // material is still in the project either way, and a reader who
        // cannot see it has been told something false about what was
        // gathered.
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const last = (entries.length - 1) * STEP;
        const x = clamp(at.x, EDGE, width - COLUMN_WIDTH);
        const y = clamp(
          at.y,
          EDGE + HALF,
          height - TOOLBAR - HALF - last
        );

        setSlots(
          entries.map((entry, i) => ({
            ...entry,
            x,
            y: y + i * STEP,
          }))
        );
      });
    };

    compute();
    map.on("move", compute);
    map.on("resize", compute);
    return () => {
      cancelAnimationFrame(frame);
      map.off("move", compute);
      map.off("resize", compute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, corner, mapRef]);

  return slots;
}

/**
 * The column itself, drawn over the map canvas.
 *
 * Each mark is the dashed square the rest of the app uses for a coordinate
 * that is not a measurement - here with no coordinate at all behind it - and
 * carries its title beside it, because a column of identical marks in the
 * white space would be a puzzle rather than a list.
 */
export function MarginColumn({
  slots,
  selectedId,
  onSelect,
}: {
  slots: MarginSlot[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
}) {
  if (slots.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {slots.map((slot) => (
        <button
          key={slot.id}
          type="button"
          onClick={() => onSelect(slot.id)}
          style={{ left: slot.x, top: slot.y }}
          className="pointer-events-auto absolute flex max-w-[180px] -translate-y-1/2 items-center gap-2 rounded bg-paper/90 px-1.5 py-0.5 text-left"
        >
          <span
            aria-hidden
            style={{
              width: 14,
              height: 14,
              borderRadius: 2,
              border: `2px dashed ${slot.color}`,
              background: "#ffffff",
              outline:
                selectedId === slot.id ? "2px solid #23282d" : undefined,
              outlineOffset: 2,
            }}
            className="shrink-0"
          />
          <span className="truncate text-[11px] text-ink-secondary">
            {slot.title}
          </span>
        </button>
      ))}
    </div>
  );
}
