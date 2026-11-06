/**
 * Turn a report's param spec into validation. paramsSchema(def).parse(query,
 * { now, tz }) coerces query strings and returns resolved values; date ranges
 * come back as { from, to, previous } via the shared resolver.
 */
import { z } from "zod";
import { DATE_PRESETS, checkCustomRange, isIsoDate, resolveDateRange } from "@my-app/shared";

const optionValues = (p) => (p.options || []).map((o) => (typeof o === "object" ? o.value : o));

const toBool = (v) => (v === undefined || typeof v === "boolean" ? v : ["true", "1", "on", "yes"].includes(String(v).toLowerCase()));

const toList = (v) => (v === undefined || Array.isArray(v) ? v : String(v).split(",").map((s) => s.trim()).filter(Boolean));

/** "from..to" string or { from, to } object -> { from, to }; a preset name stays a string. */
function rangeInput(v) {
  if (typeof v === "string" && v.includes("..")) {
    const [from, to] = v.split("..");
    return { from, to };
  }
  return v;
}

function dateRangeSchema(p) {
  return z.preprocess(rangeInput, z.union([z.enum(DATE_PRESETS), z.object({ from: z.string(), to: z.string() })])).superRefine((v, ctx) => {
    if (typeof v === "string") return;
    const problem = checkCustomRange(v, { maxDays: p.maxDays });
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });
}

/**
 * Resolve one dateRange value. A preset is only measurable once `now` is known,
 * so its `maxDays` check lands here; a failure is raised as a ZodError on the
 * param so callers report it like any other invalid value.
 */
function resolveRange(p, value, now, tz) {
  try {
    return resolveDateRange(value, now, tz, { maxDays: p.maxDays });
  } catch (err) {
    throw new z.ZodError([{ code: "custom", path: [p.name], message: err.message }]);
  }
}

function baseSchema(p) {
  switch (p.type) {
    case "dateRange": return dateRangeSchema(p);
    case "date": return z.string().refine(isIsoDate, "Enter a valid date (YYYY-MM-DD)");
    case "select": return z.string().refine((v) => optionValues(p).includes(v), "Unknown option");
    case "multiselect":
      return z.preprocess(toList, z.array(z.string().refine((v) => optionValues(p).includes(v), "Unknown option")));
    case "number": {
      let n = z.coerce.number().finite();
      if (p.min !== undefined) n = n.min(p.min);
      if (p.max !== undefined) n = n.max(p.max);
      return n;
    }
    case "toggle": return z.preprocess(toBool, z.boolean());
    default: return z.string().min(1); // lookup: a value the host's lookup understands
  }
}

function fieldSchema(p) {
  const base = baseSchema(p);
  if (p.default !== undefined) return base.default(p.default);
  return p.required ? base : base.optional();
}

export function paramsSchema(def) {
  const specs = def.params || [];
  const shape = z.object(Object.fromEntries(specs.map((p) => [p.name, fieldSchema(p)])));
  return {
    shape,
    /** Validate raw query values; unknown keys are dropped. Throws ZodError. */
    parse(query = {}, { now = new Date(), tz = "UTC" } = {}) {
      // Blank values (""/null) are parsed as missing so `required` and defaults apply, except that
      // an optional param the person cleared (sent blank) stays unset instead of taking its default.
      const isBlank = (v) => v === "" || v === null;
      const cleaned = Object.fromEntries(Object.entries(query).filter(([, v]) => !isBlank(v)));
      const out = shape.parse(cleaned);
      for (const p of specs) {
        if (!p.required && Object.hasOwn(query, p.name) && isBlank(query[p.name])) delete out[p.name];
      }
      for (const p of specs) {
        if (p.type === "dateRange" && out[p.name] !== undefined) out[p.name] = resolveRange(p, out[p.name], now, tz);
      }
      return out;
    },
  };
}
