# Diamond Orthotic Lab — Portal Status

_Last updated: 2026-06-24_

This document summarizes the current state of the new lab portal: the digital
Rx forms, how a completed Rx maps into a Seazona order, how to run the order
"mapping tester," and how doctor invoice payments work.

---

## 1. Overview

The portal replaces the old JotForm → hand-entry workflow with three faithful
digital Rx forms and a doctor billing area. Two systems sit behind it:

- **Seazona** — source of truth for clients, invoices, orders, and recorded
  payments. We read/write it through its REST API.
- **Authorize.net** — card processing for doctor invoice payments and the public
  shop. Live (production) credentials; cards are tokenized in the browser so the
  server never touches raw card data.

Everything below is **live in production** unless explicitly called an open item.

---

## 2. The three Rx forms

Doctors land on a chooser at **`/app/rx`** and pick one of three forms. Each is a
field-for-field rebuild of the corresponding live JotForm:

| Form | Route | JotForm ID |
|---|---|---|
| Diamond Orthotic Lab Rx. 2025 ("Digital Rx") | `/app/rx/digital` | 220598308432154 |
| Diamond Orthodontic Rx. | `/app/rx/ortho` | 213545611846154 |
| OLMOS – Orthodontic Rx. | `/app/rx/olmos` | 233543911011141 |

**Doctor info is automatic.** Because doctors are logged in, the forms do not ask
for doctor name/email/address — they show a read-only "Doctor: …" line and the
order is attributed to the doctor's account.

**Device selection (Digital Rx).** Instead of scrolling every device, step one is
a **multi-select of the device(s) being ordered**. Only the selected devices'
option sections then appear — so ordering one device no longer forces you through
all of them. (Ortho and OLMOS are single-appliance forms with no gate.)

**Visual options.** Where the JotForm used images (scanner logos, device-material
photos, ON design renders, expanders), the options render as image cards. Hovering
any image shows a magnifier that opens it full-size in a lightbox.

**Validation** only fires when you click Continue (not on arrival), and the step
titles no longer duplicate their content.

**File uploads** accept STL/PDF/image files and store them in a private Google
Cloud Storage bucket. (Note: very large scans over ~32 MB are an open item — see
§6.)

---

## 3. How an Rx maps into a Seazona order

### The Seazona model (important)
A Seazona order is a **flat list of product line items** plus free-text notes.
Each line item is a catalog product `{ code, name, price }` with two optional
per-line attributes: **arch** (Upper/Lower) and **tooth**. There is **no** concept
of product variations/options, and not even a quantity field (quantity = the line
repeated N times). The product catalog (≈392 products) is managed inside Seazona's
own portal; the API cannot add products or invent new fields.

This means there are exactly three places a prescription detail can land:
1. **A product line item** — if it corresponds to a catalog product (the device +
   material is one product, e.g. "DDSO Nylon"; each modification is its own product,
   e.g. "Vertical Shims").
2. **arch / tooth** on a line — for arch- or tooth-specific items.
3. **Notes** — free text, for anything with no product (occlusal contact, VDO
   measurements, special instructions, remake context).

We verified this against real hand-built orders (e.g. invoice #10601): the lab
itemizes everything as products and uses notes only for clinician prose. The
portal now mirrors that exactly:

- **Line items:** device + material/variant, and each modification.
- **Notes:** occlusal contact, design preference, VDO/titration, device comments,
  and rush — only. Material, modifications, records method, and bite are **not**
  dumped into notes.

### The code map
`device-seazona-map.js` maps each form selection to a Seazona product code:
- **Device → primary product code** (keyed by material/variant).
- **Modification → product code.**
- **Lab services** (model fabrication per arch, articulate) — codes exist but are
  not auto-added (a per-case decision; see §6).
- **Admin-confirmed overrides** (`rx_code_overrides` table) take priority over the
  file map, so codes can be confirmed without code changes.

### Current coverage (open item)
Of ~58 device/modification mapping slots, **9 are confirmed real Seazona codes**;
the rest (~51) are **placeholders awaiting lab confirmation**. Confirming a code is
done in the tester (§4) via catalog search — no engineering needed. Until a code is
confirmed, that line shows as **placeholder** in the preview and is **not** sent on
a test order. The three statuses:

- **Confirmed** — the code resolves to a real product in the live Seazona catalog.
- **Placeholder** — a best-guess code not yet in the catalog (needs confirming).
- **Unmapped** — no code yet for that selection.

---

## 4. How to run the Rx mapping tester

The tester lets an **admin** fill any of the three forms exactly as a doctor would,
see the Seazona order it generates (line items + coverage + notes), assign/confirm
product codes, and optionally send a real test order.

1. Sign in as an **admin** and open **"Rx Mapping"** in the sidebar
   (`/admin/rx-mapping`).
2. **Choose a form** (Digital / Orthodontic / OLMOS).
3. **Fill it out completely** — this is the same form doctors use, fully validated.
4. Click **"Generate Seazona preview."** A panel opens showing:
   - Patient name + due date.
   - **Coverage:** `X confirmed · Y placeholder · Z unmapped`, with per-device
     counts when multiple devices were ordered.
   - **Line items**, grouped per device.
   - **Notes** (the free-text that would accompany the order).
5. For any **placeholder** or **unmapped** line, use the inline **"Search catalog…"**
   box to pick the correct Seazona product. That assignment is saved as a
   confirmed override (and can be cleared later). The preview refreshes.
6. (Optional) Click **"Send test order to Seazona."** This creates a **real** order
   under the dedicated **Matt Rago test account** (no sandbox exists), prefixed
   `[MAPPING TEST — Matt Rago]`. Only confirmed lines are sent; placeholder/unmapped
   lines are reported as "not sent." **Cancel the test order in Seazona afterward.**

Multi-device orders are fully supported — each selected device contributes its own
line items, grouped in the preview.

---

## 5. Invoice payments

Doctors can view and pay their Seazona invoices online with a card.

### Viewing invoices
At **`/doctor/invoices`**, the portal pulls the doctor's invoices from Seazona and
shows total / paid / balance. Because Seazona's API has no readable "paid" flag,
the portal computes paid/balance from its **own payment ledger** (`invoice_payments`)
and recomputes it on every load. Fully-paid invoices are locked from re-selection.

### Paying (one payment, multiple invoices, partial amounts)
The doctor selects one or more invoices and opens the payment dialog. Each invoice
row defaults to its full balance and can be edited down to any amount.

**Confirmed working:** a doctor can, in **a single payment**, pay invoice A **in
full** and invoice B **partially** (e.g. half). The dialog allocates the charge
across invoices; the server records:
- **One** account-level payment in Seazona for the full charge, with a reference of
  the form **"Invoices A, B"** — the token Seazona's report parses to attribute the
  payment to those invoices (verified live).
- **One ledger row per invoice** (the per-invoice split), all tied to that one
  Seazona payment.

On the next load, invoice A shows a zero balance and is marked paid; invoice B shows
its remaining balance and stays payable. So invoices are **marked paid
automatically** as soon as their balance reaches zero — no manual step.

### Card on file
Doctors can save a card for reuse:
- Add a card (stored securely with Authorize.net's Customer Profiles — the portal
  stores only a profile reference, never card data).
- List saved cards (masked), update expiry/billing, and delete a card.
- Pay an invoice (including the multi-invoice/partial flow above) with a saved card.

All of this is wired end-to-end.

### Card data / PCI
New cards are entered through Authorize.net's **hosted payment form** (an embedded
secure iframe); the public shop uses in-browser tokenization. Either way the
portal's servers never receive raw card numbers.

### Security
The payment system passed a dedicated security & correctness audit, and all
findings were fixed: each hosted transaction is cryptographically bound to the
doctor and the issued payment session; allocations are capped server-side at each
invoice's remaining balance; charges are idempotent (no double-charge on retry);
card declines return the gateway's reason; and inputs are validated through shared
schemas. Card data never reaches the portal's servers, and only public keys are
exposed to the browser.

### Reconciling payments entered directly in Seazona
Because Seazona's payments API is write-only (the portal can't read payments staff
key in directly), an admin can **record an offline payment** against an invoice
(Admin → Invoices → "Record offline payment") so the portal's balance reflects it.

---

## 6. Status summary & open items

**Live and working**
- Three Rx forms (chooser, device gate, images + lightbox, STL upload).
- The admin mapping tester: form → Seazona preview → code assignment → test order.
- Order model matches the lab's real pattern (line items, not notes).
- Doctor invoice payments: view, pay one or many invoices in one charge, partial
  amounts, card on file, automatic paid-marking, Seazona reconciliation.

**Open items**
1. **Confirm the remaining product codes** (~51 placeholders). This is lab data
   entry via the tester's catalog search — the main thing standing between "test"
   and "doctors ordering for real." We can also do a coverage pass to list exactly
   which selections already have a matching product vs. which need a product created
   in Seazona's portal.
2. **Lab-service line items** (model fabrication per arch, articulate) appear on
   nearly every real order but are not auto-added yet — a billing decision for the
   lab (auto-add to every order, make them per-case toggles, or leave manual).
3. **Large STL uploads (>~32 MB)** need a streaming upload change to clear a
   hosting request-size limit; typical scans are under this today.
4. **Browser walkthrough** of each form and a small real-card payment test are
   recommended before go-live.

_(A prior open item — payment hardening — is now complete: a full security audit
was performed and all findings fixed; see §5 Security.)_
