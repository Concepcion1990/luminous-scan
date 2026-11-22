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
 *  - Subscription: on top of ownership, the workspace must be
 *    entitled (server/subscriptionAccess.js) — unpaid workspaces
 *    serve nothing here, and grace is products/stock-levels read-only.
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
 * the business's rows. Purchase orders and BOMs are full T5 entities:
 * created as draft (never silently ordered), $0 lines warned, not
 * silently written, and status moves only through the guarded
 * transitions (the atomic receive/build endpoints live in
 * server/business.js).
 */
import crypto from 'node:crypto';
import { matchesFilter, pageRows, FETCH_CAP } from './query.js';
import { trainingFlagForMemberChange, trainingFlagForRoleChange } from './trainingCore.js';
import {
  resolveAccess,
  accessibleBusinessIds,
  staffRowForEmail,
  isTrustedStaffRow,
  parseJsonArray,
} from './authz.js';
import { ownerPublicName, attributionNameMap, attributionName } from './profilePhotos.js';
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
import { createStaffMember, staffSeatCount, resolveMemberStore, singleStoreLocation } from './staff.js';
import { memberLevel } from './staffWindow.js';
import { ensureDefaultLocation } from './defaultLocation.js';
import { rememberOrderAddress } from './customerAddresses.js';
import { withTx } from './billing.js';
import {
  assertSubscriptionAccess,
  subscriptionAccessFor,
  subscriptionDeniedError,
  graceReadOnlyError,
  GRACE_READABLE_ENTITIES,
} from './subscriptionAccess.js';

const DEFS = {
  Product: {
    table: 'products',
    json: ['variant_options', 'photo_urls', 'tags', 'custom_fields'],
    numeric: ['cost', 'price', 'reorder_point', 'clearance_price', 'sale_price'],
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
  // One summary row per committed Create/Update import, surfaced in
  // the activity feeds (Nov 15, 2026). Deliberately NOT a stock
  // movement: no stock math, count or reconciliation ever reads it.
  ImportEvent: {
    table: 'import_events',
    json: [],
    numeric: ['product_count'],
    bool: [],
    required: ['kind'],
    writePerm: 'exports.use',
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
  PurchaseOrder: {
    table: 'purchase_orders',
    json: ['lines'],
    numeric: ['subtotal', 'shipping', 'tax', 'total', 'send_count'],
    bool: [],
    required: ['number', 'supplier_id'],
    // Business-only (plan §2.11). Created as draft, never silently
    // ordered — guardCreate forces status 'draft' whatever the
    // browser sent — and $0 lines are refused unless the caller
    // explicitly acknowledges them (allow_zero_cost).
    planGate: 'business',
    writePerm: 'purchasing.manage',
  },
  Bom: {
    table: 'boms',
    json: ['lines'],
    numeric: [],
    bool: ['active'],
    required: ['product_id'],
    // Business-only (plan §2.11): bundles & builds.
    planGate: 'business',
    writePerm: 'builds.manage',
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
    if (key === 'allow_zero_cost') continue; // acknowledgement flag, never a column
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

/**
 * Attribution shaping (owner's rider + email-exposure audit,
 * Nov 21, 2026): the counts board is shared with every staff
 * member (release 333), and its "Started by" / "Applied by"
 * lines carried the person's EMAIL whenever the client had no
 * name for them — the owner's own email included, visible to
 * all staff. The audit found the same stored-email shape in
 * every "…by" field in the app. Attribution is a NAME, never
 * an address:
 *   - writes are stamped server-side with the actor's display
 *     name (the owner's set name or "Owner"; a member's staff
 *     name) — see createEntity / updateEntity below;
 *   - reads for a NON-OWNER viewer resolve any legacy email
 *     value to that person's name (owner → their display name,
 *     member → their staff name); an email that matches nobody
 *     in the business becomes blank, so the line simply drops.
 * The owner's own view is never shaped: her payload is the row
 * exactly as stored.
 */
const ATTRIBUTION_FIELDS = {
  CountSession: ['started_by', 'applied_by'],
  PurchaseOrder: ['received_by'],
  Order: ['reserved_by', 'shipped_by'],
  Return: ['approved_by', 'completed_by'],
  StockMovement: ['user_name'],
  ImportEvent: ['user_name'],
};

async function shapeAttribution(pool, access, entityName, rows) {
  const fields = ATTRIBUTION_FIELDS[entityName];
  if (!fields || !rows.length) return rows;
  const hasEmail = (value) => typeof value === 'string' && value.includes('@');
  if (!rows.some((row) => fields.some((field) => hasEmail(row[field])))) return rows;
  const byEmail = await attributionNameMap(pool, access.business);
  for (const row of rows) {
    for (const field of fields) {
      if (hasEmail(row[field])) row[field] = attributionName(byEmail, row[field]);
    }
  }
  return rows;
}

/** The display name an attribution write is stamped with: the
 *  owner's set name (or "Owner"), else the member's staff name —
 *  never an email address. */
async function countActorName(pool, access) {
  if (access.isOwner) return ownerPublicName(pool, access.business);
  return access.staffRow?.full_name || '';
}

/** Stamp every attribution field PRESENT in a write with the
 *  actor's display name (see ATTRIBUTION_FIELDS). The client's
 *  value is never trusted for a "…by" field. */
async function stampAttribution(pool, access, entityName, values) {
  const fields = ATTRIBUTION_FIELDS[entityName];
  if (!fields || !values) return values;
  const present = fields.filter((field) => field in values);
  if (!present.length) return values;
  const name = await countActorName(pool, access);
  const out = { ...values };
  for (const field of present) out[field] = name;
  return out;
}

/**
 * The creator stamp is an audit key, not a display field: every
 * row stores created_by = the creator's login email (insertRow),
 * and a NON-OWNER never receives it (or the creator's user id)
 * in a payload (owner's email-exposure rule, Nov 21, 2026 — the
 * audit's finding B1). The owner's payloads keep both, exactly
 * as stored.
 */
function stripCreatedBy(row) {
  if (!row) return row;
  const copy = { ...row };
  delete copy.created_by;
  delete copy.created_by_id;
  return copy;
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

/**
 * Is this product row a copy of another product? The server twin of
 * src/lib/productDuplicates.js — the two must agree, because this
 * predicate decides the plan cap while that one decides the counts
 * the customer sees (owner's counting rule, Nov 14, 2026: a copy
 * never counts; archiving never frees a slot). A copy carries the
 * durable duplicate_of marker (migration 024), or — for copies
 * minted before the marker existed — BOTH legacy birthmarks: a
 * '-COPY' SKU and every code field cleared.
 */
export function isDuplicateProductRow(row) {
  if (!row) return false;
  if (row.duplicate_of) return true;
  const sku = String(row.sku || '').trim();
  if (!/-COPY(-\d+)?$/i.test(sku)) return false;
  return !row.upc && !row.barcode && !row.qr_code;
}

/**
 * The product count the plan cap enforces: DISTINCT ORIGINAL
 * products, any status — active or archived. Copies never count;
 * an archived original still counts (archive is a shelf, not a
 * shredder — otherwise the cap could be sieved by archiving to
 * make room); only a true delete lowers the count. Decided in JS
 * over the signature fields so the rule is identical on every
 * database engine, exactly as the client's twin computes it.
 */
async function distinctProductCount(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT sku, upc, barcode, qr_code, duplicate_of FROM products WHERE business_id = $1',
    [businessId],
  );
  return rows.filter((row) => !isDuplicateProductRow(row)).length;
}

async function operatingSiteCount(pool, businessId) {
  const { rows } = await pool.query('SELECT kind, parent_id FROM locations WHERE business_id = $1', [businessId]);
  return rows.filter((row) => isOperatingSite(row)).length;
}

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/** A missing cost is not a cost of zero: a line with no unit cost at
 * all (blank, missing, or an explicit 0 the browser wrote for a
 * blank) must be named, never written silently. A recorded $0 the
 * owner explicitly confirms is real and is kept. */
function poZeroCostLines(lines) {
  return (Array.isArray(lines) ? lines : []).filter(
    (line) =>
      line &&
      (line.unit_cost === '' ||
        line.unit_cost === null ||
        line.unit_cost === undefined ||
        Number(line.unit_cost) === 0),
  );
}

function poTotalsFor(lines, shipping, tax) {
  const subtotal = (Array.isArray(lines) ? lines : []).reduce(
    (sum, line) => sum + (Number(line.qty_ordered) || 0) * (Number(line.unit_cost) || 0),
    0,
  );
  return { subtotal, total: subtotal + (Number(shipping) || 0) + (Number(tax) || 0) };
}

async function assertProductsInBusiness(pool, businessId, productIds) {
  for (const id of [...new Set((productIds || []).filter(Boolean))]) {
    const found = (
      await pool.query('SELECT id FROM products WHERE id = $1 AND business_id = $2', [id, businessId])
    ).rows[0];
    if (!found) throw err(400, 'invalid_reference', 'Every line must name a product in this business.');
  }
}

function poZeroCostError(zero) {
  return Object.assign(
    err(
      400,
      'po_zero_cost_lines',
      `These lines have no unit cost: ${zero.map((l) => l.product_name || l.sku || 'a line').join(', ')}. Add the cost, or save again to confirm $0 is what you mean.`,
    ),
    { zero_lines: zero.map((l) => l.product_name || l.sku || '') },
  );
}

/** Shared line checks for a purchase order (create + update). */
async function validatePoLines(pool, business, values, { allowZeroCost }) {
  const lines = Array.isArray(values.lines) ? values.lines : [];
  if (!lines.length) throw err(400, 'invalid_value', 'Add at least one order line.');
  for (const line of lines) {
    if (!(Number(line.qty_ordered) > 0)) {
      throw err(400, 'invalid_quantity', 'Every order line needs a quantity greater than zero.');
    }
  }
  await assertProductsInBusiness(pool, business.id, lines.map((l) => l.product_id));
  const zero = poZeroCostLines(lines);
  if (zero.length && !allowZeroCost) throw poZeroCostError(zero);
  return lines;
}

/** Shared checks for a build list (create + update). */
async function validateBom(pool, business, productId, kind, lines) {
  if (!['bundle', 'recipe'].includes(kind || 'bundle')) {
    throw err(400, 'invalid_value', 'A build list is a bundle or a recipe.');
  }
  const finished = (
    await pool.query('SELECT id FROM products WHERE id = $1 AND business_id = $2', [productId, business.id])
  ).rows[0];
  if (!finished) throw err(400, 'invalid_reference', 'The built product must belong to this business.');
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) throw err(400, 'invalid_value', 'Add at least one component.');
  for (const line of list) {
    if (line.component_id === productId) {
      throw err(400, 'invalid_value', 'A product cannot be a component of itself.');
    }
    if (!(Number(line.quantity) > 0)) {
      throw err(400, 'invalid_quantity', 'Every component needs a quantity greater than zero.');
    }
  }
  await assertProductsInBusiness(pool, business.id, list.map((l) => l.component_id));
  return list;
}

/** Status moves a purchase order may make by direct edit. Receiving
 * sets `partial` / `received` — never an edit — and a received or
 * cancelled order is terminal. */
const PO_EDIT_TRANSITIONS = {
  draft: ['ordered', 'cancelled'],
  ordered: ['cancelled'],
  partial: ['cancelled'],
  received: [],
  cancelled: [],
};

/** Guard a product write against the plan's distinct-product cap. */
export async function assertProductCap(pool, businessId, planKey, additionalDistinct, { neutral = false } = {}) {
  const limits = limitsForPlan(planKey);
  if (limits.products == null || additionalDistinct <= 0) return;
  const used = await distinctProductCount(pool, businessId);
  if (used + additionalDistinct > limits.products) {
    throw Object.assign(
      err(403, 'product_limit', productLimitMessage(limits.products, used, { neutral })),
      { limit: limits.products, used },
    );
  }
}

// ---- Clearance + rollback pricing (migration 018, Nov 13, 2026) ----
// Business-only, like the POS till gate: the pricing fields may only
// be SET on Business (403 pricing_business_only), and reads on any
// other plan see them stripped back to defaults — held, never lost,
// applying again if the business returns to Business. The regular
// `price` is never part of this: it is retained untouched in every
// mode, and the effective price is derived client-side from the
// window (src/lib/pricing.js).
const PRICING_DEFAULTS = Object.freeze({
  pricing_mode: 'regular',
  clearance_price: null,
  sale_price: null,
  sale_start: null,
  sale_end: null,
});
const PRICING_MODES = ['regular', 'clearance', 'rollback'];

function pricingPayloadActive(values) {
  if (!values) return false;
  if (values.pricing_mode && values.pricing_mode !== 'regular') return true;
  if (values.clearance_price != null && values.clearance_price !== '') return true;
  if (values.sale_price != null && values.sale_price !== '') return true;
  if (values.sale_start || values.sale_end) return true;
  return false;
}

/** SKU generation (Nov 14, 2026): a SKU is NOT required to create
 *  a product — the owner hit the old refusal creating a product
 *  from a barcode scan, where the scan fills name + UPC and there
 *  is no SKU yet. A blank SKU is generated with the SAME scheme
 *  the spreadsheet import already uses (src/lib/csvImport.js
 *  uniqueSku): the name slug, ITEM-<n> when the name slugs to
 *  nothing, -2/-3… until unique within the business. The generated
 *  SKU is stored on the product like any typed one — visible and
 *  editable afterward. A TYPED sku keeps the catalog's uniqueness
 *  rule (the import layer's wording): duplicates are refused. */
function slugSku(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

async function generateProductSku(pool, businessId, name) {
  const { rows } = await pool.query(
    'SELECT sku FROM products WHERE business_id = $1',
    [businessId],
  );
  const taken = new Set(
    rows.map((r) => String(r.sku || '').toLowerCase()).filter(Boolean),
  );
  const base = slugSku(name) || `ITEM-${rows.length + 1}`;
  let candidate = base;
  let attempt = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}-${attempt}`;
    attempt += 1;
  }
  return candidate;
}

async function assertSkuAvailable(pool, businessId, sku) {
  const { rows } = await pool.query(
    'SELECT 1 FROM products WHERE business_id = $1 AND LOWER(sku) = LOWER($2) LIMIT 1',
    [businessId, sku],
  );
  if (rows.length) {
    throw err(400, 'sku_already_exists', `SKU ${sku} is already in the catalog.`);
  }
}

/** Product photos: at most 6 per product (the form's own promise),
 *  each a string URL. Enforced here — the one door every product
 *  write passes through — so the cap holds for imports and bulk
 *  edits too, not just the form. */
export const MAX_PRODUCT_PHOTOS = 6;
function assertPhotoUrls(values) {
  if (values.photo_urls === undefined) return;
  const urls = values.photo_urls;
  if (!Array.isArray(urls) || urls.some((u) => typeof u !== 'string')) {
    throw err(400, 'invalid_photo_urls', 'Photos must be a list of image links.');
  }
  if (urls.length > MAX_PRODUCT_PHOTOS) {
    throw err(400, 'too_many_photos', `A product can carry at most ${MAX_PRODUCT_PHOTOS} photos.`);
  }
}

function assertPricingShape(values) {
  if (values.pricing_mode !== undefined && values.pricing_mode !== null && !PRICING_MODES.includes(values.pricing_mode)) {
    throw err(400, 'invalid_value', 'Pricing mode must be regular, clearance or rollback.');
  }
  for (const field of ['clearance_price', 'sale_price']) {
    if (values[field] != null && values[field] !== '' && !(Number(values[field]) >= 0)) {
      throw err(400, 'invalid_value', 'A sale price cannot be negative.');
    }
  }
}

function stripPricing(row) {
  return { ...row, ...PRICING_DEFAULTS };
}

// Staff personal contact details (owner ruling, Nov 19, 2026):
// a member's home address and phone live on their staff record
// but are visible ONLY to the owner and to managers trusted
// with hiring (staff.manage). Everyone else — the member
// themselves included — never receives the values at all: the
// keys are removed, not blanked, so no door can render them.
function stripStaffContact(row, { stripEmail = false } = {}) {
  const copy = { ...row };
  delete copy.personal_address;
  delete copy.personal_phone;
  if (stripEmail) delete copy.email;
  return copy;
}

function canSeeStaffContact(access) {
  return access.isOwner || access.can('staff.manage');
}

/** The staff roster (owner ruling, Nov 19, 2026, answering the
 * release-314 §17 flag): the entity reads below scope every
 * non-owner to their OWN StaffMember row — unless the owner
 * has ticked the staff.roster grant for a MANAGER on their
 * member record. Whether a manager sees the whole roster is
 * the owner's choice, made per manager, and locked by default.
 * The tick follows the release-314 manager-level composition
 * (the settings.editName / settings.contactDetails ticks):
 * offered for every role, stored on any member, in effect only
 * at manager level — a staff member's stored tick stays inert
 * here. Reading only: writes keep their staff.manage door
 * (guardUpdate is untouched), and the contact strip above
 * still applies to a roster holder who lacks staff.manage. */
function canSeeRoster(access) {
  if (access.isOwner) return true;
  if (!access.can('staff.roster')) return false;
  return memberLevel(access.staffRow) === 'manager';
}

/** The returns approval gate refusal (owner ruling, Nov 19,
 * 2026). Factual, subject-only: it says who may approve and
 * finish a return and nothing else. Registered in the client's
 * apiErrors map (apiErrors.returnsCompleteReserved) so it
 * renders in the reader's language. */
export const RETURNS_COMPLETE_MESSAGE =
  'Only the owner, or a team member the owner has allowed to complete refunds and exchanges, can approve and finish a return.';

/** The add-a-location refusal (owner ruling, Nov 19, 2026).
 * Factual, subject-only: it says who may add a location and
 * nothing else. Registered in the client's apiErrors map
 * (apiErrors.locationsCreateReserved) so it renders in the
 * reader's language. */
export const LOCATIONS_CREATE_MESSAGE =
  'Only the owner, or a team member the owner has allowed to add locations, can add a location.';

/** The reorder-point save refusal (owner ruling, Nov 20,
 * 2026). Factual, subject-only: it says who may change a
 * reorder point and nothing else. Registered in the client's
 * apiErrors map (apiErrors.reorderChangeReserved) so it
 * renders in the reader's language. */
export const REORDER_CHANGE_MESSAGE =
  'Only the owner, or a team member the owner has allowed to change reorder points, can change a reorder point.';

/** The low-stock alerts refusal (owner ruling, Nov 20, 2026):
 * the alert endpoints answer a Business member without the
 * owner's alerts.view tick with this — factual, subject-only.
 * Registered in the client's apiErrors map
 * (apiErrors.alertsViewReserved) so it renders in the reader's
 * language. */
export const ALERTS_VIEW_MESSAGE =
  'Only the owner, or a team member the owner has allowed to see low-stock alerts, can see low-stock alerts.';

/**
 * Does this caller hold the reorder-point right? (Owner
 * ruling, Nov 20, 2026.) The Reorder at box stays visible to
 * everyone on Business; SAVING a changed value belongs to the
 * owner, or to a member the owner gave the products.reorder
 * enrollment tick. Off Business the right is universal —
 * Essentials has no low stock and no tick, and its stored
 * values keep round-tripping exactly as the Nov 20 sweep left
 * them. The guards below compare values themselves: a save
 * that does not change the stored point never reaches for
 * this right.
 */
function holdsReorderRight(access) {
  if (access.planKey !== 'business') return true;
  return access.isOwner || access.can('products.reorder');
}

/**
 * Is this CountSession patch one of the three floor powers?
 * (Owner ruling, Nov 19, 2026: the Stock counts page is one
 * shared board — EVERY staff member can count the stock on
 * the floor, save, and send the count for review, so nobody
 * double-counts the same count. Creating counts, approving,
 * applying and cancelling stay with counts.run exactly as
 * before.) A floor patch touches ONLY the counted lines, and
 * may move the session exactly one step: open → review (send
 * for review). A lines-only save counts only while the
 * session is still open — once a count sits in review it
 * waits for a boss, and reopening it is a counts.run act.
 * Anything else — a jump to applied or cancelled, the
 * applied stamp fields, a notes or scope edit — is not a
 * floor patch and keeps the counts.run door in guardUpdate.
 */
function isFloorCountPatch(row, patch) {
  const keys = Object.keys(patch || {});
  if (!keys.length) return false;
  if (!keys.every((key) => key === 'lines' || key === 'status')) return false;
  if (patch.lines !== undefined && !Array.isArray(patch.lines)) return false;
  if (patch.status !== undefined) {
    return row.status === 'open' && patch.status === 'review';
  }
  return row.status === 'open';
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
  // Adding a location is the owner's job (owner ruling, Nov 19,
  // 2026): a Location CREATE belongs to the owner, or to a member
  // the owner gave the locations.create enrollment tick — a
  // manager included holds it only by that tick, never by role.
  // locations.manage alone no longer opens this door; it still
  // governs editing and deleting (guardUpdate / deleteEntity are
  // untouched), exactly as her ruling covers ADDING only.
  if (name === 'Location' && !access.isOwner && !access.can('locations.create')) {
    throw err(403, 'locations_create_not_granted', LOCATIONS_CREATE_MESSAGE);
  }
  // Product creation is the one create door the owner can hand to
  // a member at enrollment (the products.create tick — the owner's
  // "no dangling doors" ruling, Nov 19, 2026): creating a product
  // takes products.edit OR that tick, with the same refusal
  // otherwise. Editing an existing product still takes
  // products.edit alone (guardUpdate is untouched), the Adjust
  // door keeps its own products.edit gate, and every other entity
  // keeps its single writePerm door exactly as before. A Location
  // create that passed the gate above may belong to a tick-holder
  // without locations.manage, so the tick satisfies this check too.
  const mayCreate =
    access.can(def.writePerm)
    || (name === 'Product' && access.can('products.create'))
    || (name === 'Location' && access.can('locations.create'));
  if (def.writePerm && !mayCreate) {
    throw err(403, 'forbidden', 'You do not have permission to do that here.');
  }
  for (const field of def.required) {
    if (values[field] === undefined || values[field] === null || String(values[field]).trim() === '') {
      throw err(400, 'invalid_value', `Field ${field} is required.`);
    }
  }
  if (name === 'PurchaseOrder') {
    // Never silently ordered: every order starts as a draft, whatever
    // the browser asked for. It moves to `ordered` only through the
    // guarded transition (update) — see guardUpdate.
    values.status = 'draft';
    // And never pre-sent: the send record belongs to the send
    // endpoint alone (server/business.js sendPurchaseOrder).
    values.sent_at = null;
    values.sent_to = '';
    values.send_count = 0;
    const supplier = (
      await pool.query('SELECT id FROM suppliers WHERE id = $1 AND business_id = $2', [
        values.supplier_id,
        business.id,
      ])
    ).rows[0];
    if (!supplier) throw err(400, 'invalid_reference', 'The supplier must belong to this business.');
    const lines = await validatePoLines(pool, business, values, {
      allowZeroCost: values.allow_zero_cost === true,
    });
    const totals = poTotalsFor(lines, values.shipping, values.tax);
    values.subtotal = totals.subtotal;
    values.total = totals.total;
    // Received quantities always start at zero on create.
    values.lines = lines.map((line) => ({ ...line, qty_received: 0 }));
  }
  if (name === 'Bom') {
    values.kind = values.kind || 'bundle';
    await validateBom(pool, business, values.product_id, values.kind, values.lines);
  }
  if (name === 'Return') {
    // Returns approval gate (owner ruling, Nov 19, 2026): a
    // return is BORN waiting. Only the owner, or a member the
    // owner gave the returns.complete grant, may bring one into
    // the world already approved or completed — anyone else's
    // create starts at 'new', whatever the caller sent (the
    // PurchaseOrder draft force above is the house pattern).
    if (
      ['approved', 'completed'].includes(values.status)
      && !access.isOwner
      && !access.can('returns.complete')
    ) {
      values.status = 'new';
    }
  }
  if (name === 'Product') {
    // Reorder-point gate (owner ruling, Nov 20, 2026): a
    // product BORN with a reorder point is a reorder point
    // being set. On Business that takes the owner, or a member
    // the owner gave the products.reorder tick — the value is
    // refused, never silently stripped (refusals over silent
    // changes is the house rule). A product born at the
    // default (no point) needs no tick, and off Business the
    // value stores exactly as it always has.
    if (
      !holdsReorderRight(access)
      && values.reorder_point !== undefined
      && values.reorder_point !== null
      && values.reorder_point !== ''
      && Number(values.reorder_point) !== 0
    ) {
      throw err(403, 'reorder_change_not_granted', REORDER_CHANGE_MESSAGE);
    }
    if (pricingPayloadActive(values) && !featureAllowed(planKey, 'pricing')) {
      throw err(403, 'pricing_business_only', 'Clearance and rollback pricing is part of the Business plan.');
    }
    assertPricingShape(values);
    assertPhotoUrls(values);
    if (!String(values.sku || '').trim()) {
      values.sku = await generateProductSku(pool, business.id, values.name);
    } else {
      await assertSkuAvailable(pool, business.id, String(values.sku).trim());
    }
    // The incoming row consumes a cap slot unless it is a copy —
    // its status is irrelevant: an original born archived counts
    // exactly like an active one (owner's counting rule, Nov 14,
    // 2026 — archiving never frees a slot).
    await assertProductCap(pool, business.id, planKey, isDuplicateProductRow(values) ? 0 : 1, { neutral: !access.isOwner });
  }
  if (name === 'Location' && isOperatingSite(values)) {
    const limits = limitsForPlan(planKey);
    if (limits.sites != null) {
      const used = await operatingSiteCount(pool, business.id);
      if (used >= limits.sites) throw err(403, 'site_limit', siteLimitMessage(limits.sites, { neutral: !access.isOwner }));
    }
  }
  if (name === 'StockLevel') {
    if (Number(values.quantity ?? 0) < 0 || Number(values.reserved ?? 0) < 0) {
      throw err(400, 'invalid_quantity', 'Stock levels can never be negative.');
    }
    const product = (await pool.query('SELECT id, status, name FROM products WHERE id = $1 AND business_id = $2', [values.product_id, business.id])).rows[0];
    const location = (await pool.query('SELECT id FROM locations WHERE id = $1 AND business_id = $2', [values.location_id, business.id])).rows[0];
    if (!product || !location) throw err(400, 'invalid_reference', 'The product and location must belong to this business.');
    // Archived products are frozen (Nov 14, 2026): no level write.
    if (product.status === 'archived') {
      throw err(400, 'product_archived', `${product.name || 'This product'} is archived, so its stock is frozen. Restore it to active to move its stock again.`);
    }
  }
  if (name === 'StockMovement') {
    if (BUNDLE_MOVEMENT_TYPES.includes(values.type) && !featureAllowed(planKey, 'builds')) {
      throw err(403, 'bundle_business_only', 'Bundle movements are a Business feature — building bundles and taking them apart need the Business plan.');
    }
    if (!(Number(values.quantity) >= 0)) throw err(400, 'invalid_quantity', 'A movement quantity must be zero or more.');
    if (values.product_id) {
      const product = (await pool.query('SELECT id, status, name FROM products WHERE id = $1 AND business_id = $2', [values.product_id, business.id])).rows[0];
      if (!product) throw err(400, 'invalid_reference', 'The product must belong to this business.');
      // Archived products are frozen (Nov 14, 2026): no ledger write.
      if (product.status === 'archived') {
        throw err(400, 'product_archived', `${product.name || 'This product'} is archived, so its stock is frozen. Restore it to active to move its stock again.`);
      }
    }
  }
  if (name === 'StaffRole' && planKey !== 'business') {
    throw err(403, 'custom_roles_business_only', customRolesBusinessOnlyMessage({ neutral: !access.isOwner }));
  }
}

async function guardUpdate(pool, def, name, access, row, patch) {
  const { planKey } = access;
  if (def.planGate && !featureAllowed(planKey, def.planGate)) {
    throw err(403, 'plan_gated', 'This feature is part of the Business plan.');
  }
  if (name === 'Entitlement') throw err(403, 'entitlement_read_only', 'Entitlements are managed by billing (T4).');
  if (def.writePerm && !access.can(def.writePerm)) {
    // The counts floor exception (owner ruling, Nov 19, 2026):
    // a CountSession patch that is only counting, saving or
    // sending for review is open to every member of the
    // business — the shared board. Everything else on a count
    // (create, apply, reopen, cancel, delete, any other field)
    // keeps the counts.run door.
    const floorCount = name === 'CountSession' && isFloorCountPatch(row, patch);
    if (!floorCount) {
      throw err(403, 'forbidden', 'You do not have permission to do that here.');
    }
  }
  // Audit Finding 36: role edit has no plan check — a custom role left
  // over from a downgrade could be edited on Essentials, bypassing
  // the create guard. Custom roles are Business-only, full stop.
  if (name === 'StaffRole' && planKey !== 'business') {
    throw err(403, 'custom_roles_business_only', customRolesBusinessOnlyMessage({ neutral: !access.isOwner }));
  }
  if (name === 'Product') {
    // Reorder-point gate (owner ruling, Nov 20, 2026): the
    // Reorder at box stays visible to everyone on Business,
    // but SAVING a different value belongs to the owner, or
    // to a member the owner gave the products.reorder tick.
    // The comparison is against the stored row, so a save
    // that leaves the point untouched — the ordinary product
    // edit — goes through on the normal edit right, and the
    // bulk-edit write path (one guarded update per product)
    // is held to exactly the same line.
    if (
      !holdsReorderRight(access)
      && patch.reorder_point !== undefined
      && Number(patch.reorder_point ?? 0) !== Number(row.reorder_point ?? 0)
    ) {
      throw err(403, 'reorder_change_not_granted', REORDER_CHANGE_MESSAGE);
    }
    if (pricingPayloadActive(patch) && !featureAllowed(planKey, 'pricing')) {
      throw err(403, 'pricing_business_only', 'Clearance and rollback pricing is part of the Business plan.');
    }
    assertPricingShape(patch);
    assertPhotoUrls(patch);
  }
  if (name === 'StockLevel') {
    // Archived products are frozen (Nov 14, 2026): the level row of
    // an archived product cannot be rewritten until it is restored.
    const product = (await pool.query('SELECT status, name FROM products WHERE id = $1 AND business_id = $2', [row.product_id, access.business.id])).rows[0];
    if (product?.status === 'archived') {
      throw err(400, 'product_archived', `${product.name || 'This product'} is archived, so its stock is frozen. Restore it to active to move its stock again.`);
    }
  }
  if (name === 'PurchaseOrder') {
    const current = row;
    if (patch.sent_at !== undefined || patch.sent_to !== undefined || patch.send_count !== undefined) {
      throw err(400, 'po_send_via_endpoint', 'The sent record changes only when an order is sent to the supplier, not by editing the order.');
    }
    if (patch.status && patch.status !== current.status) {
      if (['partial', 'received'].includes(patch.status)) {
        throw err(400, 'invalid_po_status', 'Received progress is set by receiving stock, not by editing the order.');
      }
      if (!(PO_EDIT_TRANSITIONS[current.status] || []).includes(patch.status)) {
        throw err(400, 'invalid_po_status', `A ${current.status} order cannot move to ${patch.status}.`);
      }
    }
    if (Array.isArray(patch.lines)) {
      const existing = Array.isArray(current.lines) ? current.lines : [];
      const existingById = new Map(existing.map((l) => [l.product_id, l]));
      for (const line of patch.lines) {
        if (!(Number(line.qty_ordered) > 0)) {
          throw err(400, 'invalid_quantity', 'Every order line needs a quantity greater than zero.');
        }
        const prev = existingById.get(line.product_id);
        if (prev && Number(line.qty_received ?? 0) !== Number(prev.qty_received ?? 0)) {
          throw err(400, 'po_receive_via_endpoint', 'Received quantities change only when stock is received, not by editing the order.');
        }
        if (Number(line.qty_ordered) < Number(line.qty_received ?? 0)) {
          throw err(400, 'invalid_quantity', 'The ordered quantity cannot drop below what already arrived.');
        }
      }
      await validatePoLines(pool, access.business, patch, {
        allowZeroCost: patch.allow_zero_cost === true,
      });
      const totals = poTotalsFor(patch.lines, patch.shipping ?? current.shipping, patch.tax ?? current.tax);
      patch.subtotal = totals.subtotal;
      patch.total = totals.total;
    }
  }
  if (name === 'Bom') {
    await validateBom(
      pool,
      access.business,
      patch.product_id ?? row.product_id,
      patch.kind ?? row.kind,
      patch.lines ?? row.lines,
    );
  }
  if (name === 'Return') {
    // Returns approval gate (owner ruling, Nov 19, 2026):
    // logging a return is returns.manage work, but APPROVING or
    // COMPLETING one — the step that finishes a refund or an
    // exchange — belongs to the owner, or to a member the owner
    // granted returns.complete at enrollment. The grant follows
    // the release-314 tick pattern: it lives in the member's
    // stored permissions array and in NO role, so nobody holds
    // it by accident — a manager included. Edits, rejection and
    // deletion stay returns.manage work, exactly as before.
    const next = patch.status;
    if (
      next
      && next !== row.status
      && (next === 'approved' || next === 'completed')
      && !access.isOwner
      && !access.can('returns.complete')
    ) {
      throw err(403, 'returns_complete_not_granted', RETURNS_COMPLETE_MESSAGE);
    }
  }
  if (name === 'StaffMember') {
    // A staff member may never raise their own permissions; only the
    // owner or a staff-manager may change a member row.
    if (!access.isOwner && !access.can('staff.manage')) {
      throw err(403, 'forbidden', 'You do not have permission to manage staff here.');
    }
    // Recovery kit (T7): an email CHANGE never goes through the plain
    // edit. The email is the person's identity — it keys their
    // account, their rows at OTHER businesses and their trial
    // history — so it moves only through the owner's email-fix flow,
    // which carries all of it atomically. (An unchanged email in the
    // patch is fine: the Staff dialog always sends the field.)
    if (
      patch.email !== undefined
      && String(patch.email).trim().toLowerCase() !== String(row.email || '').trim().toLowerCase()
    ) {
      throw err(
        400,
        'staff_email_change',
        "Use the email fix on the Staff page to change a team member's email — it moves their account, their other stores and their trial history with it. A plain edit would strand them under the old address.",
      );
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
  const def = entityDef(name);
  if (!def) throw err(404, 'unknown_entity', `Unknown entity ${name}.`);
  const wantedIds = businessIdsFromFilter(filter);
  const accessible = wantedIds.length ? wantedIds : await accessibleBusinessIds(pool, user);
  const rows = [];
  for (const businessId of accessible) {
    const access = await resolveAccess(pool, user, businessId);
    if (!access) continue;
    // Default-location heal (Nov 14, 2026): a business found with
    // zero locations gains its one store location before the list
    // is read, so no stock surface ever shows an empty picker.
    // Businesses that have locations are never touched.
    if (name === 'Location') {
      await ensureDefaultLocation(pool, businessId, user.id);
    }
    // Subscription access gate (2026-11-13): an unpaid workspace
    // contributes NO rows; in grace only the grace view's entities
    // (products + stock levels) are readable. The Entitlement entity
    // itself stays readable — it is how the client learns the state.
    // A list that explicitly targets this business gets the hard 403;
    // an unscoped portfolio list simply skips it, like a business
    // the caller cannot access at all.
    if (name !== 'Entitlement') {
      const gate = await subscriptionAccessFor(pool, user, businessId);
      if (gate.state === 'denied') {
        if (wantedIds.length) throw subscriptionDeniedError(gate, user);
        continue;
      }
      if (gate.state === 'grace' && gate.reason !== 'failed_payment_view_only' && !GRACE_READABLE_ENTITIES.has(name)) {
        if (wantedIds.length) throw graceReadOnlyError(gate, user);
        continue;
      }
    }
    if (def.planGate && !featureAllowed(access.planKey, def.planGate)) continue;
    let businessRows = await fetchBusinessRows(pool, def, businessId);
    if (name === 'Product' && !featureAllowed(access.planKey, 'pricing')) {
      // Pricing is Business-only: off-Business reads see the fields
      // held at defaults (kept in the row, inert — migration 018).
      businessRows = businessRows.map(stripPricing);
    }
    if (name === 'StaffMember' && !access.isOwner && !canSeeRoster(access)) {
      // Staff read-by-email: a non-owner sees only their own row, and
      // only when that row is trusted (owner-created or chained).
      // A manager the owner gave the staff roster (canSeeRoster)
      // skips this filter and reads the business's full roster —
      // the same rows the owner sees; the contact strip below
      // still applies to them.
      businessRows = businessRows.filter((row) => String(row.email || '').toLowerCase() === String(user.email || '').toLowerCase());
      const trusted = [];
      for (const row of businessRows) {
        if (await isTrustedStaffRow(pool, access.business, row)) trusted.push(row);
      }
      businessRows = trusted;
    }
    if (name === 'StaffMember' && !canSeeStaffContact(access)) {
      // Personal contact details stay behind the hiring gate
      // (owner ruling, Nov 19, 2026) — see stripStaffContact.
      // Roster-only viewers (the release-322 roster tick, no
      // staff.manage) also lose each OTHER member's email: the
      // roster is a names-and-roles view for them (audit A6/B9,
      // Nov 21, 2026). A member's own row keeps their own email.
      businessRows = businessRows.map((row) =>
        stripStaffContact(row, {
          stripEmail:
            canSeeRoster(access) &&
            String(row.email || '').toLowerCase() !== String(user.email || '').toLowerCase(),
        }),
      );
    }
    if (name === 'StaffMember' && access.planKey === 'essentials') {
      // One-store auto-assignment, read side (owner's ruling,
      // Nov 21, 2026): an Essentials member whose pick is empty
      // reads as assigned to the business's one store, so
      // members added before the rule — or through any door —
      // show their store without the owner re-editing everyone.
      // Display only: the stored row is never rewritten here.
      const store = await singleStoreLocation(pool, businessId);
      if (store) {
        businessRows = businessRows.map((row) => (row.location_id
          ? row
          : { ...row, location_id: store.id, location_name: store.name || row.location_name || '' }));
      }
    }
    if (!access.isOwner) {
      // Attribution fields carry names, never emails, to a
      // non-owner (rider + audit, Nov 21, 2026); the creator
      // stamp is never served to a non-owner at all.
      businessRows = await shapeAttribution(pool, access, name, businessRows);
      businessRows = businessRows.map(stripCreatedBy);
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
  const def = entityDef(name);
  if (!def) throw err(404, 'unknown_entity', `Unknown entity ${name}.`);
  const { rows } = await pool.query(`SELECT * FROM ${def.table} WHERE id = $1 LIMIT 1`, [id]);
  let row = rows[0];
  if (!row) throw err(404, 'not_found', 'Not found.');
  const access = await resolveAccess(pool, user, row.business_id);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  // Subscription access gate (2026-11-13): single-row reads obey the
  // same rule as lists. Entitlement reads are exempt (state discovery).
  if (name !== 'Entitlement') {
    await assertSubscriptionAccess(pool, user, row.business_id, {
      graceRead: GRACE_READABLE_ENTITIES.has(name),
      broadRead: true,
    });
  }
  if (def.planGate && !featureAllowed(access.planKey, def.planGate)) {
    throw err(403, 'plan_gated', 'This feature is part of the Business plan.');
  }
  if (name === 'StaffMember' && access.planKey === 'essentials' && !row.location_id) {
    // One-store auto-assignment, read side — same rule as the
    // list path above (Nov 21, 2026): display only.
    const store = await singleStoreLocation(pool, row.business_id);
    if (store) {
      row = { ...row, location_id: store.id, location_name: store.name || row.location_name || '' };
    }
  }
  if (name === 'Product' && !featureAllowed(access.planKey, 'pricing')) {
    const shaped = publicRow(def, stripPricing(row));
    return access.isOwner ? shaped : stripCreatedBy(shaped);
  }
  if (name === 'StaffMember' && !access.isOwner && !canSeeRoster(access)) {
    if (String(row.email || '').toLowerCase() !== String(user.email || '').toLowerCase()) {
      throw err(403, 'forbidden', 'You can only read your own staff record.');
    }
    if (!(await isTrustedStaffRow(pool, access.business, publicRow(def, row)))) {
      throw err(403, 'forbidden', 'You can only read your own staff record.');
    }
  }
  if (name === 'StaffMember' && !canSeeStaffContact(access)) {
    // This branch is non-owner by construction (canSeeStaffContact
    // covers the owner and staff.manage), so the creator stamp is
    // stripped here too.
    return stripCreatedBy(
      publicRow(
        def,
        stripStaffContact(row, {
          stripEmail:
            canSeeRoster(access) &&
            String(row.email || '').toLowerCase() !== String(user.email || '').toLowerCase(),
        }),
      ),
    );
  }
  if (!access.isOwner) {
    const shaped = publicRow(def, row);
    await shapeAttribution(pool, access, name, [shaped]);
    return stripCreatedBy(shaped);
  }
  return publicRow(def, row);
}

export async function createEntity(pool, user, name, values) {
  const def = entityDef(name);
  if (!def) throw err(404, 'unknown_entity', `Unknown entity ${name}.`);
  const businessId = values?.business_id;
  if (!businessId) throw err(400, 'invalid_value', 'business_id is required.');
  const access = await resolveAccess(pool, user, businessId);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  await assertSubscriptionAccess(pool, user, businessId, { write: true });
  if (name === 'StaffMember') {
    if (!access.isOwner && !access.can('staff.manage')) {
      throw err(403, 'forbidden', 'You are not allowed to manage staff here.');
    }
    const row = await createStaffMember(pool, {
      business: access.business,
      planKey: access.planKey,
      caller: user,
      member: values,
      actor: {
        userId: user.id,
        staffId: access.staffRow?.id ?? null,
        name: access.isOwner ? await ownerPublicName(pool, access.business) : access.staffRow?.full_name || user.email,
      },
    });
    return publicRow(def, row);
  }
  await guardCreate(pool, def, name, access, values);
  if (name === 'CountSession') {
    // Attribution is stamped by the server, never taken from
    // the client (rider, Nov 21, 2026): the starter's display
    // name, so the shared board can never show an email.
    values = { ...values, started_by: await countActorName(pool, access) };
  } else {
    values = await stampAttribution(pool, access, name, values);
  }
  const createdRow = await insertRow(pool, def, businessId, user, values);
  // The 90-day customer address book: an order save remembers /
  // refreshes the customer's reusable ship-to address. Never
  // allowed to fail the order itself.
  if (name === 'Order') {
    try {
      await rememberOrderAddress(pool, createdRow);
    } catch {
      /* the address book is a convenience, never a blocker */
    }
  }
  return createdRow;
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
  await assertSubscriptionAccess(pool, user, businessId, { write: true });
  if (name === 'StaffMember') throw err(400, 'invalid_value', 'Invite staff members one at a time.');
  if (name === 'Product') {
    // Only distinct originals consume cap slots — copies and
    // archived rows alike follow the one counting rule (see
    // distinctProductCount): copies never count, archived
    // originals always do.
    const additional = rows.filter((row) => !isDuplicateProductRow(row)).length;
    await assertProductCap(pool, businessId, access.planKey, additional, { neutral: !access.isOwner });
  }
  const created = [];
  for (const row of rows) {
    await guardCreate(pool, def, name, access, row);
    const stamped = name === 'CountSession'
      ? { ...row, started_by: await countActorName(pool, access) }
      : await stampAttribution(pool, access, name, row);
    created.push(await insertRow(pool, def, businessId, user, stamped));
  }
  return created;
}

export async function updateEntity(pool, user, name, id, patch) {
  const def = entityDef(name);
  if (!def) throw err(404, 'unknown_entity', `Unknown entity ${name}.`);
  const { rows } = await pool.query(`SELECT * FROM ${def.table} WHERE id = $1 LIMIT 1`, [id]);
  const row = rows[0];
  if (!row) throw err(404, 'not_found', 'Not found.');
  const access = await resolveAccess(pool, user, row.business_id);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  await assertSubscriptionAccess(pool, user, row.business_id, { write: true });
  const publicExisting = publicRow(def, row);
  await guardUpdate(pool, def, name, access, publicExisting, patch);
  // Attribution fields in any patch are stamped with the
  // patcher's display name (rider + audit, Nov 21, 2026): a
  // "…by" field names the person who did it, never their email.
  patch = await stampAttribution(pool, access, name, patch);
  if (name === 'StaffMember' && Object.hasOwn(patch, 'location_id')) {
    // Their store resolves exactly as at creation (owner's
    // ruling, Nov 21, 2026): a shelf pick becomes its store,
    // and clearing the pick on Essentials re-assigns the one
    // store instead of leaving the member store-less.
    const store = await resolveMemberStore(pool, {
      businessId: row.business_id,
      planKey: access.planKey,
      locationId: patch.location_id || null,
      locationName: patch.location_name ?? publicExisting.location_name ?? '',
    });
    patch = { ...patch, location_id: store.id, location_name: store.name };
  }
  // No cap check on a status change: an archived original never
  // left the count (owner's counting rule, Nov 14, 2026 — archive
  // is a shelf, not a shredder), so restoring it can never breach
  // the cap, and archiving one can never free a slot.
  const dbValues = toDbValues(def, patch);
  dbValues.updated_at = new Date().toISOString();
  const columns = Object.keys(dbValues);
  if (!columns.length) return publicExisting;
  const sets = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');
  const updated = await pool.query(
    `UPDATE ${def.table} SET ${sets} WHERE id = $${columns.length + 1} RETURNING *`,
    [...columns.map((col) => dbValues[col]), id],
  );
  const result = publicRow(def, updated.rows[0]);
  // Training flag (owner's rule): when a person's role or permissions
  // GROW — directly on their member row, or through their role —
  // lessons for the new parts are assigned and their bell rings. The
  // hooks diff effective permissions and never throw into this write.
  if (name === 'StaffMember' || name === 'StaffRole') {
    const actor = {
      userId: user.id,
      staffId: access.staffRow?.id ?? null,
      name: access.isOwner ? await ownerPublicName(pool, access.business) : access.staffRow?.full_name || user.email,
    };
    const hookArgs = { business: access.business, planKey: access.planKey, before: publicExisting, after: result, actor };
    if (name === 'StaffMember') await trainingFlagForMemberChange(pool, hookArgs);
    else await trainingFlagForRoleChange(pool, hookArgs);
  }
  if (name === 'Order') {
    try {
      await rememberOrderAddress(pool, result);
    } catch {
      /* the address book is a convenience, never a blocker */
    }
  }
  if (!access.isOwner) {
    // The update response obeys the same read rule: attribution
    // resolved to names, creator stamp withheld (Nov 21, 2026).
    await shapeAttribution(pool, access, name, [result]);
    return stripCreatedBy(result);
  }
  return result;
}

export async function deleteEntity(pool, user, name, id) {
  const def = entityDef(name);
  if (!def) throw err(404, 'unknown_entity', `Unknown entity ${name}.`);
  const { rows } = await pool.query(`SELECT * FROM ${def.table} WHERE id = $1 LIMIT 1`, [id]);
  const row = rows[0];
  if (!row) throw err(404, 'not_found', 'Not found.');
  const access = await resolveAccess(pool, user, row.business_id);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  await assertSubscriptionAccess(pool, user, row.business_id, { write: true });
  if (name === 'StaffMember') {
    // PR #63 follow-up (b): the owner may delete ANY StaffMember row
    // on their own business — including attacker-created ones.
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the business owner can remove a staff member.');
    // Offboarding: removal is complete or it does not happen. The
    // member's direct-deposit bank details are purged in the same
    // transaction as the row delete — explicitly, not left to the
    // migration-007 cascade, so the purge holds wherever this code
    // runs. Access itself needs no session surgery: resolveAccess
    // re-reads this row on every request, so the member's very next
    // request with an existing session resolves to no access.
    // The books stay: pay stubs and time entries keep their rows
    // (migration 010 removed their staff cascades).
    await withTx(pool, async (client) => {
      await client.query(
        'DELETE FROM direct_deposit_details WHERE business_id = $1 AND staff_member_id = $2',
        [row.business_id, id],
      );
      // Their sealed direct-deposit forms go too (Nov 21, 2026):
      // a sealed form carries the same bank numbers as the details
      // row, so it shares the details' fate — purged in the same
      // transaction, never kept as a souvenir.
      await client.query(
        'DELETE FROM direct_deposit_submissions WHERE business_id = $1 AND staff_member_id = $2',
        [row.business_id, id],
      );
      // Their profile photo goes with them (Nov 21, 2026): the
      // approved and pending bytes alike — a removed member's
      // face is not kept on file.
      await client.query(
        'DELETE FROM profile_photos WHERE business_id = $1 AND person_key = $2',
        [row.business_id, id],
      );
      // The workspace-list link goes too (Nov 15, 2026): the member's
      // business_memberships row is deleted in the same transaction,
      // so the workspace leaves their list at once and a later
      // sign-in cannot resurrect it (ensureStaffMemberships only
      // materializes memberships for ACTIVE staff rows).
      const memberUser = (
        await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [row.email])
      ).rows[0];
      if (memberUser) {
        await client.query(
          "DELETE FROM business_memberships WHERE business_id = $1 AND user_id = $2 AND role = 'member'",
          [row.business_id, memberUser.id],
        );
      }
      await client.query(`DELETE FROM ${def.table} WHERE id = $1`, [id]);
    });
    return { ok: true, id };
  } else if (name === 'Entitlement') {
    throw err(403, 'entitlement_read_only', 'Entitlements are managed by billing (T4).');
  } else if (name === 'StaffRole' && access.planKey !== 'business') {
    // Audit Finding 36: role delete has no plan check either.
    throw err(403, 'custom_roles_business_only', customRolesBusinessOnlyMessage({ neutral: !access.isOwner }));
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
