import { parsePartyKey, practiceLabel } from "@my-app/shared";

/**
 * Helpers shared by every client-portal list that spans practices. A practice's
 * label and party key come from @my-app/shared (practiceLabel, practiceKeyFor),
 * the same functions the API uses.
 */

/** The practice (account id) a list row belongs to: its accountId, else a "practice:<id>" party key. */
export function practiceIdOf(row) {
  if (row?.accountId) return row.accountId;
  return parsePartyKey(row?.partyKey)?.practice ?? null;
}

/** The Practice select filter for a client-mode DataTable (a server table filters through the switcher). */
export const practiceFilter = (accounts) => ({
  id: "practice", label: "Practice", type: "select", placeholder: "All practices",
  options: accounts.map((a) => ({ value: a.id, label: practiceLabel(a) })),
  match: (row, v) => practiceIdOf(row) === v,
});

/**
 * What a login may download a statement for: each practice, plus a "Combined statement" for each
 * group it administers whose combined statement is on (the API refuses it to anyone else).
 * → [{ value, label }] for StatementDownload `subjects`; the practice in view comes first.
 */
export function statementSubjects({ accounts, organizations = [], scope = "all" }) {
  const practices = accounts.map((a) => ({ value: a.id, label: practiceLabel(a) }));
  practices.sort((a, b) => (b.value === scope) - (a.value === scope));
  const combined = organizations.filter((o) => o.combinedStatement).map((o) => ({ value: `organization:${o.id}`, label: `Combined statement: ${o.name}` }));
  return [...practices, ...combined];
}
