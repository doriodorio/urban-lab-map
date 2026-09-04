import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PublicViewer } from "./public-viewer";

type PublicProject = {
  project: {
    id: string;
    name: string;
    description: string | null;
    base_map_image_url: string | null;
    base_map_bounds: [[number, number], [number, number]] | null;
    base_map_style: string | null;
    statement: string | null;
    cover_image_url: string | null;
    doco_url: string | null;
    public_slug: string;
  };
  layers: { id: string; name: string; color: string | null }[];
  items: {
    id: string;
    layer_id: string | null;
    type: string;
    title: string | null;
    body: string | null;
    attribution: string | null;
    tags: string[] | null;
    date_start: string | null;
    media: { url: string; type: string }[] | null;
    geometry: {
      type: "Point" | "LineString" | "Polygon";
      coordinates: never;
    };
  }[];
  threads: { id: string; name: string; description: string | null }[];
  thread_items: {
    thread_id: string;
    item_id: string;
    order_index: number;
    narration: string | null;
  }[];
};

// Reads through get_public_project(), a SECURITY DEFINER function scoped to a
// single published slug — the underlying tables stay closed to anon.
async function loadPublicProject(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_project", { slug });
  return (data as PublicProject | null) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadPublicProject(slug);
  if (!data?.project) return { title: "Urban Lab Map" };
  return {
    title: data.project.name,
    description: data.project.description ?? undefined,
  };
}

export default async function PublicProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadPublicProject(slug);

  // Unpublishing nulls the slug, so an old link lands here.
  if (!data?.project) {
    notFound();
  }

  return (
    <PublicViewer
      project={data.project}
      layers={data.layers ?? []}
      items={data.items ?? []}
      threads={data.threads ?? []}
      threadItems={data.thread_items ?? []}
    />
  );
}
