/**
 * The one problem shape every import report uses: { kind, count, seazonaIds }
 * (Ruling Q6). Callers pass ids, never record contents. `count` is the full
 * number; `seazonaIds` lists the first PROBLEM_ID_CAP so a report stays readable.
 */
export const PROBLEM_ID_CAP = 50;
export const problem = (kind, seazonaIds) => ({ kind, count: seazonaIds.length, seazonaIds: seazonaIds.slice(0, PROBLEM_ID_CAP) });

/** Build a report's problems list from [kind, ids] pairs, dropping the empty ones. */
export const problemList = (pairs) => pairs.filter(([, ids]) => ids.length).map(([kind, ids]) => problem(kind, ids));
