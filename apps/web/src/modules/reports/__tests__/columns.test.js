import { test } from "vitest";
import assert from "node:assert/strict";
import { toTableColumns, fillTemplate, sortParam } from "../columns.jsx";

const SPECS = [
  { id: "name", label: "Client", type: "link", link: "/clients/{id}" },
  { id: "total", label: "Total", type: "money" },
  { id: "count", label: "Count", type: "int", sortable: false },
  { id: "day", label: "Day", type: "date" },
];

test("link template fills {id}", () => {
  assert.equal(fillTemplate("/clients/{id}", { id: "c 1" }), "/clients/c%201");
  assert.equal(fillTemplate("/a/{group}/{id}", { group: "g", id: 7 }), "/a/g/7");
  // A missing field means no link, never "/clients/undefined".
  assert.equal(fillTemplate("/clients/{id}", {}), null);

  const [name] = toTableColumns(SPECS);
  const cell = name.cell({ id: "c1", name: "Acme" });
  assert.equal(cell.props.to, "/clients/c1");
  assert.equal(cell.props.children, "Acme");
  // No id on the row: plain text.
  assert.equal(name.cell({ name: "Acme" }), "Acme");
});

test("money exportValue is a plain number string", () => {
  const total = toTableColumns(SPECS)[1];
  assert.equal(total.exportValue({ total: -1250 }), "-12.50");
  assert.equal(total.exportValue({ total: 123456 }), "1234.56");
  assert.equal(total.cell({ total: 123456 }), "$1,234.56");
  assert.equal(total.align, "right");
  assert.equal(total.sortValue({ total: 5 }), 5);
});

test("columns carry header, sortValue only when sortable, and dates format as plain days", () => {
  const cols = toTableColumns(SPECS);
  assert.deepEqual(cols.map((c) => c.header), ["Client", "Total", "Count", "Day"]);
  assert.equal(cols[2].sortValue, undefined);
  assert.equal(cols[0].sortValue({ name: { label: "Acme" } }), "Acme");
  assert.equal(cols[3].cell({ day: "2026-10-31" }), "2026-10-31");
});

test("sortParam maps table sort to the server's id / -id", () => {
  assert.equal(sortParam(null), undefined);
  assert.equal(sortParam({ id: "total", dir: "asc" }), "total");
  assert.equal(sortParam({ id: "total", dir: "desc" }), "-total");
});
