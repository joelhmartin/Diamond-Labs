import { describe, it, expect, beforeAll } from "vitest";
import assert from "node:assert/strict";

// Set a deterministic key before importing the crypto-backed module (the key is
// read at import time inside lib/crypto.js).
beforeAll(() => {
  process.env.PHI_ENCRYPTION_KEY =
    process.env.PHI_ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const phi = await import("./phi-crypto.js");
const { encryptRxPhi, decryptRxPhi } = phi;
const { isEncrypted } = await import("../../lib/crypto.js");
const { buildSeazonaOrderPayload } = await import("./build-order-payload.js");
const { DEVICE_ROWS } = await import("./catalog-map/devices.table.js");

const plaintextRow = {
  id: "case-1",
  caseNumber: "RX-ABC",
  userId: "user-1",
  seazonaClientId: "client-1",
  patientFirst: "Jane",
  patientLast: "Doe",
  dob: "1990-01-01",
  contactPhone: "555-123-4567",
  generalComments: "cover 1st molar to 1st molar",
  shipTo: { name: "Dr. Smith", address1: "1 Main St", city: "Austin" },
  formData: { q1: "yes", q2: ["a", "b"] },
  deviceOptions: { baseMaterial: "Nylon", occlusalContact: "Posterior" },
  dueDate: "2026-07-01",
  deviceKey: "ddso",
  // A non-PHI field should be untouched.
  gender: "F",
};

describe("rx phi-crypto helpers", () => {
  it("encryptRxPhi encrypts exactly the PHI fields and leaves others alone", () => {
    const enc = encryptRxPhi(plaintextRow);
    // PHI text fields
    for (const f of ["patientFirst", "patientLast", "dob", "contactPhone", "generalComments"]) {
      expect(isEncrypted(enc[f])).toBe(true);
    }
    // PHI JSON blobs → encrypted strings
    for (const f of ["shipTo", "formData", "deviceOptions"]) {
      expect(typeof enc[f]).toBe("string");
      expect(isEncrypted(enc[f])).toBe(true);
    }
    // Non-PHI untouched
    expect(enc.gender).toBe("F");
    expect(enc.caseNumber).toBe("RX-ABC");
    // Source object not mutated
    expect(plaintextRow.patientFirst).toBe("Jane");
  });

  it("decryptRxPhi round-trips back to the original plaintext values", () => {
    const enc = encryptRxPhi(plaintextRow);
    const dec = decryptRxPhi(enc);
    expect(dec.patientFirst).toBe("Jane");
    expect(dec.patientLast).toBe("Doe");
    expect(dec.dob).toBe("1990-01-01");
    expect(dec.contactPhone).toBe("555-123-4567");
    expect(dec.generalComments).toBe("cover 1st molar to 1st molar");
    expect(dec.shipTo).toEqual({ name: "Dr. Smith", address1: "1 Main St", city: "Austin" });
    expect(dec.formData).toEqual({ q1: "yes", q2: ["a", "b"] });
    expect(dec.deviceOptions).toEqual({ baseMaterial: "Nylon", occlusalContact: "Posterior" });
  });

  it("passes through null PHI fields", () => {
    const enc = encryptRxPhi({ patientFirst: "A", patientLast: "B", dob: null, shipTo: null, deviceOptions: null });
    expect(enc.dob).toBe(null);
    expect(enc.shipTo).toBe(null);
    expect(enc.deviceOptions).toBe(null);
    const dec = decryptRxPhi(enc);
    expect(dec.dob).toBe(null);
    expect(dec.shipTo).toBe(null);
    expect(dec.deviceOptions).toBe(null);
  });

  it("build-order-payload receives PLAINTEXT after decrypting an encrypted row", () => {
    // Build a valid codeToId from the real device table so the pipeline resolves.
    const codeToId = {};
    for (const row of DEVICE_ROWS) if (row.code) codeToId[row.code] = `id-${row.code}`;

    const encrypted = encryptRxPhi(plaintextRow);
    // Simulate the route boundary: decrypt what came out of the DB, THEN build.
    const decrypted = decryptRxPhi(encrypted);
    const { payload } = buildSeazonaOrderPayload(decrypted, { codeToId, userId: "lab-staff-1" });

    assert.equal(payload.patientName, "Jane Doe"); // plaintext names
    assert.match(payload.notes, /Occlusal Contact: Posterior/); // plaintext deviceOptions
    assert.match(payload.notes, /cover 1st molar to 1st molar/); // plaintext generalComments
    assert.equal(payload.clientId, "client-1");
  });
});
