/**
 * Pure conditional-visibility predicate for form fields.
 *
 * Kept in a JSX-free module so `node --test` can import it directly
 * (`fields.jsx` re-exports it for the React side).
 *
 * showIf shapes:
 *   { key, equals }  -> show when answers[key] === equals
 *   { key, prefix }  -> show when answers[key] is a string starting with prefix
 */
export function shouldShow(field, answers) {
  if (!field.showIf) return true;
  const other = (answers || {})[field.showIf.key];
  if (field.showIf.equals != null) return other === field.showIf.equals;
  if (field.showIf.prefix != null)
    return typeof other === "string" && other.startsWith(field.showIf.prefix);
  return true;
}
