import { createClient } from "@/lib/supabase/server";
import type { Geometry } from "@/lib/perimeter";
import { PLACEMENT_MEANINGS } from "@/lib/placement";

/**
 * The project as a GeoJSON file.
 *
 * Everything else here is written on the assumption that this route exists.
 * The reason an unplaced item keeps a null geometry rather than borrowing the
 * perimeter's corner is that "anything else that opens this project - a
 * GeoJSON export, QGIS - sees no location, which is the truth". Until now
 * nothing could open it. The argument was sound and unreachable.
 *
 * It is also the only way a semester's fieldwork outlives the tool. A group
 * finishes in March; the archive should not depend on this app still running,
 * on Supabase still existing, or on anyone still paying for either. A file
 * they can keep is the difference between a research archive and a website.
 *
 * RFC 7946 is followed rather than approximated, because the point is that
 * other software reads it:
 *
 *  - A Feature may have `"geometry": null` (section 3.2). That is the whole
 *    unplaced case, expressed in the format's own vocabulary instead of a
 *    convention a reader would have to be told about.
 *  - Foreign members are permitted on a FeatureCollection (section 6.1), so
 *    the project's own metadata, its legend, and the links between items ride
 *    along at the top level. A reader that only understands GeoJSON ignores
 *    them and still gets every feature; QGIS opens this without being told
 *    anything.
 *
 * The file explains itself. A legend of what each `located_by` value claims
 * is written into every export, because the one thing that must survive is
 * the distinction between a coordinate that was measured and one that is a
 * subject - and in five years nobody will have this codebase open to look it
 * up.
 */

type ItemRow = {
  id: string;
  layer_id: string | null;
  type: string;
  category: string | null;
  title: string | null;
  body: string | null;
  attribution: string | null;
  tags: string[] | null;
  date_start: string | null;
  media: { url: string; type: string }[] | null;
  geometry: Geometry | null;
  located_by: string | null;
  created_at: string | null;
};

/**
 * A filename the browser will actually keep.
 *
 * Most of these projects are named in Hebrew, and a raw Hebrew name in a
 * Content-Disposition header is not something every client handles the same
 * way. RFC 6266 answers this with two parameters: a plain ASCII `filename`
 * that any client understands, and `filename*` carrying the real name in
 * UTF-8 for those that do. Both are sent, so nobody gets a download called
 * "route" and nobody loses the project's name either.
 */
function contentDisposition(name: string, stamp: string): string {
  const real = `${name} ${stamp}.geojson`;
  const ascii =
    name
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/["\\]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "urban-lab-project";

  return [
    "attachment",
    `filename="${ascii}-${stamp}.geojson"`,
    `filename*=UTF-8''${encodeURIComponent(real)}`,
  ].join("; ");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // No membership check of its own: every one of these reads goes through the
  // same RLS policy the rest of the app does, so a stranger gets empty
  // results and the 404 below. A second check here could only drift from the
  // real one.
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, description, statement, public_slug")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!project) {
    return new Response("Not found", { status: 404 });
  }

  const [layersResult, itemsResult] = await Promise.all([
    supabase
      .from("layers")
      .select("id, name, color")
      .eq("project_id", id)
      .order("created_at"),
    supabase
      .from("items")
      .select(
        "id, layer_id, type, category, title, body, attribution, tags, date_start, media, geometry, located_by, created_at"
      )
      .eq("project_id", id)
      .is("deleted_at", null)
      .order("created_at"),
  ]);

  // An export that silently drops half the archive is worse than no export,
  // because the file looks complete. Fail loudly instead.
  if (layersResult.error || itemsResult.error) {
    return new Response(
      `Export failed: ${(layersResult.error ?? itemsResult.error)?.message}`,
      { status: 500 }
    );
  }

  const layers = layersResult.data ?? [];
  const items = (itemsResult.data ?? []) as ItemRow[];
  const layerById = new Map(layers.map((l) => [l.id, l]));

  const itemIds = items.map((i) => i.id);
  const { data: linkRows } = itemIds.length
    ? await supabase
        .from("item_links")
        .select("item_a, item_b, note")
        .in("item_a", itemIds)
    : { data: [] };

  // Trashed items are left out. They are recoverable inside the app, and a
  // file that quietly contains work the group believes it deleted is not an
  // archive of the project - it is a leak of it.
  const features = items.map((item) => {
    const layer = item.layer_id ? layerById.get(item.layer_id) : null;
    return {
      type: "Feature" as const,
      // Null where there is no location. Not a placeholder coordinate, not
      // the perimeter's corner: the absence itself is the record.
      geometry: item.geometry,
      properties: {
        id: item.id,
        title: item.title,
        type: item.type,
        category: item.category,
        layer: layer?.name ?? null,
        layer_color: layer?.color ?? null,
        /** See `location_claims` at the top of the file. Null means unknown. */
        located_by: item.located_by,
        body: item.body,
        attribution: item.attribution,
        tags: item.tags ?? [],
        date: item.date_start,
        added_at: item.created_at,
        media: (item.media ?? []).map((m) => ({ url: m.url, type: m.type })),
      },
    };
  });

  const stamp = new Date().toISOString().slice(0, 10);

  const collection = {
    type: "FeatureCollection" as const,
    name: project.name,
    features,
    // Foreign members: RFC 7946 §6.1. Ignored by readers that only know
    // GeoJSON, which still get every feature above.
    urban_lab: {
      format: 1,
      exported_at: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        statement: project.statement,
        published: Boolean(project.public_slug),
      },
      counts: {
        items: items.length,
        placed: features.filter((f) => f.geometry !== null).length,
        unplaced: features.filter((f) => f.geometry === null).length,
        layers: layers.length,
      },
      /**
       * What each coordinate claims. The file carries this so that it can be
       * read without the app, which is the only reason the file exists.
       */
      location_claims: PLACEMENT_MEANINGS,
      unplaced_note:
        "A feature with a null geometry has no location at all - a reading, a general source, a note on method. It was never given a coordinate, and none is invented here.",
      /**
       * GeoJSON has no way to say that one feature explains another, and
       * "this article explains that photograph" is often the finding itself.
       * Stored as recorded, by id, rather than forced into the features.
       */
      links: (linkRows ?? []).map((l) => ({
        from: l.item_a,
        to: l.item_b,
        note: l.note,
      })),
      layers: layers.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })),
    },
  };

  return new Response(JSON.stringify(collection, null, 2), {
    headers: {
      "Content-Type": "application/geo+json; charset=utf-8",
      "Content-Disposition": contentDisposition(project.name, stamp),
      // The archive is the members' own material; nothing should hold a copy
      // between them and it.
      "Cache-Control": "no-store, private",
    },
  });
}
