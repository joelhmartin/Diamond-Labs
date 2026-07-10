import crypto from "node:crypto";

// Application-level field encryption for PHI at rest (HIPAA §164.312(a)(2)(iv)).
// AES-256-GCM with a random 96-bit IV per value. Ciphertext is stored as
// `enc:v1:<base64(iv | ciphertext | authTag)>` so we can (a) recognise encrypted
// values on read and (b) version the scheme if we ever rotate algorithms.
//
// Reads are PASSTHROUGH for any value that lacks the prefix — this lets a row that
// hasn't been migrated yet, or a genuinely null/plaintext field, round-trip without
// error while `encrypt-existing-phi.js` backfills. Once everything is migrated the
// passthrough simply never triggers.

const PREFIX = "enc:v1:";
const IV_BYTES = 12; // 96-bit nonce, GCM standard
const TAG_BYTES = 16;

let cachedKey = null;

/**
 * Derive the 32-byte AES key from PHI_ENCRYPTION_KEY. Accepts a 64-char hex key,
 * a base64 key, or any string ≥32 chars (hashed to 32 bytes as a fallback).
 * @returns {Buffer}
 */
function getKey() {
  if (cachedKey) return cachedKey;
  // Read process.env directly (not via config/env.js) so this module stays
  // importable in unit tests without the full env schema. env.js separately
  // enforces that PHI_ENCRYPTION_KEY is present in production.
  const raw = process.env.PHI_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "PHI_ENCRYPTION_KEY is not set — required to encrypt/decrypt PHI at rest. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    cachedKey = Buffer.from(raw, "hex");
  } else {
    // Any other sufficiently-long secret: SHA-256 to a deterministic 32 bytes.
    cachedKey = crypto.createHash("sha256").update(raw, "utf8").digest();
  }
  return cachedKey;
}

/**
 * Encrypt a string. Returns `enc:v1:<base64>`. `null`/`undefined` pass through
 * unchanged so nullable columns stay null. Non-strings are JSON-stringified by
 * the caller (see encryptJson) — this function expects a string.
 * @param {string|null|undefined} plaintext
 * @returns {string|null|undefined}
 */
export function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined) return plaintext;
  const str = String(plaintext);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(str, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

/**
 * Decrypt a value produced by encryptField. Any value WITHOUT the `enc:v1:`
 * prefix is returned unchanged (passthrough for un-migrated / null / plaintext).
 * Throws only when a prefixed value fails authentication (tampering / wrong key).
 * @param {string|null|undefined} value
 * @returns {string|null|undefined}
 */
export function decryptField(value) {
  if (value === null || value === undefined) return value;
  const str = String(value);
  if (!str.startsWith(PREFIX)) return value; // not encrypted — passthrough
  const buf = Buffer.from(str.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Encrypt a JSON-serialisable value (object/array/etc.) into a single encrypted
 * string. Returns `null`/`undefined` unchanged. Use for jsonb PHI blobs
 * (shipTo, formData, deviceOptions).
 * @param {unknown} obj
 * @returns {string|null|undefined}
 */
export function encryptJson(obj) {
  if (obj === null || obj === undefined) return obj;
  return encryptField(JSON.stringify(obj));
}

/**
 * Inverse of encryptJson. A prefixed value is decrypted then JSON-parsed.
 * A value WITHOUT the prefix is returned as-is (already a parsed object from a
 * jsonb column that predates encryption, or null).
 * @param {unknown} value
 * @returns {unknown}
 */
export function decryptJson(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return value;
  return JSON.parse(decryptField(value));
}

/** True if a value is an `enc:v1:` ciphertext. Used by the backfill for idempotency. */
export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}
