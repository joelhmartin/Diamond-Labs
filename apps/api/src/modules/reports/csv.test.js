import { describe, test, expect, vi } from "vitest";
import { createRegistry } from "./registry.js";
import { createRunSlots } from "./runner.js";
import { streamCsv } from "./csv.js";

function fakeReply() {
  const r = { headers: {}, code: vi.fn(() => r), header(k, v) { r.headers[k] = v; return r; }, send(body) { r.body = body; return r; } };
  return r;
}
async function drain(stream) {
  let out = "";
  for await (const c of stream) out += c;
  return out;
}
function setup(def) {
  const reg = createRegistry({ defaultRoles: ["staff"] });
  reg.defineGroup({ key: "g", title: "G" });
  reg.defineReport({ key: "r.one", group: "g", title: "One", ...def });
  return reg;
}
const db = { transaction: async (fn) => fn({ execute: async () => {} }) };
const call = (reg, reply, extra = {}) =>
  streamCsv({ registry: reg, db, key: "r.one", query: {}, actor: { role: "staff" }, reply, slots: createRunSlots(), now: new Date("2026-11-05T15:00:00Z"), tz: "America/Chicago", ...extra });

describe("streamCsv", () => {
  test("export streams all pages up to the cap", async () => {
    const offsets = [];
    const reg = setup({
      paging: "server",
      columns: [{ id: "n", label: "N", type: "int" }],
      run: async (_d, _p, _a, ctx) => {
        offsets.push(ctx.page.offset);
        const count = Math.min(ctx.page.limit, 4500 - ctx.page.offset);
        return { rows: Array.from({ length: count }, (_, i) => ({ n: ctx.page.offset + i })), total: 4500 };
      },
    });
    const reply = fakeReply();
    await call(reg, reply);
    const text = await drain(reply.body);
    expect(offsets).toEqual([0, 2000, 4000]);
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(4501);
    expect(text.startsWith("N\r\n0\r\n")).toBe(true);
  });

  test("a client-paged report exports past the on-screen cap (6000 rows, not 5000)", async () => {
    const reg = setup({
      columns: [{ id: "n", label: "N", type: "int" }],
      run: async () => ({ rows: Array.from({ length: 6000 }, (_, i) => ({ n: i })) }),
    });
    const reply = fakeReply();
    await call(reg, reply);
    const lines = (await drain(reply.body)).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(6001);
    expect(lines.at(-1)).toBe("5999");
  });

  test("headers: content type and dated filename in the app timezone", async () => {
    const reg = setup({ columns: [{ id: "n", label: "N", type: "int" }], run: async () => ({ rows: [] }) });
    const reply = fakeReply();
    await call(reg, reply, { now: new Date("2026-11-06T03:30:00Z") });
    expect(reply.headers["Content-Type"]).toBe("text/csv; charset=utf-8");
    expect(reply.headers["Content-Disposition"]).toBe('attachment; filename="r.one-2026-11-05.csv"');
  });

  test("server csv neutralises formulas but keeps -12.50", async () => {
    const reg = setup({
      columns: [{ id: "name", label: "Name", type: "text" }, { id: "amt", label: "Amount", type: "money" }],
      run: async () => ({ rows: [{ name: "=SUM(A1)", amt: -1250 }, { name: "Ann", amt: 5 }] }),
    });
    const reply = fakeReply();
    await call(reg, reply);
    const lines = (await drain(reply.body)).split("\r\n");
    expect(lines[1]).toBe("'=SUM(A1),-12.50");
    expect(lines[2]).toBe("Ann,0.05");
  });

  test("cells are RFC 4180 quoted by the shared encoder", async () => {
    const reg = setup({
      columns: [{ id: "a", label: 'A "x"', type: "text" }, { id: "n", label: "N", type: "int" }],
      run: async () => ({ rows: [{ a: 'b"c,d', n: 5 }, { a: "e\nf", n: 0 }] }),
    });
    const reply = fakeReply();
    await call(reg, reply);
    expect(await drain(reply.body)).toBe('"A ""x""",N\r\n"b""c,d",5\r\n"e\nf",0\r\n');
  });

  test("errors before the first byte are thrown, not streamed", async () => {
    const reg = setup({ roles: ["admin"], columns: [{ id: "n", label: "N", type: "int" }], run: async () => ({ rows: [] }) });
    await expect(call(reg, fakeReply())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("onExport receives the resolved param names", async () => {
    const reg = setup({ params: [{ name: "k", type: "toggle", default: false }], columns: [{ id: "n", label: "N", type: "int" }], run: async () => ({ rows: [] }) });
    const seen = [];
    await call(reg, fakeReply(), { onExport: (names) => seen.push(names) });
    expect(seen).toEqual([["k"]]);
  });
});
