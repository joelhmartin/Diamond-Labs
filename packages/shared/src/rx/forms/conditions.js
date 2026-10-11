/**
 * Pure show/hide logic for the definition-driven Rx forms: the `showIf`
 * Condition contract (documented in apps/web/src/data/forms/form-logic.js)
 * evaluated against a flat answers map. Lives in shared so the web form and
 * the API (work ticket, order detail) agree on what is hidden. ONE
 * implementation of the predicate.
 */

/**
 * Whether a plain object carries any non-empty value on any of its own keys.
 * This is the matrix branch's original rule, factored out because
 * isEmptyValue (below) reuses it for every object-shaped answer.
 */
export function objectHasNoContent(obj) {
  if (!obj || typeof obj !== "object") return true;
  return !Object.values(obj).some(
    (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)
  );
}

/**
 * Value-only emptiness check, for conditions like `{ key, answered }` and
 * `{ key, cell }` that only have `answers[key]` to work with — not the
 * referenced field's definition, so not its `type`. Duck-types the value's
 * own shape instead:
 *   - array            → checkbox/fileUpload rule: empty iff length 0
 *   - plain object      → fullname/address/matrix answers all serialize as
 *                         objects; reuses objectHasNoContent (the matrix
 *                         rule: empty iff no own value is non-empty). This is
 *                         a deliberate widening for fullname/address: isEmpty
 *                         requires ALL subfields present for submission
 *                         validity, but "answered" only needs the doctor to
 *                         have started — ANY subfield counts.
 *   - string            → plain-string/signature/artboard rule: empty iff ""
 *   - anything else     → empty iff null/undefined
 */
function isEmptyValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value !== null && typeof value === "object") return objectHasNoContent(value);
  if (typeof value === "string") return value === "";
  return value == null;
}

/**
 * Shared condition evaluator behind both shouldShow and sectionVisible (and
 * disableOptionsIf's `when`). There is exactly ONE implementation of this
 * predicate — see field-logic.js's docstring for the history of the bug that
 * came from field-level and section-level visibility drifting apart when
 * this was two hand-written copies.
 */
export function conditionMet(cond, answers) {
  if (!cond) return true;
  if (cond.all != null) return cond.all.every((c) => conditionMet(c, answers));
  if (cond.not != null) return !conditionMet(cond.not, answers);
  const other = (answers || {})[cond.key];
  if (cond.includes != null)
    return Array.isArray(other) ? other.includes(cond.includes) : other === cond.includes;
  if (cond.equals != null) return other === cond.equals;
  if (cond.prefix != null)
    return typeof other === "string" && other.startsWith(cond.prefix);
  if (cond.oneOf != null)
    return Array.isArray(other)
      ? other.some((v) => cond.oneOf.includes(v))
      : cond.oneOf.includes(other);
  if (cond.answered === true) return !isEmptyValue(other);
  if (cond.cell != null) {
    if (!other || typeof other !== "object") return false;
    return !isEmptyValue(other[cond.cell]);
  }
  // Unrecognised shape. Throw loudly in development (Vite/Vitest set
  // import.meta.env.DEV); fall back to "always visible" everywhere else
  // (production builds, or any non-Vite runtime that lacks import.meta.env).
  if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV) {
    throw new Error(`Unrecognised showIf/condition shape: ${JSON.stringify(cond)}`);
  }
  return true;
}

/**
 * Conditional-visibility predicate. See the Condition contract in this
 * module's docstring. `shouldShow` and `sectionVisible` are deliberately the
 * same predicate — both delegate to conditionMet — so a field-level and
 * section-level showIf never silently disagree.
 */
export function shouldShow(field, answers) {
  if (!field || !field.showIf) return true;
  return conditionMet(field.showIf, answers);
}

/** Section-level conditional visibility. Same predicate as shouldShow. */
export function sectionVisible(section, answers) {
  if (!section || !section.showIf) return true;
  return conditionMet(section.showIf, answers);
}

