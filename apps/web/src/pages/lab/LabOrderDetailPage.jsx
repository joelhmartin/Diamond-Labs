import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, AlertCircle, FileText, PauseCircle } from "lucide-react";
import { LAB_TIMEZONE, LAB_STATUS_LABELS, allowedNextStatuses, reasonRequiredFor, groupRxAnswers, getRxForm } from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ROUTES, labOrderPath, labThreadPath } from "../../config/routes.js";
import { RecordThreads } from "../../modules/messaging/index.js";
import { LegacyOrderPanel } from "../../components/lab/LegacyOrderPanel.jsx";
import { ShippingPanel } from "../../components/lab/ShippingPanel.jsx";
import { SchedulePanel } from "../../components/lab/SchedulePanel.jsx";
import { ProductionPanel } from "../../components/lab/ProductionPanel.jsx";
import { LinesEditor } from "../../components/lab/LinesEditor.jsx";
import { RemakeModal } from "../../components/lab/RemakeModal.jsx";
import { Panel } from "../../components/lab/Panel.jsx";
import { OrderHeader } from "../../components/lab/OrderHeader.jsx";
import { StatusPanel } from "../../components/lab/StatusPanel.jsx";
import { WorkPanel } from "../../components/lab/WorkPanel.jsx";
import { LabNotesPanel } from "../../components/lab/LabNotesPanel.jsx";
import { RxAnswersPanel } from "../../components/lab/RxAnswersPanel.jsx";
import { TimelinePanel } from "../../components/lab/TimelinePanel.jsx";
import { ReasonModal } from "../../components/lab/ReasonModal.jsx";
import { LabelsPanel } from "../../components/lab/LabelsPanel.jsx";
import { MergedPanel } from "../../components/lab/MergedPanel.jsx";
import { FileList } from "../../modules/record-files/index.js";
import { errorText, blobErrorText, isStale, openInNewTab, openPdf } from "../../lib/requests.js";

export function LabOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lookupError, setLookupError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  // Hold / cancel all need a reason: one dialog, not window.prompt.
  const [reasonFor, setReasonFor] = useState(null); // { title, submit(reason) }
  const [remaking, setRemaking] = useState(false); // the remake dialog (reason picker + note)

  const requestSeq = useRef(0);
  const shownId = useRef(null);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const res = await api.get(`/lab/orders/${id}`);
      if (seq !== requestSeq.current) return;
      shownId.current = id;
      setDetail(res.data.data);
      setError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      // A failed reload keeps the order already on screen; only a first load fails the page.
      if (shownId.current === id) addToast({ message: errorText(err), type: "error" });
      else setError(errorText(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [id, addToast]);

  // Navigating to another order (e.g. a remake) must not show the old one.
  useEffect(() => {
    setDetail(null);
    setError(null);
    setLoading(true);
    shownId.current = null;
    load();
  }, [load]);
  useEffect(() => {
    Promise.all([api.get("/lab/staff"), api.get("/lab/departments", { params: { includeInactive: "true" } })])
      .then(([s, d]) => { setStaff(s.data.data.staff); setDepartments(d.data.data.departments); })
      .catch((err) => setLookupError(errorText(err)));
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

  const { order, lines, events, rxCase, files, shopOrder, shipment, legacy, schedule, scheduleFlags, staff: staffEntry, tags, starred, mergedFrom, mergedInto } = detail;
  const moves = allowedNextStatuses(order.status, { heldFrom: order.heldFrom, labelled: Boolean(order.shipmentId) });
  const answerGroups = rxCase ? groupRxAnswers(getRxForm(rxCase.formType), rxCase.formData) : [];
  const devices = lines.filter((l) => !l.noteOnly);
  const instructions = lines.filter((l) => l.noteOnly);
  const closed = order.status === "shipped" || order.status === "cancelled";

  const doMove = (to, reason) =>
    act(() => api.post(`/lab/orders/${order.id}/status`, { to, reason, expectedVersion: order.version }), `Order #${order.orderNumber}: ${LAB_STATUS_LABELS[to]}`);
  const move = (to) => {
    if (!reasonRequiredFor(to)) return doMove(to);
    setReasonFor({ title: to === "on_hold" ? "Why is this order on hold?" : "Why is this order being cancelled?", submit: (reason) => doMove(to, reason) });
  };
  const setField = (field, value) =>
    act(() => api.patch(`/lab/orders/${order.id}`, { field, value, expectedVersion: order.version }));
  const submitRemake = async (why) => {
    setRemaking(false);
    const res = await act(() => api.post(`/lab/orders/${order.id}/remake`, { ...why, expectedVersion: order.version }));
    if (res) navigate(labOrderPath(res.data.data.labOrder.id));
  };
  const printTicket = () =>
    openPdf(api, `/lab/orders/${order.id}/ticket.pdf`).catch(async (err) => addToast({ message: await blobErrorText(err), type: "error" }));
  const openFile = (fileId) =>
    openInNewTab(async () => (await api.get(`/admin/rx-cases/${rxCase.id}/files/${fileId}`)).data.data.url)
      .catch((err) => addToast({ message: errorText(err), type: "error" }));

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <Link to={ROUTES.LAB_BOARD} className="mb-6 inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy">
        <ArrowLeft size={12} /> Board
      </Link>

      <OrderHeader
        order={order} rxCase={rxCase} shopOrder={shopOrder} legacy={legacy} scheduleFlags={scheduleFlags}
        busy={busy} onPrint={printTicket} onRemake={() => setRemaking(true)}
      />

      {lookupError && (
        <div className="mb-5 flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={14} /> Couldn't load staff and departments ({lookupError}). Names may be missing and assignment is unavailable until you refresh.
        </div>
      )}

      {order.status === "on_hold" && (
        <div className="mb-5 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <PauseCircle size={16} className="mt-0.5" /> On hold: {order.holdReason || "no reason recorded"}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Lines">
            <LinesEditor order={order} lines={devices} onChanged={load} />
            {instructions.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-navy/80">
                {instructions.map((l) => <li key={l.id}>{l.sourceLabel || l.name}</li>)}
              </ul>
            )}
          </Panel>

          {legacy && <LegacyOrderPanel legacy={legacy} order={order} />}
          {rxCase?.buildNotes && <Panel title="Build notes"><p className="whitespace-pre-wrap text-sm text-navy">{rxCase.buildNotes}</p></Panel>}
          {rxCase?.generalComments && <Panel title="Doctor's comments"><p className="whitespace-pre-wrap text-sm text-navy">{rxCase.generalComments}</p></Panel>}

          <RxAnswersPanel groups={answerGroups} />

          {shopOrder?.shipping && (
            <Panel title="Ship to">
              <p className="text-sm text-navy">
                {shopOrder.shipping.name}<br />{shopOrder.shipping.address1}<br />
                {shopOrder.shipping.city}, {shopOrder.shipping.state} {shopOrder.shipping.postalCode}
              </p>
            </Panel>
          )}

          <TimelinePanel events={events} staffById={staffById} departmentsById={departmentsById} />
        </div>

        <div className="space-y-5">
          <MergedPanel mergedFrom={mergedFrom ?? []} mergedInto={mergedInto ?? null} />

          <ShippingPanel order={order} shipment={shipment} onChanged={load} />

          <StatusPanel order={order} moves={moves} busy={busy} onMove={move} />

          <LabelsPanel order={order} tags={tags ?? []} starred={Boolean(starred)} onChanged={load} />

          <WorkPanel
            order={order} staff={staff} departments={departments} busy={busy} closed={closed} onField={setField}
            practice={rxCase?.practiceName || order.clientName || shopOrder?.shipping?.name}
            patient={rxCase?.patientName || legacy?.patientName || staffEntry?.patientName}
          />

          <Panel title="Schedule">
            <SchedulePanel order={order} schedule={schedule ?? null} onChanged={load} />
          </Panel>

          <Panel title="Production">
            <ProductionPanel order={order} onChanged={load} />
          </Panel>

          <LabNotesPanel order={order} busy={busy} onSave={(notes) => setField("notes", notes)} />

          <Panel title="Order files">
            <FileList recordType="lab_order" recordId={order.id} canEdit={!closed} />
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

      {/* An order released from an Rx case shares that case's conversation, so both sides land in one thread. */}
      <div className="mt-6">
        <RecordThreads
          recordType={order.source === "rx_case" ? "rx_case" : "lab_order"}
          recordId={order.source === "rx_case" ? order.sourceId : order.id}
          side="host"
          threadPath={labThreadPath}
          timeZone={LAB_TIMEZONE}
        />
      </div>

      <RemakeModal open={remaking} onClose={() => setRemaking(false)} onSubmit={submitRemake} />
      <ReasonModal request={reasonFor} onClose={() => setReasonFor(null)} />
    </div>
  );
}
