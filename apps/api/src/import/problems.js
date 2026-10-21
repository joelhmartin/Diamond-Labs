/**
 * The one problem shape every import report uses: { kind, count, seazonaIds }
 * (Ruling Q6). Callers pass ids, never record contents.
 */
export const problem = (kind, seazonaIds) => ({ kind, count: seazonaIds.length, seazonaIds });

/** Build a report's problems list from [kind, ids] pairs, dropping the empty ones. */
export const problemList = (pairs) => pairs.filter(([, ids]) => ids.length).map(([kind, ids]) => problem(kind, ids));
