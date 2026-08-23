import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MapEditor } from "./map-editor";
import {
  createLayer,
  deleteLayer,
  createItem,
  deleteItem,
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

  const [{ data: layers }, { data: items }] = await Promise.all([
    supabase
      .from("layers")
      .select("id, name, color")
      .eq("project_id", id)
      .order("created_at"),
    supabase
      .from("items")
      .select("id, layer_id, title, body, media, geometry")
      .eq("project_id", id),
  ]);

  return (
    <MapEditor
      project={project}
      layers={layers ?? []}
      items={items ?? []}
      createLayerAction={createLayer.bind(null, project.id)}
      deleteLayerAction={deleteLayer.bind(null, project.id)}
      createItemAction={createItem.bind(null, project.id)}
      deleteItemAction={deleteItem.bind(null, project.id)}
      setBaseMapAction={setBaseMap.bind(null, project.id)}
      clearBaseMapAction={clearBaseMap.bind(null, project.id)}
    />
  );
}
