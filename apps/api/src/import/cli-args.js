import { ImportRefusal } from "./import-errors.js";

/**
 * argv → { positional, flags }. Accepts `--name value` and `--name=value`;
 * names in `booleans` take no value. Unknown flags and missing values are
 * refused: a typo must never quietly turn into a different run.
 */
export function parseArgs(argv, { allowed = [], booleans = [] } = {}) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (!allowed.includes(name)) throw new ImportRefusal(`Unknown flag --${name}.`);
    if (name in flags) throw new ImportRefusal(`--${name} was given more than once.`);
    if (booleans.includes(name)) {
      if (inline !== undefined) throw new ImportRefusal(`--${name} takes no value.`);
      flags[name] = true;
      continue;
    }
    const value = inline ?? argv[i + 1];
    if (value === undefined || value === "" || (inline === undefined && value.startsWith("--"))) {
      throw new ImportRefusal(`--${name} needs a value.`);
    }
    if (inline === undefined) i += 1;
    flags[name] = value;
  }
  return { positional, flags };
}

export function intFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  const raw = String(flags[name]);
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n)) throw new ImportRefusal(`--${name} must be a whole number.`);
  return n;
}

export function listFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  return String(flags[name]).split(",").map((s) => s.trim()).filter(Boolean);
}
