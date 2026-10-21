import { slugify } from "@my-app/shared";
import { createId } from "../lib/id.js";
import { firstString } from "./seazona-records.js";

/**
 * Seazona clients → doctor users, practices and owner memberships (moved here
 * from the retired live importer; it now reads the raw store,
 * never Seazona). Pure: the caller loads `existing` and writes the plan.
 * Imported doctors have no password: they log in after a reset. A client with
 * no email gets a SUSPENDED doctor with a reserved `.invalid` address (Spec
 * correction 3) so its invoices have an owner; email.service never mails it.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "seazona-clients.invalid";
const SLUG_MAX = 50; // accounts.slug is varchar(50)

/** The first plausible address in Seazona's email field; null when none. */
export function clientEmail(raw) {
  if (!raw) return null;
  const first = String(raw).split(/[,;]/)[0].trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(first) ? first : null;
}

export function placeholderEmail(seazonaClientId) {
  return `client-${String(seazonaClientId).toLowerCase().replace(/[^a-z0-9-]/g, "")}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export const isPlaceholderEmail = (email) => String(email ?? "").toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);

const cut = (s, n) => (s == null ? null : String(s).slice(0, n));

/** A doctor_profiles row from a complete Seazona address, else null. NPI is blank for the lab to fill in. */
export function profileFromClient(client, userId, now) {
  const address1 = firstString(client, ["address1", "address", "street", "addressLine1"]);
  const city = firstString(client, ["city"]);
  const state = firstString(client, ["state", "province"]);
  const zip = firstString(client, ["zip", "zipCode", "postalCode"]);
  if (!address1 || !city || !state || !zip) return null;
  return {
    id: createId(), userId, npiNumber: "", licenseNumber: null,
    companyName: cut(firstString(client, ["company", "fullName"]) ?? "Practice", 255),
    address1: cut(address1, 255), address2: cut(firstString(client, ["address2", "addressLine2"]), 255),
    city: cut(city, 100), state: cut(state, 50), zip: cut(zip, 20), phone: cut(firstString(client, ["phone"]), 30),
    createdAt: now, updatedAt: now,
  };
}

const oldestFirst = (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id));

function indexBy(userRows, key) {
  const out = new Map();
  for (const u of [...userRows].sort(oldestFirst)) {
    const k = u[key] == null ? null : String(u[key]);
    if (k && !out.has(k)) out.set(k, u.id);
  }
  return out;
}

/** The doctor who owns a Seazona client's invoices and orders: the oldest sharing its id. */
export const ownerIndex = (userRows) => indexBy(userRows, "seazonaClientId");
/** The same by Seazona account number (the per-client balance export's key). */
export const accountOwnerIndex = (userRows) => indexBy(userRows, "seazonaAccountNumber");

/**
 * Linking an existing login to a Seazona client follows the codebase's
 * verify-and-approve gate (auth.service completePendingSeazonaLink): only an
 * APPROVED, EMAIL-VERIFIED doctor. Anyone else with the same email (pending or
 * unverified doctor, shopper, admin, lab) is reported, never linked.
 */
export const isLinkableUser = (u) => u.role === "doctor" && u.approvalStatus === "approved" && Boolean(u.emailVerifiedAt);

export function existingFromRows(userRows, slugRows, profileRows) {
  const byEmail = new Map();
  for (const u of userRows) {
    const key = String(u.email).toLowerCase();
    const entry = {
      id: u.id, email: key, seazonaClientId: u.seazonaClientId ?? null,
      seazonaAccountNumber: u.seazonaAccountNumber ?? null, linkable: isLinkableUser(u), ambiguous: false,
    };
    // Two users differing only by case are never silently merged.
    byEmail.set(key, byEmail.has(key) ? { ...byEmail.get(key), ambiguous: true } : entry);
  }
  return {
    owners: ownerIndex(userRows),
    userEmails: new Map(userRows.map((u) => [u.id, String(u.email).toLowerCase()])),
    byEmail,
    slugs: new Set(slugRows.map((r) => r.slug)),
    profileUserIds: new Set(profileRows.map((r) => r.userId)),
  };
}

function uniqueSlug(name, taken) {
  const root = (slugify(name) || `account-${createId().slice(0, 8)}`).slice(0, SLUG_MAX);
  let slug = root;
  for (let n = 1; taken.has(slug); n++) {
    const suffix = `-${n}`;
    slug = `${root.slice(0, SLUG_MAX - suffix.length)}${suffix}`;
  }
  taken.add(slug);
  return slug;
}

function newDoctor(client, id, email, placeholder, slugs, now) {
  const userId = createId();
  const name = firstString(client, ["fullName", "company"]) ?? email;
  const practice = firstString(client, ["company", "fullName"]) ?? email;
  const accountId = createId();
  return {
    user: {
      id: userId, email, name: name.slice(0, 100), passwordHash: null, emailVerifiedAt: null,
      status: placeholder ? "suspended" : "active", role: "doctor", approvalStatus: "approved",
      seazonaClientId: id, seazonaAccountNumber: client.accountNumber == null ? null : String(client.accountNumber),
      createdAt: now, updatedAt: now,
    },
    account: { id: accountId, name: practice.slice(0, 100), slug: uniqueSlug(practice, slugs), ownerId: userId, plan: "pro", status: "active", createdAt: now, updatedAt: now },
    membership: { id: createId(), userId, accountId, role: "owner", status: "active", createdAt: now, updatedAt: now },
  };
}

/**
 * Seazona clients → { create, link, profiles, skipped }. Never mutates `existing`.
 * The plan is read before the transaction that writes it: run this step inside
 * the write freeze (docs/cutover-runbook.md) so no user changes in between.
 */
export function planClients(clients, existing, { noEmail = "placeholder", now = new Date() } = {}) {
  const slugs = new Set(existing.slugs);
  const usedEmails = new Map(existing.byEmail);
  const withProfile = new Set(existing.profileUserIds);
  const plan = {
    create: [], link: [], profiles: [],
    skipped: { alreadyLinked: 0, noEmail: [], emailTaken: [], emailNotLinkable: [], emailCaseAmbiguous: [], accountMismatch: [], placeholderNowHasEmail: [] },
  };
  const addProfile = (client, userId) => {
    if (withProfile.has(userId)) return;
    const p = profileFromClient(client, userId, now);
    if (p) { plan.profiles.push(p); withProfile.add(userId); }
  };
  for (const client of clients) {
    const id = String(client.id);
    const account = client.accountNumber == null ? null : String(client.accountNumber);
    if (existing.owners.has(id)) {
      plan.skipped.alreadyLinked += 1;
      const ownerId = existing.owners.get(id);
      if (isPlaceholderEmail(existing.userEmails?.get(ownerId)) && clientEmail(client.email)) plan.skipped.placeholderNowHasEmail.push(id);
      addProfile(client, ownerId);
      continue;
    }
    const email = clientEmail(client.email);
    if (!email && noEmail === "skip") { plan.skipped.noEmail.push(id); continue; }
    const address = email ?? placeholderEmail(id);
    const taken = usedEmails.get(address);
    if (taken?.ambiguous) { plan.skipped.emailCaseAmbiguous.push(id); continue; }
    if (taken && !taken.linkable) {
      // Created this run or already linked → plain "taken"; anyone else is not a verified, approved doctor.
      (taken.seazonaClientId ? plan.skipped.emailTaken : plan.skipped.emailNotLinkable).push(id);
      continue;
    }
    if (taken && !taken.seazonaClientId) {
      plan.link.push({ userId: taken.id, seazonaClientId: id, seazonaAccountNumber: account });
      if (taken.seazonaAccountNumber && account && taken.seazonaAccountNumber !== account) plan.skipped.accountMismatch.push(id);
      usedEmails.set(address, { ...taken, seazonaClientId: id });
      addProfile(client, taken.id);
      continue;
    }
    if (taken) { plan.skipped.emailTaken.push(id); continue; }
    const doctor = newDoctor(client, id, address, !email, slugs, now);
    plan.create.push(doctor);
    addProfile(client, doctor.user.id);
    usedEmails.set(address, { id: doctor.user.id, seazonaClientId: id, linkable: false, ambiguous: false });
  }
  return plan;
}
