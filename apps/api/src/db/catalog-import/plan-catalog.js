import { toCents } from "../../lib/money.js";

// Pure: products mirror + family seed + shop seed → families to insert.
// Never infers a grouping from product names — only FAMILY_SEED groups.

export function slugify(s) {
  const slug = String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return slug || "item";
}

function uniqueSlug(base, taken) {
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

const variantFrom = (p) => ({
  code: p.code ?? null,
  name: p.name ?? p.code ?? p.seazonaProductId,
  basePriceCents: toCents(p.price),
  taxable: Boolean(p.taxable),
  active: true,
  catalogId: p.catalogId ?? null,
  legacySeazonaProductId: p.seazonaProductId,
});

export function planCatalogImport({ products, familySeed, shopSeed = [] }) {
  const warnings = [];
  const byCode = new Map();
  for (const p of products) {
    if (!p.code) continue;
    if (byCode.has(p.code)) warnings.push(`Seazona code ${p.code} appears twice — grouped the first (${byCode.get(p.code).seazonaProductId}).`);
    else byCode.set(p.code, p);
  }
  const shopById = new Map(shopSeed.map((s) => [String(s.id), s]));
  const used = new Set();
  const slugs = new Set();
  const families = [];

  for (const f of familySeed) {
    const variants = [];
    for (const sv of f.variants) {
      const p = byCode.get(sv.code);
      if (!p) { warnings.push(`${f.slug}: code ${sv.code} is not in the products table — skipped.`); continue; }
      used.add(p.seazonaProductId);
      variants.push({ ...variantFrom(p), values: sv.values });
    }
    if (variants.length === 0) continue;
    families.push({
      slug: uniqueSlug(f.slug, slugs), name: f.name, channel: f.channel,
      category: f.category ?? null, description: null, imageUrl: null,
      options: f.options.map((name) => ({ name, values: [...new Set(variants.map((v) => v.values[name]))] })),
      variants,
    });
  }

  for (const p of products) {
    if (used.has(p.seazonaProductId)) continue;
    // product_variants.code is unique: a duplicate Seazona code imports without one.
    const dupCode = p.code && byCode.get(p.code) !== p;
    if (dupCode) warnings.push(`Product ${p.seazonaProductId} reuses code ${p.code} — imported without a code.`);
    const shop = p.catalogId ? shopById.get(String(p.catalogId)) : null;
    const isShop = Boolean(p.purchasable || shop);
    const name = p.name ?? p.code ?? p.seazonaProductId;
    families.push({
      slug: uniqueSlug(slugify(name), slugs),
      name,
      channel: isShop ? "shop" : "rx",
      category: p.category ?? shop?.categories?.[0] ?? null,
      description: p.description ?? shop?.description ?? null,
      imageUrl: p.imageUrl ?? shop?.image ?? null,
      options: [],
      variants: [{
        ...variantFrom(p),
        code: dupCode ? null : (p.code ?? null),
        active: isShop ? Boolean(p.purchasable) && shop?.active !== false : true,
        values: {},
      }],
    });
  }
  return { families, warnings };
}
