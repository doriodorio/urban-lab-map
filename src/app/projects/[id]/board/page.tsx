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

  // Only the links whose ends are both on the board. A line to a card that
  // is not here would have nowhere to land, and drawing it to the edge would
  // suggest a direction that means nothing.
  const onBoardIds = new Set(onBoard.map((i) => i.id));
  const { data: linkRows } = onBoardIds.size
    ? await supabase
        .from("item_links")
        .select("id, item_a, item_b, note")
        .in("item_a", [...onBoardIds])
    : { data: [] };

  const links = (linkRows ?? []).filter((l) => onBoardIds.has(l.item_b));

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
