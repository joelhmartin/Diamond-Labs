import { useState, useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import api from "../../config/api.js";

/**
 * Accept Hosted Customer Profile (SAQ A) — add-payment-method iframe.
 *
 * Fetches a one-time session token from the backend
 * (POST /payments/saved-cards/hosted-token → { token, addCardUrl }),
 * then loads Authorize.net's hosted add-card page inside an iframe via a
 * form-POST of the token. Card data is entered entirely on Authorize.net's
 * domain — it never touches our DOM.
 *
 * Completion is signalled by window.AuthorizeNetIFrame.onReceiveCommunication()
 * (same IFrameCommunicator relay used by HostedPaymentForm) but with
 * action=successfulSave instead of action=transactResponse. No server-side
 * verify step is needed: Authorize.net stores the new payment profile under
 * the doctor's CIM customer profile automatically.
 *
 * Props:
 *   tokenEndpoint  string  backend route returning { token, addCardUrl }
 *   tokenBody      object  extra fields merged into the token request body
 *   onComplete     () => void   called on action=successfulSave
 *   onCancel       () => void   called on action=cancel
 *   onError        (message) => void
 */
export function HostedAddCardForm({
  tokenEndpoint = "/payments/saved-cards/hosted-token",
  tokenBody = {},
  onComplete,
  onCancel,
  onError,
}) {
  const [token, setToken] = useState(null);
  const [addCardUrl, setAddCardUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const formRef = useRef(null);
  const iframeRef = useRef(null);

  // Stable ref so the mount-time token fetch never re-runs when parents pass
  // fresh object literals each render.
  const tokenBodyRef = useRef(tokenBody);

  // Install the IFrameCommunicator handler. The hosted profile page fires
  // action=successfulSave on completion and action=cancel on dismissal — the
  // same relay and global as HostedPaymentForm, but different action names.
  useEffect(() => {
    const handle = (queryStr) => {
      let params;
      try {
        params = new URLSearchParams(queryStr);
      } catch {
        return;
      }
      const action = params.get("action");
      if (!action) return;

      if (action === "resizeWindow") {
        const h = parseInt(params.get("height"), 10);
        if (h && iframeRef.current) iframeRef.current.style.height = `${h + 30}px`;
      } else if (action === "successfulSave") {
        onComplete?.();
      } else if (action === "cancel") {
        onCancel?.();
      }
    };

    const prev = window.AuthorizeNetIFrame;
    window.AuthorizeNetIFrame = { onReceiveCommunication: handle };
    return () => { window.AuthorizeNetIFrame = prev; };
  }, [onComplete, onCancel]);

  // Fetch the session token once on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .post(tokenEndpoint, {
        ...tokenBodyRef.current,
        iframeCommunicatorUrl: `${window.location.origin}/IFrameCommunicator.html`,
      })
      .then(({ data }) => {
        if (cancelled) return;
        setToken(data.data.token);
        setAddCardUrl(data.data.addCardUrl);
      })
      .catch((err) => {
        if (!cancelled)
          onError?.(
            err.response?.data?.error?.message || "Could not load the add-card form."
          );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [tokenEndpoint, onError]);

  // Once we have both token and URL, submit the hidden form into the iframe.
  useEffect(() => {
    if (token && addCardUrl && formRef.current) formRef.current.submit();
  }, [token, addCardUrl]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!token) {
    return (
      <p className="py-6 text-center text-sm text-red-600">Add-card form unavailable.</p>
    );
  }

  return (
    <div className="relative">
      {/* Hidden form-POST that authenticates the hosted session. The iframe
          name must differ from hostedPaymentIframe so both can coexist if ever
          both components are in the tree at the same time. */}
      <form
        ref={formRef}
        method="post"
        action={addCardUrl}
        target="hostedAddCardIframe"
        className="hidden"
      >
        <input type="hidden" name="token" value={token} />
      </form>
      <iframe
        ref={iframeRef}
        name="hostedAddCardIframe"
        title="Add payment method"
        width="100%"
        height="600"
        frameBorder="0"
        scrolling="auto"
        className="w-full rounded-xl border border-gray-200"
        style={{ minHeight: 600 }}
      />
    </div>
  );
}
