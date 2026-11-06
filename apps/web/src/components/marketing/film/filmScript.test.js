import { test } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHAPTERS, LOOKS, VARIANTS } from "./filmScript";

const publicFile = (path) => fileURLToPath(new URL(`../../../../public${path}`, import.meta.url));

test("chapters move through neighbouring looks, the only change the scan plane can wipe", () => {
  CHAPTERS.forEach((chapter, i) => {
    assert.ok(LOOKS[chapter.look], `${chapter.id} names a look that exists`);
    if (i > 0) {
      const step = chapter.look - CHAPTERS[i - 1].look;
      assert.ok(step === 0 || step === 1, `${chapter.id} steps by ${step}`);
    }
  });
  assert.equal(CHAPTERS.at(-1).look, LOOKS.length - 1);
});

test("every model a look draws is built", () => {
  for (const look of LOOKS) {
    assert.ok(existsSync(publicFile(`/models/appliances/${look.device}.glb`)), look.device);
    if (look.mode === "wire") assert.ok(existsSync(publicFile(`/models/appliances/${look.device}-wire.glb`)), look.device);
  }
});

test("every chapter has a photo for visitors who get no film", () => {
  for (const { id, fallback } of CHAPTERS) assert.ok(fallback && existsSync(publicFile(fallback)), id);
  for (const { key, image } of VARIANTS) assert.ok(existsSync(publicFile(image)), key);
});
