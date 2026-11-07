"use client";

import { useEffect, useState } from "react";
import type * as maplibregl from "maplibre-gl";
import type { PerimeterRing } from "@/lib/perimeter";
import { useMapInstance } from "@/lib/map-ready";

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
 * it: a strip running the full width of the perimeter, just under its bottom
 * edge, in the order the group gathered them. That is the oldest convention
 * a map sheet has - the margin, where the legend and the sources have always
 * lived, and which nobody has ever read as part of the territory.
 *
 * Two rules hold it up.
 *
 * The strip is laid out in screen pixels against the projected corners, not
 * at spaced coordinates. Coordinates would scatter the row at every zoom,
 * and - because the perimeter is derived from the items - a stored position
 * on its edge would push that edge out, which would push the row out again.
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

/** How close to any edge of the canvas the strip may come. */
const EDGE = 8;
/**
 * Kept clear at the foot of the canvas for the drawing tools, which sit in
 * the bottom-left. The strip now runs the full width of the perimeter, so it
 * crosses above them rather than beside them.
 */
const TOOLBAR = 66;
/** Paper showing around the marks, a row's height, and a mark's own width. */
const PANEL_PAD = 8;
const ROW_HEIGHT = 24;
const MARK_WIDTH = 196;
/**
 * A strip narrower than this has nowhere to put a title, which happens when
 * the perimeter itself is a sliver - a project whose material is all in one
 * street, or a view zoomed far out.
 */
const MIN_WIDTH = 220;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** Where the strip sits on screen, in canvas pixels. */
export type MarginBox = {
  left: number;
  top: number;
  width: number;
  /** True when the strip hangs below the frame's line, false when it sits
   * above it. Only the corners away from the line are rounded, so the edge
   * that touches the frame reads as joined to it. */
  below: boolean;
};

/**
 * Where the margin strip sits on screen right now.
 *
 * Recomputed on every map move - the perimeter's corners are geographic
 * points, so they travel with the map even though the strip's padding does
 * not. Throttled to one pass per frame, like the gallery's own layout: `move`
 * fires far faster than React can usefully re-render.
 */
export function useMarginColumn(
  mapRef: { current: maplibregl.Map | null },
  entries: MarginEntry[],
  perimeter: PerimeterRing | null
): MarginBox | null {
  const map = useMapInstance(mapRef);
  const [box, setBox] = useState<MarginBox | null>(null);

  const count = entries.length;
  const corners = perimeter
    ? `${perimeter[0][0]},${perimeter[0][1]}|${perimeter[1][0]},${perimeter[1][1]}`
    : "";

  useEffect(() => {
    // Nothing to subscribe to. The box is not cleared here - a hook that
    // writes state on its way out re-renders for no reason - it is withheld
    // at the return instead.
    if (!map || count === 0) return;

    let frame = 0;
    const compute = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const canvas = map.getCanvas();
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        // perimeter[0] and [1] are the ring's south-west and south-east
        // corners: the rectangle is built [SW, SE, NE, NW, SW]. The strip
        // runs between them, under the frame's bottom edge, which is where a
        // map sheet has always put its sources.
        //
        // A project whose only material so far is unplaced has no perimeter
        // to measure - and that is exactly the project where losing the strip
        // would be worst, because nothing else is on the map either. It falls
        // back to the foot of the view.
        const sw = perimeter ? map.project(perimeter[0]) : null;
        const se = perimeter ? map.project(perimeter[1]) : null;

        // The corners are geographic points, so nothing keeps them on screen,
        // and the usual case is the worst one. Opening a project fits the
        // view to its items, which leaves the perimeter filling the canvas
        // with no white space outside it to put a margin in, so the strip
        // lands past the bottom edge and cannot even be clicked.
        //
        // So the perimeter is where the strip wants to be, not where it has
        // to be: it is held inside the canvas, and when the frame leaves the
        // view the strip stays at the edge rather than following it out.
        // Overlapping the map a little is a smaller lie than vanishing - the
        // material is still in the project either way, and a reader who
        // cannot see it has been told something false about what was
        // gathered.
        const strip = clamp(
          sw && se ? se.x - sw.x : width - EDGE * 2,
          MIN_WIDTH,
          width - EDGE * 2
        );
        const perRow = Math.max(1, Math.floor(strip / MARK_WIDTH));
        const tall = Math.ceil(count / perRow) * ROW_HEIGHT + PANEL_PAD * 2;
        const floor = height - TOOLBAR - tall;

        // The strip's edge sits on the frame's bottom line, with nothing
        // between them. A gap would make it a panel floating near the frame;
        // flush, it is the frame's own footer, the way a title block belongs
        // to a drawing sheet's border rather than lying beside it.
        //
        // Below that line when there is room, and above it when there is
        // not. Opening a project fits the view to its items, so the usual
        // case is a perimeter that reaches the foot of the canvas with no
        // paper left under it - and a strip that answered by drifting upward
        // would be touching nothing at all. Inside the frame it still reads
        // as the frame's footer, because it is still on the line.
        const bottom = se ? se.y : height - TOOLBAR;
        const top = bottom <= floor ? bottom : bottom - tall;

        setBox({
          left: clamp(sw ? sw.x : EDGE, EDGE, width - strip - EDGE),
          top: clamp(top, EDGE, floor),
          width: strip,
          below: bottom <= floor,
        });
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
  }, [count, corners, map]);

  return map && count > 0 ? box : null;
}

/**
 * The strip itself, drawn over the map canvas.
 *
 * Each mark is the dashed square the rest of the app uses for a coordinate
 * that is not a measurement - here with no coordinate at all behind it - and
 * carries its title beside it, because a row of identical marks in the white
 * space would be a puzzle rather than a list.
 *
 * The marks sit on paper, not in a gap. A margin on a map sheet is part of
 * the sheet: it has an edge, and what is printed on it is read as a list
 * because the paper says so. Loose labels over the territory read instead as
 * things standing in it, faintly, which is the one reading this whole strip
 * exists to prevent. The paper is nearly opaque so street names do not run
 * through the titles.
 *
 * It runs the full width of the perimeter because that is the width of the
 * sheet. A small box tucked into one corner reads as a widget the map happens
 * to carry; a strip that spans the frame reads as the frame's own footer, and
 * says that these sources belong to this project rather than to a spot in it.
 * Marks fill it from the right, the way the rest of the project reads.
 */
export function MarginColumn({
  box,
  entries,
  selectedId,
  onSelect,
}: {
  box: MarginBox | null;
  entries: MarginEntry[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
}) {
  if (!box || entries.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        style={{ left: box.left, top: box.top, width: box.width }}
        className={`pointer-events-auto absolute flex flex-row-reverse flex-wrap items-center gap-x-5 gap-y-1 border border-rule bg-paper/95 px-2 py-2 shadow-sm backdrop-blur-[2px] ${
          box.below ? "rounded-b-md" : "rounded-t-md"
        }`}
      >
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect(entry.id)}
            className="flex max-w-[180px] items-center gap-2 rounded px-1 py-0.5 text-right"
          >
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: 2,
                border: `2px dashed ${entry.color}`,
                background: "#ffffff",
                outline:
                  selectedId === entry.id ? "2px solid #23282d" : undefined,
                outlineOffset: 2,
              }}
              className="shrink-0"
            />
            <span className="truncate text-[11px] text-ink-secondary">
              {entry.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
