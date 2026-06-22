import { RENDERERS, shouldShow } from "./fields.jsx";

/**
 * Renders the device-specific option schema defined in rx-devices.js.
 * `schema` is the device.options object; `values` is the per-device state slice.
 *
 * Field renderers + shouldShow now live in ./fields.jsx (single source of truth).
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
