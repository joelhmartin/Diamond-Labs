import { test } from "vitest";
import assert from "node:assert/strict";
import { compileNotes, compileNotesMulti } from "./case-notes.js";

const baseCase = {
  deviceKey: "ddso",
  deviceOptions: { baseMaterial: "Nylon", occlusalContact: "Posterior", designPreference: "Buccal-Free" },
  generalComments: "cover 1st molar to 1st molar",
  rush: false,
};

test("structured options + comments compile into notes", () => {
  const notes = compileNotes(baseCase);
  assert.match(notes, /Occlusal Contact: Posterior/);
  assert.match(notes, /Design Preference: Buccal-Free/);
  assert.match(notes, /cover 1st molar to 1st molar/);
});

test("material and modifications are NOT in notes (they are line items)", () => {
  const notes = compileNotes({ ...baseCase, deviceOptions: { baseMaterial: "Nylon", modifications: ["Labial bow"], occlusalContact: "Posterior" } });
  assert.doesNotMatch(notes, /Material:/);
  assert.doesNotMatch(notes, /Modifications:/);
  assert.doesNotMatch(notes, /Labial bow/);
  assert.match(notes, /Occlusal Contact: Posterior/);
});

test("multi-device notes name each device and the rush once", () => {
  const notes = compileNotesMulti({ rush: true, rushTier: "nylon" }, [
    { label: "DDSO", deviceOptions: { occlusalContact: "TRIPOD Occlusion" } },
    { label: "Nightguard", deviceOptions: {} },
  ]);
  assert.equal(notes, "[DDSO] Occlusal Contact: TRIPOD Occlusion | [Nightguard] | RUSH (nylon)");
});

test("clinical notes are never truncated (the 2000-char cap was Seazona's)", () => {
  const long = "x".repeat(3000);
  assert.ok(compileNotes({ ...baseCase, generalComments: long }).endsWith(long));
  const multi = compileNotesMulti({}, [{ label: "A", deviceOptions: { comments: long } }]);
  assert.ok(multi.includes(long));
});
