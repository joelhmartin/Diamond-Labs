import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, X } from "lucide-react";
import {
  LAB_DELIVERY_METHODS, LAB_DELIVERY_LABELS, LAB_PAN_MAX, LAB_PATIENT_NAME_MAX, RECORD_FILES_MAX_COUNT, PRICE_SOURCE_LABELS,
} from "@my-app/shared";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.jsx";
import { ROUTES, labOrderPath } from "../../config/routes.js";
import { INPUT } from "../../components/lab/form-styles.js";
import { PracticePicker } from "../../components/lab/order-entry/PracticePicker.jsx";
import { LinePicker } from "../../components/lab/order-entry/LinePicker.jsx";
import { EnclosedFields } from "../../components/lab/order-entry/EnclosedFields.jsx";
import { FileDrop, FileList, uploadRecordFiles } from "../../modules/record-files/index.js";
import { TagPicker } from "../../modules/record-tags/index.js";
import { formatCents } from "../../lib/money.js";
import { errorText } from "../../lib/requests.js";

const MODES = [{ value: "quick", label: "Quick" }, { value: "full", label: "Full" }];
const RECORD_TYPE = "lab_order";
const INTAKE_TYPE = "intake";

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-navy/50">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-2xl border border-surface-300/50 bg-white p-5">
      <h2 className="mb-3 font-heading text-sm font-bold text-navy">{title}</h2>
      {children}
    </section>
  );
}

/** Unit price and where it came from, for one previewed line. */
function PriceBadge({ price }) {
  if (!price) return <span className="text-xs text-navy/30">…</span>;
  const unpriced = price.priceSource === "unpriced";
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-navy">{unpriced ? "No price" : formatCents(price.unitCents)}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${unpriced ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}>
        {PRICE_SOURCE_LABELS[price.priceSource] ?? price.priceSource}
      </span>
    </span>
  );
}

/**
 * Staff order entry. Quick takes practice, patient, due date, pan and notes; Full adds rush,
 * delivery, enclosed items, catalog lines (priced for the chosen practice), labels and files.
 * Submitting creates the order, uploads any files to it, and opens it. A failed upload never
 * undoes the order.
 */
export function NewLabOrderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const intakeId = searchParams.get("intake"); // a dropped scan this order is made from; its files move onto the order
  const { addToast } = useToast();
  const [mode, setMode] = useState("quick");
  const [clientUserId, setClientUserId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTouched, setDueTouched] = useState(false); // a typed date wins over the scheduled one
  const [workflowName, setWorkflowName] = useState(null);
  const [pan, setPan] = useState("");
  const [notes, setNotes] = useState("");
  const [rush, setRush] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [enclosures, setEnclosures] = useState([]);
  const [lines, setLines] = useState([]);
  const [tagIds, setTagIds] = useState([]);
  const [files, setFiles] = useState([]);
  const [prices, setPrices] = useState({}); // variantId -> { unitCents, priceSource }
  const [busy, setBusy] = useState(false);
  const previewFailed = useRef(false); // toast a failed price preview once per failure streak
  const full = mode === "full";

  // Until staff type a date, the due date follows the scheduling rules for the chosen lines and
  // rush (a dry run: GET /lab/schedule/preview writes nothing). Typing over it wins.
  const variantKey = useMemo(() => (full ? [...new Set(lines.map((l) => l.variantId))].join(",") : ""), [full, lines]);
  const rushOn = full && rush;
  useEffect(() => {
    if (dueTouched) return undefined;
    let live = true;
    api.get("/lab/schedule/preview", { params: { variantIds: variantKey || undefined, rush: rushOn ? "true" : undefined } })
      .then((res) => {
        if (!live) return;
        setDueDate(res.data.data.dueDate || "");
        setWorkflowName(res.data.data.plan?.workflowName ?? null);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [dueTouched, variantKey, rushOn]);

  // Price the lines for the chosen practice: the client's own price where it has one.
  const lineKey = useMemo(() => lines.map((l) => `${l.variantId}x${l.qty}`).join(","), [lines]);
  useEffect(() => {
    if (!full || !clientUserId || !lines.length) { setPrices({}); return undefined; }
    let live = true;
    api.post("/lab/orders/price-preview", { clientUserId, lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) })
      .then((res) => {
        previewFailed.current = false;
        if (live) setPrices(Object.fromEntries(res.data.data.lines.map((p) => [p.variantId, { unitCents: p.unitCents, priceSource: p.priceSource }])));
      })
      .catch((err) => {
        if (!live) return;
        setPrices({});
        if (!previewFailed.current) addToast({ message: errorText(err), type: "error" });
        previewFailed.current = true;
      });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- lineKey stands for `lines`
  }, [full, clientUserId, lineKey]);

  const addLine = (picked) =>
    setLines((cur) => {
      const same = cur.find((l) => l.variantId === picked.variantId);
      return same ? cur.map((l) => (l === same ? { ...l, qty: l.qty + picked.qty } : l)) : [...cur, picked];
    });

  const addFiles = (picked) => {
    if (files.length + picked.length > RECORD_FILES_MAX_COUNT) {
      addToast({ message: `Attach up to ${RECORD_FILES_MAX_COUNT} files.`, type: "error" });
      return;
    }
    setFiles((cur) => [...cur, ...picked]);
  };

  const body = () => ({
    clientUserId,
    patientName: patientName.trim(),
    ...(intakeId ? { intakeId } : {}),
    // An untouched date is the scheduled one: let the server plan it forward rather than in reverse from it.
    ...(dueTouched && dueDate ? { dueDate } : {}),
    pan: pan.trim() || null,
    notes: notes.trim() || null,
    ...(full ? {
      rush,
      deliveryMethod: deliveryMethod || null,
      enclosures: enclosures.length ? enclosures : null,
      lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      tagIds,
    } : {}),
  });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    let created;
    try {
      created = (await api.post("/lab/orders", body())).data.data;
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
      setBusy(false);
      return;
    }
    const { labOrder, panWarning } = created;
    if (panWarning) addToast({ message: `Pan ${pan.trim()} is also on open order #${panWarning.orderNumber}`, type: "warning" });
    if (full && files.length) {
      try {
        await uploadRecordFiles(RECORD_TYPE, labOrder.id, files);
      } catch (err) {
        addToast({ message: `Order #${labOrder.orderNumber} was created, but these files did not upload: ${files.map((f) => f.name).join(", ")}. ${errorText(err)}`, type: "error", duration: 10000 });
      }
    }
    addToast({ message: `Order #${labOrder.orderNumber} created.`, type: "success" });
    navigate(labOrderPath(labOrder.id));
  };

  const ready = Boolean(clientUserId) && patientName.trim().length > 0;

  return (
    <div className="mx-auto max-w-3xl p-6 md:p-8">
      <Link to={ROUTES.LAB_BOARD} className="mb-6 inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy">
        <ArrowLeft size={12} /> Board
      </Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">New order</h1>
        <SegmentedControl label="Entry mode" value={mode} onChange={setMode} options={MODES} />
      </div>

      <form onSubmit={submit} className="space-y-5">
        {intakeId && (
          <Section title="From intake">
            <FileList recordType={INTAKE_TYPE} recordId={intakeId} />
            <p className="mt-2 text-[11px] text-navy/40">These files move onto the order when you create it.</p>
          </Section>
        )}
        <Section title="Order">
          <div className="space-y-3">
            <div>
              <span className="text-xs text-navy/50">Practice</span>
              <PracticePicker value={clientUserId} onChange={setClientUserId} disabled={busy} />
            </div>
            <Field label="Patient">
              <input aria-label="Patient" className={INPUT} maxLength={LAB_PATIENT_NAME_MAX} disabled={busy} value={patientName} onChange={(e) => setPatientName(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Due date">
                <input
                  type="date" aria-label="Due date" className={INPUT} disabled={busy} value={dueDate}
                  onChange={(e) => { setDueTouched(true); setDueDate(e.target.value); }}
                />
                {!dueTouched && workflowName && <span className="mt-1 block text-[11px] text-navy/40">Scheduled by {workflowName}</span>}
              </Field>
              <Field label="Pan number">
                <input aria-label="Pan number" className={INPUT} maxLength={LAB_PAN_MAX} disabled={busy} value={pan} onChange={(e) => setPan(e.target.value)} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea aria-label="Notes" className={`${INPUT} min-h-[80px]`} maxLength={5000} disabled={busy} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </Section>

        {full && (
          <>
            <Section title="Production">
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-navy">
                  <input type="checkbox" checked={rush} disabled={busy} onChange={(e) => setRush(e.target.checked)} /> Rush
                </label>
                <Field label="Delivery method">
                  <select aria-label="Delivery method" className={INPUT} disabled={busy} value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)}>
                    <option value="">Not set</option>
                    {LAB_DELIVERY_METHODS.map((m) => <option key={m} value={m}>{LAB_DELIVERY_LABELS[m]}</option>)}
                  </select>
                </Field>
                <div>
                  <span className="text-xs text-navy/50">Enclosed items</span>
                  <div className="mt-1"><EnclosedFields value={enclosures} onChange={setEnclosures} disabled={busy} /></div>
                </div>
              </div>
            </Section>

            <Section title="Lines">
              {lines.length > 0 && (
                <ul className="mb-3 divide-y divide-surface-300/40 text-sm">
                  {lines.map((l) => (
                    <li key={l.variantId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-navy">{l.qty} × {l.code ? `${l.code} · ` : ""}{l.name}</span>
                      <span className="flex items-center gap-3">
                        {clientUserId ? <PriceBadge price={prices[l.variantId]} /> : <span className="text-xs text-navy/40">Choose a practice to price</span>}
                        <button type="button" aria-label={`Remove ${l.name}`} disabled={busy} onClick={() => setLines((cur) => cur.filter((x) => x !== l))} className="text-navy/40 hover:text-red-600">
                          <X size={14} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <LinePicker onAdd={addLine} disabled={busy} />
            </Section>

            <Section title="Labels">
              <TagPicker recordType={RECORD_TYPE} value={tagIds} onChange={setTagIds} disabled={busy} />
            </Section>

            <Section title="Files">
              {files.length > 0 && (
                <ul className="mb-3 space-y-1 text-sm">
                  {files.map((f, i) => (
                    <li key={`${f.name}:${i}`} className="flex items-center justify-between">
                      <span className="text-navy">{f.name}</span>
                      <button type="button" aria-label={`Remove file ${f.name}`} disabled={busy} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} className="text-navy/40 hover:text-red-600">
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <FileDrop onFiles={addFiles} disabled={busy} />
            </Section>
          </>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={busy || !ready} className="rounded-full bg-navy px-6 py-2.5 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-40">
            {busy ? "Creating…" : "Create order"}
          </button>
        </div>
      </form>
    </div>
  );
}
