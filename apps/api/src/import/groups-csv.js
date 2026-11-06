import { ImportRefusal } from "./import-errors.js";

/**
 * The lab's list of practices that share a bill: a CSV with the header
 * `account_number,group`, one practice per row. Pure; the payments-match
 * command reads the file and passes the client resolver.
 *
 * `resolveClient(accountNumber)` is the command's clientResolver (account
 * number → Seazona client id, or null when unknown or shared by two clients).
 * Returns the `groupOf` map (client key → the lab's group label) and the
 * `problems` the live gate looks at: { kind, line } with row numbers only, so
 * nothing printed from them carries an account number or a group name.
 *   unknown-account    the account number resolves to no client
 *   missing-group      the row has no group
 *   duplicate-account  the account is listed again: it is left out of EVERY
 *                      group (never guessed), and each repeat is a problem
 *   bad-header         the first line is not account_number,group (nothing read)
 */
export function readGroupsCsv(bytes, resolveClient) {
  const rows = parseCsv(Buffer.from(bytes).toString("utf8").replace(/^﻿/, ""));
  const problems = [];
  const head = (rows[0]?.cells ?? []).map((c) => c.trim().toLowerCase());
  if (head[0] !== "account_number" || head[1] !== "group") {
    return { groupOf: new Map(), problems: [{ kind: "bad-header", line: 1 }] };
  }
  const groupOf = new Map();
  const seen = new Set();
  for (const { cells, line } of rows.slice(1)) {
    const [account = "", label = ""] = cells.map((c) => c.trim());
    if (!account && !label) continue;
    const key = resolveClient(account);
    if (key == null) { problems.push({ kind: "unknown-account", line }); continue; }
    if (seen.has(key)) { groupOf.delete(key); problems.push({ kind: "duplicate-account", line }); continue; }
    seen.add(key);
    if (!label) { problems.push({ kind: "missing-group", line }); continue; }
    groupOf.set(key, label);
  }
  return { groupOf, problems };
}

/** "account_number,group" counts for the run's summary: practices placed, distinct groups. */
export const groupCounts = (groupOf) => ({ practices: groupOf.size, groups: new Set(groupOf.values()).size });

/** RFC 4180 enough for this file: quoted cells may hold commas, quotes ("") and newlines. Each row carries its 1-based line. */
export function parseCsv(text) {
  const rows = [];
  let cells = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    cells.push(cell);
    rows.push({ cells, line: rowLine });
    cells = []; cell = ""; rowLine = line;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else { if (c === "\n") line++; cell += c; }
    } else if (c === '"') quoted = true;
    else if (c === ",") { cells.push(cell); cell = ""; }
    else if (c === "\n") { line++; endRow(); rowLine = line; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || cells.length) endRow();
  if (quoted) throw new ImportRefusal("The groups file has an unclosed quote.");
  return rows;
}
