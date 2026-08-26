/**
 * Turns a video page URL into its embeddable player URL.
 *
 * Returns null for anything that isn't a recognised video host, and callers
 * fall back to rendering a plain link. That's deliberate: an item's URL is
 * typed in by a student and shown to whoever reads the published map, so
 * dropping arbitrary URLs into an iframe would let any page be framed inside
 * the project. Only hosts on this list are ever embedded.
 */
function parseHttpUrl(url: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return parsed;
}

/** The video id from any YouTube URL shape, or null if it isn't one. */
export function youtubeId(url: string): string | null {
  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtube.com" || host === "m.youtube.com") {
    const id = parsed.searchParams.get("v");
    if (id && isPlainId(id)) return id;
    // Already an embed link, or a /shorts/ or /live/ link.
    const path = parsed.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/);
    return path ? path[1] : null;
  }

  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    return id && isPlainId(id) ? id : null;
  }

  return null;
}

export function toVideoEmbed(url: string): string | null {
  const youtube = youtubeId(url);
  if (youtube) return `https://www.youtube.com/embed/${youtube}`;

  const parsed = parseHttpUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "vimeo.com") {
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
  }

  if (host === "player.vimeo.com") {
    const path = parsed.pathname.match(/^\/video\/(\d+)/);
    return path ? `https://player.vimeo.com/video/${path[1]}` : null;
  }

  return null;
}

/**
 * A still for a video link, for places that need a picture rather than a
 * player - the gallery view's cards, mainly.
 *
 * YouTube publishes these at a predictable path, so no API call is needed.
 * `mqdefault` is a true 16:9 crop; `hqdefault` pads widescreen video with
 * black bars, which look like part of the image once it's cropped square.
 *
 * Vimeo has no equivalent - its thumbnails are only reachable through an
 * oEmbed request - so Vimeo items fall back to the placeholder tile.
 */
export function videoThumbnail(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
}

function isPlainId(value: string) {
  return /^[\w-]{6,20}$/.test(value);
}

/** Host shown next to a plain link, so a reader can see where it goes. */
export function linkHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
