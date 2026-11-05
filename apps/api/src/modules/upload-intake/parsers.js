/**
 * Intake parsers turn a set of dropped files into "hints" for whoever turns the
 * intake into a record. A parser is { key, accepts(file) -> bool, parse(files) -> hints }.
 * Vendor-specific parsers register here later; the built-in `generic` one
 * accepts everything and extracts nothing but the file names.
 */
export function defineIntakeParser({ key, accepts, parse }) {
  if (!key || typeof accepts !== "function" || typeof parse !== "function") {
    throw new Error("An intake parser needs a key, accepts() and parse().");
  }
  return { key, accepts, parse };
}

export const genericParser = defineIntakeParser({
  key: "generic",
  accepts: () => true,
  parse: (files) => ({ files: files.map((f) => f.originalName) }),
});

/** A registry that tries parsers in registration order; `generic` is the fallback. */
export function createParserRegistry(parsers = []) {
  const list = [...parsers];
  return {
    register: (parser) => { list.push(parser); },
    /** The first parser that accepts every file, else generic. */
    pick: (files) => list.find((p) => files.every((f) => p.accepts(f))) ?? genericParser,
  };
}

export const defaultParsers = createParserRegistry();
