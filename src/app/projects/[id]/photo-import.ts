"use client";

import { gps as exifGps, parse as exifParse } from "exifr";

export type PreparedPhoto = {
  file: File;
  /** [lng, lat] in GeoJSON order, or null when the photo carries no GPS. */
  coordinates: [number, number] | null;
  /** YYYY-MM-DD from EXIF DateTimeOriginal, for the item's date field. */
  date: string | null;
  converted: boolean;
};

/**
 * Decodes HEIC through libheif compiled to WASM and re-encodes as JPEG.
 *
 * Uses libheif-js rather than heic2any: the latter bundles an older libheif
 * that answers `ERR_LIBHEIF format not supported` for the tiled HEICs iPhones
 * actually produce. Native libheif (via sharp) refuses them too, for having
 * more tile references than its default security limit allows.
 *
 * Loaded on demand - it's a megabyte-plus of WASM that most sessions never
 * need, and nothing else on the page depends on it.
 */
async function heicToJpeg(file: File): Promise<Blob> {
  const libheif = (await import("libheif-js/wasm-bundle")).default;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await file.arrayBuffer()));

  const image = images?.[0];
  if (!image) throw new Error("no image found in file");

  const width = image.get_width();
  const height = image.get_height();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  const imageData = ctx.createImageData(width, height);
  await new Promise<void>((resolve, reject) => {
    image.display(imageData, (result: ImageData | null) => {
      if (result) resolve();
      else reject(new Error("libheif could not render the image"));
    });
  });
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85)
  );
  if (!blob) throw new Error("JPEG encoding failed");
  return blob;
}

function isHeic(file: File) {
  return (
    /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
  );
}

/**
 * Reads a photo's location and date, and converts HEIC to JPEG.
 *
 * Order matters: EXIF is read from the *original* file, because conversion
 * discards metadata. Doing it the other way round silently loses the location
 * of every iPhone photo.
 *
 * Conversion runs in the browser rather than on the server: it's libheif
 * compiled to WASM either way, and doing it here keeps a bulk import off the
 * serverless budget and shrinks what gets uploaded. It also handles the tiled
 * HEICs iPhones actually produce, which native libheif rejects by default for
 * having more tile references than its security limit allows.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let coordinates: [number, number] | null = null;
  let date: string | null = null;

  try {
    const gps = await exifGps(file);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      coordinates = [gps.longitude, gps.latitude];
    }
  } catch {
    // No GPS, or a format exifr can't read. Not an error - most photos from a
    // dedicated camera have no GPS at all, and messaging apps strip it.
  }

  try {
    const meta = await exifParse(file, ["DateTimeOriginal"]);
    if (meta?.DateTimeOriginal instanceof Date) {
      date = meta.DateTimeOriginal.toISOString().slice(0, 10);
    }
  } catch {
    // Same - a missing date is normal, not a failure.
  }

  if (!isHeic(file)) {
    return { file, coordinates, date, converted: false };
  }

  // Browsers can't render HEIC, so an unconverted upload would look like a
  // broken image with no explanation.
  let converted: Blob;
  try {
    converted = await heicToJpeg(file);
  } catch (e) {
    // Surface why, rather than a bare "failed" - the caller shows this to
    // someone who has to decide what to do about the file.
    const reason =
      e instanceof Error
        ? e.message
        : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : String(e);
    throw new Error(`Couldn't convert ${file.name} from HEIC: ${reason}`);
  }

  const jpegName = file.name.replace(/\.hei[cf]$/i, "") + ".jpg";
  return {
    file: new File([converted], jpegName, { type: "image/jpeg" }),
    coordinates,
    date,
    converted: true,
  };
}
