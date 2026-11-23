/**
 * The kinds of thing a group can record, and what the long field is called
 * for each.
 *
 * Lives here rather than in the map editor because the editor is not the only
 * place items are made any more: the field page records them from the street
 * and must offer exactly the same vocabulary. Two lists would drift, and the
 * drift would show up as a type that exists on one screen and not the other.
 */
export const TYPE_OPTIONS: { value: string; label: string; bodyLabel: string }[] = [
  { value: "text", label: "Text / Note", bodyLabel: "Notes, reflection…" },
  { value: "quote", label: "Quote", bodyLabel: "The quoted text" },
  { value: "interview", label: "Interview", bodyLabel: "Transcript (full or excerpt)" },
  { value: "document", label: "Document / Citation", bodyLabel: "Description" },
  { value: "data", label: "Data", bodyLabel: "A stat, number, or short data note" },
  { value: "image", label: "Image", bodyLabel: "Caption" },
  // The senses a street is recorded through besides looking. Kept as separate
  // types rather than tags because they behave differently: sound carries a
  // recording, smell and touch are described in words and can only be
  // photographed at second hand.
  { value: "sound", label: "Sound", bodyLabel: "What is heard here" },
  { value: "smell", label: "Smell", bodyLabel: "What it smells of, and when" },
  { value: "touch", label: "Touch / Material", bodyLabel: "Surface, texture, temperature" },
  { value: "link", label: "Web link", bodyLabel: "What's at this link, and why it matters" },
  { value: "video", label: "Video", bodyLabel: "Notes on the video" },
  { value: "composite", label: "Composite (mixed)", bodyLabel: "Notes" },
];

/**
 * The types worth reaching first with one hand on a street corner.
 *
 * A photograph, and then the three senses that have no file to carry them -
 * which are the whole reason a reading has to be taken on the spot, since
 * nothing in a sound or a smell records where it was. A plain note closes the
 * set. The rest are a tap further on, in the full list.
 */
export const FIELD_FIRST_TYPES = ["image", "sound", "smell", "touch", "text"];
