import { test } from "vitest";
import assert from "node:assert/strict";
import { checkImageFile } from "./ImageUploadField.jsx";

test("accepts the four web image types up to 5 MB", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
    assert.equal(checkImageFile({ type, size: 1024 }), null, type);
  }
  assert.equal(checkImageFile({ type: "image/png", size: 5 * 1024 * 1024 }), null);
});

test("refuses other types and oversized files with a message the admin can act on", () => {
  assert.match(checkImageFile({ type: "image/svg+xml", size: 10 }), /JPEG, PNG, WebP or GIF/);
  assert.match(checkImageFile({ type: "application/pdf", size: 10 }), /JPEG, PNG, WebP or GIF/);
  assert.match(checkImageFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 }), /over 5 MB/);
  assert.ok(checkImageFile(null));
});
