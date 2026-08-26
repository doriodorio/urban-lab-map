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
  "link",
  "video",
  "composite",
];

type ValidGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Polygon"; coordinates: [number, number][][] };

function isPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

/**
 * Checks a geometry is actually one of the three shapes the map can draw.
 *
 * The column is `jsonb not null`, which accepts any valid JSON - so without
 * this, `"hello"` or `{}` inserts happily and then renders as nothing at all:
 * the editor matches on `geometry.type`, finds no branch, and draws neither a
 * marker nor a shape. The item exists, counts toward the project, and can't
 * be seen, selected or deleted through the UI. Better to reject it here.
 */
function parseGeometry(raw: string): ValidGeometry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const geometry = parsed as { type?: unknown; coordinates?: unknown };

  if (geometry.type === "Point") {
    return isPosition(geometry.coordinates)
      ? { type: "Point", coordinates: geometry.coordinates }
      : null;
  }

  if (geometry.type === "LineString") {
    const line = geometry.coordinates;
    if (!Array.isArray(line) || line.length < 2) return null;
    if (!line.every(isPosition)) return null;
    return { type: "LineString", coordinates: line };
  }

  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates;
    if (!Array.isArray(rings) || rings.length === 0) return null;
    for (const ring of rings) {
      // A closed ring needs at least a triangle plus the repeated first point.
      if (!Array.isArray(ring) || ring.length < 4) return null;
      if (!ring.every(isPosition)) return null;
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) return null;
    }
    return { type: "Polygon", coordinates: rings };
  }

  return null;
}

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
  const geometry = parseGeometry(geometryRaw);
  if (!geometry) {
    return { error: "Missing or invalid map location." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    created_by: user?.id ?? null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function updateItemGeometry(
  projectId: string,
  itemId: string,
  lng: number,
  lat: number
): Promise<ActionResult> {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { error: "Invalid coordinates." };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: "Coordinates out of range." };
  }

  const supabase = await createClient();

  // Only point items are draggable; refuse anything else rather than
  // silently flattening a line or polygon into a single point.
  const { data: item, error: readError } = await supabase
    .from("items")
    .select("geometry")
    .eq("id", itemId)
    .maybeSingle();

  if (readError) {
    return { error: readError.message };
  }
  if (!item) {
    return { error: "Item not found." };
  }
  if ((item.geometry as { type?: string })?.type !== "Point") {
    return { error: "Only point items can be moved." };
  }

  const { error } = await supabase
    .from("items")
    .update({ geometry: { type: "Point", coordinates: [lng, lat] } })
    .eq("id", itemId);

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

// Media urls are public bucket urls; the storage API needs the path within
// the bucket. Anything not served from our bucket (embedded YouTube/Vimeo
// links, for instance) has no file to remove and is skipped.
const BUCKET_MARKER = "/storage/v1/object/public/project-media/";

function storagePathFromUrl(url: string): string | null {
  const at = url.indexOf(BUCKET_MARKER);
  if (at === -1) return null;
  return decodeURIComponent(url.slice(at + BUCKET_MARKER.length));
}

// Hard delete, restricted to the item's creator. The check is enforced by the
// items_delete_creator RLS policy (see purge_items.sql); the explicit checks
// here exist to return a useful message instead of a silent no-op, since a
// blocked delete comes back as "0 rows affected" rather than an error.
export async function purgeItem(
  projectId: string,
  itemId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in." };
  }

  const { data: item, error: readError } = await supabase
    .from("items")
    .select("id, created_by, deleted_at, media")
    .eq("id", itemId)
    .maybeSingle();

  if (readError) {
    return { error: readError.message };
  }
  if (!item) {
    return { error: "Item not found." };
  }
  if (!item.deleted_at) {
    return { error: "Delete the item first — only trashed items can be purged." };
  }
  if (item.created_by !== user.id) {
    return {
      error: item.created_by
        ? "Only the person who added this item can delete it permanently."
        : "This item predates authorship tracking, so it has no owner who can permanently delete it.",
    };
  }

  // Remove the row first: if this is blocked, the files must survive.
  const { error: deleteError, count } = await supabase
    .from("items")
    .delete({ count: "exact" })
    .eq("id", itemId);

  if (deleteError) {
    return { error: deleteError.message };
  }
  if (!count) {
    return { error: "Couldn't delete this item." };
  }

  // Best effort: the row is already gone, so a storage failure here leaves an
  // orphaned file rather than a broken item. Not worth failing the action over.
  const paths = ((item.media ?? []) as { url: string }[])
    .map((m) => storagePathFromUrl(m.url))
    .filter((p): p is string => Boolean(p));

  if (paths.length) {
    await supabase.storage.from("project-media").remove(paths);
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
