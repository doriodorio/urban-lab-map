"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MAP_STYLES } from "@/lib/base-maps";
import { CATEGORIES } from "@/lib/categories";

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

/**
 * Remember the base map this project is arranged on, so the published view
 * opens on the same map rather than a global default.
 *
 * Any member can set it: the base map is a property of the project the group
 * is building together, not of the person who happened to click last.
 */
export async function updateBaseMapStyle(
  projectId: string,
  styleId: string
): Promise<ActionResult> {
  // The id is written into the project row and later used to pick a style, so
  // it is checked against the real list rather than stored as free text.
  if (!MAP_STYLES.some((s) => s.id === styleId)) {
    return { error: "Unknown base map." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ base_map_style: styleId })
    .eq("id", projectId);

  if (error) {
    return { error: error.message };
  }

  // Deliberately no revalidatePath: the editor already shows the new base map,
  // and re-rendering the whole page under someone mid-edit to confirm what
  // they just did would cost more than it tells them.
  return { success: true };
}

export async function updateLayer(
  projectId: string,
  layerId: string,
  name: string,
  color: string
): Promise<ActionResult> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "Name is required." };
  }
  // The colour reaches the map as an inline style and an SVG stroke, so it is
  // checked here rather than trusted from the picker.
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return { error: "Colour must be a hex value like #3b82f6." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("layers")
    .update({ name: trimmed, color })
    .eq("id", layerId)
    .eq("project_id", projectId);

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
  "sound",
  "smell",
  "touch",
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

/** True when at least two of the positions differ - i.e. the shape has extent. */
function hasDistinctPositions(positions: [number, number][]) {
  const [firstLng, firstLat] = positions[0];
  return positions.some(([lng, lat]) => lng !== firstLng || lat !== firstLat);
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
    // Two vertices at the same place is valid GeoJSON and draws nothing: no
    // marker, because it is not a Point, and no line, because it has no
    // length. The item then exists, counts, stretches the project perimeter,
    // and cannot be seen or clicked on the map. One got into this project that
    // way. A line needs at least two distinct points.
    if (!hasDistinctPositions(line)) return null;
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
      // Same trap as a zero-length line: a ring whose points coincide encloses
      // nothing and renders as nothing.
      if (!hasDistinctPositions(ring)) return null;
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
  const claimed = formData.get("located_by") as string;
  const locatedBy =
    claimed === "photo" || claimed === "moved" ? claimed : null;

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
    located_by: locatedBy,
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
    .select("geometry, located_by")
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

  // Dragging a photograph's own position demotes it rather than erasing it:
  // the picture still came from a camera that knew where it was, we have just
  // stopped trusting that this is the spot. A hand-placed item that gets
  // dragged was never making a claim, so it keeps not making one.
  const wasLocated =
    item.located_by === "photo" || item.located_by === "moved";

  const { error } = await supabase
    .from("items")
    .update({
      geometry: { type: "Point", coordinates: [lng, lat] },
      located_by: wasLocated ? "moved" : item.located_by,
    })
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

/**
 * Bring this project's media files into its own storage folder.
 *
 * Files are stored as "{project_id}/{name}", and moving an item between
 * projects leaves its file behind under the old project's id. That still
 * *reads* - the bucket is public and its read policy checks nothing - so
 * nothing looks broken. What breaks is administration: the delete policy asks
 * whether you are a member of the project named in the path, so once that
 * project is gone the file can never be removed, and permanently deleting the
 * item would drop its record and orphan the file for good.
 *
 * Copy, then repoint the item, then delete the original - in that order. If it
 * fails partway, every item still points at a file that exists: the ones
 * already handled at their new home, the rest at the old one. Re-running
 * finishes the job.
 *
 * Must be run while you are still a member of the *source* project, since
 * removing the old file is checked against that membership.
 */
export async function relocateProjectMedia(
  projectId: string
): Promise<ActionResult & { moved?: number; skipped?: number }> {
  const supabase = await createClient();

  const { data: items, error: readError } = await supabase
    .from("items")
    .select("id, media")
    .eq("project_id", projectId);

  if (readError) {
    return { error: readError.message };
  }

  const bucket = supabase.storage.from("project-media");
  let moved = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const item of items ?? []) {
    const media = (item.media ?? []) as { url: string; type: string }[];
    // Collected as we go rather than carried on the entries themselves, so the
    // shape written back to the row is exactly the shape that came out of it.
    const stale: string[] = [];
    const next: { url: string; type: string }[] = [];

    for (const entry of media) {
      const path = storagePathFromUrl(entry.url);
      const rest = path ? path.split("/").slice(1).join("/") : "";
      // Not one of ours - a YouTube still, say - or already in place.
      if (!path || !rest || path.startsWith(`${projectId}/`)) {
        next.push(entry);
        continue;
      }

      const target = `${projectId}/${rest}`;
      const { error: copyError } = await bucket.copy(path, target);
      // A duplicate means an earlier run copied it and stopped before
      // repointing the item; carry on and repoint it now.
      if (copyError && !/exist/i.test(copyError.message)) {
        problems.push(copyError.message);
        skipped += 1;
        next.push(entry);
        continue;
      }

      const {
        data: { publicUrl },
      } = bucket.getPublicUrl(target);
      next.push({ ...entry, url: publicUrl });
      stale.push(path);
      moved += 1;
    }

    if (stale.length === 0) continue;

    const { error: updateError } = await supabase
      .from("items")
      .update({ media: next })
      .eq("id", item.id);

    if (updateError) {
      problems.push(updateError.message);
      continue;
    }

    // Only now is the original safe to remove: the item already points at the
    // copy, so a failed delete costs a stray file, not a picture.
    await bucket.remove(stale);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);

  return problems.length
    ? { error: `${moved} moved, ${skipped} could not be: ${problems[0]}` }
    : { success: true, moved, skipped };
}

// Hard delete, restricted to the item's creator. The check is enforced by the
// items_delete_creator RLS policy (see purge_items.sql); the explicit checks
// here exist to return a useful message instead of a silent no-op, since a
// blocked delete comes back as "0 rows affected" rather than an error.
/**
 * Replace the URL on a link or video item.
 *
 * Restricted to whoever added the item, matching permanent delete. A URL is
 * the whole of these items - swapping it silently replaces one person's
 * source with another's under their name, which is not the same kind of edit
 * as fixing a title.
 */
export async function updateItemUrl(
  projectId: string,
  itemId: string,
  url: string
): Promise<ActionResult> {
  const trimmed = url.trim();
  if (!trimmed) {
    return { error: "A link is required." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: "That isn't a valid link." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "Links must start with http:// or https://" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in." };
  }

  const { data: item, error: readError } = await supabase
    .from("items")
    .select("id, created_by, type, media")
    .eq("id", itemId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (readError) {
    return { error: readError.message };
  }
  if (!item) {
    return { error: "Item not found." };
  }
  if (item.type !== "link" && item.type !== "video") {
    return { error: "Only link and video items have a link to change." };
  }
  if (item.created_by !== user.id) {
    return {
      error: item.created_by
        ? "Only the person who added this item can change its link."
        : "This item predates authorship tracking, so it has no owner who can change its link.",
    };
  }

  // These items carry exactly one embed entry, written at creation. Rebuilding
  // it rather than editing in place keeps any stray entries from surviving.
  const { error } = await supabase
    .from("items")
    .update({
      media: [{ url: trimmed, type: "embed" }],
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

/**
 * Move an item between theory and field, or hand it back to the guess.
 *
 * Null means "work it out from the type", which is the state every item starts
 * in - so clearing an override is a real operation, not a deletion.
 */
export async function updateItemCategory(
  projectId: string,
  itemId: string,
  category: string | null
): Promise<ActionResult> {
  if (category !== null && !CATEGORIES.some((c) => c.id === category)) {
    return { error: "Unknown category." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("items")
    .update({ category })
    .eq("id", itemId)
    .eq("project_id", projectId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

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
