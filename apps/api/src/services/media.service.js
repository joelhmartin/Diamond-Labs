import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

/**
 * Public media (product / catalog images) — uploaded by admins, shown to anyone.
 *
 * Kept apart from storage.service.js on purpose: that module writes Rx case
 * files (PHI) to a private bucket. Media lives in its own bucket
 * (MEDIA_GCS_BUCKET) and is served by GET /api/v1/media/:name, so the bucket
 * itself never needs public access. Local dev falls back to apps/api/.localfiles/media.
 *
 * Images are stored under a random UUID name, never the uploader's filename, and
 * the type is decided by the file's magic bytes rather than its extension or
 * the browser-supplied Content-Type.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_MEDIA_DIR = join(__dirname, "..", "..", ".localfiles", "media");

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const TYPES = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** A stored media name: `<uuid>.<ext>`. Anything else is rejected before any I/O. */
export const MEDIA_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/;

/** Identify an image by its first bytes. Returns the extension, or null. */
export function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a") return "gif";
  return null;
}

export const contentTypeFor = (name) => TYPES[name.split(".").pop()];

async function bucket() {
  const name = process.env.MEDIA_GCS_BUCKET;
  if (!name) return null;
  const { Storage } = await import("@google-cloud/storage");
  return new Storage().bucket(name);
}

/**
 * Store an uploaded image. Throws `{ code: "INVALID_IMAGE" | "IMAGE_TOO_LARGE" }`
 * for bad input. Returns the stored name and the public URL path to use.
 */
export async function saveImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw Object.assign(new Error("Empty upload."), { code: "INVALID_IMAGE" });
  if (buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error("Image is larger than 5 MB."), { code: "IMAGE_TOO_LARGE" });
  const ext = sniffImageType(buffer);
  if (!ext) throw Object.assign(new Error("Only JPEG, PNG, WebP and GIF images are accepted."), { code: "INVALID_IMAGE" });

  const name = `${crypto.randomUUID()}.${ext}`;
  const b = await bucket();
  if (b) {
    await b.file(`media/${name}`).save(buffer, { contentType: TYPES[ext], resumable: false });
  } else {
    await mkdir(LOCAL_MEDIA_DIR, { recursive: true });
    await writeFile(join(LOCAL_MEDIA_DIR, name), buffer);
  }
  return { name, url: `/api/v1/media/${name}` };
}

/** Read a stored image by name, or null if the name is invalid or absent. */
export async function readImage(name) {
  if (!MEDIA_NAME.test(String(name))) return null;
  try {
    const b = await bucket();
    if (b) {
      const [buffer] = await b.file(`media/${name}`).download();
      return { buffer, contentType: contentTypeFor(name) };
    }
    return { buffer: await readFile(join(LOCAL_MEDIA_DIR, name)), contentType: contentTypeFor(name) };
  } catch (err) {
    if (err?.code === 404 || err?.code === "ENOENT") return null;
    throw err;
  }
}
