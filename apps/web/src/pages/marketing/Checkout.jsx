import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle,
  CreditCard,
  Loader2,
  Lock,
  ShoppingBag,
  Image as ImageIcon,
} from "lucide-react";
import { useCartStore } from "../../stores/cart.store";

const INPUT =
  "w-full px-4 py-3 rounded-xl bg-white border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

function formatUSD(n) {
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/* ─── SUMMARY LINE ITEM ─── */
function SummaryItem({ item }) {
  return (
    <div className="flex gap-3 py-3 border-b border-surface-300/40">
      <div className="relative w-14 h-14 flex-shrink-0 rounded-xl bg-surface-50 border border-surface-300/30 overflow-hidden">
        {item.image ? (
          <img
            src={item.image}
            alt=""
            className="w-full h-full object-contain p-1"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-navy/20">
            <ImageIcon size={16} />
          </div>
        )}
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-navy text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
          {item.qty}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-navy truncate">
          {item.name}
        </div>
        <div className="text-xs text-navy/45 mt-0.5">
          {item.price === 0 ? "Included" : formatUSD(item.price)} each
        </div>
      </div>
      <div className="font-heading font-bold text-sm text-navy whitespace-nowrap">
        {item.price === 0 ? "—" : formatUSD(item.price * item.qty)}
      </div>
    </div>
  );
}

/* ─── PAGE ─── */
export function CheckoutPage() {
  const items = useCartStore((s) => s.items);
  const subtotal = useCartStore((s) => s.subtotal());
  const clear = useCartStore((s) => s.clear);
  const navigate = useNavigate();

  const [contact, setContact] = useState({ email: "", phone: "" });
  const [ship, setShip] = useState({
    name: "",
    practice: "",
    address1: "",
    address2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "US",
  });
  const [card, setCard] = useState({
    number: "",
    month: "",
    year: "",
    cvv: "",
  });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const SHIPPING = subtotal > 0 ? 12 : 0; // flat-rate placeholder
  const TAX = Math.round(subtotal * 0.08 * 100) / 100; // CA-ish placeholder
  const total = subtotal + SHIPPING + TAX;
  const free = subtotal === 0;

  function validate() {
    setError(null);
    if (items.length === 0) {
      setError("Your cart is empty.");
      return false;
    }
    if (!contact.email || !contact.email.includes("@")) {
      setError("A valid email is required.");
      return false;
    }
    if (!ship.name || !ship.address1 || !ship.city || !ship.state || !ship.postalCode) {
      setError("Please complete your shipping address.");
      return false;
    }
    if (!free) {
      if (!card.number || !card.month || !card.year || !card.cvv) {
        setError("Please fill in all card fields.");
        return false;
      }
    }
    return true;
  }

  async function submit() {
    if (!validate()) return;
    setProcessing(true);

    try {
      const payload = {
        amount: total,
        items: items.map((i) => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
        email: contact.email,
        phone: contact.phone || undefined,
        shipping: ship,
      };

      if (free) {
        // $0 order — skip Authorize.net entirely. Just confirm the order.
        const res = await fetch("/api/v1/orders/free", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(() => null);
        const data = res?.ok ? await res.json() : null;
        setSuccess({
          invoiceNumber: data?.data?.invoiceNumber || `DOL-${Date.now().toString().slice(-8)}`,
          transactionId: "FREE",
        });
        clear();
        return;
      }

      // Tokenize the card via Accept.js → dispatchData returns opaqueData
      if (!window.Accept) {
        setError("Payment system failed to load. Please refresh and try again.");
        setProcessing(false);
        return;
      }
      if (!window.__AUTHORIZE_NET_API_LOGIN__ || !window.__AUTHORIZE_NET_CLIENT_KEY__) {
        setError(
          "Payments aren't configured. Contact the lab to place your order."
        );
        setProcessing(false);
        return;
      }

      const authData = {
        clientKey: window.__AUTHORIZE_NET_CLIENT_KEY__,
        apiLoginID: window.__AUTHORIZE_NET_API_LOGIN__,
      };
      const cardData = {
        cardNumber: card.number.replace(/\s/g, ""),
        month: String(card.month).padStart(2, "0"),
        year: String(card.year),
        cardCode: card.cvv,
      };

      window.Accept.dispatchData({ authData, cardData }, async (response) => {
        if (response.messages.resultCode === "Error") {
          const msg =
            response.messages.message?.[0]?.text || "Card validation failed.";
          setError(msg);
          setProcessing(false);
          return;
        }

        try {
          const res = await fetch("/api/v1/payments/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, opaqueData: response.opaqueData }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(data?.error?.message || "Payment failed.");
            setProcessing(false);
            return;
          }
          setSuccess(data.data);
          clear();
        } catch (e) {
          setError(e.message || "Payment failed.");
        } finally {
          setProcessing(false);
        }
      });
    } catch (e) {
      setError(e.message || "Checkout failed.");
      setProcessing(false);
    }
  }

  /* ── success ── */
  if (success) {
    return (
      <div className="pt-28 md:pt-32 pb-16 section-pad">
        <div className="max-w-xl mx-auto text-center">
          <div className="bg-white card-radius p-10 md:p-14 border border-surface-300/50 shadow-xl shadow-navy/5">
            <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-6">
              <CheckCircle size={32} className="text-white" />
            </div>
            <h1 className="font-heading font-bold text-2xl text-navy">
              Order placed!
            </h1>
            <p className="mt-1 font-mono text-xs text-navy/30">
              {success.invoiceNumber}
            </p>
            <p className="mt-4 text-sm text-navy/50 leading-relaxed">
              A confirmation has been sent to{" "}
              <span className="font-semibold text-navy">{contact.email}</span>.
              You&apos;ll receive tracking as soon as your order ships.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Link
                to="/products"
                className="px-6 py-3 rounded-full text-sm font-semibold border border-surface-300/50 text-navy/60 hover:text-navy hover:border-brand-500/30 transition-all"
              >
                Continue Shopping
              </Link>
              <Link
                to="/"
                className="px-6 py-3 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
              >
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── empty cart ── */
  if (items.length === 0) {
    return (
      <div className="pt-28 md:pt-32 pb-16 section-pad">
        <div className="max-w-md mx-auto text-center">
          <div className="bg-white card-radius p-10 md:p-14 border border-surface-300/50 shadow-xl shadow-navy/5">
            <ShoppingBag size={32} className="mx-auto mb-4 text-navy/20" />
            <h1 className="font-heading font-bold text-xl text-navy">
              Your cart is empty
            </h1>
            <p className="mt-2 text-sm text-navy/50 leading-relaxed">
              Add items from the catalog to start an order.
            </p>
            <Link
              to="/products#catalog"
              className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            >
              Browse catalog
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-28 md:pt-32 pb-20 section-pad bg-surface-100">
      <div className="max-w-5xl mx-auto">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 flex items-center gap-1 text-xs text-navy/50 hover:text-navy font-medium"
        >
          <ArrowLeft size={12} /> Back
        </button>
        <h1 className="font-heading font-bold text-3xl md:text-4xl text-navy tracking-tight">
          Checkout
        </h1>
        <p className="mt-1 text-sm text-navy/50">
          {items.length} {items.length === 1 ? "item" : "items"} in your cart
        </p>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Contact */}
            <Card title="Contact">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Email" required>
                  <input
                    type="email"
                    className={INPUT}
                    value={contact.email}
                    onChange={(e) =>
                      setContact({ ...contact, email: e.target.value })
                    }
                    placeholder="you@practice.com"
                  />
                </Field>
                <Field label="Phone">
                  <input
                    type="tel"
                    className={INPUT}
                    value={contact.phone}
                    onChange={(e) =>
                      setContact({ ...contact, phone: e.target.value })
                    }
                    placeholder="(555) 123-4567"
                  />
                </Field>
              </div>
            </Card>

            {/* Shipping */}
            <Card title="Shipping address">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Full name" required>
                  <input
                    className={INPUT}
                    value={ship.name}
                    onChange={(e) => setShip({ ...ship, name: e.target.value })}
                  />
                </Field>
                <Field label="Practice / Company">
                  <input
                    className={INPUT}
                    value={ship.practice}
                    onChange={(e) =>
                      setShip({ ...ship, practice: e.target.value })
                    }
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Address line 1" required>
                    <input
                      className={INPUT}
                      value={ship.address1}
                      onChange={(e) =>
                        setShip({ ...ship, address1: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Address line 2">
                    <input
                      className={INPUT}
                      value={ship.address2}
                      onChange={(e) =>
                        setShip({ ...ship, address2: e.target.value })
                      }
                      placeholder="Suite, unit, etc."
                    />
                  </Field>
                </div>
                <Field label="City" required>
                  <input
                    className={INPUT}
                    value={ship.city}
                    onChange={(e) => setShip({ ...ship, city: e.target.value })}
                  />
                </Field>
                <Field label="State / Region" required>
                  <input
                    className={INPUT}
                    value={ship.state}
                    onChange={(e) =>
                      setShip({ ...ship, state: e.target.value })
                    }
                  />
                </Field>
                <Field label="Postal code" required>
                  <input
                    className={INPUT}
                    value={ship.postalCode}
                    onChange={(e) =>
                      setShip({ ...ship, postalCode: e.target.value })
                    }
                  />
                </Field>
                <Field label="Country">
                  <input
                    className={INPUT}
                    value={ship.country}
                    onChange={(e) =>
                      setShip({ ...ship, country: e.target.value })
                    }
                  />
                </Field>
              </div>
            </Card>

            {/* Payment */}
            {!free ? (
              <Card
                title="Payment"
                icon={<CreditCard size={14} />}
                note={
                  <span className="flex items-center gap-1 text-[11px] text-navy/40">
                    <Lock size={11} />
                    Card data is tokenized by Authorize.net — Diamond never stores the number.
                  </span>
                }
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Field label="Card number" required>
                      <input
                        inputMode="numeric"
                        className={INPUT}
                        value={card.number}
                        onChange={(e) =>
                          setCard({ ...card, number: e.target.value })
                        }
                        placeholder="1234 5678 9012 3456"
                        autoComplete="cc-number"
                      />
                    </Field>
                  </div>
                  <Field label="MM" required>
                    <input
                      inputMode="numeric"
                      maxLength={2}
                      className={INPUT}
                      value={card.month}
                      onChange={(e) =>
                        setCard({ ...card, month: e.target.value })
                      }
                      placeholder="MM"
                      autoComplete="cc-exp-month"
                    />
                  </Field>
                  <Field label="YYYY" required>
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      className={INPUT}
                      value={card.year}
                      onChange={(e) =>
                        setCard({ ...card, year: e.target.value })
                      }
                      placeholder="YYYY"
                      autoComplete="cc-exp-year"
                    />
                  </Field>
                  <div className="col-span-2">
                    <Field label="CVV" required>
                      <input
                        inputMode="numeric"
                        maxLength={4}
                        className={INPUT}
                        value={card.cvv}
                        onChange={(e) =>
                          setCard({ ...card, cvv: e.target.value })
                        }
                        placeholder="123"
                        autoComplete="cc-csc"
                      />
                    </Field>
                  </div>
                </div>
              </Card>
            ) : (
              <Card title="Payment">
                <p className="text-sm text-navy/60 leading-relaxed">
                  No card required — this order totals $0.00. Confirm your
                  shipping details and submit.
                </p>
              </Card>
            )}
          </div>

          {/* Summary */}
          <div>
            <div className="sticky top-28 bg-white rounded-2xl border border-surface-300/50 p-5">
              <h2 className="font-heading font-bold text-base text-navy mb-3">
                Order summary
              </h2>
              <div className="max-h-80 overflow-y-auto -mx-1 px-1">
                {items.map((i) => (
                  <SummaryItem key={i.id} item={i} />
                ))}
              </div>
              <dl className="mt-4 space-y-2 text-sm">
                <Row label="Subtotal" value={formatUSD(subtotal)} />
                <Row
                  label="Shipping"
                  value={SHIPPING === 0 ? "Free" : formatUSD(SHIPPING)}
                />
                <Row label="Tax (est.)" value={formatUSD(TAX)} />
              </dl>
              <div className="mt-4 pt-4 border-t border-surface-300/40 flex items-center justify-between">
                <span className="font-mono text-xs text-navy/40 uppercase tracking-widest">
                  Total
                </span>
                <span className="font-heading font-bold text-2xl text-navy tracking-tight">
                  {formatUSD(total)}
                </span>
              </div>

              {error && (
                <div className="mt-4 p-3 rounded-xl bg-red-50 text-red-600 text-xs">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={processing}
                className="mt-5 btn-magnetic w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-sm font-semibold bg-accent-500 text-white hover:bg-accent-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="btn-bg bg-accent-600 rounded-full" />
                <span className="relative z-10 flex items-center gap-2">
                  {processing ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Processing…
                    </>
                  ) : free ? (
                    <>Place order</>
                  ) : (
                    <>
                      <Lock size={13} />
                      Pay {formatUSD(total)}
                    </>
                  )}
                </span>
              </button>

              <p className="mt-3 text-[10px] font-mono text-navy/30 text-center uppercase tracking-widest">
                Payments by Authorize.net
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, icon, note, children }) {
  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading font-bold text-base text-navy flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {note}
      </div>
      {children}
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-[10px] font-mono text-navy/40 uppercase tracking-widest mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-navy/50">{label}</dt>
      <dd className="text-navy font-medium">{value}</dd>
    </div>
  );
}
