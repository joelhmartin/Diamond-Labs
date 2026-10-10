import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, AlertCircle, Printer, FileText, RotateCcw, Zap, PauseCircle, Clock } from "lucide-react";
import { LAB_STATUS_LABELS, allowedNextStatuses, reasonRequiredFor, groupRxAnswers, getRxForm } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { ROUTES, labOrderPath } from "../../config/routes.js";
import { describeEvent, errorText, isStale, openInNewTab } from "../../lib/lab-board.js";

const INPUT =
  "w-full px-3 py-2 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

function moveLabel(from, to) {
  if (to === "on_hold") return "Put on hold";
  if (to === "cancelled") return "Cancel order";
  if (from === "on_hold") return `Resume — ${LAB_STATUS_LABELS[to]}`;
  return `→ ${LAB_STATUS_LABELS[to]}`;
}

function Panel({ title, children, action }) {
  return (
    <section className="rounded-2xl border border-surface-300/50 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-sm font-bold text-navy">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function LabOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [notes, setNotes] = useState("");
  const [due, setDue] = useState("");
  // Hold / cancel / remake all need a reason: one dialog, not window.prompt.
  const [reasonFor, setReasonFor] = useState(null); // { kind: "status"|"remake", to?, title, submit }
  const [reasonText, setReasonText] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/lab/orders/${id}`);
      setDetail(res.data.data);
      setNotes(res.data.data.order.labNotes ?? "");
      setDue(res.data.data.order.dueDate ?? "");
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    Promise.all([api.get("/lab/staff"), api.get("/lab/departments", { params: { includeInactive: "true" } })])
      .then(([s, d]) => { setStaff(s.data.data.staff); setDepartments(d.data.data.departments); })
      .catch((err) => setError(errorText(err)));
  }, []);

  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s.name])), [staff]);
  const departmentsById = useMemo(() => Object.fromEntries(departments.map((d) => [d.id, d.name])), [departments]);

  const act = async (fn, success) => {
    setBusy(true);
    try {
      const out = await fn();
      if (success) addToast({ message: success, type: "success" });
      await load();
      return out;
    } catch (err) {
      addToast({ message: isStale(err) ? `${errorText(err)} The latest version has been loaded.` : errorText(err), type: "error" });
      if (isStale(err)) await load();
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-navy/40">
        <Loader2 size={18} className="mr-2 animate-spin" /> Loading order…
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div className="mx-auto max-w-5xl p-6 md:p-8">
        <Link to={ROUTES.LAB_BOARD} className="mb-6 inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy">
          <ArrowLeft size={12} /> Board
        </Link>
        <p className="py-20 text-center text-sm text-navy/60">{error || "Order not found."}</p>
      </div>
    );
  }

  const { order, lines, events, rxCase, files, shopOrder } = detail;
  const moves = allowedNextStatuses(order.status, { heldFrom: order.heldFrom });
  const answerGroups = rxCase ? groupRxAnswers(getRxForm(rxCase.formType), rxCase.formData) : [];
  const devices = lines.filter((l) => !l.noteOnly);
  const instructions = lines.filter((l) => l.noteOnly);
  const closed = order.status === "shipped" || order.status === "cancelled";

  const askReason = (title, submit) => { setReasonText(""); setReasonFor({ title, submit }); };
  const submitReason = async () => {
    const reason = reasonText.trim();
    if (!reason) return;
    const { submit } = reasonFor;
    setReasonFor(null);
    await submit(reason);
  };
  const doMove = (to, reason) =>
    act(() => api.post(`/lab/orders/${order.id}/status`, { to, reason, expectedVersion: order.version }), `Order #${order.orderNumber}: ${LAB_STATUS_LABELS[to]}`);
  const move = (to) => {
    if (!reasonRequiredFor(to)) return doMove(to);
    askReason(to === "on_hold" ? "Why is this order on hold?" : "Why is this order being cancelled?", (reason) => doMove(to, reason));
  };
  const setField = (field, value) =>
    act(() => api.patch(`/lab/orders/${order.id}`, { field, value, expectedVersion: order.version }));
  const remake = () =>
    askReason("Why is this order being remade?", async (reason) => {
      const res = await act(() => api.post(`/lab/orders/${order.id}/remake`, { reason, expectedVersion: order.version }));
      if (res) navigate(labOrderPath(res.data.data.labOrder.id));
    });
  const printTicket = () =>
    openInNewTab(async () => {
      const res = await api.get(`/lab/orders/${order.id}/ticket.pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return url;
    }).catch((err) => addToast({ message: errorText(err), type: "error" }));
  const openFile = (fileId) =>
    openInNewTab(async () => (await api.get(`/admin/rx-cases/${rxCase.id}/files/${fileId}`)).data.data.url)
      .catch((err) => addToast({ message: errorText(err), type: "error" }));

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <Link to={ROUTES.LAB_BOARD} className="mb-6 inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy">
        <ArrowLeft size={12} /> Board
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Order #{order.orderNumber}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-navy/60">
            <span className="rounded-full bg-navy px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">{LAB_STATUS_LABELS[order.status]}</span>
            {order.rush && <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-bold uppercase text-red-700"><Zap size={11} /> Rush{order.rushTier ? ` — ${order.rushTier}` : ""}</span>}
            {order.isRemake && (
              <span className="flex items-center gap-1 rounded-full bg-violet-500/10 px-3 py-1 text-xs font-bold uppercase text-violet-700">
                <RotateCcw size={11} /> Remake{order.remakeOfOrderNumber ? ` of #${order.remakeOfOrderNumber}` : ""}
              </span>
            )}
            {order.overdue && <span className="flex items-center gap-1 text-xs font-semibold text-red-600"><Clock size={11} /> Overdue</span>}
            {rxCase && <Link to={`/admin/rx-cases/${rxCase.id}`} className="font-mono text-xs text-brand-600 hover:underline">{rxCase.caseNumber}</Link>}
            {shopOrder && <span className="font-mono text-xs">{shopOrder.orderNumber}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={printTicket} className="flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">
            <Printer size={14} /> Work ticket
          </button>
          {order.status === "shipped" && (
            <button type="button" disabled={busy} onClick={remake} className="flex items-center gap-1.5 rounded-full border border-navy/20 bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy/40 disabled:opacity-40">
              <RotateCcw size={14} /> Remake
            </button>
          )}
        </div>
      </div>

      {order.status === "on_hold" && (
        <div className="mb-5 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <PauseCircle size={16} className="mt-0.5" /> On hold: {order.holdReason || "no reason recorded"}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Lines">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] font-mono uppercase tracking-widest text-navy/40">
                <tr><th className="py-1">Qty</th><th>Code</th><th>Item</th><th>Arch</th></tr>
              </thead>
              <tbody>
                {devices.map((l) => (
                  <tr key={l.id} className="border-t border-surface-300/40">
                    <td className="py-1.5">{l.qty}</td>
                    <td className="font-mono text-xs">{l.code ?? "—"}</td>
                    <td>{l.name}</td>
                    <td className="text-navy/60">{l.arch ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {instructions.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-navy/80">
                {instructions.map((l) => <li key={l.id}>{l.sourceLabel || l.name}</li>)}
              </ul>
            )}
          </Panel>

          {rxCase?.buildNotes && <Panel title="Build notes"><p className="whitespace-pre-wrap text-sm text-navy">{rxCase.buildNotes}</p></Panel>}
          {rxCase?.generalComments && <Panel title="Doctor's comments"><p className="whitespace-pre-wrap text-sm text-navy">{rxCase.generalComments}</p></Panel>}

          {answerGroups.length > 0 && (
            <Panel title="Prescription">
              <div className="space-y-4">
                {answerGroups.map((g) => (
                  <div key={g.id}>
                    <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-navy/50">{g.title}</h3>
                    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                      {g.items.map((i) => (
                        <div key={i.key} className="contents">
                          <dt className="text-navy/50">{i.label}</dt>
                          <dd className="text-navy">{i.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {shopOrder?.shipping && (
            <Panel title="Ship to">
              <p className="text-sm text-navy">
                {shopOrder.shipping.name}<br />{shopOrder.shipping.address1}<br />
                {shopOrder.shipping.city}, {shopOrder.shipping.state} {shopOrder.shipping.postalCode}
              </p>
            </Panel>
          )}

          <Panel title="Timeline">
            <ol className="space-y-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-36 flex-shrink-0 text-xs text-navy/40">{new Date(e.at).toLocaleString()}</span>
                  <span className="text-navy">{describeEvent(e, { staffById, departmentsById })}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Status">
            <div className="flex flex-col gap-2">
              {moves.length === 0 && <p className="text-sm text-navy/50">This order is closed.</p>}
              {moves.map((to) => (
                <button
                  key={to}
                  type="button"
                  disabled={busy}
                  onClick={() => move(to)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
                    to === "cancelled" ? "bg-red-50 text-red-700 hover:bg-red-100"
                      : to === "on_hold" ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
                      : "bg-brand-500 text-white hover:bg-brand-600"
                  }`}
                >
                  {moveLabel(order.status, to)}
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Work">
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-xs text-navy/50">Assigned to</span>
                <select className={INPUT} disabled={busy || closed} value={order.assigneeUserId ?? ""} onChange={(e) => setField("assign", e.target.value || null)}>
                  <option value="">Nobody</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-navy/50">Department</span>
                <select className={INPUT} disabled={busy || closed} value={order.departmentId ?? ""} onChange={(e) => setField("department", e.target.value || null)}>
                  <option value="">None</option>
                  {departments.filter((d) => d.active || d.id === order.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <div>
                <span className="text-xs text-navy/50">Due date</span>
                <div className="flex gap-2">
                  <input type="date" className={INPUT} disabled={busy || closed} value={due} onChange={(e) => setDue(e.target.value)} />
                  <button type="button" disabled={busy || closed || due === (order.dueDate ?? "")} onClick={() => setField("due", due || null)} className="rounded-lg bg-surface-100 px-3 text-xs font-semibold text-navy disabled:opacity-40">Save</button>
                </div>
              </div>
              <div className="text-xs text-navy/50">
                Practice: <span className="text-navy">{rxCase?.practiceName || order.clientName || shopOrder?.shipping?.name || "—"}</span><br />
                {rxCase?.patientName && <>Patient: <span className="text-navy">{rxCase.patientName}</span></>}
              </div>
            </div>
          </Panel>

          <Panel title="Lab notes (staff only)">
            <textarea className={`${INPUT} min-h-[100px]`} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button type="button" disabled={busy || notes === (order.labNotes ?? "")} onClick={() => setField("notes", notes)} className="mt-2 rounded-full bg-navy px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              Save notes
            </button>
          </Panel>

          {files.length > 0 && (
            <Panel title="Files">
              <ul className="space-y-1.5 text-sm">
                {files.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => openFile(f.id)} className="flex items-center gap-1.5 text-brand-600 hover:underline">
                      <FileText size={13} /> {f.originalName || f.kind}
                      <span className="text-[10px] uppercase text-navy/40">{f.kind}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <Modal open={!!reasonFor} onClose={() => setReasonFor(null)} title={reasonFor?.title}>
        <textarea
          autoFocus
          className={`${INPUT} min-h-[90px]`}
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          maxLength={500}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setReasonFor(null)} className="rounded-full bg-surface-100 px-4 py-2 text-sm font-semibold text-navy hover:bg-surface-200">
            Never mind
          </button>
          <button type="button" disabled={!reasonText.trim()} onClick={submitReason} className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-40">
            Confirm
          </button>
        </div>
      </Modal>
    </div>
  );
}
