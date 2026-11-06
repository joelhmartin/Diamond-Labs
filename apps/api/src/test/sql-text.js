import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Render a drizzle `sql` fragment for assertions: `text` with identifier
 * quotes dropped (reads like hand-written SQL), plus the bound `params`.
 * `executedSql(tx)` does it for every `execute` a fakeTx recorded.
 */
const dialect = new PgDialect();

export function renderSql(q) {
  const { sql, params } = dialect.sqlToQuery(q);
  return { text: sql.replace(/"/g, ""), params };
}

export const sqlText = (q) => renderSql(q).text;

export const executedSql = (tx) => tx.log.filter((e) => e.op === "execute").map((e) => renderSql(e.q));
