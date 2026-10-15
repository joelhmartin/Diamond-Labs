import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileDown, Loader2 } from "lucide-react";
import api from "../../config/api.js";
import { ROUTES, labOrderPath } from "../../config/routes.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { InvoiceView } from "../../components/billing/InvoiceView.jsx";
import { DraftLinesEditor } from "../../components/admin/DraftLinesEditor.jsx";
import { RecordPaymentModal } from "../../components/admin/RecordPaymentModal.jsx";
import { formatCents } from "../../lib/money.js";
import { errorText, isStale, openPdf, blobErrorText } from "../../lib/requests.js";
import { typedCents, instantText, activityLabel } from "../../lib/invoices.js";

const INPUT = "rounded-lg border border-surface-300/60 bg-white px-2.5 py-1.5 text-sm text-navy focus:border-brand-500 focus:outline-none";
const PILL = "rounded-full px-3 py-1.5 text-xs font-semibold";

/** Credit (write-off) on an issued invoice: reduces what's owed, never touches a card. */
function CreditPanel({ invoice, busy, act }) {
  const [credit, setCredit] = useState({ amountStr: "", reason: "" });
  const cents = typedCents(credit.amountStr);
  return (
    <section className="rounded-2xl border border-surface-300/50 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-navy">Credit (write-off)</h2>
      <p className="mb-2 text-xs text-navy/50">Reduces what's owed by up to {formatCents(Math.max(0, invoice.balanceCents))}. No card is touched.</p>
      <div className="flex flex-wrap gap-2">
        <input className={`${INPUT} w-28`} inputMode="decimal" placeholder="0.00" value={credit.amountStr} onChange={(e) => setCredit({ ...credit, amountStr: e.target.value })} aria-label="Credit amount" />
        <input className={`${INPUT} flex-1`} placeholder="Why (required)" value={credit.reason} onChange={(e) => setCredit({ ...credit, reason: e.target.value })} aria-label="Credit reason" />
        <ConfirmButton className={`${PILL} bg-surface-100 text-navy`} confirmLabel={`Credit ${formatCents(cents)}?`}
          disabled={busy || cents <= 0 || cents > invoice.balanceCents || !credit.reason.trim()}
          onConfirm={async () => {
            const ok = await act(() => api.post(`/admin/invoices/${invoice.id}/credit`, { amountCents: cents, reason: credit.reason.trim() }), "Credit applied.");
            if (ok) setCredit({ amountStr: "", reason: "" });
          }}>
          Apply credit
        </ConfirmButton>
      </div>
    </section>
  );
}

/** Void a draft, or an issued invoice with nothing paid or credited. */
function VoidPanel({ invoice, busy, act }) {
  const [reason, setReason] = useState("");
  return (
    <section className="rounded-2xl border border-red-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-red-700">Void</h2>
      <p className="mb-2 text-xs text-navy/50">A void keeps its number and owes nothing. Not possible once a payment or credit is applied.</p>
      <div className="flex flex-wrap gap-2">
        <input className={`${INPUT} flex-1`} placeholder="Why (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Void reason" />
        <ConfirmButton className={`${PILL} bg-red-600 text-white`} confirmLabel="Click again to void" disabled={busy || !reason.trim()}
          onConfirm={() => act(() => api.post(`/admin/invoices/${invoice.id}/void`, { expectedVersion: invoice.version, reason: reason.trim() }), "Invoice voided.")}>
          Void invoice
        </ConfirmButton>
      </div>
    </section>
  );
}

/** Admin invoice detail: edit and issue a draft; credit, void or email an issued invoice; record a payment. */
export function AdminInvoiceDetailPage() {
  const { id } = useParams();
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [recording, setRecording] = useState(false);

  // Staff notes are seeded once per invoice: a reload after a line edit or a
  // stale-version 409 must not wipe text that hasn't been saved yet.
  const notesSeededFor = useRef(null);
  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/invoices/${id}`);
      setData(res.data.data);
      if (notesSeededFor.current !== id) {
        notesSeededFor.current = id;
        setNotes(res.data.data.invoice.notes ?? "");
      }
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Run one action, toast the outcome, reload. Resolves true when it applied.
  const act = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) addToast({ message: success, type: "success" });
      await load();
      return true;
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
      if (isStale(err)) await load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <div className="p-8 text-sm text-red-600">Couldn't load this invoice.</div>;
  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-navy/30" /></div>;

  const { invoice, lines, payments, labOrder, client, activity } = data;
  const draft = invoice.status === "draft";
  const issued = invoice.status === "issued";
  const edit = (e) => act(() => api.patch(`/admin/invoices/${invoice.id}/lines`, { expectedVersion: invoice.version, edit: e }));
  const pdf = () => openPdf(api, `/admin/invoices/${invoice.id}/pdf`).catch(async (err) => addToast({ message: await blobErrorText(err), type: "error" }));
  const email = async () => {
    let sent = false;
    const ok = await act(async () => { sent = (await api.post(`/admin/invoices/${invoice.id}/email`)).data.data.sent; });
    if (ok) addToast(sent ? { message: "Notice sent to the client.", type: "success" } : { message: "The notice could not be sent.", type: "error" });
  };

  return (
    <div className="mx-auto max-w-5xl p-6 md:p-8">
      <Link to={ROUTES.ADMIN_INVOICES} className="mb-6 inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy"><ArrowLeft size={12} /> Invoices</Link>
      <p className="mb-2 text-sm text-navy/60">
        {client ? (client.practice || client.name) : "Guest (shop)"}
        {client?.accountNumber ? ` · Account ${client.accountNumber}` : ""}
        {labOrder ? <> · <Link className="text-brand-700 hover:underline" to={labOrderPath(labOrder.id)}>Lab order #{labOrder.orderNumber}</Link></> : null}
      </p>

      <InvoiceView
        invoice={invoice}
        order={labOrder}
        lines={lines}
        payments={payments}
        linesSlot={draft ? <DraftLinesEditor lines={lines} onEdit={edit} busy={busy} /> : null}
        actions={
          <>
            <button type="button" onClick={pdf} className={`${PILL} flex items-center gap-1 bg-surface-100 text-navy hover:bg-surface-200`}><FileDown size={12} /> PDF</button>
            {draft && (
              <ConfirmButton className={`${PILL} bg-brand-500 text-white`} confirmLabel="Click again to issue" disabled={busy}
                onConfirm={() => act(() => api.post(`/admin/invoices/${invoice.id}/issue`, { expectedVersion: invoice.version }), `Invoice #${invoice.invoiceNumber} issued.`)}>
                Issue invoice
              </ConfirmButton>
            )}
            {issued && client?.email && (
              <ConfirmButton className={`${PILL} bg-surface-100 text-navy`} confirmLabel={`Email ${client.email}?`} disabled={busy} onConfirm={email}>
                Email invoice
              </ConfirmButton>
            )}
            {issued && invoice.balanceCents > 0 && client && (
              <button type="button" onClick={() => setRecording(true)} className={`${PILL} bg-surface-100 text-navy hover:bg-surface-200`}>Record payment</button>
            )}
          </>
        }
      />

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {draft && (
          <section className="rounded-2xl border border-surface-300/50 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-navy">Staff notes</h2>
            <textarea className={`${INPUT} h-24 w-full`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} aria-label="Staff notes" />
            <button type="button" className={`${PILL} mt-2 bg-surface-100 text-navy disabled:opacity-50`} disabled={busy || notes === (invoice.notes ?? "")}
              onClick={() => edit({ op: "notes", notes: notes || null })}>Save notes</button>
          </section>
        )}
        {issued && <CreditPanel invoice={invoice} busy={busy} act={act} />}
        {(draft || (issued && invoice.paidCents === 0)) && <VoidPanel invoice={invoice} busy={busy} act={act} />}
      </div>

      {payments.some((p) => p.reference || p.note) && (
        <section className="mt-6 text-xs text-navy/60">
          {payments.filter((p) => p.reference || p.note).map((p) => (
            <p key={p.id}>{p.kind === "credit" ? "Credit" : "Payment"} {formatCents(Math.abs(p.amountCents))}: {p.reference ? `ref ${p.reference}` : ""}{p.note ? ` — ${p.note}` : ""}</p>
          ))}
        </section>
      )}

      {activity.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-navy">History</h2>
          <ol className="space-y-1 text-xs text-navy/60">
            {activity.map((a) => (
              <li key={a.id}>{instantText(a.createdAt)} · {activityLabel(a.action)}{a.actorName ? ` by ${a.actorName}` : ""}</li>
            ))}
          </ol>
        </section>
      )}

      {recording && client && (
        <RecordPaymentModal clientUserId={client.id} clientName={client.practice || client.name} onClose={() => setRecording(false)} onRecorded={load} />
      )}
    </div>
  );
}
