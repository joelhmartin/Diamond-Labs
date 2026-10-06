const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatCents = (cents) => USD.format(cents / 100);
