import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScanLine } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { errorText } from "../../lib/requests.js";

const INPUT_CLASS = "rounded-lg border border-surface-300/60 bg-white px-3 py-2 text-sm text-navy focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/10";

/**
 * A box for scanned or typed codes. Enter looks the code up: one hit goes
 * straight to it, several show a choice list, none says so and keeps focus
 * so the next scan can follow immediately.
 */
export function ScanBox({ placeholder = "Scan or type a code…", autoFocus = false, onHit, lookupPath = "/lookup" }) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const inputRef = useRef(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState(null);
  const [missed, setMissed] = useState(null);

  const open = (hit) => {
    setChoices(null);
    setMissed(null);
    setCode("");
    onHit?.(hit);
    navigate(hit.href);
  };

  const submit = async (e) => {
    e.preventDefault();
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setChoices(null);
    setMissed(null);
    try {
      const res = await api.get(lookupPath, { params: { code: value } });
      const hits = res.data.data.hits;
      if (hits.length === 1) open(hits[0]);
      else if (hits.length > 1) setChoices(hits);
      else {
        setMissed(value);
        setCode("");
      }
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="relative">
      <form onSubmit={submit} className="relative">
        <ScanLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-label="Scan a code"
          className={`${INPUT_CLASS} w-56 pl-8`}
        />
      </form>
      {missed && <p role="status" className="absolute left-0 top-full z-20 mt-1 whitespace-nowrap text-xs font-semibold text-red-700">No match for {missed}</p>}
      {choices && (
        <ul className="absolute right-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-lg" aria-label="Matches">
          {choices.map((h) => (
            <li key={`${h.recordType}:${h.recordId}`}>
              <button type="button" onClick={() => open(h)} className="block w-full px-4 py-2 text-left hover:bg-surface-100">
                <span className="block text-sm font-semibold text-navy">{h.title}</span>
                {h.subtitle && <span className="block text-xs text-navy/60">{h.subtitle}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
