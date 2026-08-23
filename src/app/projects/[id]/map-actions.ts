"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error?: string; success?: boolean };

export async function createLayer(
  projectId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const name = (formData.get("name") as string)?.trim();
  const color = (formData.get("color") as string) || "#3b82f6";

  if (!name) {
    return { error: "Name is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("layers")
    .insert({ project_id: projectId, name, color });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function deleteLayer(projectId: string, layerId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("layers").delete().eq("id", layerId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

async function uploadImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  file: File
) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${projectId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from("project-media")
    .upload(path, file, { contentType: file.type });

  if (error) {
    throw new Error(error.message);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("project-media").getPublicUrl(path);

  return publicUrl;
}

export async function createItem(
  projectId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const title = (formData.get("title") as string)?.trim();
  const body = (formData.get("body") as string)?.trim() || null;
  const layerId = (formData.get("layer_id") as string) || null;
  const lng = parseFloat(formData.get("lng") as string);
  const lat = parseFloat(formData.get("lat") as string);
  const image = formData.get("image") as File | null;

  if (!title) {
    return { error: "Title is required." };
  }
  if (Number.isNaN(lng) || Number.isNaN(lat)) {
    return { error: "Missing map location." };
  }

  const supabase = await createClient();

  let media: { url: string; type: string }[] = [];
  if (image && image.size > 0) {
    try {
      const url = await uploadImage(supabase, projectId, image);
      media = [{ url, type: "image" }];
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Image upload failed." };
    }
  }

  const { error } = await supabase.from("items").insert({
    project_id: projectId,
    layer_id: layerId || null,
    type: media.length > 0 ? "image" : "text",
    geometry: { type: "Point", coordinates: [lng, lat] },
    title,
    body,
    media,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function updateItemLayer(
  projectId: string,
  itemId: string,
  layerId: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("items")
    .update({ layer_id: layerId })
    .eq("id", itemId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function deleteItem(projectId: string, itemId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("items").delete().eq("id", itemId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function setBaseMap(
  projectId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const image = formData.get("image") as File | null;
  const north = parseFloat(formData.get("north") as string);
  const south = parseFloat(formData.get("south") as string);
  const east = parseFloat(formData.get("east") as string);
  const west = parseFloat(formData.get("west") as string);

  if (!image || image.size === 0) {
    return { error: "Choose an image." };
  }
  if ([north, south, east, west].some((n) => Number.isNaN(n))) {
    return { error: "All four corner values are required." };
  }

  const supabase = await createClient();

  let url: string;
  try {
    url = await uploadImage(supabase, projectId, image);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Image upload failed." };
  }

  const { error } = await supabase
    .from("projects")
    .update({
      base_map_image_url: url,
      base_map_bounds: [
        [north, west],
        [south, east],
      ],
    })
    .eq("id", projectId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function clearBaseMap(projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ base_map_image_url: null, base_map_bounds: null })
    .eq("id", projectId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}
