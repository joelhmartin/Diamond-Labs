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

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/**
 * Orthodontic answers → the one ortho-expander device. The ONLY ortho adapter:
 * the ortho form, legacy digital-form ortho cases, the admin preview and the
 * submit route all come through here.
 *
 * Every appliance answer is carried, keyed as the resolver
 * (apps/api/src/services/rx/catalog-map/resolvers/ortho.js) reads it. Add-ons
 * stay PER ARCH (upperAddOns / lowerAddOns) instead of being pooled into
 * `modifications`, because the same literal ("Buccal tubes to bands") bills
 * differently depending on which arch it was ticked for. An earlier
 * buildOrthoDevices dropped every retention / screw / clasp answer; nothing may
 * be dropped here — a field the resolver does not price still travels in
 * deviceOptions for the lab to read.
 */
function buildOrthoDevice(answers = {}) {
  return makeDevice("ortho-expander", {
    applianceType: answers.selectDevice,
    upperArchRetention: answers.upperArchRetention,
    upperExpansionType: answers.upperExpansionType,
    lowerArchRetention: answers.lowerArchRetention,
    lowerExpansionType: answers.lowerExpansionType,
    upperExpansionSelection: answers.upperExpansionSelection,
    lowerExpansionSelection: answers.lowerExpansionSelection,
    removableMandibularExpansion: answers.removableMandibularExpansion,
    fixedMandibularExpansion: answers.fixedMandibularExpansion,
    mxSelections: answers.mxSelections,
    requiredSelection: answers.requiredSelection,
    occlusalOptionsTandem: answers.occlusalOptionsTandem,
    tandemBowSetting: answers.tandemBowSetting,
    upperAddOns: [...new Set([...asList(answers.addToMaxillary), ...asList(answers.maxillaryAdd)])],
    lowerAddOns: [...new Set([...asList(answers.addToMandibular), ...asList(answers.mandibularAdd)])],
    digitalStudyModels: answers.digitalStudyModels,
    nuveloDigitalSetup: answers.nuveloDigitalSetup,
    comments: [
      answers.dualArchComments,
      answers.maxillaryComments,
      answers.orthoDesignComments,
    ].filter(Boolean).join(" | "),
  });
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
          answered(answers.onDesign) ||
          answered(answers.onMaterial) ||
          answered(answers.onSpecifications) ||
          answered(answers.onModifications);
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
              baseMaterial: answers.onMaterial,
              modifications: answers.onModifications,
              // Build instructions, not products — they travel as order notes.
              instructions: [
                ...(answers.onSpecifications || []),
                ...(answers.opposingTrutaine ? [`Opposing trutaine: ${answers.opposingTrutaine}`] : []),
              ],
              comments: answers.onComments,
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
            titrationPlacement: answers.ddsoTitrationPlacement,
            modifications: answers.ddsoModifications,
            instructions: answers.ddsoAdditionalOptions,
            comments: answers.ddsoComments,
          })
        );
        break;
      case "dpro":
        devices.push(
          makeDevice("cadcam-d-pro", {
            variant: answers.dproDevice,
            occlusalContact: answers.dproOcclusalContact,
            designPreference: answers.dproDesignPreference,
            titrationPlacement: answers.dproTitrationPlacement,
            modifications: answers.dproModifications,
            instructions: answers.dproAdditionalOptions,
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
            // The device picker is a CHECKBOX — pass every checked render, not
            // just the first. resolveGuard accepts a string or an array and
            // flags anything it cannot map, so nothing selected is dropped.
            variant: answers.nightguardDevice,
            standardGuards: answers.standardGuards,
            modifications: answers.attachmentsModifications,
            comments: answers.nightguardComments,
          })
        );
        break;
      case "ortho":
        // Legacy: ortho was a gated device of this form Aug–Oct 2026. New
        // ortho prescriptions arrive as their own formType (buildFormDevices);
        // digital cases from that window still rebuild through here.
        devices.push(buildOrthoDevice(answers));
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
 * Any Rx form's answers → its devices, by the form type stored on the case
 * (rx_cases.form_type). The ortho form always orders exactly one ortho
 * appliance — even unanswered, so the case reaches the lab flagged
 * ("ortho:unspecified") rather than arriving with no device at all.
 */
function buildFormDevices(formType, answers = {}) {
  if (formType === "ortho") return [buildOrthoDevice(answers)];
  return buildDigitalDevices(answers);
}

export { buildDigitalDevices, buildFormDevices, buildOrthoDevice, DEVICE_LABELS };
