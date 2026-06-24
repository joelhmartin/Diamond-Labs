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
Of ~58 device/modification mapping slots, **~17 are now confirmed against real
Seazona codes** (9 seeded in code plus 8 high-confidence matches loaded
2026-06-24 — OD BioFlex/Nylon/Acrylic/Dual-Laminate/Milled, ARA, SnoreHook,
Essix); the remaining **~43** still need lab confirmation. Confirming a code is
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

## 5. Invoice payments & card on file

A doctor can log in, see their outstanding Seazona invoices, and pay them by card —
a single invoice, several at once, or partial amounts — and the payment flows
straight back into Seazona against the right invoices and marks them paid. Doctors
can also keep a card on file for faster future payments. All of this is live.

### What a doctor can do
- **View their invoices** pulled live from Seazona — total, amount paid, and
  remaining balance for each.
- **Pay a single invoice** on its own.
- **Pay several invoices in one card charge** (one transaction across multiple
  invoices).
- **Pay a partial amount** on any invoice — and mix it: e.g. invoice A in full plus
  half of invoice B in the same payment.
- **Save a card on file**, reuse it, and manage it (update expiration, remove).

### Viewing invoices
At **`/doctor/invoices`** the portal pulls the doctor's invoices directly from
Seazona and shows total / paid / balance. Seazona's API has no readable "paid"
flag, so the portal keeps its own payment ledger and recomputes each invoice's
balance on every load. An invoice whose balance reaches zero is automatically shown
as paid and locked from being paid again.

### Paying — individual, multiple, or partial
The doctor selects one or more invoices and opens the payment dialog. Each selected
invoice starts at its full balance and can be edited down to any amount, so every
combination works:
- Pay one invoice in full.
- Pay a batch of invoices in a single card charge.
- Pay part of an invoice now and the rest later.
- Any mix — e.g. one invoice in full and half of another, all in one payment.

### Direct mapping back to Seazona
Every successful card charge is recorded back into Seazona **automatically** and
attributed to the specific invoices it paid:
- The portal writes **one payment in Seazona** for the charge, tagged with a
  reference of the form **"Invoices 10612, 10617"** — the exact token Seazona's
  reporting parses to apply the payment to those invoice numbers (verified against
  the live account).
- The per-invoice split (how much went to each invoice) is kept in the portal's
  ledger, all tied to that one Seazona payment.
- The instant an invoice's balance reaches zero it is **marked paid
  automatically** — no manual reconciliation step.

So from the doctor's side it's simply "pay my invoices," and on the lab's side the
payment appears in Seazona applied to the correct invoices.

### Card on file
- **Add a card** through Authorize.net's secure hosted form. The portal stores
  **only a profile reference** — never the card number.
- **See saved cards** (masked), **update** the expiration / billing address, or
  **remove** a card.
- **Charge a saved card** for any payment — including the multi-invoice and partial
  flows above — without re-entering it.

### Security & card data (PCI)
- Card numbers are entered on Authorize.net's hosted form (or tokenized in the
  browser for the shop) — **the portal's servers never see or store a raw card
  number**, and only public keys reach the browser.
- The payment system passed a dedicated security audit and every finding was fixed:
  each card transaction is bound to the specific doctor and payment session; the
  amount and which-invoices are verified server-side; an allocation can't exceed an
  invoice's remaining balance; charges are idempotent (a double-click or retry
  cannot double-charge); and declines return the real reason from the card
  processor rather than a generic error.

### Reconciling payments taken outside the portal
If staff record a payment directly in Seazona (or take one over the phone), the
portal can't see it automatically — Seazona's payments API is write-only. An admin
can **record an offline payment** against an invoice (Admin → Invoices → "Record
offline payment") to bring the portal's balance back in line.

---

## 6. Status summary & open items

**Live and working**
- Three Rx forms (chooser, device gate, images + lightbox, STL upload).
- The admin mapping tester: form → Seazona preview → code assignment → test order.
- Order model matches the lab's real pattern (line items, not notes).
- Doctor invoice payments: view, pay one or many invoices in one charge, partial
  amounts, card on file, automatic paid-marking, Seazona reconciliation.

**Open items**
1. **Confirm the remaining product codes** (~43 placeholders; a coverage report
   listing each with candidate SKUs is in the repo). This is lab data entry via the
   tester's catalog search — the main thing standing between "test" and "doctors
   ordering for real." Most remaining gaps are material/variant judgment calls
   (e.g. ON-D/P/R material, MORA ClearSplint vs PMT) or items needing a product
   created in Seazona's portal (e.g. whitening tray).
2. **Lab-service line items** (model fabrication per arch, articulate) appear on
   nearly every real order but are not auto-added yet — a billing decision for the
   lab (auto-add to every order, make them per-case toggles, or leave manual).
3. **Large STL uploads (>~32 MB)** need a streaming upload change to clear a
   hosting request-size limit; typical scans are under this today.
4. **Browser walkthrough** of each form and a small real-card payment test are
   recommended before go-live.

_(A prior open item — payment hardening — is now complete: a full security audit
was performed and all findings fixed; see §5 Security.)_
