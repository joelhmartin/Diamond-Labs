import { ShippingError } from "../shipping-errors.js";

/**
 * Staff-recorded shipments: a courier, a hand delivery, or a carrier used
 * outside the system. No API, so it is always configured, and it is what makes
 * the whole flow usable before the UPS and FedEx accounts exist. It never
 * rates and never tracks; staff move it (Mark shipped).
 */
export function createManualAdapter() {
  return {
    id: "manual",
    label: "Manual",
    tracks: false,
    configured: () => ({ ok: true }),
    async rate() {
      return [];
    },
    async createLabel({ manual } = {}) {
      const carrierName = String(manual?.carrierName ?? "").trim();
      if (!carrierName) throw new ShippingError("INVALID", "Type the carrier's name.");
      return {
        trackingNumber: String(manual?.trackingNumber ?? "").trim() || null,
        carrierShipmentId: null,
        labelFormat: null,
        labelData: null,
        chargeCents: 0,
        currency: "USD",
        serviceCode: "manual",
        serviceName: carrierName.slice(0, 80),
      };
    },
    async voidLabel() {
      return { ok: true };
    },
    async track() {
      return [];
    },
  };
}
