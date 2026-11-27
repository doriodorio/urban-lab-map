import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createItem, createItemLink, deleteItemLink } from "../map-actions";
import { setItemCanvas, createBoardItem } from "./board-actions";
import { Board } from "./board";

/**
 * The board: the project's other view.
 *
 * Not a second workspace. The same items as the map, arranged by hand instead
 * of by coordinate - because half of this research has no coordinate and
 * never will. An article about a street was not written on it; a concept is
 * not anywhere at all.
 *
 * Until this existed the archive had nowhere to put that half, and it showed:
 * of 463 items, 449 were photographs and not one had a body longer than two
 * hundred characters. The reading, the terms and the comparisons went to a
 * whiteboard tool instead, where they sit in a file that has never heard of
 * Jerusalem.
 *
 * The argument for keeping them here instead is not that this is a better
 * whiteboard. It is that a card on this board and a pin on that map are the
 * same row, so an article can be joined to the photograph that answers it,
 * and either can be opened from the other. That is the thing a separate tool
 * cannot do at any price.
 */
export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (projectError) {
    throw new Error(`Couldn't load this project: ${projectError.message}`);
  }
  if (!project) {
    notFound();
  }

  const [itemsResult, layersResult] = await Promise.all([
    supabase
      .from("items")
      .select(
        "id, title, type, body, attribution, media, canvas, layer_id, geometry, located_by"
      )
      .eq("project_id", id)
      .is("deleted_at", null)
      .order("created_at"),
    supabase
      .from("layers")
      .select("id, name, color")
      .eq("project_id", id)
      .order("created_at"),
  ]);

  // A board that silently drops half the cards is worse than one that will
  // not open: the group would rearrange what was left and believe it.
  if (itemsResult.error || layersResult.error) {
    const message = (itemsResult.error ?? layersResult.error)?.message ?? "";
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-6">
        <h1 className="display text-lg">Couldn&apos;t open the board</h1>
        <p className="text-sm text-ink-secondary">
          Nothing is lost — this is a problem reading the project, not a
          deletion.
        </p>
        <pre className="overflow-x-auto rounded bg-paper p-3 text-xs">
          {message}
          {message.includes("canvas")
            ? "\n\nThis names the `canvas` column: supabase/canvas_board.sql still needs running."
            : ""}
        </pre>
        <Link href={`/projects/${id}`} className="text-sm underline">
          Back to the map
        </Link>
      </main>
    );
  }

  const items = itemsResult.data ?? [];
  const onBoard = items.filter((i) => i.canvas !== null);

  /**
   * Every link with at least one end on the board - not only the ones with
   * both.
   *
   * A link whose far end is missing used to be dropped here, which put the
   * board back in the state that made links useless in the first place: a
   * relationship nobody can see is a relationship nobody makes. If a card is
   * connected to something, that something belongs on the board too, whether
   * or not anyone thought to fetch it.
   *
   * It arrives as a card that has not been placed - see `ghosts` in board.tsx
   * - so the board shows the connection without anybody's layout being
   * written for them.
   *
   * Two queries rather than one `or`: the filter is a list of ids on each
   * side, and an `or` of two `in`s has to be built as a string, which is the
   * kind of query that breaks silently on an id containing the wrong
   * character.
   */
  const onBoardIds = [...new Set(onBoard.map((i) => i.id))];
  const [fromRows, toRows] = onBoardIds.length
    ? await Promise.all([
        supabase
          .from("item_links")
          .select("id, item_a, item_b, note")
          .in("item_a", onBoardIds),
        supabase
          .from("item_links")
          .select("id, item_a, item_b, note")
          .in("item_b", onBoardIds),
      ])
    : [{ data: [] }, { data: [] }];

  const links = [
    ...new Map(
      [...(fromRows.data ?? []), ...(toRows.data ?? [])].map((l) => [l.id, l])
    ).values(),
  ];

  return (
    <Board
      projectId={project.id}
      projectName={project.name}
      items={items}
      links={links}
      layers={layersResult.data ?? []}
      setItemCanvasAction={setItemCanvas}
      createBoardItemAction={createBoardItem}
      createItemAction={createItem}
      createItemLinkAction={createItemLink}
      deleteItemLinkAction={deleteItemLink}
    />
  );
}
