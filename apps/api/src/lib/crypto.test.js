import { describe, it, expect, beforeAll } from "vitest";

// Set a deterministic key before importing the module (env is read at import time).
beforeAll(() => {
  process.env.PHI_ENCRYPTION_KEY =
    process.env.PHI_ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const mod = await import("./crypto.js");
const { encryptField, decryptField, encryptJson, decryptJson, isEncrypted } = mod;

describe("crypto field encryption", () => {
  it("round-trips a string", () => {
    const ct = encryptField("Jane Patient");
    expect(ct).toMatch(/^enc:v1:/);
    expect(decryptField(ct)).toBe("Jane Patient");
  });

  it("produces a different ciphertext each call (random IV) but same plaintext", () => {
    const a = encryptField("1990-01-01");
    const b = encryptField("1990-01-01");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("1990-01-01");
    expect(decryptField(b)).toBe("1990-01-01");
  });

  it("passes through null/undefined unchanged", () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeUndefined();
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeUndefined();
  });

  it("passes through unprefixed (un-migrated / plaintext) values on decrypt", () => {
    expect(decryptField("plain text patient name")).toBe("plain text patient name");
  });

  it("detects tampering via the GCM auth tag", () => {
    const ct = encryptField("secret");
    // Flip a character in the base64 body.
    const body = ct.slice("enc:v1:".length);
    const tampered =
      "enc:v1:" + (body[0] === "A" ? "B" : "A") + body.slice(1);
    expect(() => decryptField(tampered)).toThrow();
  });

  it("round-trips JSON objects", () => {
    const obj = { line1: "1 Main St", city: "Dallas", nested: { x: [1, 2, 3] } };
    const ct = encryptJson(obj);
    expect(isEncrypted(ct)).toBe(true);
    expect(decryptJson(ct)).toEqual(obj);
  });

  it("decryptJson passes through already-parsed (un-migrated jsonb) objects", () => {
    const obj = { city: "Dallas" };
    expect(decryptJson(obj)).toEqual(obj);
    expect(decryptJson(null)).toBeNull();
  });

  it("isEncrypted only true for prefixed strings", () => {
    expect(isEncrypted(encryptField("x"))).toBe(true);
    expect(isEncrypted("x")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(42)).toBe(false);
  });
});
