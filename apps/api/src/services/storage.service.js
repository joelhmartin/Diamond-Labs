import { writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Resolves to apps/api/.localfiles
const LOCAL_FILES_BASE = join(__dirname, "..", "..", ".localfiles");

/**
 * Sanitize a single path segment so it cannot escape its parent directory.
 * Neutralizes `..` (replaced with `__`) then strips path separators and colons.
 * Applied to caseId, kind, and originalName before building any object path.
 *
 * @param {string} s
 * @returns {string}
 */
function sanitizeSegment(s) {
  return String(s)
    .replace(/\.\./g, "__")    // neutralize parent-dir references
    .replace(/[/\\:]/g, "_");  // strip path separators and colons
}

/**
 * Upload a case file to GCS (production) or local disk (dev fallback).
 *
 * Reads process.env.RX_GCS_BUCKET at call time so tests can run without
 * loading the full env schema (env.js calls process.exit on validation failure).
 *
 * @param {{ caseId: string, kind: string, buffer: Buffer, originalName: string, contentType?: string }} opts
 * @returns {Promise<{ gcsUrl: string, size: number }>}
 */
export async function uploadCaseFile({ caseId, kind, buffer, originalName, contentType }) {
  // --- input validation ---
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("uploadCaseFile: buffer must be a Buffer");
  }
  if (!caseId || typeof caseId !== "string") {
    throw new Error("uploadCaseFile: caseId must be a non-empty string");
  }
  if (!kind || typeof kind !== "string") {
    throw new Error("uploadCaseFile: kind must be a non-empty string");
  }

  // Sanitize ALL path segments so none can escape via traversal or separator injection.
  const safeCaseId = sanitizeSegment(caseId);
  const safeKind = sanitizeSegment(kind);
  const safeName = sanitizeSegment(String(originalName || "file"));
  const objectPath = `rx-cases/${safeCaseId}/${safeKind}/${crypto.randomUUID()}-${safeName}`;

  const bucket = process.env.RX_GCS_BUCKET;

  if (bucket) {
    // --- GCS path (production / Cloud Run with ADC) ---
    // Dynamic import keeps the GCS SDK out of the module graph when not needed
    // (dev fallback path, tests). The package is still listed as a runtime dep.
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage();
    const file = storage.bucket(bucket).file(objectPath);
    try {
      await file.save(buffer, { contentType });
    } catch (err) {
      console.error("[storage] GCS upload failed", { bucket, objectPath, err: err.message });
      throw err;
    }
    return { gcsUrl: `gs://${bucket}/${objectPath}`, size: buffer.length };
  }

  // --- dev fallback: local disk ---
  console.warn("[STORAGE] RX_GCS_BUCKET not configured — writing to local disk (dev mode)");
  const absPath = join(LOCAL_FILES_BASE, objectPath);

  // Defense-in-depth: even after sanitization, assert the resolved path can't
  // escape the .localfiles base directory (guards against any sanitizer gap).
  if (!absPath.startsWith(LOCAL_FILES_BASE)) {
    throw new Error(`[storage] invalid storage path: resolved path escapes base dir`);
  }

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, buffer);
  return { gcsUrl: `file://${absPath}`, size: buffer.length };
}

/**
 * Issue a short-lived signed READ URL for a stored file (HIPAA: PHI files are
 * never served via public or long-lived links).
 *
 *   gs://<bucket>/<object>  → a V4 signed GCS URL, valid for `ttlSeconds`.
 *   file://<abs>            → the file:// URL unchanged (dev fallback; the dev
 *                             box has no GCS to sign against).
 *
 * Signing requires the runtime identity to have the `iam.serviceAccounts.signBlob`
 * permission (role: Service Account Token Creator) on its own service account —
 * see operator notes. Never embeds credentials in the URL.
 *
 * @param {string} gcsUrl
 * @param {number} [ttlSeconds=300]
 * @returns {Promise<string>}
 */
export async function getSignedReadUrl(gcsUrl, ttlSeconds = 300) {
  if (typeof gcsUrl !== "string" || gcsUrl.length === 0) {
    throw new Error("getSignedReadUrl: gcsUrl must be a non-empty string");
  }

  if (gcsUrl.startsWith("gs://")) {
    const withoutScheme = gcsUrl.slice("gs://".length);
    const slashIdx = withoutScheme.indexOf("/");
    if (slashIdx < 0) {
      throw new Error(`getSignedReadUrl: malformed gs:// URL: ${gcsUrl}`);
    }
    const bucket = withoutScheme.slice(0, slashIdx);
    const objectPath = withoutScheme.slice(slashIdx + 1);
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage();
    const [url] = await storage
      .bucket(bucket)
      .file(objectPath)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + ttlSeconds * 1000,
      });
    return url;
  }

  if (gcsUrl.startsWith("file://")) {
    // Dev fallback: no GCS to sign against. Return the local URL as-is; dev
    // serves these files directly.
    return gcsUrl;
  }

  throw new Error(`getSignedReadUrl: unrecognised URL scheme: ${gcsUrl}`);
}

/**
 * Best-effort delete of a stored file.  Handles both local dev paths
 * (file://<abs>) and GCS objects (gs://<bucket>/<path>).
 * Never throws — logs on error so the caller can proceed without crashing.
 *
 * @param {string} gcsUrl
 */
export async function deleteStoredFile(gcsUrl) {
  try {
    if (gcsUrl.startsWith("file://")) {
      const filePath = gcsUrl.slice("file://".length);
      await rm(filePath, { force: true }); // force: ignore ENOENT
    } else if (gcsUrl.startsWith("gs://")) {
      // gs://<bucket>/<objectPath>
      const withoutScheme = gcsUrl.slice("gs://".length);
      const slashIdx = withoutScheme.indexOf("/");
      const bucket = withoutScheme.slice(0, slashIdx);
      const objectPath = withoutScheme.slice(slashIdx + 1);
      const { Storage } = await import("@google-cloud/storage");
      const storage = new Storage();
      await storage.bucket(bucket).file(objectPath).delete({ ignoreNotFound: true });
    } else {
      console.warn("[storage] deleteStoredFile: unrecognised URL scheme", gcsUrl);
    }
  } catch (err) {
    console.error("[storage] deleteStoredFile: best-effort delete failed", {
      gcsUrl,
      err: err.message,
    });
  }
}
