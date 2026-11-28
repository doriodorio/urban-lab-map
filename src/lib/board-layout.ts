/**
 * How big a card is on the board, and where a new one goes.
 *
 * Shared between the board itself and the server action that brings
 * connected items onto it, because both have to agree about the size of a
 * card. A layout computed from one set of heights and drawn with another
 * puts cards on top of each other, which on a board reads as lost material
 * rather than as a rounding error.
 */

export const DEFAULT_CARD_WIDTH = 260;

/** Narrower, so a handful arriving at once does not swamp the anchor. */
export const CONNECTED_CARD_WIDTH = 220;

export const CARD_HEADER = 44;

export type Box = { x: number; y: number; w: number; h: number };

export type CardLike = {
  body?: string | null;
  attribution?: string | null;
  media?: { url: string; type: string }[] | null;
};

/**
 * The drawn height of a card.
 *
 * An estimate by construction: the body is text in a flexible box, so the
 * real height is whatever the browser makes of it. It only has to be close
 * enough that two cards placed side by side do not overlap, and it is capped
 * the same way the card itself is.
 */
export function cardHeight(card: CardLike, width: number) {
  const cover = card.media?.find((m) => m.type === "image");
  const picture = cover ? Math.round(width * 0.62) : 0;
  const text = card.body ? Math.min(220, 40 + card.body.length * 0.36) : 0;
  const credit = card.attribution ? 20 : 0;
  return CARD_HEADER + picture + text + credit + 12;
}

/** Breathing room between cards, in board units. */
const GAP = 28;

function overlaps(a: Box, b: Box) {
  return (
    a.x < b.x + b.w + GAP &&
    b.x < a.x + a.w + GAP &&
    a.y < b.y + b.h + GAP &&
    b.y < a.y + a.h + GAP
  );
}

/**
 * The nearest free place to the one asked for.
 *
 * Spirals outwards until the box fits. Without this, everything pulled in by
 * one gesture lands at the same computed angle and stacks: the board looks
 * like it placed one card when it placed six, and the five underneath are
 * only findable by dragging the top one away.
 */
export function findFreeSpot(occupied: Box[], want: Box): { x: number; y: number } {
  const fits = (x: number, y: number) =>
    !occupied.some((o) => overlaps({ x, y, w: want.w, h: want.h }, o));

  if (fits(want.x, want.y)) return { x: want.x, y: want.y };

  const step = Math.round(want.w * 0.75) + GAP;
  for (let turn = 1; turn <= 24; turn += 1) {
    const points = turn * 6;
    for (let k = 0; k < points; k += 1) {
      // Offset each turn so successive rings do not test the same angles.
      const angle = ((k + turn * 0.5) / points) * Math.PI * 2;
      const x = Math.round(want.x + Math.cos(angle) * step * turn);
      const y = Math.round(want.y + Math.sin(angle) * step * turn);
      if (fits(x, y)) return { x, y };
    }
  }

  // Twenty-four rings out and still nothing: put it where it was asked for
  // rather than somewhere nobody will scroll to.
  return { x: want.x, y: want.y };
}

/** A stable number in [0, 1) from an id, so a layout does not reshuffle. */
function seedAngle(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 3600;
  }
  return hash / 3600;
}

/**
 * Where the nth of several cards goes around the card it is connected to.
 *
 * Fanned around the anchor rather than queued beside it, so the arrangement
 * says "these belong to that" at a glance. The starting angle comes from the
 * anchor's id: two anchors on the same board fan their children differently
 * and the two groups stay tellable apart.
 */
export function ringAround(
  anchor: Box,
  anchorId: string,
  index: number,
  total: number,
  w: number,
  h: number
): Box {
  const radius =
    Math.max(anchor.w, anchor.h) / 2 + Math.max(w, h) / 2 + 120;
  const angle = (seedAngle(anchorId) + index / Math.max(1, total)) * Math.PI * 2;
  const cx = anchor.x + anchor.w / 2;
  const cy = anchor.y + anchor.h / 2;
  return {
    x: Math.round(cx + Math.cos(angle) * radius - w / 2),
    y: Math.round(cy + Math.sin(angle) * radius - h / 2),
    w,
    h,
  };
}
