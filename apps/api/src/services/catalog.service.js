import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "../config/database.js";
import {
  productFamilies, productOptions, productOptionValues, productVariants, productVariantOptionValues,
} from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import {
  shapeFamily, missingCombinations, validateCombination, findDuplicateCombination,
} from "../lib/catalog-variants.js";

export class CatalogError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // NOT_FOUND | CONFLICT | INVALID
  }
}

const UNIQUE_VIOLATION = "23505";
function rethrowConflict(err, what) {
  if (err?.code === UNIQUE_VIOLATION) throw new CatalogError("CONFLICT", `${what} is already used by another product.`);
  throw err;
}

async function loadShaped(familyRows, conn = db) {
  if (familyRows.length === 0) return [];
  const familyIds = familyRows.map((f) => f.id);
  const options = await conn.select().from(productOptions).where(inArray(productOptions.familyId, familyIds));
  const optionIds = options.map((o) => o.id);
  const values = optionIds.length
    ? await conn.select().from(productOptionValues).where(inArray(productOptionValues.optionId, optionIds))
    : [];
  const variants = await conn.select().from(productVariants)
    .where(inArray(productVariants.familyId, familyIds)).orderBy(asc(productVariants.name));
  const variantIds = variants.map((v) => v.id);
  const links = variantIds.length
    ? await conn.select().from(productVariantOptionValues).where(inArray(productVariantOptionValues.variantId, variantIds))
    : [];
  return familyRows.map((family) => {
    const opts = options.filter((o) => o.familyId === family.id);
    const optIds = new Set(opts.map((o) => o.id));
    const vars = variants.filter((v) => v.familyId === family.id);
    const varIds = new Set(vars.map((v) => v.id));
    return shapeFamily({
      family,
      options: opts,
      values: values.filter((v) => optIds.has(v.optionId)),
      variants: vars,
      links: links.filter((l) => varIds.has(l.variantId)),
    });
  });
}

export async function listFamilies({ shopOnly = false } = {}) {
  const where = shopOnly
    ? and(eq(productFamilies.active, true), ne(productFamilies.channel, "rx"))
    : undefined;
  const rows = await db.select().from(productFamilies).where(where)
    .orderBy(asc(productFamilies.position), asc(productFamilies.name));
  return loadShaped(rows);
}

export async function getFamily(id, conn = db) {
  const rows = await conn.select().from(productFamilies).where(eq(productFamilies.id, id));
  if (rows.length === 0) throw new CatalogError("NOT_FOUND", "Product family not found.");
  return (await loadShaped(rows, conn))[0];
}

/**
 * Insert a whole family from a plan. Shared by the admin "new family" action
 * and db/import-catalog.js so there is one way a family gets built.
 */
export async function insertPlannedFamily(tx, planned) {
  const familyId = createId();
  await tx.insert(productFamilies).values({
    id: familyId, slug: planned.slug, name: planned.name, channel: planned.channel,
    category: planned.category ?? null, description: planned.description ?? null, imageUrl: planned.imageUrl ?? null,
  });
  const valueIdByOptionAndValue = new Map();
  for (const [i, opt] of planned.options.entries()) {
    const optionId = createId();
    await tx.insert(productOptions).values({ id: optionId, familyId, name: opt.name, position: i });
    for (const [j, value] of opt.values.entries()) {
      const valueId = createId();
      await tx.insert(productOptionValues).values({ id: valueId, optionId, value, position: j });
      valueIdByOptionAndValue.set(`${opt.name}\u0000${value}`, valueId);
    }
  }
  for (const pv of planned.variants) {
    const variantId = createId();
    await tx.insert(productVariants).values({
      id: variantId, familyId, code: pv.code ?? null, name: pv.name,
      basePriceCents: pv.basePriceCents ?? null, taxable: Boolean(pv.taxable), active: pv.active !== false,
      catalogId: pv.catalogId ?? null, legacySeazonaProductId: pv.legacySeazonaProductId ?? null,
    });
    for (const opt of planned.options) {
      const valueId = valueIdByOptionAndValue.get(`${opt.name}\u0000${pv.values?.[opt.name]}`);
      if (!valueId) throw new CatalogError("INVALID", `Variant ${pv.name} has no ${opt.name}.`);
      await tx.insert(productVariantOptionValues).values({ variantId, optionValueId: valueId });
    }
  }
  return familyId;
}

/** A new family starts with one unpriced, inactive variant to fill in. */
export async function createFamily(input) {
  try {
    const id = await db.transaction((tx) => insertPlannedFamily(tx, {
      ...input, options: [],
      variants: [{ name: input.name, basePriceCents: null, taxable: false, active: false, values: {} }],
    }));
    return getFamily(id);
  } catch (err) { rethrowConflict(err, "That slug"); }
}

export async function updateFamily(id, patch) {
  await getFamily(id);
  try {
    await db.update(productFamilies).set({ ...patch, updatedAt: new Date() }).where(eq(productFamilies.id, id));
  } catch (err) { rethrowConflict(err, "That slug"); }
  return getFamily(id);
}

/**
 * Add an axis. Existing variants take the axis's first value, then every
 * missing combination is created inactive and unpriced, so adding an option
 * never makes anything buyable by accident.
 */
export async function addOption(familyId, { name, values }) {
  return db.transaction(async (tx) => {
    const family = await getFamily(familyId, tx);
    if (family.options.some((o) => o.name.toLowerCase() === name.toLowerCase())) {
      throw new CatalogError("CONFLICT", `This family already has an option called ${name}.`);
    }
    const optionId = createId();
    await tx.insert(productOptions).values({ id: optionId, familyId, name, position: family.options.length });
    const valueIds = [];
    for (const [i, value] of values.entries()) {
      const id = createId();
      valueIds.push(id);
      await tx.insert(productOptionValues).values({ id, optionId, value, position: i });
    }
    for (const v of family.variants) {
      await tx.insert(productVariantOptionValues).values({ variantId: v.id, optionValueId: valueIds[0] });
    }
    await fillMissingCombinations(tx, familyId);
    return getFamily(familyId, tx);
  });
}

export async function addOptionValue(optionId, value) {
  return db.transaction(async (tx) => {
    const [option] = await tx.select().from(productOptions).where(eq(productOptions.id, optionId));
    if (!option) throw new CatalogError("NOT_FOUND", "Option not found.");
    const existing = await tx.select().from(productOptionValues).where(eq(productOptionValues.optionId, optionId));
    if (existing.some((v) => v.value.toLowerCase() === value.toLowerCase())) {
      throw new CatalogError("CONFLICT", `${option.name} already has ${value}.`);
    }
    await tx.insert(productOptionValues).values({ id: createId(), optionId, value, position: existing.length });
    await fillMissingCombinations(tx, option.familyId);
    return getFamily(option.familyId, tx);
  });
}

async function fillMissingCombinations(tx, familyId) {
  const family = await getFamily(familyId, tx);
  const labelOf = new Map(family.options.flatMap((o) => o.values.map((v) => [v.id, v.value])));
  for (const combo of missingCombinations(family.options, family.variants)) {
    const variantId = createId();
    await tx.insert(productVariants).values({
      id: variantId, familyId, name: [family.name, ...combo.map((id) => labelOf.get(id))].join(" "),
      basePriceCents: null, taxable: false, active: false,
    });
    for (const optionValueId of combo) {
      await tx.insert(productVariantOptionValues).values({ variantId, optionValueId });
    }
  }
}

export async function updateVariant(id, patch) {
  const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, id));
  if (!variant) throw new CatalogError("NOT_FOUND", "Variant not found.");
  try {
    await db.update(productVariants).set({ ...patch, updatedAt: new Date() }).where(eq(productVariants.id, id));
  } catch (err) { rethrowConflict(err, "That code or shop SKU"); }
  return getFamily(variant.familyId);
}

/**
 * Fold a one-variant family into another family as a specific combination —
 * how "Mute Small", "Mute Medium", "Mute Large" become one product with a
 * Size option. The source family is deleted.
 */
export async function mergeSingleVariantFamily({ targetFamilyId, sourceFamilyId, optionValueIds }) {
  if (targetFamilyId === sourceFamilyId) throw new CatalogError("INVALID", "A family cannot be merged into itself.");
  return db.transaction(async (tx) => {
    const target = await getFamily(targetFamilyId, tx);
    const source = await getFamily(sourceFamilyId, tx);
    if (source.variants.length !== 1 || source.options.length !== 0) {
      throw new CatalogError("INVALID", "Only a family with a single variant and no options can be merged.");
    }
    const check = validateCombination(target.options, optionValueIds);
    if (!check.ok) throw new CatalogError("INVALID", check.reason);
    const clash = findDuplicateCombination(target.variants, optionValueIds);
    // An inactive, unpriced placeholder created by the grid can be replaced.
    if (clash && (clash.active || clash.basePriceCents != null)) {
      throw new CatalogError("CONFLICT", `That combination is already ${clash.name}.`);
    }
    if (clash) {
      await tx.delete(productVariantOptionValues).where(eq(productVariantOptionValues.variantId, clash.id));
      await tx.delete(productVariants).where(eq(productVariants.id, clash.id));
    }
    const moving = source.variants[0];
    await tx.update(productVariants).set({ familyId: targetFamilyId, updatedAt: new Date() })
      .where(eq(productVariants.id, moving.id));
    for (const optionValueId of optionValueIds) {
      await tx.insert(productVariantOptionValues).values({ variantId: moving.id, optionValueId });
    }
    await tx.delete(productFamilies).where(eq(productFamilies.id, sourceFamilyId));
    return getFamily(targetFamilyId, tx);
  });
}

export async function variantByCode(code) {
  if (!code) return null;
  const [row] = await db.select().from(productVariants).where(eq(productVariants.code, String(code)));
  return row ?? null;
}
