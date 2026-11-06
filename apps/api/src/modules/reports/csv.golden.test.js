/**
 * Golden bytes of the report CSV export, captured before the CSV path was
 * shared with the exports module. A change here changes downloaded files.
 */
import { test, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { createRegistry } from "./registry.js";
import { createRunSlots } from "./runner.js";
import { streamCsv } from "./csv.js";

const COLUMNS = [
  { id: "name", label: "Name, full", type: "text" },
  { id: "n", label: "N", type: "int" },
  { id: "amt", label: "Amount", type: "money" },
  { id: "on", label: "On", type: "date", timeZone: "America/Chicago" },
  { id: "at", label: "At", type: "datetime", timeZone: "America/Chicago" },
  { id: "share", label: "Share", type: "pct" },
  { id: "age", label: "Age", type: "duration_days" },
  { id: "who", label: "Who", type: "link" },
  { id: "state", label: 'State "now"', type: "badge" },
];

const NAMES = ["Ann", "=SUM(A1)", 'b"c,d', "e\nf", "-12.50", "+1 call", "@cmd", "Zoë Ünal", "", null];

function rowAt(i) {
  return {
    name: NAMES[i % NAMES.length],
    n: i % 7 === 0 ? null : i * 3 - 50,
    amt: i % 5 === 0 ? null : i * 137 - 9000,
    on: i % 3 === 0 ? "2026-03-08" : new Date(Date.UTC(2026, 2, 8, (i * 5) % 24, 30)),
    at: new Date(Date.UTC(2026, 10, 1, (i * 7) % 24, (i * 11) % 60)),
    share: i % 4 === 0 ? null : (i % 9) / 37 - 0.1,
    age: i % 6 === 0 ? 3 : i / 4,
    who: i % 2 ? { label: `Person ${i}`, id: i } : `p${i}`,
    state: { label: i % 3 ? "open" : "closed, late" },
  };
}

function fakeReply() {
  const r = { headers: {}, code: vi.fn(() => r), header(k, v) { r.headers[k] = v; return r; }, send(body) { r.body = body; return r; } };
  return r;
}
async function drain(stream) {
  let out = "";
  for await (const c of stream) out += c;
  return out;
}
const db = { transaction: async (fn) => fn({ execute: async () => {} }) };

async function exportOf(def) {
  const reg = createRegistry({ defaultRoles: ["staff"] });
  reg.defineGroup({ key: "g", title: "G" });
  reg.defineReport({ key: "r.gold", group: "g", title: "Gold", columns: COLUMNS, ...def });
  const reply = fakeReply();
  await streamCsv({
    registry: reg, db, key: "r.gold", query: {}, actor: { role: "staff" }, reply,
    slots: createRunSlots(), now: new Date("2026-11-05T15:00:00Z"), tz: "America/Chicago",
  });
  return { reply, text: await drain(reply.body) };
}

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

test("client-paged report CSV: exact bytes, no BOM", async () => {
  const { reply, text } = await exportOf({ run: async () => ({ rows: Array.from({ length: 12 }, (_, i) => rowAt(i)) }) });
  expect(reply.headers).toEqual({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="r.gold-2026-11-05.csv"',
    "Cache-Control": "no-store",
  });
  expect(text).toBe(GOLDEN_CLIENT);
});

test("server-paged report CSV over three pages: exact bytes", async () => {
  const offsets = [];
  const { text } = await exportOf({
    paging: "server",
    run: async (_tx, _p, _a, { page }) => {
      offsets.push([page.offset, page.limit]);
      const count = Math.max(0, Math.min(page.limit, 4500 - page.offset));
      return { rows: Array.from({ length: count }, (_, i) => rowAt(page.offset + i)), total: 4500 };
    },
  });
  expect(offsets).toEqual([[0, 2000], [2000, 2000], [4000, 500]]);
  expect(text.startsWith(GOLDEN_CLIENT.split("\r\n").slice(0, 3).join("\r\n"))).toBe(true);
  expect(text.length).toBe(GOLDEN_SERVER_LENGTH);
  expect(sha(text)).toBe(GOLDEN_SERVER_SHA);
});

const GOLDEN_CLIENT =
  "\"Name, full\",N,Amount,On,At,Share,Age,Who,\"State \"\"now\"\"\"\r\n" +
  "Ann,,,2026-03-08,2026-10-31 19:00,,3,p0,\"closed, late\"\r\n" +
  "'=SUM(A1),-47,-88.63,2026-03-07,2026-11-01 01:11,-7.3,0.3,Person 1,open\r\n" +
  "\"b\"\"c,d\",-44,-87.26,2026-03-08,2026-11-01 08:22,-4.6,0.5,p2,open\r\n" +
  "\"e\nf\",-41,-85.89,2026-03-08,2026-11-01 15:33,-1.9,0.8,Person 3,\"closed, late\"\r\n" +
  "-12.50,-38,-84.52,2026-03-08,2026-10-31 23:44,,1,p4,open\r\n" +
  "'+1 call,-35,,2026-03-07,2026-11-01 05:55,3.5,1.3,Person 5,open\r\n" +
  "'@cmd,-32,-81.78,2026-03-08,2026-11-01 12:06,6.2,3,p6,\"closed, late\"\r\n" +
  "Zo\u00eb \u00dcnal,,-80.41,2026-03-08,2026-10-31 20:17,8.9,1.8,Person 7,open\r\n" +
  ",-26,-79.04,2026-03-08,2026-11-01 02:28,,2,p8,open\r\n" +
  ",-23,-77.67,2026-03-08,2026-11-01 09:39,-10.0,2.3,Person 9,\"closed, late\"\r\n" +
  "Ann,-20,,2026-03-07,2026-11-01 16:50,-7.3,2.5,p10,open\r\n" +
  "'=SUM(A1),-17,-74.93,2026-03-08,2026-11-01 00:01,-4.6,2.8,Person 11,open\r\n";
const GOLDEN_SERVER_LENGTH = 324350;
const GOLDEN_SERVER_SHA = "f00176323bebb321d284ddb868a1800a0585376769cd0e412cefcb5581e55a58";

