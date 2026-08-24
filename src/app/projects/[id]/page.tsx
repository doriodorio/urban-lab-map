import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MapEditor } from "./map-editor";
import {
  createLayer,
  deleteLayer,
  createItem,
  deleteItem,
  restoreItem,
  purgeItem,
  updateItemLayer,
  updateItemTags,
  createItemLink,
  deleteItemLink,
  setBaseMap,
  clearBaseMap,
} from "./map-actions";

export default async function ProjectMapPage({
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

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, base_map_image_url, base_map_bounds")
    .eq("id", id)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const itemColumns =
    "id, layer_id, type, title, body, attribution, tags, date_start, media, geometry, created_by";

  const [layersResult, itemsResult, deletedItemsResult] = await Promise.all([
    supabase
      .from("layers")
      .select("id, name, color")
      .eq("project_id", id)
      .order("created_at"),
    supabase
      .from("items")
      .select(itemColumns)
      .eq("project_id", id)
      .is("deleted_at", null),
    supabase
      .from("items")
      .select(`${itemColumns}, deleted_at`)
      .eq("project_id", id)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false }),
  ]);

  // Never fall back to an empty array on a failed query: an editor showing
  // zero items is indistinguishable from "someone deleted all our work", and
  // that's the last thing a group should have to guess about. Surface it.
  const loadError =
    layersResult.error ?? itemsResult.error ?? deletedItemsResult.error;

  if (loadError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6">
        <h1 className="text-lg font-semibold">Couldn&apos;t load this map</h1>
        <p className="text-sm text-neutral-600">
          Your items are still stored — this is a problem reading them, not a
          deletion. Retry in a moment; if it persists, send this to whoever
          maintains the tool:
        </p>
        <pre className="overflow-x-auto rounded bg-neutral-100 p-3 text-xs">
          {loadError.message}
        </pre>
        <Link
          href="/projects"
          className="text-sm text-neutral-500 underline"
        >
          ← Workspace
        </Link>
      </main>
    );
  }

  const { data: layers } = layersResult;
  const { data: items } = itemsResult;
  const { data: deletedItems } = deletedItemsResult;

  // Links are stored with the pair ordered (item_a < item_b), so every link
  // touching this project has its item_a among the project's items - one
  // `in` on item_a is enough to fetch them all. Deleted ids are included so a
  // restored item gets its links back rather than losing them permanently.
  const allItemIds = [
    ...(items ?? []).map((i) => i.id),
    ...(deletedItems ?? []).map((i) => i.id),
  ];
  const { data: links } = allItemIds.length
    ? await supabase
        .from("item_links")
        .select("id, item_a, item_b, note")
        .in("item_a", allItemIds)
    : { data: [] };

  // auth.users isn't reachable from PostgREST, so creator ids are resolved to
  // emails through the same members RPC the settings page uses. Magic-link
  // auth means an email is the only identity we have - there are no display
  // names to show.
  const { data: members } = (await supabase.rpc("get_project_members", {
    p_project_id: id,
  })) as {
    data:
      | {
          user_id: string;
          email: string;
          role: string;
          display_name: string | null;
        }[]
      | null;
  };

  // Prefer whatever the person chose to be called; fall back to their email.
  const memberNames = Object.fromEntries(
    (members ?? []).map((m) => [m.user_id, m.display_name || m.email])
  );

  return (
    <MapEditor
      project={project}
      layers={layers ?? []}
      items={items ?? []}
      deletedItems={deletedItems ?? []}
      links={links ?? []}
      memberNames={memberNames}
      currentUserId={user.id}
      createLayerAction={createLayer.bind(null, project.id)}
      deleteLayerAction={deleteLayer.bind(null, project.id)}
      createItemAction={createItem.bind(null, project.id)}
      deleteItemAction={deleteItem.bind(null, project.id)}
      restoreItemAction={restoreItem.bind(null, project.id)}
      purgeItemAction={purgeItem.bind(null, project.id)}
      updateItemLayerAction={updateItemLayer.bind(null, project.id)}
      updateItemTagsAction={updateItemTags.bind(null, project.id)}
      createItemLinkAction={createItemLink.bind(null, project.id)}
      deleteItemLinkAction={deleteItemLink.bind(null, project.id)}
      setBaseMapAction={setBaseMap.bind(null, project.id)}
      clearBaseMapAction={clearBaseMap.bind(null, project.id)}
    />
  );
}
