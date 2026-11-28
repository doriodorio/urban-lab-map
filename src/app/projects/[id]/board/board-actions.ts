"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { placeConnected } from "./place-connected";

type ActionResult = { error?: string; success?: boolean };

/**
 * Where an item sits on the project's board.
 *
 * Board units, not degrees. See supabase/canvas_board.sql: this is a layout
 * fact and carries no claim about anywhere in the world. The one rule that
 * matters is that it never touches `geometry` and `geometry` never touches
 * it.
 */
export type CanvasSpot = { x: number; y: number; w: number };

/**
 * Bounds on a position, so that a bad number cannot put a card somewhere
 * nobody can scroll to and lose it.
 *
 * Generous rather than tight - a board is meant to be sprawled over - but
 * finite, because "lost somewhere past a million" is the same as deleted, and
 * worse because it looks like a bug in the drawing code.
 */
const LIMIT = 100_000;
const MIN_WIDTH = 80;
const MAX_WIDTH = 1600;

function readSpot(spot: unknown): CanvasSpot | null {
  if (!spot || typeof spot !== "object") return null;
  const { x, y, w } = spot as Record<string, unknown>;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w)) {
    return null;
  }
  const nx = x as number;
  const ny = y as number;
  const nw = w as number;
  if (Math.abs(nx) > LIMIT || Math.abs(ny) > LIMIT) return null;
  return {
    x: Math.round(nx),
    y: Math.round(ny),
    w: Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, nw))),
  };
}

/**
 * Put an item on the board, move it, resize it, or take it off.
 *
 * Taking it off is `null`, and it removes the item from the board only -
 * never from the project. A card dragged off a board should not be a
 * deletion, and the one thing a research archive must not do is lose
 * something because of where it was dragged.
 *
 * No membership check of its own: this goes through the same RLS policy the
 * rest of the app does, so a stranger's update matches no rows and the count
 * below catches it.
 */
export async function setItemCanvas(
  projectId: string,
  itemId: string,
  spot: CanvasSpot | null
): Promise<
  ActionResult & {
    alsoPlaced?: { id: string; spot: CanvasSpot }[];
    truncated?: boolean;
  }
> {
  const canvas = spot === null ? null : readSpot(spot);
  if (spot !== null && canvas === null) {
    return { error: "Invalid position on the board." };
  }

  const supabase = await createClient();

  /**
   * Was it on the board before this?
   *
   * Only an arrival brings the things it is connected to with it. A drag and
   * a resize are the same call, and a card already on the board should not
   * re-run the cascade every time somebody nudges it - the chain is already
   * here, and re-placing it would move cards the group had arranged by hand.
   */
  const { data: before } = await supabase
    .from("items")
    .select("canvas")
    .eq("id", itemId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  const arriving = canvas !== null && (before?.canvas ?? null) === null;

  const { error, count } = await supabase
    .from("items")
    .update({ canvas }, { count: "exact" })
    .eq("id", itemId)
    .eq("project_id", projectId)
    .is("deleted_at", null);

  if (error) {
    return { error: error.message };
  }
  if (!count) {
    return { error: "That item is not in this project, or is in the trash." };
  }

  const cascade = arriving
    ? await placeConnected(supabase, projectId, [itemId])
    : { cards: [], truncated: false };

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
  return {
    success: true,
    alsoPlaced: cascade.cards,
    truncated: cascade.truncated,
  };
}

/**
 * A new item made on the board rather than on the map.
 *
 * This is the whole point of the board, so it is worth being explicit about
 * what it writes: `geometry` null and `located_by` 'unplaced'. An article
 * about a street has no coordinate, and the archive says so in its own
 * vocabulary rather than borrowing the corner of the map.
 *
 * Nothing stops it being placed later - a card can be put on the map, and is
 * then asked what the coordinate claims, like anything else.
 */
export async function createBoardItem(
  projectId: string,
  input: {
    title: string;
    type: string;
    body: string | null;
    attribution: string | null;
    spot: CanvasSpot;
  }
): Promise<ActionResult & { id?: string }> {
  const title = input.title.trim();
  if (!title) return { error: "Give it a title." };

  const canvas = readSpot(input.spot);
  if (!canvas) return { error: "Invalid position on the board." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("items")
    .insert({
      project_id: projectId,
      type: input.type,
      title,
      body: input.body?.trim() || null,
      attribution: input.attribution?.trim() || null,
      geometry: null,
      located_by: "unplaced",
      canvas,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/board`);
  revalidatePath(`/projects/${projectId}`);
  return { success: true, id: data.id };
}
