"use client";

import { gps as exifGps, parse as exifParse } from "exifr";

export type PreparedPhoto = {
  file: File;
  /** [lng, lat] in GeoJSON order, or null when the photo carries no GPS. */
  coordinates: [number, number] | null;
  /** YYYY-MM-DD from EXIF DateTimeOriginal, for the item's date field. */
  date: string | null;
  /** True when the source was HEIC and had to be re-encoded to be viewable. */
  converted: boolean;
  /** True when the image was larger than MAX_EDGE and got scaled down. */
  resized?: boolean;
};

/**
 * Longest edge a stored photo is allowed to have.
 *
 * A modern phone or mirrorless camera produces roughly 4000px, which is far
 * more than a map panel ever shows and adds up fast: a semester of fieldwork
 * at full size would exhaust Supabase's free storage tier and make the editor
 * slow to load. 2400px still prints and crops comfortably.
 */
const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.85;

function scaledSize(width: number, height: number) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scaled: scale < 1,
  };
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) throw new Error("JPEG encoding failed");
  return blob;
}

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
async function heicToJpeg(
  file: File
): Promise<{ blob: Blob; resized: boolean }> {
  const libheif = (await import("libheif-js/wasm-bundle")).default;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await file.arrayBuffer()));

  const image = images?.[0];
  if (!image) throw new Error("no image found in file");

  const width = image.get_width();
  const height = image.get_height();

  // libheif hands back raw pixels, which only putImageData accepts - and that
  // ignores any transform. So the full-size buffer is written first, then
  // drawn down to the target size in a second pass.
  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  const fullCtx = full.getContext("2d");
  if (!fullCtx) throw new Error("canvas unavailable");

  const imageData = fullCtx.createImageData(width, height);
  await new Promise<void>((resolve, reject) => {
    image.display(imageData, (result: ImageData | null) => {
      if (result) resolve();
      else reject(new Error("libheif could not render the image"));
    });
  });
  fullCtx.putImageData(imageData, 0, 0);

  const target = scaledSize(width, height);
  if (!target.scaled) {
    return { blob: await canvasToJpeg(full), resized: false };
  }

  const out = document.createElement("canvas");
  out.width = target.width;
  out.height = target.height;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("canvas unavailable");
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(full, 0, 0, target.width, target.height);
  return { blob: await canvasToJpeg(out), resized: true };
}

/**
 * Shrinks an already-decodable image to MAX_EDGE, or returns it untouched if
 * it's already small enough - re-encoding a file that doesn't need it would
 * only throw away quality.
 *
 * `imageOrientation: "from-image"` matters: re-encoding drops the EXIF
 * orientation flag, so without baking the rotation into the pixels every
 * portrait photo would come out on its side.
 */
async function downscale(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null; // Not decodable here (SVG, an odd codec) - upload it as-is.
  }

  const target = scaledSize(bitmap.width, bitmap.height);
  if (!target.scaled) {
    bitmap.close();
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close();
  return canvasToJpeg(canvas);
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
    const smaller = await downscale(file);
    if (!smaller) return { file, coordinates, date, converted: false };

    const jpegName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return {
      file: new File([smaller], jpegName, { type: "image/jpeg" }),
      coordinates,
      date,
      converted: false,
      resized: true,
    };
  }

  // Browsers can't render HEIC, so an unconverted upload would look like a
  // broken image with no explanation.
  let converted: { blob: Blob; resized: boolean };
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
    file: new File([converted.blob], jpegName, { type: "image/jpeg" }),
    coordinates,
    date,
    converted: true,
    resized: converted.resized,
  };
}
