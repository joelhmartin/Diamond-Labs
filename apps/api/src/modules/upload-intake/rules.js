import { INTAKE_ACCEPTED_EXTENSIONS } from "@my-app/shared";

export class IntakeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IntakeError";
    this.code = code; // NOT_FOUND | INVALID | CONFLICT
  }
}

const extensionOf = (name) => {
  const i = String(name).lastIndexOf(".");
  return i < 0 ? "" : String(name).slice(i).toLowerCase();
};

/** Null when the file type is accepted, else the message shown for that file. */
export function refusalFor(name) {
  return INTAKE_ACCEPTED_EXTENSIONS.includes(extensionOf(name))
    ? null
    : `"${name}" was not added: ${extensionOf(name) || "this"} files are not accepted (use ${INTAKE_ACCEPTED_EXTENSIONS.join(", ")}).`;
}

/**
 * Splits dropped files into the intakes to create. Refused files are named and
 * left out; the rest proceed. split "one" = one intake for all; "per_file" = one each.
 * `reason` is name-free (a screen can count by it without echoing file names).
 *
 * @returns {{ groups: Array<Array<object>>, refused: Array<{ name: string, reason: string, message: string }> }}
 */
export function planIntakes(files, split = "one") {
  if (split !== "one" && split !== "per_file") throw new IntakeError("INVALID", "Unknown split.");
  const ok = [];
  const refused = [];
  for (const f of files) {
    const message = refusalFor(f.originalName);
    if (message) refused.push({ name: f.originalName, reason: "unsupported type", message });
    else ok.push(f);
  }
  if (!ok.length) return { groups: [], refused };
  return { groups: split === "per_file" ? ok.map((f) => [f]) : [ok], refused };
}
