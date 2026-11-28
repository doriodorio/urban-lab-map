"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
 * it: a strip as wide as the perimeter, resting on the foot of the canvas,
 * in the order the group gathered them. That is the oldest convention a map
 * sheet has - the margin, where the legend and the sources have always
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
 * Kept clear at the foot of the canvas when there is nothing down there to
 * measure - the map's own attribution line, and no more.
 */
const BARE_CLEARANCE = 44;
/** Paper between the strip and whatever sits under it. */
const FOOTER_GAP = 10;
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
  /**
   * Distance from the foot of the canvas, not a top.
   *
   * The strip wraps its marks, so how tall it is depends on how many fit on
   * a line - which the browser knows and this does not. Anchoring the bottom
   * edge means the height never has to be guessed: an over-estimate used to
   * leave it hovering above the tools with a band of map showing under it.
   */
  bottom: number;
  width: number;
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
  perimeter: PerimeterRing | null,
  /**
   * Whatever already occupies the foot of the canvas - in the editor, the
   * cluster holding the drawing tools.
   *
   * Measured rather than guessed. A constant was wrong twice in one morning:
   * once when the tools became forty-pixel squares and the strip landed on
   * top of them, and again on a phone, where that cluster sits higher to
   * clear the attribution line and a number large enough for the phone left
   * a band of dead map on the laptop. The element knows where it is.
   */
  footerRef?: { current: HTMLElement | null }
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
        const footer = footerRef?.current?.getBoundingClientRect();
        const clearance = footer
          ? Math.max(
              BARE_CLEARANCE,
              canvas.getBoundingClientRect().bottom - footer.top + FOOTER_GAP
            )
          : BARE_CLEARANCE;

        // perimeter[0] and [1] are the ring's south-west and south-east
        // corners: the rectangle is built [SW, SE, NE, NW, SW]. The strip
        // spans between them, so it is as wide as the sheet whose sources it
        // lists.
        //
        // A project whose only material so far is unplaced has no perimeter
        // to measure - and that is exactly the project where losing the strip
        // would be worst, because nothing else is on the map either. It falls
        // back to the width of the view.
        const sw = perimeter ? map.project(perimeter[0]) : null;
        const se = perimeter ? map.project(perimeter[1]) : null;

        // The corners are geographic points, so nothing keeps them on
        // screen: pan far enough and the frame leaves the view entirely.
        // The strip is held inside the canvas instead of following it out.
        // Overlapping the map a little is a smaller lie than vanishing - the
        // material is still in the project either way, and a reader who
        // cannot see it has been told something false about what was
        // gathered.
        const strip = clamp(
          sw && se ? se.x - sw.x : width - EDGE * 2,
          MIN_WIDTH,
          width - EDGE * 2
        );
        // Always at the foot of the canvas, never hanging off the frame's
        // bottom line.
        //
        // It used to follow that line, on the argument that a margin belongs
        // to the sheet it edges. The argument is right; following the line
        // was the wrong way to honour it. A fitted view centres the frame,
        // so there is a band of map under it - 87 pixels on a laptop, 241 on
        // a phone - and a strip that hangs from the line comes to rest in
        // that band, touching nothing, reading as a panel dropped over the
        // territory rather than as a list beside it.
        //
        // So the strip stays on the bottom edge, and the band is closed from
        // the other end: the opening view brings the sheet down until its
        // bottom line meets the strip (useSheetAboveMargin, below). In a
        // fitted view the two are then the same place, which is what the
        // argument wanted. Once the group pans away the line goes wherever
        // they put it, and the strip stays where a reader can find it.
        setBox({
          left: clamp(sw ? sw.x : EDGE, EDGE, width - strip - EDGE),
          bottom: clearance,
          width: strip,
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

/** Map left above the sheet's top line when it is brought down. */
const HEAD_ROOM = 24;
/** Paper between the sheet's bottom line and the strip under it. */
const SHEET_GAP = 10;
/** Below this, there is no room worth refitting a project into. */
const MIN_SHEET = 160;
/**
 * How much of the sheet the strip may cover before the view gives way.
 *
 * The perimeter adds a tenth of the content's own size as a border
 * (PADDING_RATIO in lib/perimeter.ts), so the bottom tenth of the frame is
 * empty by construction: a strip resting on it covers margin, not material.
 * Tolerating that much is not laziness. The strip is as wide as the frame,
 * so taking the view out to clear it gives the strip a narrower column, its
 * titles wrap onto another line, and it asks for the room again - chase the
 * last pixel and a short window ends up with a small sheet above a tall
 * block of sources. The overlap it stops at is invisible; that is not.
 */
const MARGIN_SHARE = 0.1;
/** Measure-and-correct passes allowed before the view is left as it is. */
const PASSES = 3;
/**
 * Milliseconds between one pass and the next measurement.
 *
 * Not a frame. A move of the camera reaches the strip through the map's own
 * `move` event, which this file throttles to a frame, then through a React
 * render, and only then is the strip laid out at its new width - so a pass
 * that measures on the next frame reads the strip the move was meant to
 * change, finds nothing to correct, and stops one correction short.
 */
const SETTLE_WAIT = 60;

/**
 * Brings the sheet down to meet its margin, once, as the project opens.
 *
 * `fitBounds` centres what it is given, so a project that does not happen to
 * share the window's proportions opens with a band of empty map under its
 * frame - and the strip of unplaced sources sits below that band, on the foot
 * of the canvas, reading as a thing of its own rather than as the frame's
 * footer. Both halves of the record are on screen and nothing says they
 * belong to each other.
 *
 * The fix is the camera, not a different strip. The view drops until the
 * frame's bottom line rests just above the strip, which costs nothing - the
 * map above the sheet is the rest of the city, which is context; the map
 * below it was the gap this closes.
 *
 * A frame that already reaches past the strip is refitted first, with the
 * strip's own room held back, so it is the view that gives way rather than
 * the sources being covered by it. That is a zoom out and never a zoom in:
 * the opening fit stops at street level on purpose, and nothing here may
 * push past it.
 *
 * Taking the view out moves the thing being aimed at, which is why this
 * settles over a few frames rather than in one. The strip is as wide as the
 * frame, so a wider view gives it a narrower strip, the titles wrap onto one
 * more line, and its top edge rises by a row - a single pass lands the sheet
 * about 25 pixels low and the strip covers the corner of it. Each pass
 * re-measures and the correction shrinks; three is enough, and the loop stops
 * as soon as the two edges are within a pixel or two of each other.
 *
 * Two things keep it from being a nuisance:
 *
 *   * It never drops further than the room above the sheet, so bringing the
 *     bottom edge in cannot push the top edge out.
 *   * It runs once, and not at all after the group has touched the map. The
 *     camera belongs to them from their first drag; a view that re-seats
 *     itself later is a view nobody can aim.
 */
export function useSheetAboveMargin(
  mapRef: { current: maplibregl.Map | null },
  perimeter: PerimeterRing | null,
  box: MarginBox | null,
  panelRef: { current: HTMLElement | null }
) {
  const map = useMapInstance(mapRef);
  const settled = useRef(false);
  const touched = useRef(false);
  /**
   * The pass in flight, held outside the effect that started it.
   *
   * Each move the settling makes re-renders the strip, which re-runs that
   * effect, and an effect's cleanup would cancel the very pass that is
   * waiting to measure the result. Only leaving the page stops it.
   */
  const pending = useRef(0);

  useEffect(() => () => clearTimeout(pending.current), []);

  const corners = perimeter
    ? `${perimeter[1][0]},${perimeter[1][1]}|${perimeter[2][0]},${perimeter[2][1]}`
    : "";

  // Only a real gesture counts. Our own jumps and the camera moves that
  // follow a search result arrive with no originalEvent, and neither is the
  // group saying where they want to be looking.
  useEffect(() => {
    if (!map) return;
    const mark = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) touched.current = true;
    };
    map.on("movestart", mark);
    return () => {
      map.off("movestart", mark);
    };
  }, [map]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!map || !perimeter || !box || !panel) return;
    if (settled.current || touched.current) return;

    // Claimed before the first measurement, not after the last: every move
    // below re-renders the strip and re-runs this effect, and a settling
    // that restarts itself never finishes.
    settled.current = true;

    let pass = 0;

    // Each pass measures a strip the browser has had time to lay out at the
    // width the pass before it left behind.
    const step = () => {
      const canvas = map.getCanvas().getBoundingClientRect();
      // Where the sheet's bottom line is being brought to: just clear of the
      // strip's own top edge, wherever the line-breaking put it.
      const want = panel.getBoundingClientRect().top - canvas.top - SHEET_GAP;

      // Almost nothing left above the strip - a short window with a long
      // list of sources. Rearranging the view around a sliver would be
      // worse than leaving it alone.
      if (want < HEAD_ROOM + MIN_SHEET) return;

      const foot = map.project(perimeter[1]).y;
      const head = map.project(perimeter[2]).y;
      const off = want - foot;
      // Covering the frame's own bottom margin is allowed; covering what is
      // inside it is not.
      const spare = Math.max(0, foot - head) * MARGIN_SHARE;
      if (pass >= PASSES) return;
      if (off < 2 && off > -spare) return;
      pass += 1;

      // The sheet reaches past the strip by more than its margin: it is the
      // view that gives way.
      if (off < 0) {
        map.fitBounds([perimeter[0], perimeter[2]], {
          padding: {
            top: HEAD_ROOM,
            bottom: canvas.height - want,
            left: HEAD_ROOM,
            right: HEAD_ROOM,
          },
          duration: 0,
        });
        pending.current = window.setTimeout(step, SETTLE_WAIT);
        return;
      }

      // Room to spare under it: bring it down, as far as the map above it
      // allows. Expressed as a new centre rather than a pan by pixels - the
      // point `drop` above the middle becomes the middle, so everything,
      // the sheet with it, moves down by exactly that much.
      const drop = Math.min(off, Math.max(0, head - HEAD_ROOM));
      if (drop < 1) return;
      map.jumpTo({
        center: map.unproject([canvas.width / 2, canvas.height / 2 - drop]),
      });
      // A pan leaves the frame the width it was, so the strip wraps the same
      // way and there is nothing left to correct unless the headroom cut the
      // drop short - in which case there is nothing to be done either.
      if (drop < off - 1) return;
      pending.current = window.setTimeout(step, SETTLE_WAIT);
    };

    pending.current = window.setTimeout(step, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, corners, box]);
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
  boardHref,
  panelRef,
}: {
  box: MarginBox | null;
  entries: MarginEntry[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  /**
   * The strip's own element, for whoever needs to know how tall it came out.
   *
   * It wraps, so its height is a fact about the browser's line-breaking, not
   * something this file can work out - and the opening view has to clear it.
   */
  panelRef?: React.Ref<HTMLDivElement>;
  /**
   * Where this strip leads, when it leads anywhere.
   *
   * The strip is what the material without a location gets instead of a pin,
   * and a strip is somewhere to put a leftover rather than somewhere to work.
   * So it is also the door to the board, where that material can actually be
   * arranged and joined up. Absent in the published view, which has nothing
   * to arrange.
   */
  boardHref?: string;
}) {
  if (!box || entries.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        ref={panelRef}
        style={{ left: box.left, bottom: box.bottom, width: box.width }}
        className="pointer-events-auto absolute flex flex-row-reverse flex-wrap items-center gap-x-5 gap-y-1 rounded-t-md border border-rule bg-paper/95 px-2 py-2 shadow-sm backdrop-blur-[2px]"
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

        {boardHref && (
          <Link
            href={boardHref}
            className="press ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink"
          >
            Open the board →
          </Link>
        )}
      </div>
    </div>
  );
}
