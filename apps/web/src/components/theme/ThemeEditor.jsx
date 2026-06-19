import { useEffect, useState } from "react";
import { useAuthStore } from "../../stores/auth.store.js";
import { applyTheme, fetchTheme, saveTheme, resetTheme } from "../../lib/theme.js";
import { EDITOR_TOKENS, FONT_OPTIONS, ON_DARK_WHITE, ON_DARK_NAVY } from "./theme-tokens.js";

const hexToChannels = (hex) => {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
};
const channelsToHex = (ch) => {
  const [r, g, b] = ch.split(" ").map(Number);
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

export function ThemeEditor() {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  const enabled = import.meta.env.VITE_THEME_EDITOR === "on" && isAdmin;

  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState({});   // working override (channels/font strings)
  const [status, setStatus] = useState("");

  useEffect(() => { if (enabled) fetchTheme().then(setTokens); }, [enabled]);
  useEffect(() => { if (enabled) applyTheme(tokens); }, [tokens, enabled]); // live preview

  if (!enabled) return null;

  const setToken = (key, value) => setTokens((t) => ({ ...t, [key]: value }));
  const valueFor = (tok) =>
    tokens[tok.key] ?? (tok.type === "color" ? hexToChannels(tok.default) : tok.default);

  const groups = ["Palette", "Typography", "Dark sections"];

  return (
    <div className="fixed bottom-5 left-5 z-[10000] font-sans">
      {!open && (
        <button onClick={() => setOpen(true)}
          className="rounded-full bg-navy text-on-dark px-5 py-3 shadow-xl text-sm font-semibold">
          🎨 Theme
        </button>
      )}
      {open && (
        <div className="w-80 max-h-[80vh] overflow-y-auto rounded-[2rem] bg-surface-50 shadow-2xl border border-color-border p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="font-semibold text-color-text">Theme editor</span>
            <button onClick={() => setOpen(false)} className="text-color-text/50">✕</button>
          </div>

          {groups.map((g) => (
            <section key={g} className="mb-5">
              <h4 className="text-xs uppercase tracking-wide text-color-text/40 mb-2">{g}</h4>
              {EDITOR_TOKENS.filter((t) => t.group === g).map((tok) => (
                <div key={tok.key} className="flex items-center justify-between gap-3 mb-2">
                  <label className="text-sm text-color-text/80">{tok.label}</label>
                  {tok.type === "color" && (
                    <input type="color" value={channelsToHex(valueFor(tok))}
                      onChange={(e) => setToken(tok.key, hexToChannels(e.target.value))} />
                  )}
                  {tok.type === "font" && (
                    <select value={valueFor(tok)} onChange={(e) => setToken(tok.key, e.target.value)}
                      className="text-xs border border-color-border rounded px-1 py-1 max-w-[55%]">
                      {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f.split(",")[0].replace(/"/g, "")}</option>)}
                    </select>
                  )}
                  {tok.type === "toggle" && (
                    <button
                      onClick={() => setToken(tok.key, valueFor(tok) === ON_DARK_WHITE ? ON_DARK_NAVY : ON_DARK_WHITE)}
                      className="text-xs rounded-full border border-color-border px-3 py-1">
                      {valueFor(tok) === ON_DARK_WHITE ? "White text" : "Dark text"}
                    </button>
                  )}
                </div>
              ))}
            </section>
          ))}

          <div className="flex gap-2 mt-4">
            <button onClick={async () => { try { await saveTheme(tokens); setStatus("Saved ✓"); } catch { setStatus("Save failed"); } }}
              className="flex-1 rounded-full bg-brand-500 text-on-dark py-2 text-sm font-semibold">Save</button>
            <button onClick={async () => { try { await resetTheme(); setTokens({}); applyTheme({}); setStatus("Reset"); } catch { setStatus("Reset failed"); } }}
              className="flex-1 rounded-full border border-color-border py-2 text-sm">Reset</button>
          </div>
          <button onClick={() => navigator.clipboard.writeText(`:root{${Object.entries(tokens).map(([k,v]) => `--${k}:${v};`).join("")}}`)}
            className="w-full mt-2 text-xs text-color-text/50 underline">Copy override CSS</button>
          {status && <p className="text-xs text-color-text/60 mt-2">{status}</p>}
        </div>
      )}
    </div>
  );
}
