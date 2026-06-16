import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Resolves to apps/api/.localfiles
const LOCAL_FILES_BASE = join(__dirname, "..", "..", ".localfiles");

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

  // Sanitize originalName: strip path separators and colons so the name is
  // safe to embed in a GCS object path or a local filesystem path.
  const safeName = String(originalName || "file").replace(/[/\\:]/g, "_");
  const objectPath = `rx-cases/${caseId}/${kind}/${crypto.randomUUID()}-${safeName}`;

  const bucket = process.env.RX_GCS_BUCKET;

  if (bucket) {
    // --- GCS path (production / Cloud Run with ADC) ---
    // Dynamic import keeps the GCS SDK out of the module graph when not needed
    // (dev fallback path, tests). The package is still listed as a runtime dep.
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage();
    const file = storage.bucket(bucket).file(objectPath);
    await file.save(buffer, { contentType });
    return { gcsUrl: `gs://${bucket}/${objectPath}`, size: buffer.length };
  }

  // --- dev fallback: local disk ---
  console.warn("[STORAGE] RX_GCS_BUCKET not configured — writing to local disk (dev mode)");
  const absPath = join(LOCAL_FILES_BASE, objectPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, buffer);
  return { gcsUrl: `file://${absPath}`, size: buffer.length };
}
