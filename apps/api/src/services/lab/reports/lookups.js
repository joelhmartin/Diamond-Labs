/**
 * Report param lookups (the `lookup` param type's `source`). Each returns at
 * most 20 `{ value, label }` matches for the typed text, and `label(db, value)`
 * names a value that arrived without a pick (a shared link). Roles are set per
 * lookup: `client` names every doctor and `priceList` names the pricing
 * templates, so both are admin-only like the money reports that use them; the
 * rest expose no money and keep the staff default. `tag` is a lab-order label
 * (piece 6 record-tags, record type "lab_order"). `practice` names the client
 * accounts (piece 11, `accounts.is_client`) and `organization` the practice
 * groups: no money, so staff, like the operations reports that filter by them
 * (report-helpers PRACTICE_PARAMS). A report may name a closed practice or an
 * archived group, so both list every status and say which is no longer active.
 */
import { and, asc, eq, ilike, inArray, isNotNull, or } from "drizzle-orm";
import { STAFF_ROLES, practiceLabel } from "@my-app/shared";
import {
  users, doctorProfiles, productVariants, productFamilies, labDepartments, tagDefinitions, priceLists, accounts, organizations,
} from "../../../db/schema/index.js";
import { containsPattern } from "../../../lib/list-query.js";
import { listAssignableStaff } from "../lab-orders.service.js";
import { LAB_ORDER_RECORD_TYPE } from "../lab-tags.js";
import { clientName } from "./lab-metrics.js";

export const LOOKUP_LIMIT = 20;

/** The typed text, trimmed and capped at 100 characters. */
export const lookupTerm = (q) => String(q ?? "").trim().slice(0, 100);

const firstLabel = (rows) => rows[0]?.label ?? null;

const variantLabel = (v) => (v.code ? `${v.code} · ${v.name}` : v.name);

/** A name with "(inactive)" / "(archived)" when it no longer applies. */
const withState = (name, off, word) => (off ? `${name} (${word})` : name);

/** A practice as picked: the shared "Name (account number)" label, with its status when not active. */
const pickedPractice = (a) => withState(practiceLabel(a), a.status !== "active", a.status);
const practiceColumns = { value: accounts.id, name: accounts.name, accountNumber: accounts.accountNumber, status: accounts.status };

export const LAB_LOOKUPS = [
  {
    key: "client",
    roles: ["admin"],
    async search(db, q) {
      const term = lookupTerm(q);
      const p = containsPattern(term);
      const match = term ? or(ilike(users.name, p), ilike(doctorProfiles.companyName, p), ilike(users.email, p)) : undefined;
      return db.select({ value: users.id, label: clientName }).from(users)
        .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
        .where(and(eq(users.role, "doctor"), match))
        .orderBy(asc(clientName), asc(users.id)).limit(LOOKUP_LIMIT);
    },
    async label(db, value) {
      return firstLabel(await db.select({ label: clientName }).from(users)
        .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
        .where(and(eq(users.id, value), eq(users.role, "doctor"))).limit(1));
    },
  },
  {
    key: "product",
    async search(db, q) {
      const term = lookupTerm(q);
      const p = containsPattern(term);
      const rows = await db.select({ value: productVariants.id, code: productVariants.code, name: productVariants.name }).from(productVariants)
        .where(term ? or(ilike(productVariants.code, p), ilike(productVariants.name, p)) : undefined)
        .orderBy(asc(productVariants.code), asc(productVariants.name), asc(productVariants.id)).limit(LOOKUP_LIMIT);
      return rows.map((v) => ({ value: v.value, label: variantLabel(v) }));
    },
    async label(db, value) {
      const [v] = await db.select({ code: productVariants.code, name: productVariants.name }).from(productVariants).where(eq(productVariants.id, value)).limit(1);
      return v ? variantLabel(v) : null;
    },
  },
  {
    key: "category",
    async search(db, q) {
      const term = lookupTerm(q);
      const rows = await db.selectDistinct({ category: productFamilies.category }).from(productFamilies)
        .where(and(isNotNull(productFamilies.category), term ? ilike(productFamilies.category, containsPattern(term)) : undefined))
        .orderBy(asc(productFamilies.category)).limit(LOOKUP_LIMIT);
      return rows.map((r) => ({ value: r.category, label: r.category }));
    },
    async label(db, value) {
      const [r] = await db.select({ category: productFamilies.category }).from(productFamilies).where(eq(productFamilies.category, value)).limit(1);
      return r?.category ?? null;
    },
  },
  {
    key: "department",
    async search(db, q) {
      const term = lookupTerm(q);
      const rows = await db.select({ value: labDepartments.id, name: labDepartments.name, active: labDepartments.active }).from(labDepartments)
        .where(term ? ilike(labDepartments.name, containsPattern(term)) : undefined)
        .orderBy(asc(labDepartments.position), asc(labDepartments.name)).limit(LOOKUP_LIMIT);
      return rows.map((d) => ({ value: d.value, label: d.active ? d.name : `${d.name} (inactive)` }));
    },
    async label(db, value) {
      return firstLabel(await db.select({ label: labDepartments.name }).from(labDepartments).where(eq(labDepartments.id, value)).limit(1));
    },
  },
  {
    key: "staff",
    async search(db, q) {
      const term = lookupTerm(q).toLowerCase();
      const staff = await listAssignableStaff(db);
      return staff.filter((s) => !term || s.name.toLowerCase().includes(term)).slice(0, LOOKUP_LIMIT).map((s) => ({ value: s.id, label: s.name }));
    },
    async label(db, value) {
      // Any staff member, active or not (a report can name someone who has since left), never a doctor.
      return firstLabel(await db.select({ label: users.name }).from(users).where(and(eq(users.id, value), inArray(users.role, STAFF_ROLES))).limit(1));
    },
  },
  {
    key: "tag",
    async search(db, q) {
      const term = lookupTerm(q);
      const rows = await db.select({ value: tagDefinitions.id, label: tagDefinitions.label, active: tagDefinitions.active }).from(tagDefinitions)
        .where(and(eq(tagDefinitions.recordType, LAB_ORDER_RECORD_TYPE), term ? ilike(tagDefinitions.label, containsPattern(term)) : undefined))
        .orderBy(asc(tagDefinitions.position), asc(tagDefinitions.label)).limit(LOOKUP_LIMIT);
      return rows.map((t) => ({ value: t.value, label: withState(t.label, !t.active, "inactive") }));
    },
    async label(db, value) {
      return firstLabel(await db.select({ label: tagDefinitions.label }).from(tagDefinitions)
        .where(and(eq(tagDefinitions.id, value), eq(tagDefinitions.recordType, LAB_ORDER_RECORD_TYPE))).limit(1));
    },
  },
  {
    key: "priceList",
    roles: ["admin"],
    async search(db, q) {
      const term = lookupTerm(q);
      const rows = await db.select({ value: priceLists.id, name: priceLists.name, archivedAt: priceLists.archivedAt }).from(priceLists)
        .where(term ? ilike(priceLists.name, containsPattern(term)) : undefined)
        .orderBy(asc(priceLists.name), asc(priceLists.id)).limit(LOOKUP_LIMIT);
      return rows.map((l) => ({ value: l.value, label: withState(l.name, l.archivedAt, "archived") }));
    },
    async label(db, value) {
      return firstLabel(await db.select({ label: priceLists.name }).from(priceLists).where(eq(priceLists.id, value)).limit(1));
    },
  },
  {
    key: "practice",
    async search(db, q) {
      const term = lookupTerm(q);
      const p = containsPattern(term);
      const rows = await db.select(practiceColumns).from(accounts)
        .where(and(eq(accounts.isClient, true), term ? or(ilike(accounts.name, p), ilike(accounts.accountNumber, p)) : undefined))
        .orderBy(asc(accounts.name), asc(accounts.id)).limit(LOOKUP_LIMIT);
      return rows.map((a) => ({ value: a.value, label: pickedPractice(a) }));
    },
    async label(db, value) {
      const [a] = await db.select(practiceColumns).from(accounts).where(and(eq(accounts.id, value), eq(accounts.isClient, true))).limit(1);
      return a ? pickedPractice(a) : null;
    },
  },
  {
    key: "organization",
    async search(db, q) {
      const term = lookupTerm(q);
      const rows = await db.select({ value: organizations.id, name: organizations.name, status: organizations.status }).from(organizations)
        .where(term ? ilike(organizations.name, containsPattern(term)) : undefined)
        .orderBy(asc(organizations.name), asc(organizations.id)).limit(LOOKUP_LIMIT);
      return rows.map((o) => ({ value: o.value, label: withState(o.name, o.status !== "active", o.status) }));
    },
    async label(db, value) {
      const [o] = await db.select({ name: organizations.name, status: organizations.status }).from(organizations).where(eq(organizations.id, value)).limit(1);
      return o ? withState(o.name, o.status !== "active", o.status) : null;
    },
  },
];

export function registerLabLookups(registry) {
  for (const l of LAB_LOOKUPS) registry.defineLookup(l);
}
