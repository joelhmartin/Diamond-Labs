import { useEffect, useMemo, useState } from "react";
import api from "../../config/api.js";
import { Modal } from "../ui/Modal.jsx";
import { ConfirmButton } from "../ui/ConfirmButton.jsx";
import { DataTable } from "../ui/data-table/index.js";
import { CONTROL } from "../ui/data-table/FilterControl.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { formatCents } from "../../lib/money.js";
import { sourceChip } from "../../lib/price-lists.js";
import { errorText } from "../../lib/requests.js";

const MODES = [
  { value: "replace", label: "Replace: make them match the source (their other client prices are removed)" },
  { value: "merge", label: "Merge: add the source's prices, keep their other client prices" },
];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const money = (cents) => (cents == null ? "—" : formatCents(cents));
const sourceLabel = (source, cents) => (cents == null ? "Base" : sourceChip({ source }).label);

const changeColumns = (variantName) => [
  { id: "variant", header: "Product", sortValue: (c) => variantName(c.variantId).toLowerCase(), exportValue: (c) => variantName(c.variantId), cell: (c) => variantName(c.variantId) },
  { id: "before", header: "Before", align: "right", exportValue: (c) => c.beforeCents ?? "", cell: (c) => <>{money(c.beforeCents)} <span className="text-xs text-navy/40">{sourceLabel(c.beforeSource, c.beforeCents)}</span></> },
  { id: "after", header: "After", align: "right", exportValue: (c) => c.afterCents ?? "", cell: (c) => <span className="font-medium">{money(c.afterCents)} <span className="text-xs font-normal text-navy/40">{sourceLabel(c.afterSource, c.afterCents)}</span></span> },
];

/** One target's per-variant before/after, in the shared DataTable. */
function ChangesTable({ changes, variantName }) {
  const table = useDataTable({
    mode: "client", rows: changes, getRowId: (c) => c.variantId, initialPageSize: 10,
    searchFn: (c, q) => variantName(c.variantId).toLowerCase().includes(q.toLowerCase()),
  });
  const columns = useMemo(() => changeColumns(variantName), [variantName]);
  return <DataTable table={table} columns={columns} selectable={false} exportable={false} dense searchPlaceholder="Product" itemLabel="changes" emptyText="No price changes." />;
}

const listsText = (lists) => (lists.length ? lists.map((l) => l.name).join(", ") : "none");

function targetColumns(clientName) {
  return [
    { id: "client", header: "Client", sortValue: (t) => clientName(t.clientUserId).toLowerCase(), exportValue: (t) => clientName(t.clientUserId), cell: (t) => clientName(t.clientUserId) },
    { id: "changes", header: "Changes", align: "right", sortValue: (t) => t.changes.length, exportValue: (t) => t.changes.length, cell: (t) => plural(t.changes.length, "change", "changes") },
    {
      id: "lists", header: "Price lists", exportValue: (t) => listsText(t.listsAfter),
      cell: (t) => {
        const before = listsText(t.listsBefore);
        const after = listsText(t.listsAfter);
        return before === after ? <span className="text-navy/50">{after}</span> : <span className="text-xs">{before} → <span className="font-medium">{after}</span></span>;
      },
    },
  ];
}

function PreviewTable({ targets, clientName, variantName }) {
  const table = useDataTable({
    mode: "client", rows: targets, getRowId: (t) => t.clientUserId, initialPageSize: 10,
    searchFn: (t, q) => clientName(t.clientUserId).toLowerCase().includes(q.toLowerCase()),
  });
  const columns = useMemo(() => targetColumns(clientName), [clientName]);
  return (
    <DataTable
      table={table} columns={columns} selectable={false} exportable={false} searchPlaceholder="Client" itemLabel="clients"
      emptyText="Nothing to copy to." renderExpanded={(t) => <ChangesTable changes={t.changes} variantName={variantName} />}
    />
  );
}

/**
 * Copy one client's prices onto `targetIds`: pick the source and a mode, preview the per-client
 * before/after, then apply. The apply carries the preview's hash, so a plan that went stale
 * (source or target edited since) is refused and the admin must preview again.
 * `onDone({ ok, failed })` receives the server's result; the caller toasts it.
 */
export function CopyPricesModal({ targetIds, onDone, onClose }) {
  const [people, setPeople] = useState(null);
  const [variants, setVariants] = useState(new Map());
  const [sourceId, setSourceId] = useState("");
  const [mode, setMode] = useState("replace");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.get("/admin/users"), api.get("/admin/catalog/families")])
      .then(([u, c]) => {
        if (!live) return;
        setPeople(u.data.data.users);
        setVariants(new Map(c.data.data.families.flatMap((f) => f.variants.map((v) => [v.id, f.name === v.name ? v.name : `${f.name} — ${v.name}`]))));
      })
      .catch((err) => live && setError(errorText(err)));
    return () => { live = false; };
  }, []);

  const body = { fromClientUserId: sourceId, toClientUserIds: targetIds, mode };
  const clientName = useMemo(() => {
    const byId = new Map((people ?? []).map((u) => [u.id, u.name || u.email]));
    return (id) => byId.get(id) ?? id;
  }, [people]);
  const variantName = useMemo(() => (id) => variants.get(id) ?? id, [variants]);
  const sources = (people ?? []).filter((u) => u.role === "doctor" && !targetIds.includes(u.id));

  const choose = (setter) => (e) => { setter(e.target.value); setPreview(null); setError(null); };

  async function runPreview() {
    setError(null);
    setBusy(true);
    try {
      setPreview((await api.post("/admin/prices/copy/preview", body)).data.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setError(null);
    try {
      const res = await api.post("/admin/prices/copy", { ...body, previewHash: preview.previewHash });
      onDone?.(res.data.data);
    } catch (err) {
      setError(errorText(err));
      if (err?.response?.data?.error?.code === "STALE") setPreview(null);
    }
  }

  const n = preview?.targets.length ?? 0;
  const total = preview ? preview.targets.reduce((sum, t) => sum + t.changes.length, 0) : 0;
  return (
    <Modal open onClose={onClose} title="Copy prices from…" className="max-w-3xl">
      <div className="space-y-4">
        <label className="block text-xs text-navy/60">
          Copy from
          <select aria-label="Copy from" value={sourceId} onChange={choose(setSourceId)} className={`${CONTROL} mt-1 w-full`}>
            <option value="">{people ? "Choose a client…" : "Loading…"}</option>
            {sources.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}{u.account?.name ? ` (${u.account.name})` : ""}</option>)}
          </select>
        </label>
        <fieldset className="space-y-1.5 text-sm text-navy">
          {MODES.map((m) => (
            <label key={m.value} className="flex items-start gap-2">
              <input type="radio" name="copy-mode" checked={mode === m.value} onChange={() => { setMode(m.value); setPreview(null); }} className="mt-1 accent-brand-500" />
              {m.label}
            </label>
          ))}
        </fieldset>
        {preview && (
          <div className="space-y-2">
            <p className="text-xs text-navy/60">{plural(total, "price change", "price changes")} across {plural(n, "client", "clients")}.</p>
            {preview.failed?.length > 0 && <p className="text-xs text-amber-700">{plural(preview.failed.length, "selected user is", "selected users are")} not {preview.failed.length === 1 ? "a client" : "clients"} and will be skipped.</p>}
            <PreviewTable targets={preview.targets} clientName={clientName} variantName={variantName} />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-xl px-4 text-xs font-semibold text-navy/60 hover:bg-surface-100">Cancel</button>
          <button type="button" onClick={runPreview} disabled={!sourceId || busy} className="h-9 rounded-xl bg-navy px-4 text-xs font-semibold text-white disabled:opacity-50">Preview changes</button>
          {preview && n > 0 && (
            <ConfirmButton
              onConfirm={apply}
              confirmLabel={`Click again to copy to ${plural(n, "client", "clients")}`}
              className="h-9 rounded-xl bg-brand-500 px-4 text-xs font-semibold text-white hover:bg-brand-600"
            >
              Copy to {plural(n, "client", "clients")}
            </ConfirmButton>
          )}
        </div>
      </div>
    </Modal>
  );
}
