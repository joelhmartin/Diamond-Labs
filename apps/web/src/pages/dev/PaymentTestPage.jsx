import { useState } from "react";
import { ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "../../components/ui/Button.jsx";
import { HostedPaymentForm } from "../../components/doctor/HostedPaymentForm.jsx";

/**
 * Dev-only Accept Hosted test harness. Loads Authorize.net's hosted card form
 * (card data never touches our DOM) and verifies the result server-side. Does
 * NOT write to Seazona or the invoice ledger — pure pipeline test.
 */
export function PaymentTestPage() {
  const [mode, setMode] = useState("sandbox");
  const [amount, setAmount] = useState("1.00");
  const [started, setStarted] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const reset = () => {
    setStarted(false);
    setResult(null);
    setError(null);
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-brand-600" />
        <h1 className="text-2xl font-semibold">Payment Test (Accept Hosted)</h1>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Card data is entered on Authorize.net's hosted iframe — it never touches this page.
        This harness verifies the charge server-side and does <strong>not</strong> record anything in Seazona.
      </p>

      {!started && (
        <div className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6">
          <div>
            <label className="mb-2 block text-xs font-medium text-gray-500">Environment</label>
            <div className="flex gap-2">
              {["sandbox", "production"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium capitalize transition-colors ${
                    mode === m ? "bg-brand-50 text-brand-700 ring-1 ring-brand-500" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Amount (USD)</label>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">$</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          {mode === "sandbox" ? (
            <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
              Sandbox — use test card <strong>4111 1111 1111 1111</strong>, any future expiry, any CVV. No real money moves.
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span><strong>Production — real charge.</strong> Use a small amount and void/refund it in the Authorize.net dashboard afterward.</span>
            </div>
          )}

          <Button
            onClick={() => { setError(null); setResult(null); setStarted(true); }}
            disabled={!(Number(amount) > 0)}
            className="w-full"
          >
            Load secure payment form
          </Button>
        </div>
      )}

      {started && !result && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <HostedPaymentForm
            amount={Number(amount)}
            mode={mode}
            onComplete={(details) => setResult(details)}
            onError={(msg) => { setError(msg); setStarted(false); }}
          />
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6">
          <div className="mb-3 flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-6 w-6" />
            <h2 className="text-lg font-semibold">Payment verified</h2>
          </div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500">Transaction ID</dt><dd className="font-mono">{result.transId}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Amount</dt><dd className="font-medium">${Number(result.amount).toFixed(2)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Status</dt><dd>{result.status}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Environment</dt><dd className="capitalize">{mode}</dd></div>
          </dl>
          <Button onClick={reset} variant="secondary" className="mt-4 w-full">Run another test</Button>
        </div>
      )}
    </div>
  );
}
