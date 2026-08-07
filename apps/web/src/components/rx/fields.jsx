import { useRef, useState, useEffect } from "react";
import {
  Check,
  Upload,
  X,
  FileText,
  Image as ImageIcon,
  AlertCircle,
  ZoomIn,
} from "lucide-react";
import { Artboard } from "./Artboard.jsx";
import { Signature } from "./Signature.jsx";
import { shouldShow } from "./field-logic.js";

export { shouldShow };

const INPUT =
  "w-full px-4 py-3 rounded-xl bg-surface-50 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-muted";

export function Label({ children, required }) {
  return (
    <label className="block text-[13px] font-semibold text-secondary mb-2">
      {children} {required && <span className="text-red-400">*</span>}
    </label>
  );
}

/* ─── FIELD RENDERERS ─── */

/* Normalize an option to { value, label, image }. A plain string becomes
   value=label with no image. */
function normalizeOption(o) {
  if (typeof o === "string") return { value: o, label: o, image: undefined };
  return { value: o.value, label: o.label ?? o.value, image: o.image };
}

/* Reusable lightbox hook. `open(src, label)` shows a full-screen overlay;
   `lightbox` is the element to render (null when closed). Closes on backdrop
   click, the X button, or Escape. Use anywhere an image should be zoomable. */
export function useLightbox() {
  const [item, setItem] = useState(null); // { src, label } | null
  const open = (src, label = "") => setItem({ src, label });
  const close = () => setItem(null);

  useEffect(() => {
    if (!item) return;
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item]);

  const lightbox = item ? (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-navy/70 backdrop-blur-sm"
      onClick={close}
    >
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/90 text-navy hover:bg-white transition-all"
      >
        <X size={18} />
      </button>
      <figure
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={item.src}
          alt={item.label || ""}
          className="object-contain max-h-[80vh] max-w-[90vw] rounded-xl bg-white"
        />
        {item.label && (
          <figcaption className="text-white text-sm font-medium">{item.label}</figcaption>
        )}
      </figure>
    </div>
  ) : null;

  return { open, close, lightbox, isOpen: !!item };
}

/* Hover magnifier, absolutely positioned top-right inside a `group` parent. */
function ZoomButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Enlarge ${label || "image"}`}
      className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-white/90 text-navy/55 shadow-sm border border-surface-300/50 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-white hover:text-brand-600 transition-all"
    >
      <ZoomIn size={14} />
    </button>
  );
}

/* Selectable image card used by radio/checkbox image-option grids. The broken
   image hides itself onError so a dead URL falls back to just the label. On
   hover, a magnifier in the top-right opens the image in a lightbox. */
function ImageOptionCard({ option, active, onClick }) {
  const [imgOk, setImgOk] = useState(true);
  const { open, lightbox } = useLightbox();
  const showImg = option.image && imgOk;

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`w-full flex flex-col items-center gap-2 p-3 rounded-2xl border text-center transition-all duration-300 ${
          active
            ? "border-brand-500 ring-2 ring-brand-500/20 bg-brand-50"
            : "border-surface-300/50 hover:border-brand-300 bg-surface-50"
        }`}
      >
        {showImg && (
          <img
            src={option.image}
            alt=""
            loading="lazy"
            onError={() => setImgOk(false)}
            className="object-contain w-full h-24"
          />
        )}
        <span className="flex items-center justify-center gap-1.5 text-xs font-medium text-secondary">
          {active && <Check size={12} className="text-brand-500 flex-shrink-0" />}
          {option.label}
        </span>
      </button>

      {showImg && (
        <ZoomButton
          label={option.label}
          onClick={(e) => {
            e.stopPropagation();
            open(option.image, option.label);
          }}
        />
      )}
      {lightbox}
    </div>
  );
}

export function RadioField({ field, value, onChange }) {
  const opts = field.options.map(normalizeOption);
  const hasImages = opts.some((o) => o.image);

  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      {hasImages ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {opts.map((o) => (
            <ImageOptionCard
              key={o.value}
              option={o}
              active={value === o.value}
              onClick={() => onChange(o.value)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => {
            const active = value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(o.value)}
                className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                  active
                    ? "bg-brand-500 text-white shadow-sm"
                    : "bg-surface-50 text-navy/60 border border-surface-300/50 hover:border-brand-500/30 hover:text-navy"
                }`}
              >
                {active && <Check size={12} className="inline mr-1.5 -mt-0.5" />}
                {o.label}
              </button>
            );
          })}
        </div>
      )}
      {field.note && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-secondary">
          <AlertCircle size={11} className="mt-0.5 text-accent-500 flex-shrink-0" />
          {field.note}
        </p>
      )}
    </div>
  );
}

export function CheckboxField({ field, value, onChange }) {
  const selected = Array.isArray(value) ? value : [];
  const opts = field.options.map(normalizeOption);
  const hasImages = opts.some((o) => o.image);
  const toggle = (v) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      {hasImages ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {opts.map((o) => (
            <ImageOptionCard
              key={o.value}
              option={o}
              active={selected.includes(o.value)}
              onClick={() => toggle(o.value)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => {
            const active = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                  active
                    ? "bg-brand-500 text-white"
                    : "bg-surface-50 text-navy/60 border border-surface-300/50 hover:border-brand-500/30"
                }`}
              >
                {active && <Check size={12} className="inline mr-1.5 -mt-0.5" />}
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SelectField({ field, value, onChange }) {
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <select
        className={INPUT}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select...</option>
        {field.options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          const label = typeof o === "string" ? o : o.label;
          return (
            <option key={v} value={v}>
              {label}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export function TextField({ field, value, onChange }) {
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <div className="relative">
        <input
          type="text"
          className={`${INPUT} ${field.unit ? "pr-14" : ""}`}
          placeholder={field.placeholder}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.unit && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono text-secondary">
            {field.unit}
          </span>
        )}
      </div>
    </div>
  );
}

export function TextareaField({ field, value, onChange }) {
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <textarea
        className={`${INPUT} resize-none`}
        rows={field.rows || 3}
        placeholder={field.placeholder}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function MatrixField({ field, value, onChange }) {
  const values = value || {};
  const setCell = (row, col, v) =>
    onChange({ ...values, [`${row}__${col}`]: v });

  return (
    <div>
      <Label>{field.label}</Label>
      <div className="rounded-2xl border border-surface-300/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-100">
              <th className="text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-secondary font-normal">
                —
              </th>
              {field.columns.map((c) => (
                <th
                  key={c}
                  className="text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-secondary font-normal border-l border-surface-300/40"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {field.rows.map((row) => (
              <tr key={row} className="border-t border-surface-300/30">
                <td className="px-4 py-2 text-navy/60 font-medium whitespace-nowrap">
                  {row}
                </td>
                {field.columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-1.5 border-l border-surface-300/30"
                  >
                    <input
                      type="text"
                      className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-surface-300/50 focus:border-brand-500 focus:outline-none focus:bg-white text-sm"
                      value={values[`${row}__${col}`] || ""}
                      onChange={(e) => setCell(row, col, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ColorPaletteField({ field, value, onChange }) {
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-10 gap-2">
        {field.palette.map((c) => {
          const active = value === c.name;
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => onChange(active ? null : c.name)}
              title={c.name}
              className={`group relative aspect-square rounded-2xl transition-all duration-300 border-2 ${
                active
                  ? "border-navy scale-105 shadow-md"
                  : "border-surface-300/50 hover:border-navy/30 hover:scale-[1.02]"
              }`}
              style={{ backgroundColor: c.hex }}
            >
              {active && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor:
                        c.hex === "#f9fafb" || c.hex === "#e5e7eb"
                          ? "#0B1A2E"
                          : "#fff",
                    }}
                  >
                    <Check
                      size={12}
                      className={
                        c.hex === "#f9fafb" || c.hex === "#e5e7eb"
                          ? "text-white"
                          : "text-navy"
                      }
                    />
                  </div>
                </div>
              )}
              <span
                className={`absolute -bottom-5 left-0 right-0 text-[9px] font-mono text-secondary text-center transition-opacity ${
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                {c.name}
              </span>
            </button>
          );
        })}
      </div>
      {value && (
        <div className="mt-8 text-xs text-secondary">
          Selected: <span className="font-semibold text-navy">{value}</span>
        </div>
      )}
    </div>
  );
}

export function FileUploadField({ field, value, onChange }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const files = Array.isArray(value) ? value : [];
  const max = field.maxFiles || 10;

  const addFiles = (fileList) => {
    const existing = files.length;
    const room = Math.max(0, max - existing);
    if (room === 0) return;
    const added = Array.from(fileList)
      .slice(0, room)
      .map((file) => ({
        id: Math.random().toString(36).slice(2, 10),
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        preview: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null,
      }));
    onChange([...files, ...added]);
  };

  const remove = (id) => {
    const f = files.find((x) => x.id === id);
    if (f?.preview) URL.revokeObjectURL(f.preview);
    onChange(files.filter((x) => x.id !== id));
  };

  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-300 ${
          drag
            ? "border-brand-500 bg-brand-500/5"
            : "border-surface-300/50 bg-surface-50/50 hover:border-brand-500/30"
        }`}
      >
        <Upload
          size={20}
          className={`mx-auto mb-2 transition-colors ${
            drag ? "text-brand-500" : "text-icon"
          }`}
        />
        <p className="text-xs text-secondary">
          Drop files here or{" "}
          <span className="text-brand-500 font-medium">browse</span>
          {field.maxFiles && ` · up to ${max}`}
        </p>
        {field.accept && (
          <p className="mt-1 text-xs text-muted">
            Accepted: {field.accept}
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={field.accept || "*"}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2.5 pl-2 pr-1.5 py-1.5 rounded-xl bg-surface-50 border border-surface-300/30"
            >
              {f.preview ? (
                <img
                  src={f.preview}
                  alt=""
                  className="w-8 h-8 rounded-lg object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-surface-200/60 flex items-center justify-center">
                  <ImageIcon size={14} className="text-icon" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-secondary truncate max-w-[110px]">
                  {f.name}
                </p>
                <p className="text-xs text-muted">
                  {(f.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(f.id);
                }}
                className="w-6 h-6 rounded-full flex items-center justify-center text-icon hover:text-red-400 hover:bg-red-50 transition-all"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ArtboardField({ field, value, onChange }) {
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <Artboard value={value} onChange={onChange} />
    </div>
  );
}

/* ─── NEW RENDERERS (faithful form fields) ─── */

export function FullnameField({ field, value, onChange }) {
  const v = value && typeof value === "object" ? value : { first: "", last: "" };
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          type="text"
          className={INPUT}
          placeholder="First name"
          value={v.first || ""}
          onChange={(e) => onChange({ ...v, first: e.target.value })}
        />
        <input
          type="text"
          className={INPUT}
          placeholder="Last name"
          value={v.last || ""}
          onChange={(e) => onChange({ ...v, last: e.target.value })}
        />
      </div>
    </div>
  );
}

export function EmailField({ field, value, onChange }) {
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <input
        type="email"
        className={INPUT}
        placeholder={field.placeholder || "name@example.com"}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function PhoneField({ field, value, onChange }) {
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <input
        type="tel"
        className={INPUT}
        placeholder={field.placeholder || "(555) 555-5555"}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function AddressField({ field, value, onChange }) {
  const v = value && typeof value === "object" ? value : {};
  const set = (k, val) => onChange({ ...v, [k]: val });
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <div className="space-y-3">
        <input
          type="text"
          className={INPUT}
          placeholder="Office / Practice (optional)"
          value={v.office || ""}
          onChange={(e) => set("office", e.target.value)}
        />
        <input
          type="text"
          className={INPUT}
          placeholder="Street address"
          value={v.street || ""}
          onChange={(e) => set("street", e.target.value)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="text"
            className={INPUT}
            placeholder="City"
            value={v.city || ""}
            onChange={(e) => set("city", e.target.value)}
          />
          <input
            type="text"
            className={INPUT}
            placeholder="State"
            value={v.state || ""}
            onChange={(e) => set("state", e.target.value)}
          />
          <input
            type="text"
            className={INPUT}
            placeholder="ZIP"
            value={v.zip || ""}
            onChange={(e) => set("zip", e.target.value)}
          />
        </div>
        <input
          type="text"
          className={INPUT}
          placeholder="Country"
          value={v.country || ""}
          onChange={(e) => set("country", e.target.value)}
        />
      </div>
    </div>
  );
}

export function DateField({ field, value, onChange }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <input
        type="date"
        min={today}
        className={INPUT}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function SignatureField({ field, value, onChange }) {
  // Wraps Signature.jsx; value is the PNG data-URL string it emits.
  return (
    <Signature
      value={value}
      onChange={onChange}
      label={field.label}
      required={field.required}
    />
  );
}

/* ─── STATIC / PRESENTATIONAL RENDERERS ─── */

export function HeadingField({ field }) {
  return (
    <h3 className="text-lg font-semibold text-navy tracking-tight">
      {field.label}
    </h3>
  );
}

export function DividerField() {
  return <hr className="border-0 border-t border-surface-300/50 my-2" />;
}

export function ImageField({ field }) {
  const [ok, setOk] = useState(true);
  const { open, lightbox } = useLightbox();
  if (!field.src || !ok) return null;
  return (
    <figure className="relative group rounded-2xl overflow-hidden border border-surface-300/50 bg-surface-50">
      <img
        src={field.src}
        alt={field.alt || ""}
        loading="lazy"
        onError={() => setOk(false)}
        className="block w-full h-auto"
      />
      <ZoomButton label={field.alt} onClick={() => open(field.src, field.alt)} />
      {field.alt && (
        <figcaption className="px-4 py-2 text-xs text-secondary">
          {field.alt}
        </figcaption>
      )}
      {lightbox}
    </figure>
  );
}

export function StaticField({ field }) {
  if (field.html) {
    return (
      <div
        className="text-sm text-navy/60 leading-relaxed [&_a]:text-brand-500 [&_a]:underline"
        dangerouslySetInnerHTML={{ __html: field.html }}
      />
    );
  }
  return <p className="text-sm text-navy/60 leading-relaxed">{field.label}</p>;
}

/* ─── RENDERER REGISTRY ─── */

export const RENDERERS = {
  radio: RadioField,
  checkbox: CheckboxField,
  select: SelectField,
  text: TextField,
  textarea: TextareaField,
  matrix: MatrixField,
  colorPalette: ColorPaletteField,
  fileUpload: FileUploadField,
  artboard: ArtboardField,
  fullname: FullnameField,
  email: EmailField,
  phone: PhoneField,
  address: AddressField,
  date: DateField,
  signature: SignatureField,
  heading: HeadingField,
  divider: DividerField,
  image: ImageField,
  static: StaticField,
};

// Presentational field types render their own markup (label/note handled internally).
const SELF_RENDERING = new Set(["heading", "divider", "image", "static"]);

/**
 * Generic field wrapper used by FormRenderer.
 * - Returns null when hidden by `shouldShow`.
 * - For input fields, renders the label (with required asterisk) + optional note
 *   via the renderer itself (renderers already draw their own Label).
 * - For presentational types it just renders the renderer.
 */
export function FormField({ field, value, onChange, answers }) {
  if (!shouldShow(field, answers)) return null;
  const Renderer = RENDERERS[field.type];
  if (!Renderer) return null;

  if (SELF_RENDERING.has(field.type)) {
    return <Renderer field={field} />;
  }

  return (
    <div>
      <Renderer field={field} value={value} onChange={onChange} />
      {field.note && field.type !== "radio" && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-secondary">
          <AlertCircle size={11} className="mt-0.5 text-accent-500 flex-shrink-0" />
          {field.note}
        </p>
      )}
    </div>
  );
}
