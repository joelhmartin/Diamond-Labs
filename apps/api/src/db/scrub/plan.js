/**
 * Staging scrub plan — pure data + pure helpers (no imports, no I/O).
 *
 * Production holds PHI (medical/dental patients on Rx cases) and customer PII.
 * Every column of every table is classified here. plan.test.js fails if a
 * column on any schema table is missing, so a future column cannot reach staging
 * unclassified. Human-readable rationale: ./COLUMNS.md (keep the two in step).
 *
 * Keys are DATABASE names (snake_case), as in the schema's `pgTable("t", { x: col("c") })`.
 *
 * Classes:
 *   keep   - copied as-is (non-sensitive, or a doctor/practice identity the plan keeps)
 *   phi    - patient health information / patient identity            -> must be overwritten
 *   pii    - customer or free-text personal data                        -> must be overwritten
 *   secret - credentials, tokens, payment-profile ids                   -> must be overwritten
 *   reset  - operational state neutralised so staging cannot act on it  -> overwritten
 * Every non-keep column carries `set`, a deterministic SQL expression (idempotent:
 * re-running yields the same rows). Never decrypt: encrypted PHI is simply replaced.
 *
 * Table modes: "update" (UPDATE ... SET the `set` columns) or "delete" (DELETE all
 * rows; used where the data is worthless or dangerous in staging). In a "delete"
 * table, columns are still classified, with no `set`.
 */

const K = { class: "keep" };
const phi = (set) => ({ class: "phi", set });
const pii = (set) => ({ class: "pii", set });
const secret = (set) => ({ class: "secret", set });
const reset = (set) => ({ class: "reset", set });
// Classified columns of a table whose rows are deleted outright (no per-column rewrite).
const gone = (cls) => ({ class: cls });

const SHIPPING_PLACEHOLDER = `'{"name":"Scrubbed Customer","address1":"1 Test Street","city":"Testville","state":"TX","postalCode":"00000"}'::jsonb`;

export const SCRUB_PLAN = {
  users: {
    mode: "update",
    columns: {
      id: K,
      // Public sign-ups (role 'user') are shoppers/patients' contacts, not doctors: anonymise.
      // Doctors and admins keep email/name (the lab must recognise its clients).
      email: pii(`CASE WHEN "role" = 'user' THEN 'user+' || "id" || '@example.invalid' ELSE "email" END`),
      email_verified_at: K,
      name: pii(`CASE WHEN "role" = 'user' THEN 'Scrubbed User' ELSE "name" END`),
      avatar_url: K,
      password_hash: secret("NULL"),
      mfa_secret: secret("NULL"),
      mfa_enabled: reset("false"),
      last_login_at: K, status: K, role: K, approval_status: K,
      seazona_client_id: K, seazona_account_number: K,
      pending_seazona_client_id: K, pending_seazona_account_number: K, pending_seazona_link_approved_at: K,
      authorize_net_customer_profile_id: secret("NULL"),
      default_payment_profile_id: secret("NULL"),
      created_at: K, updated_at: K,
    },
  },
  accounts: {
    mode: "update",
    columns: {
      id: K, name: K, slug: K, owner_id: K, logo_url: K,
      settings: pii(`'{}'::jsonb`), // free-form jsonb, no schema guarantee it is PHI-free
      plan: K, status: K, created_at: K, updated_at: K,
    },
  },
  memberships: {
    mode: "update",
    columns: { id: K, user_id: K, account_id: K, role: K, joined_at: K, status: K, created_at: K, updated_at: K },
  },
  invitations: {
    mode: "delete",
    columns: {
      id: K, account_id: K, invited_by_id: K, email: gone("pii"), role: K, token: gone("secret"),
      status: K, expires_at: K, created_at: K, updated_at: K,
    },
  },
  sessions: {
    mode: "delete",
    columns: {
      id: K, user_id: K, refresh_token_hash: gone("secret"), ip_address: gone("pii"), user_agent: gone("pii"),
      expires_at: K, revoked_at: K, created_at: K, updated_at: K,
    },
  },
  approval_tokens: {
    mode: "delete",
    columns: {
      id: K, user_id: K, token: gone("secret"), used_at: K, seazona_client_id: K,
      seazona_client_label: K, expires_at: K, created_at: K,
    },
  },
  kv_store: {
    // Rate-limit counters, magic links, MFA setup state, temp tokens, shim caches.
    mode: "delete",
    columns: { key: gone("secret"), value: gone("secret"), expires_at: K },
  },
  audit_log: {
    mode: "update",
    columns: {
      id: K, user_id: K, account_id: K, action: K, target_type: K, target_id: K,
      metadata: pii(`'{}'::jsonb`), // free-text jsonb (notes, emails, names)
      ip_address: pii("NULL"),
      created_at: K,
    },
  },
  doctor_profiles: {
    // Practice identity is KEPT (lab must recognise its clients). Address/phone are
    // practice business data, not patient data. delivery_notes is free text and could
    // name a patient, so it goes.
    mode: "update",
    columns: {
      id: K, user_id: K, npi_number: K, license_number: K, company_name: K,
      address1: K, address2: K, city: K, state: K, zip: K, phone: K, phone2: K,
      delivery_method: K,
      delivery_notes: pii("NULL"),
      created_at: K, updated_at: K,
    },
  },
  invoice_payments: {
    mode: "update",
    columns: {
      id: K, user_id: K, seazona_client_id: K, seazona_invoice_id: K, invoice_number: K, applied_amount: K,
      transaction_id: K, seazona_payment_id: K, refunds_transaction_id: K, source: K, created_at: K,
    },
  },
  autopay_enrollments: {
    mode: "update",
    columns: {
      id: K, user_id: K,
      enabled: reset("false"),
      amount: K, day_of_month: K,
      payment_profile_id: secret(`'SCRUBBED'`), // prod CIM id; NOT NULL so a marker, never a real id
      status: K,
      paused_reason: pii("NULL"), // free text
      consecutive_failures: K, min_amount_override: K,
      last_run_at: K, last_charged_at: K, created_by_user_id: K, updated_by_user_id: K,
      created_at: K, updated_at: K,
    },
  },
  autopay_attempts: {
    mode: "update",
    columns: {
      id: K, enrollment_id: K, user_id: K, job_run_id: K, cycle_key: K, scheduled_for: K, status: K,
      amount_attempted: K, amount_charged: K, transaction_id: K,
      allocations: K, // invoice id / number / amount only
      failure_reason: pii("NULL"), // free text from gateway/Seazona errors
      dry_run: K, created_at: K,
    },
  },
  job_runs: {
    mode: "update",
    columns: {
      id: K, job_name: K, trigger: K, status: K, dry_run: K, started_at: K, finished_at: K,
      summary: pii("NULL"), error: pii("NULL"), actor_user_id: K,
    },
  },
  orders: {
    mode: "update",
    columns: {
      id: K, order_number: K,
      email: pii(`'guest+' || "id" || '@example.invalid'`),
      phone: pii("NULL"),
      shipping: pii(SHIPPING_PLACEHOLDER),
      subtotal: K, tax: K, shipping_cost: K, total: K, currency: K,
      transaction_id: K,
      auth_code: secret("NULL"),
      status: K, priced_for_user_id: K, seazona_client_id: K, seazona_order_id: K, seazona_push_status: K,
      seazona_push_error: pii("NULL"), // can echo the customer payload
      created_at: K, updated_at: K,
    },
  },
  order_items: {
    mode: "update",
    columns: {
      id: K, order_id: K, catalog_id: K, variant_id: K, seazona_product_id: K, name: K, unit_price: K,
      qty: K, line_total: K, taxable: K, price_source: K, created_at: K,
    },
  },
  rx_cases: {
    mode: "update",
    columns: {
      id: K, case_number: K, user_id: K, seazona_client_id: K, seazona_account_number: K,
      practice_name: K, // the doctor's practice, kept
      patient_first: phi(`'Test'`),
      patient_last: phi(`'Patient ' || "case_number"`),
      dob: phi("NULL"),
      gender: phi("NULL"),
      first_device: K,
      contact_phone: phi("NULL"),
      ship_to: phi("NULL"),
      records_method: K, physical_bite: K, form_type: K,
      form_data: phi("NULL"),
      device_key: K, device_category: K,
      device_options: phi(`'{}'`), // plaintext "{}": phi-crypto passes un-prefixed values through
      due_date: K, rush: K, rush_tier: K,
      signature_url: phi("NULL"), // GCS reference to a patient/doctor signature
      general_comments: phi("NULL"),
      status: K, seazona_push_status: K, seazona_order_id: K,
      seazona_push_error: phi("NULL"), // can echo the order payload (patient name)
      payload_snapshot: phi("NULL"),
      manual_note: phi("NULL"),
      created_at: K, updated_at: K,
    },
  },
  rx_case_files: {
    // Patient scans/photos/prescriptions/sleep studies. Rows (and so every GCS
    // reference) are deleted; the GCS objects themselves are never touched.
    mode: "delete",
    columns: {
      id: K, case_id: K, kind: K, original_name: gone("phi"), gcs_url: gone("phi"),
      content_type: K, size: K, created_at: K,
    },
  },
  rx_case_lines: {
    mode: "update",
    columns: {
      id: K, case_id: K, position: K, seazona_code: K, seazona_product_id: K,
      // Manual lines are staff-typed free text; auto lines are catalog names.
      name: phi(`CASE WHEN "origin" = 'manual' THEN 'Manual line' ELSE "name" END`),
      arch: K,
      // map_key embeds the doctor's literal "Other" text for unresolved ('open') lines AND
      // for resolved manual lines (a human mapped a literal-derived key to a product).
      map_key: phi(`CASE WHEN "status" = 'open' OR "origin" = 'manual' THEN 'line:' || "id" ELSE "map_key" END`),
      status: K, origin: K, note_only: K,
      // Copies the doctor's free-form "Other" device text verbatim (the app encrypts the source as PHI).
      source_label: phi("NULL"),
      created_at: K, updated_at: K,
    },
  },
  rx_code_overrides: {
    // map_key shapes (mod:/attr:/primary:/guard:) are shared by stable catalog slugs AND
    // literal-derived keys (mod:<doctor text>), so the shape cannot tell them apart.
    // Keep only rows whose map_key is a KNOWN catalog-map key (the lab's real
    // vocabulary, injected as ctx.knownMapKeys); DELETE every other row.
    mode: "update",
    deleteUnlessIn: { column: "map_key", ctxKey: "knownMapKeys" },
    columns: {
      id: K, map_key: K, seazona_code: K, seazona_product_id: K, seazona_name: K,
      note: K, // lab-staff mapping rationale about product codes
      note_only: K, confirmed_by: K, created_at: K, updated_at: K,
    },
  },
  client_prices: {
    mode: "update",
    columns: {
      id: K, client_user_id: K, variant_id: K, price_cents: K, source: K, reviewed_at: K, reviewed_by: K,
      note: pii("NULL"), // free text about a client's pricing
      created_at: K, updated_at: K,
    },
  },
  app_theme: { mode: "update", columns: { id: K, tokens: K, updated_by: K, updated_at: K } },
  products: {
    mode: "update",
    columns: {
      seazona_product_id: K, code: K, name: K, taxable: K, price: K, image_url: K, description: K,
      purchasable: K, category: K, catalog_id: K, last_synced_at: K, created_at: K, updated_at: K,
    },
  },
  product_families: {
    mode: "update",
    columns: {
      id: K, slug: K, name: K, description: K, category: K, image_url: K, channel: K, active: K,
      position: K, created_at: K, updated_at: K,
    },
  },
  product_options: { mode: "update", columns: { id: K, family_id: K, name: K, position: K } },
  product_option_values: { mode: "update", columns: { id: K, option_id: K, value: K, position: K } },
  product_variants: {
    mode: "update",
    columns: {
      id: K, family_id: K, code: K, name: K, base_price_cents: K, taxable: K, active: K, catalog_id: K,
      legacy_seazona_product_id: K, created_at: K, updated_at: K,
    },
  },
  product_variant_option_values: { mode: "update", columns: { variant_id: K, option_value_id: K } },
};

/** Live relations the drift check ignores (bookkeeping only: migration hashes + timestamps). */
export const IGNORED_LIVE_TABLES = ["drizzle.__drizzle_migrations"];

export const COLUMN_CLASSES = ["keep", "phi", "pii", "secret", "reset"];

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

/**
 * Ordered statements for the plan: [{ table, mode, sql, params? }]. Tables with
 * nothing to rewrite produce no statement. `ctx.knownMapKeys` (string[]) is required
 * when the plan has a deleteUnlessIn rule, so a caller that forgets it fails loudly.
 */
export function buildStatements(plan = SCRUB_PLAN, ctx = {}) {
  const out = [];
  for (const [table, spec] of Object.entries(plan)) {
    if (spec.deleteUnlessIn) {
      const { column, ctxKey } = spec.deleteUnlessIn;
      const keys = ctx[ctxKey];
      if (!Array.isArray(keys) || !keys.length) throw new Error(`buildStatements needs a non-empty ctx.${ctxKey} for ${table}`);
      out.push({ table, mode: "delete", sql: `DELETE FROM ${q(table)} WHERE NOT (${q(column)} = ANY($1))`, params: [keys] });
    }
    if (spec.mode === "delete") {
      out.push({ table, mode: "delete", sql: `DELETE FROM ${q(table)}` });
      continue;
    }
    const sets = Object.entries(spec.columns)
      .filter(([, c]) => c.class !== "keep")
      .map(([name, c]) => `${q(name)} = ${c.set}`);
    if (sets.length) out.push({ table, mode: "update", sql: `UPDATE ${q(table)} SET ${sets.join(", ")}` });
  }
  return out;
}

/** Count of columns per class across the whole plan. */
export function classSummary(plan = SCRUB_PLAN) {
  const counts = Object.fromEntries(COLUMN_CLASSES.map((c) => [c, 0]));
  for (const spec of Object.values(plan)) for (const c of Object.values(spec.columns)) counts[c.class] += 1;
  return counts;
}

/**
 * Pure guard. Throws unless the connected database is exactly diamond_labs_staging
 * AND APP_ENV is "staging". Both are required; either alone is not enough.
 */
export function assertScrubAllowed({ appEnv, currentDatabase }) {
  const problems = [];
  if (appEnv !== "staging") problems.push(`APP_ENV must be "staging" (got ${JSON.stringify(appEnv ?? null)})`);
  if (currentDatabase !== "diamond_labs_staging") {
    problems.push(`current_database() must be "diamond_labs_staging" (got ${JSON.stringify(currentDatabase ?? null)})`);
  }
  if (problems.length) throw new Error(`scrub-staging refuses to run: ${problems.join("; ")}`);
}

/**
 * Pure: plan tables/columns that do NOT exist in the live database (schema behind
 * code). `live` as for findUnclassifiedLive.
 */
export function findMissingFromLive(live, plan = SCRUB_PLAN) {
  const problems = [];
  for (const [table, spec] of Object.entries(plan)) {
    if (!live[table]) { problems.push(`table ${table} is missing`); continue; }
    for (const c of Object.keys(spec.columns)) if (!live[table].includes(c)) problems.push(`column ${table}.${c} is missing`);
  }
  return problems;
}

/**
 * Pure drift check against the live catalog: `live` is { table: [columns] } keyed by bare name for public, `schema.table` otherwise.
 * Returns human-readable problems for any live table/column the plan does not classify.
 */
export function findUnclassifiedLive(live, plan = SCRUB_PLAN) {
  const problems = [];
  for (const [table, cols] of Object.entries(live)) {
    if (IGNORED_LIVE_TABLES.includes(table)) continue;
    const spec = plan[table];
    if (!spec) { problems.push(`table ${table} is not in the scrub plan`); continue; }
    for (const c of cols) if (!spec.columns[c]) problems.push(`column ${table}.${c} is not in the scrub plan`);
  }
  return problems;
}
