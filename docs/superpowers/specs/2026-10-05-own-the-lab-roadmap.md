# Own the Lab — retiring Seazona (roadmap)

_2026-10-05. Branch: `feat/own-the-lab` (long-lived, forked from `main`)._

## Decision

Our backend becomes the full system of record for the lab: catalog, pricing,
orders/cases, production status, invoicing, balances, shipping. Seazona is
retired at a single planned cutover after the whole thing is built and loaded
with the real history, then shown to the lab.

**Why.** Seazona adds integration cost and removes capability:

- Clinical content is the Rx PDF/files we already produce; Seazona does not
  transform it. Our push sends technicians *less* than the old JotForm flow
  (`createOrder` takes line ids + a 2,000-char notes string — no files, no
  settings).
- Payments API is write-only; balances are unreadable; payments staff enter in
  Seazona are invisible to the portal (the AutoPay double-charge rule exists
  only because of this).
- `GET v1/invoices/` truncates at 10,000; host-level rate limiting blocks us.
- Variations, client price lists, settings and services are UI-only — not in
  the API — so product variations cannot be built on Seazona at all.

**What Seazona does that we must own** (from the team's own list + API
evidence): invoices, shipping labels, order status — plus **per-client price
lists** (115 of 214 sampled order lines billed off-catalog) and **opening
AR balances** (portal-only today).

## Pieces (one spec → plan → PR-into-branch each)

| # | Piece | Depends on |
|---|---|---|
| 1 | **Catalog & pricing** — product families, option axes, variants, per-client prices, money in cents, DB-served shop catalog | — |
| 2 | **Orders as record + production board** — Rx cases and shop orders become lab orders with status (received → in production → hold → shipped), assignee, files attached; staff board | 1 |
| 3 | **Invoicing & AR** — invoices generated from orders (continuing Seazona's invoice numbering), PDF, statements, balances on the existing `invoice_payments` ledger | 1, 2 |
| 4 | **Shipping labels** — carrier integration (EasyPost/Shippo or direct UPS/FedEx), label + tracking on the order | 2 |
| 5 | **Migration & cutover** — import clients, products, ~16k invoices, orders + files, opening balances; parity report vs Seazona; freeze; remove Seazona code | 1–4 |

## Working rules for the branch

- Each piece lands as its own PR **into `feat/own-the-lab`** (keeps every PR
  under CodeRabbit's 150-file skip limit). The branch merges to `main` only at
  cutover, after the lab has seen it.
- Merge `main` into the branch regularly; `main` keeps running on Seazona the
  whole time, so nothing in production changes until cutover.
- Seazona code on the branch is retired in piece 5, not before — pieces 1–4
  must not break the live sync paths that still exist on `main`.
- Libraries are fine where they earn it (PDF rendering, carrier APIs); domain
  logic (pricing, variants, ledger) stays ours.

## Open facts to check (not decisions)

- Can Seazona order files be downloaded via the API (signed URLs vs auth)? —
  probe blocked 2026-10-05 by Seazona's host rate limit; re-run before piece 5.
- Does a portal export of client price lists exist (Clients > Pricing)? If
  not, piece 1 infers them from billed history (see piece 1 spec).
- Does the lab use Seazona for anything beyond orders/invoices/labels/status
  (accounting export, scheduling)? Ask the lab office before piece 5.
