/**
 * Adapter: faithful RX form answers → admin mapping-tester case input.
 *
 * Bridges the doctor-facing FormRenderer (which produces a flat
 * `{ [fieldKey]: value }` answers map) to the shape PreviewModal expects
 * (`{ devices: [{ deviceKey, label, deviceOptions }], caseFields }`) WITHOUT
 * touching the device→Seazona map.
 *
 * A single completed form may order MULTIPLE devices (the digital form gates
 * several device sections behind one `devicesToOrder` multi-select). Each
 * selected device becomes its own entry in `devices`, so the preview resolves
 * line items per-device instead of collapsing everything into one appliance
 * plus a giant notes dump.
 *
 * Line-item coverage is intentionally partial — the whole point of the tester
 * is to surface which fields populate the Seazona order and which don't.
 */

import { visibleFields } from "./form-logic.js";

/** Does an answer count as "filled"? (non-empty array / string / object). */
function answered(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "object") return Object.values(v).some((x) => answered(x));
  return Boolean(v);
}

// Human-readable device names, keyed by rx-device key.
const DEVICE_LABELS = {
  "olmos-day": "OLMOS Day",
  "olmos-night": "OLMOS Night",
  mora: "MORA",
  ara: "ARA",
  ddso: "DDSO",
  "cadcam-d-pro": "CAD/CAM D-Pro",
  "shirazi-hybrid": "Shirazi Hybrid",
  guard: "Nightguard",
  "sport-guard": "Sport-Guard",
  snorehook: "SnoreHook",
  "ortho-expander": "Orthodontic Appliance",
};

/**
 * Drop empty/undefined deviceOptions entries so the preview never carries
 * blank fields. Keeps non-empty strings, non-empty arrays, and truthy scalars.
 */
function cleanOptions(options) {
  const out = {};
  for (const [k, v] of Object.entries(options)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length) out[k] = v;
      continue;
    }
    if (typeof v === "string") {
      if (v.trim() !== "") out[k] = v;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Build one device entry with a resolved label + cleaned options. */
function makeDevice(deviceKey, deviceOptions) {
  return {
    deviceKey,
    label: DEVICE_LABELS[deviceKey] || deviceKey,
    deviceOptions: cleanOptions(deviceOptions),
  };
}

/**
 * Digital form → one or more devices, one per selected `devicesToOrder` value.
 * Only emits devices for explicitly-selected values — never invents a device.
 */
function buildDigitalDevices(answers) {
  const sel = answers.devicesToOrder;
  const values = Array.isArray(sel) ? sel : sel ? [sel] : [];
  const devices = [];

  for (const v of values) {
    switch (v) {
      case "olmos": {
        const odAnswered =
          answered(answers.odMaterial) ||
          answered(answers.odExpansionOptions) ||
          answered(answers.odComments);
        const onAnswered =
          answered(answers.onDesign) || answered(answers.onSpecifications);
        if (odAnswered) {
          devices.push(
            makeDevice("olmos-day", {
              baseMaterial: answers.odMaterial,
              modifications: answers.odExpansionOptions,
              comments: answers.odComments,
            })
          );
        }
        if (onAnswered) {
          devices.push(
            makeDevice("olmos-night", {
              variant: answers.onDesign,
              modifications: answers.onSpecifications,
            })
          );
        }
        if (!odAnswered && !onAnswered) {
          devices.push(makeDevice("olmos-day", {}));
        }
        break;
      }
      case "mistry": {
        if (answered(answers.mora)) devices.push(makeDevice("mora", {}));
        if (answered(answers.ara)) devices.push(makeDevice("ara", {}));
        break;
      }
      case "ddso":
        devices.push(
          makeDevice("ddso", {
            baseMaterial: answers.ddsoMaterial,
            occlusalContact: answers.ddsoOcclusalContact,
            designPreference: answers.ddsoDesignPreference,
            modifications: [
              ...(answers.ddsoAdditionalOptions || []),
              ...(answers.ddsoModifications || []),
            ],
            comments: answers.ddsoComments,
          })
        );
        break;
      case "dpro":
        devices.push(
          makeDevice("cadcam-d-pro", {
            occlusalContact: answers.dproOcclusalContact,
            designPreference: answers.dproDesignPreference,
            modifications: [
              ...(answers.dproAdditionalOptions || []),
              ...(answers.dproModifications || []),
            ],
            comments: answers.dproComments,
          })
        );
        break;
      case "shirazi":
        devices.push(
          makeDevice("shirazi-hybrid", {
            occlusalContact: answers.occlusalContact,
            designPreference: answers.designPreference,
            modifications: [
              ...(answers.modificationsA || []),
              ...(answers.modificationsB || []),
            ],
            comments: answers.hybridComments,
          })
        );
        break;
      case "nightguards":
        devices.push(
          makeDevice("guard", {
            variant: answers.nightguardDevice?.[0],
            standardGuards: answers.standardGuards,
            modifications: answers.attachmentsModifications,
            comments: answers.nightguardComments,
          })
        );
        break;
      case "ortho":
        devices.push(
          makeDevice("ortho-expander", {
            applianceType: answers.selectDevice,
            upperArchRetention: answers.upperArchRetention,
            upperExpansionType: answers.upperExpansionType,
            lowerArchRetention: answers.lowerArchRetention,
            lowerExpansionType: answers.lowerExpansionType,
            upperExpansionSelection: answers.upperExpansionSelection,
            lowerExpansionSelection: answers.lowerExpansionSelection,
            tandemBowSetting: answers.tandemBowSetting,
            modifications: [
              ...(answers.addToMaxillary || []),
              ...(answers.addToMandibular || []),
              ...(answers.maxillaryAdd || []),
              ...(answers.mandibularAdd || []),
            ],
            comments: [answers.dualArchComments, answers.maxillaryComments, answers.orthoDesignComments].filter(Boolean).join(" | "),
          })
        );
        break;
      case "sportguards":
        devices.push(
          makeDevice("sport-guard", {
            variant: answers.sportGuardDevice?.[0],
            comments: answers.mouthguardComments,
          })
        );
        break;
      case "snorehook":
        devices.push(
          makeDevice("snorehook", { comments: answers.snorehookComments })
        );
        break;
      default:
        break;
    }
  }

  return devices;
}

/**
 * formAnswersToCaseInput(slug, form, answers)
 *   → { devices: [{ deviceKey, label, deviceOptions }], caseFields }
 *
 * caseFields holds the order-level (shared) settings; per-device selections
 * live on each device's `deviceOptions`. The whole-form notes dump is gone —
 * notes are now compiled per-device on the backend.
 */
export function formAnswersToCaseInput(slug, form, answers = {}) {
  const fields = visibleFields(form, answers);

  // ── Patient name ← fullname field whose key matches /patient/i ──
  const patientField = fields.find(
    (f) => f.type === "fullname" && /patient/i.test(f.key || "")
  );
  const patientVal = patientField ? answers[patientField.key] : null;
  const patientFirst = patientVal?.first?.trim() || "Test";
  const patientLast = patientVal?.last?.trim() || "Patient";

  // ── Due date ← date field whose key matches /due/i ──
  const dueField = fields.find(
    (f) => f.type === "date" && /due/i.test(f.key || "")
  );
  const dueDate = dueField ? answers[dueField.key] : undefined;

  const devices = buildDigitalDevices(answers);

  const caseFields = {
    patientFirst,
    patientLast,
    recordsMethod: "itero",
    physicalBite: "no_digital",
    firstDevice: "Yes",
    rush: false,
    rushTier: "nylon",
    ...(dueDate ? { dueDate } : {}),
  };

  return { devices, caseFields };
}

export default formAnswersToCaseInput;
