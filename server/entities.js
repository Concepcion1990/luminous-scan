/**
 * Generic entity layer — T3 (plan §5.1, §5.2, §5.3).
 *
 * The ported frontend talks to entities exactly as it talked to
 * Base44 (filter / list / get / create / update / delete / count /
 * bulkCreate / bulkUpdate / updateMany / deleteMany). This layer is
 * the twin's answer to that API, over Postgres, with every check
 * server-side:
 *
 *  - Access: the caller owns the business or is a trusted active
 *    staff member on it (server/authz.js). Reads are open to any
 *    trusted staff; writes need the matching permission (or owner).
 *  - Plan: Business-only entities (suppliers, alert rules) refuse
 *    on Essentials; the product/staff/site caps refuse over-limit
 *    writes with the same messages Base44 used.
 *  - Provenance: StaffMember rows are created only through
 *    server/staff.js (created_by_id from the session); the owner may
 *    delete any StaffMember row on their business.
 *  - Stock can never go below zero (level writes refuse negatives);
 *    bundle movement types refuse on Essentials.
 *
 * Filters use the Base44 language (server/query.js) evaluated over
 * the business's rows. Purchase orders and BOMs are T5: their reads
 * return empty, their writes refuse with t5_not_built.
 */
import crypto from 'node:crypto';
import { matchesFilter, pageRows, FETCH_CAP } from './query.js';
import {
  resolveAccess,
  accessibleBusinessIds,
  staffRowForEmail,
  isTrustedStaffRow,
  parseJsonArray,
} from './authz.js';
import {
  limitsForPlan,
  planFor,
  featureAllowed,
  isOperatingSite,
  productLimitMessage,
  siteLimitMessage,
  customRolesBusinessOnlyMessage,
  BUNDLE_MOVEMENT_TYPES,
} from './plans.js';
import { createStaffMember, staffSeatCount } from './staff.js';
import { assertNotInGrace } from './billing.js';

export const T5_STUBS = new Set(['PurchaseOrder', 'Bom']);

const DEFS = {
  Product: {
    table: 'products',
    json: ['variant_options', 'photo_urls', 'tags', 'custom_fields'],
    numeric: ['cost', 'price', 'reorder_point'],
    bool: ['active'],
    required: ['name'],
    writePerm: 'products.edit',
  },
  Category: {
    table: 'categories',
    json: [],
    numeric: [],
    bool: [],
    required: ['name'],
    writePerm: 'categories.manage',
  },
  Location: {
    table: 'locations',
    json: [],
    numeric: [],
    bool: ['active'],
    required: ['name'],
    writePerm: 'locations.manage',
  },
  StockLevel: {
    table: 'stock_levels',
    json: [],
    numeric: ['quantity', 'reserved'],
    bool: [],
    required: ['product_id', 'location_id'],
    writePerm: 'scan.use',
  },
  StockMovement: {
    table: 'stock_movements',
    json: [],
    numeric: ['quantity', 'previous_qty', 'new_qty', 'unit_cost'],
    bool: [],
    required: ['type'],
    writePerm: 'scan.use',
  },
  StaffMember: {
    table: 'staff_members',
    json: ['permissions'],
    numeric: [],
    bool: [],
    required: ['full_name', 'email'],
    writePerm: 'staff.manage',
  },
  StaffRole: {
    table: 'staff_roles',
    json: ['permissions'],
    numeric: [],
    bool: [],
    required: ['name'],
    writePerm: 'staff.manage',
  },
  Supplier: {
    table: 'suppliers',
    json: [],
    numeric: ['lead_time_days'],
    bool: ['active'],
    required: ['name'],
    // planGate stays: reads skip silently on Essentials (the list
    // pattern) and single reads refuse; guardCreate below returns
    // the specific 'supplier_business_only' error for writes.
    planGate: 'business',
    writePerm: 'suppliers.manage',
  },
  AlertRule: {
    table: 'alert_rules',
    json: ['location_ids', 'location_names'],
    numeric: ['threshold'],
    bool: ['active'],
    required: ['name'],
    planGate: 'business',
    writePerm: 'reports.view',
  },
  Order: {
    table: 'orders',
    json: ['lines'],
    numeric: ['discount', 'shipping', 'tax', 'subtotal', 'total'],
    bool: [],
    required: [],
    writePerm: 'orders.manage',
  },
  Return: {
    table: 'returns',
    json: ['lines', 'exchange_lines'],
    numeric: ['refund_amount'],
    bool: [],
    required: [],
    writePerm: 'returns.manage',
  },
  CountSession: {
    table: 'count_sessions',
    json: ['lines'],
    numeric: [],
    bool: [],
    required: [],
    writePerm: 'counts.run',
  },
  Listing: {
    table: 'listings',
    json: [],
    numeric: ['price', 'quantity_listed'],
    bool: [],
    required: [],
    writePerm: 'listings.manage',
  },
  Entitlement: {
    table: 'entitlements',
    json: [],
    numeric: [],
    bool: [],
    required: [],
    writePerm: null, // read-only until T4 owns billing
    readOnly: true,
  },
};

export function entityDef(name) {
  return DEFS[name] ?? null;
}

/** DB row -> API row: JSON fields parsed, NUMERICs as numbers, Base44 date names. */
export function publicRow(def, row) {
  if (!row) return null;
  const out = { ...row };
  for (const field of def.json) {
    out[field] = parseJsonArray(row[field]);
  }
  for (const field of def.numeric) {
    out[field] = row[field] === null || row[field] === undefined ? null : Number(row[field]);
  }
  out.created_date = row.created_at;
  out.updated_date = row.updated_at;
  delete out.created_at;
  delete out.updated_at;
  return out;
}

/** API values -> DB columns: only known fields, JSON stringified, numbers coerced. */
export function toDbValues(def, values, { isCreate = false } = {}) {
  const out = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (key === 'id' || key === 'created_date' || key === 'updated_date' || key === 'created_at' || key === 'updated_at') continue;
    if (key === 'business_id' && !isCreate) continue; // business never moves
    if (def.json.includes(key)) {
      out[key] = Array.isArray(value) ? JSON.stringify(value) : typeof value === 'string' ? value : JSON.stringify(value ?? []);
      continue;
    }
    if (def.numeric.includes(key)) {
      if (value === '' || value === null || value === undefined) {
        out[key] = null;
        continue;
      }
      const n = Number(value);
      if (!Number.isFinite(n)) throw Object.assign(new Error(`Field ${key} must be a number.`), { status: 400, code: 'invalid_number' });
      out[key] = n;
      continue;
    }
    if (def.bool.includes(key)) {
      out[key] = value === true || value === 'true';
      continue;
    }
    out[key] = value === undefined ? null : value;
  }
  return out;
}

async function fetchBusinessRows(pool, def, businessId) {
  const { rows } = await pool.query(
    `SELECT * FROM ${def.table} WHERE business_id = $1 ORDER BY created_at ASC LIMIT ${FETCH_CAP}`,
    [businessId],
  );
  return rows.map((row) => publicRow(def, row));
}

function businessIdsFromFilter(filter) {
  if (!filter || typeof filter !== 'object') return [];
  const direct = filter.business_id;
  if (typeof direct === 'string' && direct) return [direct];
  if (direct && typeof direct === 'object' && Array.isArray(direct.$in)) return direct.$in.filter(Boolean);
  const and = filter.$and;
  if (Array.isArray(and)) {
    for (const part of and) {
      const ids = businessIdsFromFilter(part);
      if (ids.length) return ids;
    }
  }
  return [];
}

async function activeProductCount(pool, businessId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1 AND (status IS NULL OR status <> 'archived')",
    [businessId],
  );
  return rows[0]?.n ?? 0;
}

async function operatingSiteCount(pool, businessId) {
  const { rows } = await pool.query('SELECT kind, parent_id FROM locations WHERE business_id = $1', [businessId]);
  return rows.filter((row) => isOperatingSite(row)).length;
}

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/** Guard a product write against the plan's active-product cap. */
export async function assertProductCap(pool, businessId, planKey, additionalActive) {
  const limits = limitsForPlan(planKey);
  if (limits.products == null || additionalActive <= 0) return;
  const used = await activeProductCount(pool, businessId);
  if (used + additionalActive > limits.products) {
    throw Object.assign(
      err(403, 'product_limit', productLimitMessage(limits.products, used)),
      { limit: limits.products, used },
    );
  }
}

async function guardCreate(pool, def, name, access, values) {
  const { business, planKey } = access;
  // Specific error first: suppliers refuse with their own code,
  // not the generic plan gate.
  if (name === 'Supplier' && planKey !== 'business') {
    throw err(403, 'supplier_business_only', 'Suppliers are part of the Business plan.');
  }
  if (def.planGate && !featureAllowed(planKey, def.planGate)) {
    throw err(403, 'plan_gated', `This feature is part of the Business plan.`);
  }
  if (name === 'Entitlement') throw err(403, 'entitlement_read_only', 'Entitlements are managed by billing (T4).');
  if (T5_STUBS.has(name)) throw err(403, 't5_not_built', 'Purchase orders and bundles are built in T5.');
  if (def.writePerm && !access.can(def.writePerm)) {
    throw err(403, 'forbidden', 'You do not have permission to do that here.');
  }
  for (const field of def.required) {
    if (values[field] === undefined || values[field] === null || String(values[field]).trim() === '') {
      throw err(400, 'invalid_value', `Field ${field} is required.`);
    }
  }
  if (name === 'Product') {
    await assertProductCap(pool, business.id, planKey, values.status === 'archived' ? 0 : 1);
  }
  if (name === 'Location' && isOperatingSite(values)) {
    const limits = limitsForPlan(planKey);
    if (limits.sites != null) {
      const used = await operatingSiteCount(pool, business.id);
      if (used >= limits.sites) throw err(403, 'site_limit', siteLimitMessage(limits.sites));
    }
  }
  if (name === 'StockLevel') {
    if (Number(values.quantity ?? 0) < 0 || Number(values.reserved ?? 0) < 0) {
      throw err(400, 'invalid_quantity', 'Stock levels can never be negative.');
    }
    const product = (await pool.query('SELECT id FROM products WHERE id = $1 AND business_id = $2', [values.product_id, business.id])).rows[0];
    const location = (await pool.query('SELECT id FROM locations WHERE id = $1 AND business_id = $2', [values.location_id, business.id])).rows[0];
    if (!product || !location) throw err(400, 'invalid_reference', 'The product and location must belong to this business.');
  }
  if (name === 'StockMovement') {
    if (BUNDLE_MOVEMENT_TYPES.includes(values.type) && !featureAllowed(planKey, 'builds')) {
      throw err(403, 'bundle_business_only', 'Bundle movements are a Business feature — building bundles and taking them apart need the Business plan.');
    }
    if (!(Number(values.quantity) >= 0)) throw err(400, 'invalid_quantity', 'A movement quantity must be zero or more.');
    if (values.product_id) {
      const product = (await pool.query('SELECT id FROM products WHERE id = $1 AND business_id = $2', [values.product_id, business.id])).rows[0];
      if (!product) throw err(400, 'invalid_reference', 'The product must belong to this business.');
    }
  }
  if (name === 'StaffRole' && planKey !== 'business') {
    throw err(403, 'custom_roles_business_only', customRolesBusinessOnlyMessage());
  }
}

async function guardUpdate(pool, def, name, access, row, patch) {
  const { planKey } = access;
  if (def.planGate && !featureAllowed(planKey, def.planGate)) {
    throw err(403, 'plan_gated', 'This feature is part of the Business plan.');
  }
  if (name === 'Entitlement') throw err(403, 'entitlement_read_only', 'Entitlements are managed by billing (T4).');
  if (T5_STUBS.has(name)) throw err(403, 't5_not_built', 'Purchase orders and bundles are built in T5.');
  if (def.writePerm && !access.can(def.writePerm)) {
    throw err(403, 'forbidden', 'You do not have permission to do that here.');
  }
  if (name === 'StaffMember') {
    // A staff member may never raise their own permissions; only the
    // owner or a staff-manager may change a member row.
    if (!access.isOwner && !access.can('staff.manage')) {
      throw err(403, 'forbidden', 'You do not have permission to manage staff here.');
    }
    if (Array.isArray(patch.permissions)) {
      const { permissionsForPlan } = await import('./plans.js');
      patch.permissions = permissionsForPlan(planKey, patch.permissions);
    }
  }
  if (name === 'StockLevel' && (patch.quantity !== undefined || patch.reserved !== undefined)) {
    const nextQty = patch.quantity !== undefined ? Number(patch.quantity) : Number(row.quantity);
    const nextRes = patch.reserved !== undefined ? Number(patch.reserved) : Number(row.reserved);
    if (nextQty < 0 || nextRes < 0) throw err(400, 'invalid_quantity', 'Stock levels can never be negative.');
  }
  if (name === 'StockMovement' && patch.type && BUNDLE_MOVEMENT_TYPES.includes(patch.type) && !featureAllowed(planKey, 'builds')) {
    throw err(403, 'bundle_business_only', 'Bundle movements are a Business feature.');
  }
}

async function insertRow(pool, def, businessId, caller, values) {
  const dbValues = toDbValues(def, values, { isCreate: true });
  dbValues.business_id = businessId;
  dbValues.id = crypto.randomUUID();
  dbValues.created_by_id = caller.id;
  dbValues.created_by = caller.email;
  const columns = Object.keys(dbValues);
  const params = columns.map((_, i) => `$${i + 1}`);
  const sql = `INSERT INTO ${def.table} (${columns.join(', ')}) VALUES (${params.join(', ')}) RETURNING *`;
  const { rows } = await pool.query(sql, columns.map((col) => dbValues[col]));
  return publicRow(def, rows[0]);
}

export async function listEntities(pool, user, name, filter = {}, options = {}) {
  if (T5_STUBS.has(name)) return { items: [], next_cursor: null, total: 0 };
  const def = entityDef(name);
  if (!def) throw err(404, 'unknown_entity', `Unknown entity ${name}.`);
  const wantedIds = businessIdsFromFilter(filter);
  const accessible = wantedIds.length ? wantedIds : await accessibleBusinessIds(pool, user);
  const rows = [];
  for (const businessId of accessible) {
    const access = await resolveAccess(pool, user, businessId);
    if (!access) continue;
    if (def.planGate && !featureAllowed(access.planKey, def.planGate)) continue;
    let businessRows = await fetchBusinessRows(pool, def, businessId);
    if (name === 'StaffMember' && !access.isOwner) {
      // Staff read-by-email: a non-owner sees only their own row, and
      // only when that row is trusted (owner-created or chained).
      businessRows = businessRows.filter((row) => String(row.email || '').toLowerCase() === String(user.email || '').toLowerCase());
      const trusted = [];
      for (const row of businessRows) {
        if (await isTrustedStaffRow(pool, access.business, row)) trusted.push(row);
      }
      businessRows = trusted;
    }
    rows.push(...businessRows);
  }
  const matched = rows.filter((row) => matchesFilter(row, filter));
  return pageRows(matched, options);
}

export async function countEntities(pool, user, name, filter = {}) {
  const page = await listEntities(pool, user, name, filter, { limit: 2000 });
  // listEntities pages at 2000; counts in this app stay far below that.
  return page.total;
}

export async function getEntity(pool, user, name, id) {
  if (T5_STUBS.has(name)) throw err(404, 'not_found', 'Not found.');
  const def = entityDef(name);
  if (!def) throw err(404, 'unknown_entity', `Unknown entity ${name}.`);
  const { rows } = await pool.query(`SELECT * FROM ${def.table} WHERE id = $1 LIMIT 1`, [id]);
  const row = rows[0];
  if (!row) throw err(404, 'not_found', 'Not found.');
  const access = await resolveAccess(pool, user, row.business_id);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  if (def.planGate && !featureAllowed(access.planKey, def.planGate)) {
    throw err(403, 'plan_gated', 'This feature is part of the Business plan.');
  }
  if (name === 'StaffMember' && !access.isOwner) {
    if (String(row.email || '').toLowerCase() !== String(user.email || '').toLowerCase()) {
      throw err(403, 'forbidden', 'You can only read your own staff record.');
    }
    if (!(await isTrustedStaffRow(pool, access.business, publicRow(def, row)))) {
      throw err(403, 'forbidden', 'You can only read your own staff record.');
    }
  }
  return publicRow(def, row);
}

export async function createEntity(pool, user, name, values) {
  const def = entityDef(name);
  if (!def) throw err(404, 'unknown_entity', `Unknown entity ${name}.`);
  if (T5_STUBS.has(name)) throw err(403, 't5_not_built', 'Purchase orders and bundles are built in T5.');
  const businessId = values?.business_id;
  if (!businessId) throw err(400, 'invalid_value', 'business_id is required.');
  const access = await resolveAccess(pool, user, businessId);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  await assertNotInGrace(pool, businessId);
  if (name === 'StaffMember') {
    if (!access.isOwner && !access.can('staff.manage')) {
      throw err(403, 'forbidden', 'You are not allowed to manage staff here.');
    }
    const row = await createStaffMember(pool, { business: access.business, planKey: access.planKey, caller: user, member: values });
    return publicRow(def, row);
  }
  await guardCreate(pool, def, name, access, values);
  return insertRow(pool, def, businessId, user, values);
}

export async function bulkCreateEntities(pool, user, name, rows) {
  const def = entityDef(name);
  if (!def) throw err(404, 'unknown_entity', `Unknown entity ${name}.`);
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) {
    throw err(400, 'invalid_value', 'Send between 1 and 100 rows at a time.');
  }
  const businessId = rows[0]?.business_id;
  if (!businessId || rows.some((row) => row.business_id !== businessId)) {
    throw err(400, 'invalid_value', 'All rows must belong to one business.');
  }
  const access = await resolveAccess(pool, user, businessId);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  await assertNotInGrace(pool, businessId);
  if (name === 'StaffMember') throw err(400, 'invalid_value', 'Invite staff members one at a time.');
  if (name === 'Product') {
    const additional = rows.filter((row) => row.status !== 'archived').length;
    await assertProductCap(pool, businessId, access.planKey, additional);
  }
  const created = [];
  for (const row of rows) {
    await guardCreate(pool, def, name, access, row);
    created.push(await insertRow(pool, def, businessId, user, row));
  }
  return created;
}

export async function updateEntity(pool, user, name, id, patch) {
  const def = entityDef(name);
  if (!def) throw err(404, 'unknown_entity', `Unknown entity ${name}.`);
  if (T5_STUBS.has(name)) throw err(403, 't5_not_built', 'Purchase orders and bundles are built in T5.');
  const { rows } = await pool.query(`SELECT * FROM ${def.table} WHERE id = $1 LIMIT 1`, [id]);
  const row = rows[0];
  if (!row) throw err(404, 'not_found', 'Not found.');
  const access = await resolveAccess(pool, user, row.business_id);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  await assertNotInGrace(pool, row.business_id);
  const publicExisting = publicRow(def, row);
  await guardUpdate(pool, def, name, access, publicExisting, patch);
  // A product re-activated from archived re-enters the cap.
  if (name === 'Product' && patch.status && patch.status !== 'archived' && publicExisting.status === 'archived') {
    await assertProductCap(pool, row.business_id, access.planKey, 1);
  }
  const dbValues = toDbValues(def, patch);
  dbValues.updated_at = new Date().toISOString();
  const columns = Object.keys(dbValues);
  if (!columns.length) return publicExisting;
  const sets = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');
  const updated = await pool.query(
    `UPDATE ${def.table} SET ${sets} WHERE id = $${columns.length + 1} RETURNING *`,
    [...columns.map((col) => dbValues[col]), id],
  );
  return publicRow(def, updated.rows[0]);
}

export async function deleteEntity(pool, user, name, id) {
  const def = entityDef(name);
  if (!def) throw err(404, 'unknown_entity', `Unknown entity ${name}.`);
  if (T5_STUBS.has(name)) throw err(403, 't5_not_built', 'Purchase orders and bundles are built in T5.');
  const { rows } = await pool.query(`SELECT * FROM ${def.table} WHERE id = $1 LIMIT 1`, [id]);
  const row = rows[0];
  if (!row) throw err(404, 'not_found', 'Not found.');
  const access = await resolveAccess(pool, user, row.business_id);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  await assertNotInGrace(pool, row.business_id);
  if (name === 'StaffMember') {
    // PR #63 follow-up (b): the owner may delete ANY StaffMember row
    // on their own business — including attacker-created ones.
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the business owner can remove a staff member.');
  } else if (name === 'Entitlement') {
    throw err(403, 'entitlement_read_only', 'Entitlements are managed by billing (T4).');
  } else if (def.planGate && !featureAllowed(access.planKey, def.planGate)) {
    throw err(403, 'plan_gated', 'This feature is part of the Business plan.');
  } else if (def.writePerm && !access.can(def.writePerm)) {
    throw err(403, 'forbidden', 'You do not have permission to do that here.');
  }
  await pool.query(`DELETE FROM ${def.table} WHERE id = $1`, [id]);
  return { ok: true, id };
}

export async function bulkUpdateEntities(pool, user, name, rows) {
  if (!Array.isArray(rows) || !rows.length) throw err(400, 'invalid_value', 'No rows to update.');
  const updated = [];
  for (const row of rows) {
    if (!row.id) throw err(400, 'invalid_value', 'Each row needs an id.');
    updated.push(await updateEntity(pool, user, name, row.id, row));
  }
  return updated;
}
