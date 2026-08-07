/**
 * Conditional-visibility predicate for form fields, for the React side.
 *
 * There is exactly ONE implementation, in ../../data/forms/form-logic.js, and
 * this module re-exports it. It used to be a second hand-written copy that knew
 * only `equals`/`prefix` and fell through to `true` for anything else — so a
 * field gated on `showIf.includes` was visible to FormField even when
 * FormRenderer had already filtered it out. That split (the renderer filtering
 * with one predicate while the field re-checks with another) is what caused a
 * Critical in Task 9; the only durable fix is for there to be nothing to keep
 * in sync.
 *
 * Supported showIf shapes — see form-logic.js for the authoritative contract:
 *   { key, includes } | { key, equals } | { key, prefix } | { key, oneOf } |
 *   { key, answered: true } | { key, cell }
 *
 * Also re-exports disabledOptions(field, answers) — the field-level
 * `disableOptionsIf` reader — for the same single-source-of-truth reason.
 *
 * Kept as its own JSX-free module so importers (fields.jsx re-exports it) and
 * plain-node tests do not change.
 */
export { shouldShow, disabledOptions } from "../../data/forms/form-logic.js";
