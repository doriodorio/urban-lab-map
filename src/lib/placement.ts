import type { Geometry } from "./perimeter";

/**
 * What a coordinate on this map claims.
 *
 * A pin asserts something, and until now it asserted the same thing whatever
 * put it there. For a photograph with GPS that assertion is a measurement;
 * for an article about a street it is a subject. Conflating the two is the
 * one thing a research archive cannot afford, because it is what makes
 * density stop being evidence: twelve articles dropped around one street read
 * as twelve findings standing in it.
 *
 * The answer is not to refuse the article - the gap between what was written
 * about a place and what you find standing in it is often the whole finding -
 * but to record which kind of claim each coordinate is. That is lineage, and
 * it is the GIS discipline's own standard: a coordinate with a documented
 * origin is sound, an undocumented one is not.
 *
 *   'photo'    - the coordinates came out of the photograph's own GPS. The
 *                camera stood here, to within a few metres.
 *   'moved'    - began as one of those and was then moved by hand. The
 *                photograph still vouches for the picture, not for the place.
 *   'device'   - the phone measured it while someone stood there. No
 *                photograph to carry the reading, which is the usual case
 *                for a sound, a smell or a surface: the person holding the
 *                device is the instrument. A measurement, like 'photo'.
 *   'surveyed' - someone says they were here. A claim, not a measurement, but
 *                an explicit one.
 *   'about'    - the coordinate is the item's SUBJECT, not its origin. The
 *                article is about this place; it was not made here.
 *   'unplaced' - no location at all: a theoretical note, a general source.
 *                The row carries no coordinate, and the item is drawn in the
 *                margin beside the map rather than on it.
 *   null       - unknown. Every item recorded before any of this was tracked,
 *                and claiming a precision nobody can vouch for is the worse
 *                mistake.
 */
export type Placement =
  | "photo"
  | "device"
  | "moved"
  | "surveyed"
  | "about"
  | "unplaced"
  | null;

/**
 * The same vocabulary in words, for readers who do not have this file.
 *
 * It is written into every GeoJSON export. A `located_by` of "about" means
 * nothing to QGIS, to a colleague opening the archive in five years, or to
 * the student who graduated - and it is precisely the value that must not be
 * mistaken for a measurement. The distinction only survives the tool if it
 * travels with the data.
 *
 * Keyed by the stored value; "null" is spelled out because an export has to
 * account for the rows that predate any of this.
 */
export const PLACEMENT_MEANINGS: Record<string, string> = {
  photo:
    "The coordinate came from the photograph's own GPS. The camera stood here, to within a few metres.",
  device:
    "The device measured this position while someone stood there, with no photograph to carry the reading. A measurement, in the same sense as 'photo'.",
  moved:
    "Began as an instrument's own reading - a photograph's GPS, or the device's - and was then moved by hand. The reading vouches for the material, not for the place.",
  surveyed:
    "Someone states they were here. An explicit claim rather than a measurement.",
  about:
    "The coordinate is the item's SUBJECT, not its origin. The material is about this place; it was not made here.",
  unplaced:
    "No location at all. The item carries no coordinate and is shown beside the map rather than on it.",
  null: "Unknown. Recorded before the origin of coordinates was tracked; no precision is claimed for it.",
};

const CLAIMS: readonly string[] = [
  "photo",
  "device",
  "moved",
  "surveyed",
  "about",
  "unplaced",
];

/** Narrows whatever came off a form or out of the database. */
export function asPlacement(value: unknown): Placement {
  return typeof value === "string" && CLAIMS.includes(value)
    ? (value as Placement)
    : null;
}

/**
 * Types recorded by standing somewhere. You cannot smell a street from the
 * library, so there is nothing to ask about them.
 */
const ALWAYS_SURVEYED = new Set(["sound", "smell", "touch"]);

/**
 * Whether the form should ask what the coordinate means.
 *
 * Not for the senses, which answer themselves, and not when an instrument has
 * already answered - a camera's own GPS, or the device's while someone stood
 * there, is a better witness than a tired student at eleven at night, and
 * asking anyway invites the reading to be overridden.
 */
export function asksPlacement(type: string, measured: Placement): boolean {
  return !ALWAYS_SURVEYED.has(type) && measured === null;
}

/**
 * Whether an item's position counts as a statement about where the group
 * worked.
 *
 * Used for the project perimeter, which is derived rather than drawn - a
 * study area of "wherever our material turned out to be". An article about a
 * neighbourhood is material, but nobody walked to it, so letting it stretch
 * the rectangle would make the project claim ground it never covered.
 */
export function isSurveyed(located: string | null): boolean {
  return located !== "about" && located !== "unplaced";
}

/**
 * The geometries the perimeter is entitled to enclose.
 *
 * Drops the two kinds it is not: an 'about' item, which has a coordinate that
 * is a subject rather than a position, and an item with no coordinate at all,
 * which is drawn in the margin beside the map. Leaving the second in would be
 * a runaway as well as a falsehood - the margin column is placed relative to
 * the perimeter, so a perimeter that grew to enclose it would push it further
 * out, and so on.
 */
export function surveyedGeometries(
  items: { geometry: Geometry | null; located_by: string | null }[]
): Geometry[] {
  return items
    .filter((i) => isSurveyed(i.located_by))
    .map((i) => i.geometry)
    .filter((g): g is Geometry => g !== null);
}

/** An item with no location at all, shown in the margin rather than on the map. */
export function isUnplaced(item: { geometry: unknown }): boolean {
  return item.geometry === null;
}

/**
 * How a mark is drawn for each kind of claim, so the editor and the published
 * view cannot drift apart on what a shape means.
 *
 * Round for a measurement - a photograph's GPS and the device's own fix are
 * the same kind of claim - square for a judgement, and dashed for a
 * coordinate that is a subject rather than a position - the same dash the
 * perimeter is drawn with, which already means "an annotation over the map;
 * nothing on the ground marks this".
 */
export function markStyle(
  located: string | null,
  color: string
): { size: number; borderRadius: string; border: string; background: string } {
  const round =
    located === "photo" || located === "device" || located === "moved";
  const hollow = located === "moved" || located === "about";
  return {
    // A square reads as larger than a circle of the same width, so it is
    // drawn slightly smaller to sit level with its neighbours in a mixed set.
    size: round ? 16 : 14,
    borderRadius: round ? "50%" : "2px",
    border:
      located === "about"
        ? `2px dashed ${color}`
        : hollow
          ? `2px solid ${color}`
          : "2px solid white",
    background: hollow ? "#ffffff" : color,
  };
}
