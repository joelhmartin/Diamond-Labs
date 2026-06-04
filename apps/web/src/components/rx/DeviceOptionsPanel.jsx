import { useRef, useState } from "react";
import {
  Check,
  Upload,
  X,
  FileText,
  Image as ImageIcon,
  AlertCircle,
} from "lucide-react";

const INPUT =
  "w-full px-4 py-3 rounded-xl bg-surface-50 border border-surface-300/50 text-ink text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-ink/25";

function Label({ children, required }) {
  return (
    <label className="block text-xs font-semibold text-ink/40 uppercase tracking-wider mb-2">
      {children} {required && <span className="text-red-400">*</span>}
    </label>
  );
}

function shouldShow(field, values) {
  if (!field.showIf) return true;
  const other = values[field.showIf.key];
  if (field.showIf.equals != null) return other === field.showIf.equals;
  if (field.showIf.prefix != null)
    return typeof other === "string" && other.startsWith(field.showIf.prefix);
  return true;
}

/* ─── FIELD RENDERERS ─── */

function RadioField({ field, value, onChange }) {
  const opts = field.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
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
                  : "bg-surface-50 text-ink/60 border border-surface-300/50 hover:border-brand-500/30 hover:text-ink"
              }`}
            >
              {active && <Check size={12} className="inline mr-1.5 -mt-0.5" />}
              {o.label}
            </button>
          );
        })}
      </div>
      {field.note && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-ink/45">
          <AlertCircle size={11} className="mt-0.5 text-accent-500 flex-shrink-0" />
          {field.note}
        </p>
      )}
    </div>
  );
}

function CheckboxField({ field, value, onChange }) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = (v) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <div className="flex flex-wrap gap-2">
        {field.options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          const label = typeof o === "string" ? o : o.label;
          const active = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                active
                  ? "bg-brand-500 text-white"
                  : "bg-surface-50 text-ink/60 border border-surface-300/50 hover:border-brand-500/30"
              }`}
            >
              {active && <Check size={12} className="inline mr-1.5 -mt-0.5" />}
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectField({ field, value, onChange }) {
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

function TextField({ field, value, onChange }) {
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
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono text-ink/40">
            {field.unit}
          </span>
        )}
      </div>
    </div>
  );
}

function TextareaField({ field, value, onChange }) {
  return (
    <div>
      <Label required={field.required}>{field.label}</Label>
      <textarea
        className={`${INPUT} resize-none`}
        rows={3}
        placeholder={field.placeholder}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function MatrixField({ field, value, onChange }) {
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
              <th className="text-left px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-ink/40 font-normal">
                —
              </th>
              {field.columns.map((c) => (
                <th
                  key={c}
                  className="text-left px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-ink/40 font-normal border-l border-surface-300/40"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {field.rows.map((row) => (
              <tr key={row} className="border-t border-surface-300/30">
                <td className="px-4 py-2 text-ink/60 font-medium whitespace-nowrap">
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

function ColorPaletteField({ field, value, onChange }) {
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
                  ? "border-ink scale-105 shadow-md"
                  : "border-surface-300/50 hover:border-ink/30 hover:scale-[1.02]"
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
                          : "text-ink"
                      }
                    />
                  </div>
                </div>
              )}
              <span
                className={`absolute -bottom-5 left-0 right-0 text-[9px] font-mono text-ink/50 text-center transition-opacity ${
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
        <div className="mt-8 text-xs text-ink/50">
          Selected: <span className="font-semibold text-ink">{value}</span>
        </div>
      )}
    </div>
  );
}

function FileUploadField({ field, value, onChange }) {
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
            drag ? "text-brand-500" : "text-ink/20"
          }`}
        />
        <p className="text-xs text-ink/50">
          Drop files here or{" "}
          <span className="text-brand-500 font-medium">browse</span>
          {field.maxFiles && ` · up to ${max}`}
        </p>
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
                  <ImageIcon size={14} className="text-ink/30" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink/70 truncate max-w-[110px]">
                  {f.name}
                </p>
                <p className="text-[10px] text-ink/25">
                  {(f.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(f.id);
                }}
                className="w-6 h-6 rounded-full flex items-center justify-center text-ink/20 hover:text-red-400 hover:bg-red-50 transition-all"
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

/* ─── MAIN PANEL ─── */

const RENDERERS = {
  radio: RadioField,
  checkbox: CheckboxField,
  select: SelectField,
  text: TextField,
  textarea: TextareaField,
  matrix: MatrixField,
  colorPalette: ColorPaletteField,
  fileUpload: FileUploadField,
};

/**
 * Renders the device-specific option schema defined in rx-devices.js.
 * `schema` is the device.options object; `values` is the per-device state slice.
 */
export function DeviceOptionsPanel({ schema, values, onChange }) {
  const entries = Object.entries(schema);

  return (
    <div className="space-y-6">
      {entries.map(([key, field]) => {
        if (!shouldShow(field, values)) return null;
        const Renderer = RENDERERS[field.type];
        if (!Renderer) return null;
        return (
          <Renderer
            key={key}
            field={field}
            value={values[key]}
            onChange={(v) => onChange(key, v)}
          />
        );
      })}
    </div>
  );
}
