import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createItem } from "../map-actions";
import { FieldCapture } from "./field-capture";

/**
 * Recording from the street.
 *
 * The editor is a desk. It holds layers, threads, a perimeter, a trash can
 * and five panels of tabs, and all of that is the work of arranging an
 * archive after the walk. None of it is what a person does while standing on
 * a corner with one hand free.
 *
 * What they do there is one thing: say where they are, say what this is, and
 * get on with walking. So that is the whole of this page. Everything the
 * editor offers and this does not - linking, tags, dates, threads, moving
 * other people's pins - was left out on purpose rather than forgotten. It can
 * all be done afterwards, to the same item, at a table.
 *
 * It writes through exactly the same action the editor does, so a thing
 * recorded in the street is not a lesser kind of record. It arrives in the
 * project as an ordinary item and the group edits it like any other.
 */
export default async function FieldPage({
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
    .select("id, name, base_map_style")
    .eq("id", id)
    .maybeSingle();

  if (projectError) {
    throw new Error(`Couldn't load this project: ${projectError.message}`);
  }
  if (!project) {
    notFound();
  }

  const { data: layers, error: layersError } = await supabase
    .from("layers")
    .select("id, name, color")
    .eq("project_id", id)
    .order("created_at");

  // Layers are how a group sorts its material, and picking the wrong one in
  // the street is tedious to undo later. A failure to read them is shown
  // rather than passed off as "this project has no layers".
  if (layersError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6">
        <h1 className="display text-lg">Couldn&apos;t load this project</h1>
        <p className="text-sm text-ink-secondary">{layersError.message}</p>
        <Link href={`/projects/${id}`} className="text-sm underline">
          Back to the map
        </Link>
      </main>
    );
  }

  return (
    <FieldCapture
      projectId={project.id}
      projectName={project.name}
      styleId={project.base_map_style ?? null}
      layers={layers ?? []}
      createItemAction={createItem.bind(null, project.id)}
    />
  );
}
