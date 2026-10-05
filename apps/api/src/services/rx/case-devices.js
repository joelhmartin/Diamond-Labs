import { buildDigitalDevices } from "@my-app/shared";

/**
 * Pure: a decrypted case row -> the device list its lines resolve from.
 *
 * Cases submitted since devices were resolved at submit carry them in
 * deviceOptions.devices. Older rows don't: digital-form cases stored only the
 * raw formData, and wizard cases stored a single deviceKey + its options.
 * Deriving from those keeps re-resolve working for every case in the queue.
 *
 * Lives apart from case-lines.service.js (which imports the database) so the
 * push path can read a case's devices without loading config/database.js.
 */
export function devicesForCase(caseRow = {}) {
  const stored = caseRow.deviceOptions?.devices;
  if (Array.isArray(stored) && stored.length > 0) return stored;
  if (caseRow.formType === "digital" && caseRow.formData) {
    return buildDigitalDevices(caseRow.formData);
  }
  if (caseRow.deviceKey) {
    return [{ deviceKey: caseRow.deviceKey, deviceOptions: caseRow.deviceOptions || {} }];
  }
  return [];
}
