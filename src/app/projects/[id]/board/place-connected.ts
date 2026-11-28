import type { createClient } from "@/lib/supabase/server";
import {
  cardHeight,
  findFreeSpot,
  ringAround,
  CONNECTED_CARD_WIDTH,
  type Box,
} from "@/lib/board-layout";

type Client = Awaited<ReturnType<typeof createClient>>;

type Spot = { x: number; y: number; w: number };

type Row = {
  id: string;
  body: string | null;
  attribution: string | null;
  media: { url: string; type: string }[] | null;
  canvas: Spot | null;
};

/**
 * One gesture should not be able to bury the board.
 *
 * A group that has linked a term to forty photographs means it; a group that
 * has accidentally chained half the archive together does not want all of it
 * arriving at once. Nearest-first, so what is cut is the far end of the
 * chain rather than the thing just placed.
 */
const MAX_NEW_CARDS = 60;

/**
 * Bring everything connected to these items onto the board.
 *
 * The rule, in Dori's words: if a card has connections, everything connected
 * to it belongs on the board - not hinted at beside it, but there, as a card
 * that can be dragged, resized and connected like any other.
 *
 * It follows the links all the way out, not one hop. A link is a claim that
 * two things belong together, and showing only the first hop of a chain
 * hides exactly the structure the board exists to make visible.
 *
 * It writes `canvas` for items that had none, which is the one thing this
 * column was otherwise careful never to do on anybody's behalf. The
 * difference is that this is not a backfill of 449 photographs that nobody
 * arranged: it is bounded by the links a group made themselves, and it is
 * triggered by a group putting a card on the board. Nothing else touches
 * `geometry`, `located_by` or anything else the item claims about the world.
 *
 * Taking a card off the board does not cascade, and this does not run when
 * the board is merely opened - otherwise a card could never be removed,
 * because the next load would drag it straight back in.
 *
 * Returns the cards it placed and where it put them - the board uses that
 * to show them at once and to move the view so they can be seen - and
 * whether it stopped short of the whole chain.
 */
export async function placeConnected(
  supabase: Client,
  projectId: string,
  seedIds: string[]
): Promise<{ cards: { id: string; spot: Spot }[]; truncated: boolean }> {
  if (!seedIds.length) return { cards: [], truncated: false };

  const { data: itemRows, error: itemsError } = await supabase
    .from("items")
    .select("id, body, attribution, media, canvas")
    .eq("project_id", projectId)
    .is("deleted_at", null);

  if (itemsError || !itemRows) return { cards: [], truncated: false };

  const items = itemRows as Row[];
  const byId = new Map(items.map((i) => [i.id, i]));

  /**
   * Every link this user can see, narrowed to this project in memory.
   *
   * `item_links` carries no project column, so the alternative is a filter
   * listing every id in the project - a few hundred uuids in a query string,
   * which is how a request quietly exceeds a URL length limit and comes back
   * as a type error somewhere else entirely. RLS already keeps this to the
   * user's own projects, and the set below keeps it to this one.
   */
  const { data: linkRows, error: linksError } = await supabase
    .from("item_links")
    .select("item_a, item_b")
    .limit(20_000);

  if (linksError || !linkRows?.length) return { cards: [], truncated: false };

  const neighbours = new Map<string, string[]>();
  for (const link of linkRows) {
    if (!byId.has(link.item_a) || !byId.has(link.item_b)) continue;
    for (const [from, to] of [
      [link.item_a, link.item_b],
      [link.item_b, link.item_a],
    ]) {
      const list = neighbours.get(from);
      if (list) list.push(to);
      else neighbours.set(from, [to]);
    }
  }
  if (!neighbours.size) return { cards: [], truncated: false };

  // What is already on the board, and the room it takes up.
  const spots = new Map<string, Spot>();
  const occupied: Box[] = [];
  for (const item of items) {
    if (!item.canvas) continue;
    spots.set(item.id, item.canvas);
    occupied.push({
      x: item.canvas.x,
      y: item.canvas.y,
      w: item.canvas.w,
      h: cardHeight(item, item.canvas.w),
    });
  }

  /**
   * Outwards from the seeds, a hop at a time.
   *
   * Breadth first so that the cards nearest what was just placed are the
   * ones that certainly arrive, and so each card is laid out next to the one
   * that brought it in rather than next to whichever link happened to be
   * read first.
   */
  const seen = new Set<string>(seedIds);
  let frontier = seedIds.filter((id) => spots.has(id));
  const placed: { id: string; spot: Spot }[] = [];
  let truncated = false;

  while (frontier.length && !truncated) {
    const next: string[] = [];

    for (const parentId of frontier) {
      const parentSpot = spots.get(parentId);
      const parent = byId.get(parentId);
      if (!parentSpot || !parent) continue;

      const children = (neighbours.get(parentId) ?? []).filter(
        (id) => !seen.has(id) && !spots.has(id)
      );
      // Mark the whole generation first, so two parents sharing a child do
      // not each place a copy of it.
      const mine = children.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      // Already-placed neighbours are still worth walking through: the chain
      // continues past them, and something hanging off one of them has
      // nowhere to be either.
      for (const id of neighbours.get(parentId) ?? []) {
        if (spots.has(id) && !seen.has(id)) {
          seen.add(id);
          next.push(id);
        }
      }

      const parentBox: Box = {
        x: parentSpot.x,
        y: parentSpot.y,
        w: parentSpot.w,
        h: cardHeight(parent, parentSpot.w),
      };

      let index = 0;
      for (const id of mine) {
        if (placed.length >= MAX_NEW_CARDS) {
          truncated = true;
          break;
        }
        const child = byId.get(id);
        if (!child) continue;

        const w = CONNECTED_CARD_WIDTH;
        const h = cardHeight(child, w);
        const want = ringAround(parentBox, parentId, index, mine.length, w, h);
        const free = findFreeSpot(occupied, want);
        const spot: Spot = { x: free.x, y: free.y, w };

        spots.set(id, spot);
        occupied.push({ x: spot.x, y: spot.y, w, h });
        placed.push({ id, spot });
        next.push(id);
        index += 1;
      }
      if (truncated) break;
    }

    frontier = next;
  }

  if (!placed.length) return { cards: [], truncated };

  /**
   * Written a few at a time.
   *
   * No bulk update: each row gets a different position, and the project
   * filter has to stay on every one of them so a crafted id cannot move a
   * card in somebody else's project. Small batches rather than all at once
   * keeps a chain of sixty from opening sixty sockets.
   */
  for (let i = 0; i < placed.length; i += 8) {
    const batch = placed.slice(i, i + 8);
    await Promise.all(
      batch.map(({ id, spot }) =>
        supabase
          .from("items")
          .update({ canvas: spot })
          .eq("id", id)
          .eq("project_id", projectId)
          .is("deleted_at", null)
          .is("canvas", null)
      )
    );
  }

  return { cards: placed, truncated };
}
