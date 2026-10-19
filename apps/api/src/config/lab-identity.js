import { env } from "./env.js";

export const DEFAULT_LAB_NAME = "Diamond Orthotic Laboratory";

// Every value a carrier needs for the ship-from. LAB_ADDRESS_LINE2 is optional.
const REQUIRED_ADDRESS_KEYS = ["LAB_ADDRESS_LINE1", "LAB_CITY", "LAB_STATE", "LAB_ZIP", "LAB_PHONE"];

const clean = (v) => String(v ?? "").trim();

/**
 * Who the lab is: THE one place its name and street address live. The name
 * is printed on invoices, statements and the shipped email. The address is
 * the ship-from on every label, and is null until every required LAB_* value
 * is set; UPS and FedEx stay disabled until then (carrier-config.js).
 *
 * `source` defaults to the parsed env; tests pass a plain object.
 */
export function labIdentity(source = env) {
  const name = clean(source.LAB_NAME) || DEFAULT_LAB_NAME;
  const missing = REQUIRED_ADDRESS_KEYS.filter((k) => !clean(source[k]));
  const address = missing.length
    ? null
    : {
        name,
        company: name,
        phone: clean(source.LAB_PHONE),
        address1: clean(source.LAB_ADDRESS_LINE1),
        address2: clean(source.LAB_ADDRESS_LINE2) || null,
        city: clean(source.LAB_CITY),
        state: clean(source.LAB_STATE).toUpperCase(),
        postalCode: clean(source.LAB_ZIP),
        country: "US",
      };
  return { name, phone: clean(source.LAB_PHONE) || null, address, missing };
}
