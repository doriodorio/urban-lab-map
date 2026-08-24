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

async function uploadFile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  file: File
) {
  const ext = file.name.split(".").pop() || "bin";
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

const VALID_TYPES = [
  "image",
  "text",
  "quote",
  "interview",
  "document",
  "data",
  "composite",
];

export async function createItem(
  projectId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const title = (formData.get("title") as string)?.trim();
  const body = (formData.get("body") as string)?.trim() || null;
  const attribution = (formData.get("attribution") as string)?.trim() || null;
  const layerId = (formData.get("layer_id") as string) || null;
  const type = (formData.get("type") as string) || "text";
  const dateStart = (formData.get("date_start") as string) || null;
  const tagsRaw = (formData.get("tags") as string) || "";
  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const geometryRaw = formData.get("geometry") as string;
  const image = formData.get("image") as File | null;
  const mediaFile = formData.get("media_file") as File | null;
  const mediaUrl = (formData.get("media_url") as string)?.trim() || null;

  if (!title) {
    return { error: "Title is required." };
  }
  if (!VALID_TYPES.includes(type)) {
    return { error: "Invalid item type." };
  }
  let geometry: { type: string; coordinates: unknown };
  try {
    geometry = JSON.parse(geometryRaw);
  } catch {
    return { error: "Missing map location." };
  }

  const supabase = await createClient();

  const media: { url: string; type: string }[] = [];
  try {
    if (image && image.size > 0) {
      media.push({ url: await uploadFile(supabase, projectId, image), type: "image" });
    }
    if (mediaFile && mediaFile.size > 0) {
      const kind = mediaFile.type.startsWith("audio")
        ? "audio"
        : mediaFile.type.startsWith("video")
        ? "video"
        : "document";
      media.push({ url: await uploadFile(supabase, projectId, mediaFile), type: kind });
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "File upload failed." };
  }
  if (mediaUrl) {
    media.push({ url: mediaUrl, type: "embed" });
  }

  const { error } = await supabase.from("items").insert({
    project_id: projectId,
    layer_id: layerId || null,
    type,
    geometry,
    title,
    body,
    attribution,
    tags,
    date_start: dateStart || null,
    media,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function updateItemTags(
  projectId: string,
  itemId: string,
  tags: string[]
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("items")
    .update({ tags })
    .eq("id", itemId);

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

// Soft delete: any member can delete any item, so a mistaken click would
// otherwise destroy someone else's work irrecoverably. Restorable from the
// editor's Trash panel via restoreItem().
export async function deleteItem(projectId: string, itemId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", itemId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function restoreItem(projectId: string, itemId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("items")
    .update({ deleted_at: null })
    .eq("id", itemId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

// Links are undirected and stored with the pair in a canonical order (see
// supabase/week5_links.sql), so both ends have to be sorted before insert or
// the unique index won't catch a duplicate created from the other direction.
export async function createItemLink(
  projectId: string,
  itemId: string,
  otherItemId: string,
  note: string | null
): Promise<ActionResult> {
  if (!otherItemId) {
    return { error: "Choose an item to link to." };
  }
  if (itemId === otherItemId) {
    return { error: "An item can't be linked to itself." };
  }

  const supabase = await createClient();

  // Both ends must live in this project - the picker only offers items from
  // it, but the id arrives from the client, so don't take that on trust.
  const { data: ends, error: endsError } = await supabase
    .from("items")
    .select("id")
    .eq("project_id", projectId)
    .in("id", [itemId, otherItemId]);

  if (endsError) {
    return { error: endsError.message };
  }
  if ((ends?.length ?? 0) !== 2) {
    return { error: "Both items must belong to this project." };
  }

  const [item_a, item_b] = [itemId, otherItemId].sort();
  const { error } = await supabase
    .from("item_links")
    .insert({ item_a, item_b, note: note?.trim() || null });

  if (error) {
    if (error.code === "23505") {
      return { error: "These items are already linked." };
    }
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function deleteItemLink(projectId: string, linkId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("item_links").delete().eq("id", linkId);

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
    url = await uploadFile(supabase, projectId, image);
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
