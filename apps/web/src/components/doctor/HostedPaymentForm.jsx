import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import api from "../../config/api.js";

/**
 * Accept Hosted (SAQ A) payment form. Fetches a one-time form token from the
 * backend, then loads Authorize.net's hosted card form inside an iframe. The
 * card data is entered on Authorize.net's domain — it never touches our DOM.
 *
 * Transaction results arrive via postMessage relayed by /IFrameCommunicator.html.
 *
 * Props:
 *   amount     number
 *   mode       "sandbox" | "production"
 *   onComplete (details) => void   // verified { transId, amount, status, responseCode }
 *   onError    (message) => void
 */
export function HostedPaymentForm({ amount, mode, onComplete, onError }) {
  const [token, setToken] = useState(null);
  const [formUrl, setFormUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const formRef = useRef(null);
  const iframeRef = useRef(null);

  const completeTransaction = useCallback(async (transId) => {
    setVerifying(true);
    try {
      const { data } = await api.post("/payments/test/hosted-complete", { transId, mode });
      onComplete?.(data.data);
    } catch (err) {
      onError?.(err.response?.data?.error?.message || "Could not verify the transaction.");
    } finally {
      setVerifying(false);
    }
  }, [mode, onComplete, onError]);

  // Relay handler for messages forwarded by IFrameCommunicator.html
  useEffect(() => {
    const handleMessage = (e) => {
      if (typeof e.data !== "string") return;
      let params;
      try {
        params = new URLSearchParams(e.data);
      } catch {
        return;
      }
      const action = params.get("action");
      if (!action) return;

      if (action === "resizeWindow") {
        const h = parseInt(params.get("height"), 10);
        if (h && iframeRef.current) iframeRef.current.style.height = `${h + 30}px`;
      } else if (action === "cancel") {
        onError?.("Payment cancelled.");
      } else if (action === "transactResponse") {
        try {
          const resp = JSON.parse(params.get("response"));
          if (resp?.transId) completeTransaction(resp.transId);
          else onError?.("No transaction id returned.");
        } catch {
          onError?.("Malformed transaction response.");
        }
      }
    };
    window.addEventListener("message", handleMessage, false);
    return () => window.removeEventListener("message", handleMessage, false);
  }, [completeTransaction, onError]);

  // Fetch the form token once on mount.
  useEffect(() => {
    let cancelled = false;
    api.post("/payments/test/hosted-token", {
      amount,
      mode,
      iframeCommunicatorUrl: `${window.location.origin}/IFrameCommunicator.html`,
    })
      .then(({ data }) => {
        if (cancelled) return;
        setToken(data.data.token);
        setFormUrl(data.data.formUrl);
      })
      .catch((err) => {
        if (!cancelled) onError?.(err.response?.data?.error?.message || "Could not load the payment form.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [amount, mode, onError]);

  // Once we have a token, POST it to the hosted form (targets the iframe).
  useEffect(() => {
    if (token && formUrl && formRef.current) formRef.current.submit();
  }, [token, formUrl]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!token) {
    return <p className="py-6 text-center text-sm text-red-600">Payment form unavailable.</p>;
  }

  return (
    <div className="relative">
      <form ref={formRef} method="post" action={formUrl} target="hostedPaymentIframe" className="hidden">
        <input type="hidden" name="token" value={token} />
      </form>
      <iframe
        ref={iframeRef}
        name="hostedPaymentIframe"
        title="Secure payment"
        width="100%"
        height="450"
        frameBorder="0"
        scrolling="no"
        className="w-full rounded-xl border border-gray-200"
      />
      {verifying && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
          <span className="ml-2 text-sm text-gray-600">Verifying…</span>
        </div>
      )}
    </div>
  );
}
