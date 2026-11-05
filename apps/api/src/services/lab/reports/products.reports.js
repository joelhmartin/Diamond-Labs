/**
 * Products & Services (5). Materials Used lists piece 6's materials and lot
 * numbers (no money, so staff). Price List can show one of piece 10's named
 * price lists beside the base price.
 * Price List and Products Sold show money and are admin only; Units Sold and
 * its detail count bench lines (no money) and are staff. Lines are matched to
 * the catalog by variant, falling back to their code (lab-metrics catalogJoins).
 */
import { inArray, sql } from "drizzle-orm";
import {
  invoices, invoiceLines, labOrders, labOrderLines, labOrderLineMaterials, productVariants, productFamilies, priceLists, priceListItems,
} from "../../../db/schema/index.js";
import {
  ORDER_LINK, byCode, catalogJoins, clientName, coverageNotice, isLiveOrder, labDayBetween, labDayText, num, orderAndPage, rowsOf, salesWhere,
} from "./lab-metrics.js";
import { ADMIN, optionalClientJoin, share, sumOf } from "./report-helpers.js";

const GROUP = "products";
const RANGE = { name: "range", label: "Dates", type: "dateRange", default: "last30", maxDays: 1100 };

/** Bench lines that are products (not build instructions) on non-cancelled orders received in the range. */
const unitLinesWhere = (range) =>
  sql`${labOrderLines.noteOnly} = false and ${isLiveOrder} and ${labDayBetween(labOrders.receivedAt, range)}`;

const priceList = {
  key: "products.price-list", group: GROUP, roles: ADMIN, title: "Price List",
  description: "Every catalog item with its base price (before client pricing) and, when a price list is picked, that list's price. Unpriced items show no price.",
  params: [
    { name: "priceList", label: "Price list", type: "lookup", source: "priceList" },
    { name: "includeInactive", label: "Include inactive items", type: "toggle", default: false },
  ],
  columns: [
    { id: "family", label: "Product", type: "text" }, { id: "category", label: "Category", type: "text" },
    { id: "variant", label: "Item", type: "text" }, { id: "code", label: "Code", type: "text" },
    { id: "basePrice", label: "Base price", type: "money" }, { id: "listPrice", label: "List price", type: "money" },
    { id: "active", label: "Active", type: "text" },
  ],
  async run(tx, params) {
    const active = params?.includeInactive ? sql`true` : sql`${productVariants.active} = true and ${productFamilies.active} = true`;
    const listId = params?.priceList || null;
    const listJoin = listId
      ? sql`left join ${priceListItems} on ${priceListItems.priceListId} = ${listId} and ${priceListItems.variantId} = ${productVariants.id}`
      : sql``;
    const raw = await rowsOf(tx, sql`
      select ${productFamilies.name} as "family", ${productFamilies.category} as "category", ${productVariants.name} as "variant",
        ${productVariants.code} as "code", ${productVariants.basePriceCents} as "basePriceCents",
        ${listId ? sql`${priceListItems.priceCents}` : sql`null`} as "listPriceCents",
        (${productVariants.active} and ${productFamilies.active}) as "active"
      from ${productVariants} join ${productFamilies} on ${productFamilies.id} = ${productVariants.familyId}
      ${listJoin}
      where ${active}
      order by ${productFamilies.position}, ${productFamilies.name}, ${productVariants.code} nulls last, ${productVariants.id}`);
    const rows = raw.map((r) => ({
      family: r.family, category: r.category ?? null, variant: r.variant, code: r.code ?? null,
      basePrice: r.basePriceCents == null ? null : num(r.basePriceCents),
      listPrice: r.listPriceCents == null ? null : num(r.listPriceCents), active: r.active ? "Yes" : "No",
    }));
    if (!listId) return { rows };
    const [list] = await rowsOf(tx, sql`select ${priceLists.name} as "name", ${priceLists.archivedAt} as "archivedAt" from ${priceLists} where ${priceLists.id} = ${listId}`);
    const named = list ? `List prices from "${list.name}"${list.archivedAt ? " (archived: it no longer applies to clients)" : ""}.` : "That price list no longer exists.";
    return { rows, notice: `${named} Items the list does not price show no list price.` };
  },
};

/** A products-sold row's label: the catalog item, else the unmatched code, else "No product". */
const soldLabel = (r) => r.product ?? (r.code ? `Code ${r.code} (not in catalog)` : "No product");

const sold = {
  key: "products.sold", group: GROUP, roles: ADMIN, title: "Products Sold",
  description: "Units and sales per catalog item from invoice lines (issued invoices, by issue day). Lines are matched by item, else by code.",
  params: [RANGE],
  columns: [
    { id: "product", label: "Item", type: "text" }, { id: "code", label: "Code", type: "text" }, { id: "family", label: "Product", type: "text" },
    { id: "units", label: "Units", type: "int" }, { id: "amount", label: "Sales", type: "money" }, { id: "share", label: "Share", type: "pct" },
  ],
  async run(tx, { range }) {
    const raw = await rowsOf(tx, sql`
      select x.variant_id as "variantId", x.code as "code", x.product as "product", x.family as "family",
        sum(x.qty) as "units", sum(x.line_cents) as "amount"
      from (
        select coalesce(${productVariants.id}, ${byCode.id}) as variant_id,
          coalesce(${productVariants.code}, ${byCode.code}, ${invoiceLines.code}) as code,
          coalesce(${productVariants.name}, ${byCode.name}) as product, ${productFamilies.name} as family,
          ${invoiceLines.qty} as qty, ${invoiceLines.lineCents} as line_cents
        from ${invoiceLines}
        join ${invoices} on ${invoices.id} = ${invoiceLines.invoiceId}
        ${catalogJoins(invoiceLines)}
        where ${invoiceLines.kind} = 'item' and ${salesWhere(range)}
      ) x
      group by 1, 2, 3, 4
      order by 6 desc, 2 nulls last, 1`);
    const total = raw.reduce((s, r) => s + num(r.amount), 0);
    const rows = raw.map((r) => ({
      variantId: r.variantId ?? null, product: soldLabel(r), code: r.code ?? null, family: r.family ?? null,
      units: num(r.units), amount: num(r.amount), share: share(num(r.amount), total),
    }));
    return {
      rows, notice: coverageNotice(range) ?? undefined,
      summary: { product: "Total", units: sumOf(rows, "units"), amount: total, share: total ? 1 : 0 },
    };
  },
};

const units = {
  key: "products.units", group: GROUP, title: "Units Sold",
  description: "Units on lab orders received in the range, per product (build instructions and cancelled orders are not counted). Lines not in the catalog are listed by their name.",
  params: [RANGE],
  columns: [
    { id: "product", label: "Product", type: "text" }, { id: "category", label: "Category", type: "text" },
    { id: "units", label: "Units", type: "int" }, { id: "orders", label: "Orders", type: "int" },
  ],
  chart: { type: "bar", x: "product", series: [{ field: "units", label: "Units" }] },
  async run(tx, { range }) {
    const raw = await rowsOf(tx, sql`
      select coalesce(${productFamilies.name}, ${labOrderLines.name}) as "product", ${productFamilies.category} as "category",
        sum(${labOrderLines.qty}) as "units", count(distinct ${labOrders.id}) as "orders"
      from ${labOrderLines}
      join ${labOrders} on ${labOrders.id} = ${labOrderLines.labOrderId}
      ${catalogJoins(labOrderLines)}
      where ${unitLinesWhere(range)}
      group by 1, 2
      order by 3 desc, 1`);
    const rows = raw.map((r) => ({ product: r.product, category: r.category ?? null, units: num(r.units), orders: num(r.orders) }));
    return { rows, summary: { product: "Total", units: sumOf(rows, "units") } };
  },
};

/**
 * Each line's invoice: the newest non-void invoice line billed for it (a
 * reissue replaces a voided one), as Map(lineId → { invoiceId, invoiceNumber }).
 * Looked up for one page of lines only: as a lateral join inside the page query
 * it ran for every line in the range before the page was cut (1.5 s at 21k orders).
 */
async function invoicesForLines(tx, lineIds) {
  if (!lineIds.length) return new Map();
  const rows = await rowsOf(tx, sql`
    select distinct on (${invoiceLines.labOrderLineId}) ${invoiceLines.labOrderLineId} as "lineId",
      ${invoices.id} as "invoiceId", ${invoices.invoiceNumber} as "invoiceNumber"
    from ${invoiceLines} join ${invoices} on ${invoices.id} = ${invoiceLines.invoiceId}
    where ${inArray(invoiceLines.labOrderLineId, lineIds)} and ${invoices.status} <> 'void'
    order by ${invoiceLines.labOrderLineId}, ${invoices.createdAt} desc, ${invoices.id} desc`);
  return new Map(rows.map((r) => [r.lineId, { invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber }]));
}

const unitsDetail = {
  key: "products.units-detail", group: GROUP, title: "Units Sold Detail", paging: "server",
  description: "Every product line on lab orders received in the range, with its order and invoice.",
  params: [RANGE],
  columns: [
    { id: "received", label: "Received", type: "date" },
    { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK },
    { id: "client", label: "Client", type: "text" }, { id: "code", label: "Code", type: "text" },
    { id: "product", label: "Product", type: "text" }, { id: "qty", label: "Qty", type: "int" },
    // No link: this report is staff, and the invoice page is admin only.
    { id: "invoiceNumber", label: "Invoice #", type: "text", sortable: false },
  ],
  async run(tx, { range }, _actor, ctx) {
    const from = sql`
      from ${labOrderLines}
      join ${labOrders} on ${labOrders.id} = ${labOrderLines.labOrderId}
      ${optionalClientJoin(labOrders.clientUserId)}`;
    const where = sql`where ${unitLinesWhere(range)}`;
    const sorts = {
      received: labOrders.receivedAt, orderNumber: labOrders.orderNumber, client: clientName,
      code: labOrderLines.code, product: labOrderLines.name, qty: labOrderLines.qty,
    };
    const [count] = await rowsOf(tx, sql`select count(*) as "total" ${from} ${where}`);
    const raw = await rowsOf(tx, sql`
      select ${labOrderLines.id} as "lineId", ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber",
        ${labDayText(labOrders.receivedAt)} as "receivedDay", ${clientName} as "client", ${labOrderLines.code} as "code",
        ${labOrderLines.name} as "product", ${labOrderLines.qty} as "qty"
      ${from}
      ${where}
      ${orderAndPage(ctx?.page, sorts, { id: "received", desc: true }, labOrderLines.id)}`);
    const billed = await invoicesForLines(tx, raw.map((r) => r.lineId));
    const rows = raw.map((r) => ({
      lineId: r.lineId, labOrderId: r.labOrderId, orderNumber: r.orderNumber, received: r.receivedDay, client: r.client ?? null,
      code: r.code ?? null, product: r.product, qty: num(r.qty),
      invoiceId: billed.get(r.lineId)?.invoiceId ?? null, invoiceNumber: billed.get(r.lineId)?.invoiceNumber ?? null,
    }));
    return { rows, total: num(count?.total) };
  },
};

const materials = {
  key: "products.materials", group: GROUP, title: "Materials Used", requires: ["materials"],
  description: "Materials and lot numbers recorded on each product line of orders received in the range (cancelled orders are not listed).",
  params: [RANGE],
  columns: [
    { id: "received", label: "Received", type: "date" }, { id: "orderNumber", label: "Order #", type: "text", link: ORDER_LINK },
    { id: "product", label: "Product", type: "text" }, { id: "material", label: "Material", type: "text" },
    { id: "lot", label: "Lot", type: "text" }, { id: "qty", label: "Qty", type: "int" },
  ],
  async run(tx, { range }) {
    const raw = await rowsOf(tx, sql`
      select ${labOrders.id} as "labOrderId", ${labOrders.orderNumber} as "orderNumber", ${labDayText(labOrders.receivedAt)} as "receivedDay",
        ${labOrderLines.name} as "product", ${labOrderLines.qty} as "qty",
        ${labOrderLineMaterials.material} as "material", ${labOrderLineMaterials.lotNumber} as "lot"
      from ${labOrderLineMaterials}
      join ${labOrderLines} on ${labOrderLines.id} = ${labOrderLineMaterials.labOrderLineId}
      join ${labOrders} on ${labOrders.id} = ${labOrderLineMaterials.labOrderId}
      where ${isLiveOrder} and ${labDayBetween(labOrders.receivedAt, range)}
      order by ${labOrders.receivedAt}, ${labOrders.orderNumber}, ${labOrderLines.position}, ${labOrderLineMaterials.position}, ${labOrderLineMaterials.id}`);
    const rows = raw.map((r) => ({
      labOrderId: r.labOrderId, orderNumber: r.orderNumber, received: r.receivedDay, product: r.product,
      material: r.material, lot: r.lot ?? null, qty: num(r.qty),
    }));
    return { rows };
  },
};

export const PRODUCT_REPORTS = [priceList, sold, units, unitsDetail, materials];

export function registerProductReports(registry) {
  for (const def of PRODUCT_REPORTS) registry.defineReport(def);
}
