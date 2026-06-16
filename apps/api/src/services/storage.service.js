import { writeFile, mkdir } from "node:fs/promises";
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
