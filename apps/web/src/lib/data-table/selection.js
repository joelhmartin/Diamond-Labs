/**
 * Row selection for every DataTable (Finder/Gmail model). Pure and immutable:
 * each function returns a new `{ ids: Set<string>, anchor }` and never touches
 * its input. `anchor` is the row a Shift-click range starts from.
 */

export function emptySelection() {
  return { ids: new Set(), anchor: null };
}

export const clear = emptySelection;

/**
 * Apply one click. Pass exactly one of:
 *   toggle  — ⌘/Ctrl-click or the row checkbox: flip this row, move the anchor here.
 *   range   — Shift-click: add every row from the anchor to this one, in
 *             `orderedIds` (the visible order). If the anchor is not visible
 *             (another page, re-sorted away) it toggles only this row, so a
 *             range never selects rows the user cannot see.
 *   replace — plain click: select only this row.
 */
export function clickRow(sel, { id, orderedIds = [], toggle, range, replace }) {
  if (range) {
    const from = sel.anchor == null ? -1 : orderedIds.indexOf(sel.anchor);
    const to = orderedIds.indexOf(id);
    if (from === -1 || to === -1) return clickRow(sel, { id, toggle: true });
    const ids = new Set(sel.ids);
    const [lo, hi] = from < to ? [from, to] : [to, from];
    for (let i = lo; i <= hi; i++) ids.add(orderedIds[i]);
    return { ids, anchor: sel.anchor };
  }
  if (replace) return { ids: new Set([id]), anchor: id };
  if (toggle) {
    const ids = new Set(sel.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { ids, anchor: id };
  }
  return sel;
}

/** Header checkbox: add (`on`) or remove every id on the current page; other pages are untouched. */
export function setPage(sel, pageIds, on) {
  const ids = new Set(sel.ids);
  for (const id of pageIds) {
    if (on) ids.add(id);
    else ids.delete(id);
  }
  return { ids, anchor: sel.anchor };
}

export function selectAll(sel, allIds) {
  const ids = new Set(sel.ids);
  for (const id of allIds) ids.add(id);
  return { ids, anchor: sel.anchor };
}

/** Drop ids that are no longer in the list (after a reload or a bulk action). */
export function prune(sel, presentIds) {
  const present = presentIds instanceof Set ? presentIds : new Set(presentIds);
  const ids = new Set([...sel.ids].filter((id) => present.has(id)));
  return { ids, anchor: present.has(sel.anchor) ? sel.anchor : null };
}
