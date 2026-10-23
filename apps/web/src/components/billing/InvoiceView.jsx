import { formatCents } from "../../lib/money.js";
import { STATUS_TONES, statusOf, dateText, instantText, dayText, ENTRY_LABELS } from "../../lib/invoices.js";

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{value}</dd>
    </div>
  );
}

function TotalRow({ label, cents, bold = false }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold text-gray-900" : "text-gray-600"}`}>
      <span>{label}</span>
      <span>{formatCents(cents)}</span>
    </div>
  );
}

/**
 * One invoice, read-only: header, lines, totals, and dated payments and
 * credits. Shared by the doctor's detail page and the admin detail page. The
 * admin page passes `actions` and, while the invoice is a draft, its own
 * editable `linesSlot`.
 *
 * invoice: { invoiceNumber, status, issuedAt, dueDate, subtotalCents, taxCents, shippingCents, totalCents, paidCents, balanceCents }
 * order:   { orderNumber, caseNumber, patientName, shopOrderNumber } | null
 * lines:   [{ id, qty, code, description, unitCents, lineCents }]
 * payments:[{ date, kind, amountCents }]
 */
export function InvoiceView({ invoice, order, lines, payments, actions = null, linesSlot = null }) {
  const status = statusOf(invoice);
  const issued = invoice.status === "issued";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-gray-900">Invoice #{invoice.invoiceNumber}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[status] ?? "bg-gray-100 text-gray-700"}`}>{status}</span>
            <span>Issued {invoice.issuedAt ? instantText(invoice.issuedAt) : "—"}</span>
            <span>· Due {dateText(invoice.dueDate)}</span>
            {invoice.kind === "legacy" && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">Carried over from Seazona</span>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-sm sm:grid-cols-4">
        <Field
          label={order?.shopOrderNumber ? "Shop order" : "Lab order"}
          value={order?.shopOrderNumber ?? (order?.orderNumber ? `#${order.orderNumber}` : "—")}
        />
        <Field label="Case" value={order?.caseNumber ?? "—"} />
        <Field label="Patient" value={order?.patientName ?? "—"} />
        <Field label="Balance" value={formatCents(Math.max(0, invoice.balanceCents ?? 0))} />
      </dl>

      {linesSlot ?? (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Unit</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-right">{l.qty}</td>
                  <td className="px-4 py-2 font-mono text-xs">{l.code ?? "—"}</td>
                  <td className="px-4 py-2">{l.description}</td>
                  <td className="px-4 py-2 text-right">{formatCents(l.unitCents)}</td>
                  <td className="px-4 py-2 text-right">{formatCents(l.lineCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <TotalRow label="Subtotal" cents={invoice.subtotalCents} />
        {invoice.shippingCents ? <TotalRow label="Shipping" cents={invoice.shippingCents} /> : null}
        <TotalRow label="Tax" cents={invoice.taxCents} />
        <TotalRow label="Total" cents={invoice.totalCents} bold />
        {issued && <TotalRow label="Paid" cents={invoice.paidCents} />}
        {issued && <TotalRow label="Balance due" cents={Math.max(0, invoice.balanceCents)} bold />}
      </div>

      {payments.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Payments and credits</h2>
          <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white text-sm">
            {payments.map((p, i) => (
              <li key={p.id ?? i} className="flex justify-between px-4 py-2">
                <span className="text-gray-600">{dayText(p.date)} · {ENTRY_LABELS[p.kind] ?? p.kind}</span>
                <span className={p.kind === "refund" ? "text-amber-700" : "text-gray-900"}>
                  {p.kind === "refund" ? "+" : "−"}{formatCents(Math.abs(p.amountCents))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
