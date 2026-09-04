/**
 * Theory or field: where a piece of material came from.
 *
 * The distinction Yona teaches is about provenance, not medium - a quote can
 * come from a book or from someone standing in the street. Item type is only a
 * proxy for that, so the type gives a starting guess and anyone can overrule it
 * on the item. Stored as null until someone does, which is what lets this work
 * on a project whose items already exist.
 */

export type Category = "theory" | "field";

export const CATEGORIES: { id: Category; label: string; blurb: string }[] = [
  {
    id: "theory",
    label: "Theory",
    blurb: "Reading, sources, and the group's own thinking.",
  },
  {
    id: "field",
    label: "Field",
    blurb: "What the group found by going and looking.",
  },
];

/**
 * The guess, from item type.
 *
 * Photographs, recordings and readings taken on site are field. Citations,
 * quotations, links and the group's own written reflection are theory. The
 * cases this gets wrong - a quote from an interviewee, a note written in the
 * street - are exactly the ones the override exists for.
 */
export function defaultCategory(type: string): Category {
  switch (type) {
    case "image":
    case "interview":
    case "video":
    case "data":
    case "composite":
    // The senses are only recorded by being there.
    case "sound":
    case "smell":
    case "touch":
      return "field";
    default:
      return "theory";
  }
}

export function itemCategory(item: {
  type: string;
  category?: string | null;
}): Category {
  return item.category === "theory" || item.category === "field"
    ? item.category
    : defaultCategory(item.type);
}

/**
 * How the field material is broken up for a reader - Yona's "interviews,
 * photos, voice", widened to cover the types the tool actually has.
 *
 * Voice is not a type of its own: it is any item carrying an audio file, which
 * in practice is an interview recording. Checking the media rather than the
 * type is what lets a recording show up as voice while its transcript still
 * reads as an interview.
 */
export function itemGroup(item: {
  type: string;
  media?: { url: string; type: string }[] | null;
}): string {
  // Type first: a sound item carries audio, and calling it Voice would put a
  // recording of traffic in with the interviews.
  switch (item.type) {
    case "sound":
      return "Sound";
    case "smell":
      return "Smell";
    case "touch":
      return "Touch & material";
  }

  if (item.media?.some((m) => m.type === "audio")) return "Voice";

  switch (item.type) {
    case "image":
      return "Photographs";
    case "interview":
      return "Interviews";
    case "video":
      return "Film";
    case "quote":
      return "Quotations";
    case "document":
      return "Documents & citations";
    case "link":
      return "Links";
    case "data":
      return "Data";
    default:
      return "Notes";
  }
}
