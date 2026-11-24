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
import { ownerPublicName, attributionNameMap, attributionName, trailActorNameMap } from './profilePhotos.js';
import {
  limitsForPlan,
  planFor,
  featureAllowed,
  isOperatingSite,
  productLimitMessage,
  siteLimitMessage,
  customRolesBusinessOnlyMessage,
  BUNDLE_MOVEMENT_TYPES,
  entitlementInheritance,
} from './plans.js';
import { createStaffMember, staffSeatCount, resolveMemberStore, singleStoreLocation } from './staff.js';
import {
  recipeCostPerMake,
  recipeCostPerUnit,
  depleteForSaleTx,
  depleteForRecipeTx,
  restoreDepletionsTx,
  activeRecipeForProduct,
  yieldQtyOf,
} from './recipes.js';
import { recordMovementTx } from './movements.js';
import { computeInvoiceMatch, priceAlertCandidates } from './restaurantOps.js';
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
    // allergens + unit_conversions join the json list with
    // release 361 (migration 048): both are JSON arrays stored
    // in TEXT columns, parsed on read like tags/custom_fields.
    json: ['variant_options', 'photo_urls', 'tags', 'custom_fields', 'allergens', 'unit_conversions'],
    numeric: ['cost', 'price', 'reorder_point', 'clearance_price', 'sale_price', 'shelf_life_days'],
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
  // The restaurant corner (release 359, Nov 23, 2026):
  // Business-only, under its own plan gate so Essentials lists
  // skip it silently and single reads refuse — no trace. Reads
  // are the free view base (any trusted member); WRITES ride
  // the owner's enrollment ticks, which live in the member's
  // permissions array exactly where access.can looks (the
  // owner's can() is always true). Recipe money is shaped at
  // read time (shapeRecipeMoney): cost figures ride the row
  // only for the owner or a restaurant.money tick holder.
  Recipe: {
    table: 'recipes',
    json: ['lines'],
    numeric: ['yield_qty', 'q_factor_pct'],
    bool: [],
    required: ['name'],
    planGate: 'restaurant',
    writePerm: 'restaurant.build',
  },
  Par: {
    table: 'pars',
    json: [],
    numeric: ['par_qty', 'pack_size'],
    bool: [],
    required: ['product_id'],
    planGate: 'restaurant',
    writePerm: 'restaurant.pars',
  },
  // Restaurant operations (release 361, Nov 23, 2026;
  // migration 048). All planGate 'restaurant' like the 359
  // foundation. The FORK on gates (flagged in the record):
  // no new ticks — BUILDING and MONEY doors ride the existing
  // ticks (invoices, batches, batch runs and price-alert
  // answers take restaurant.build), while the DAILY-LOG
  // writes (waste, temp logs, the 86 board, staff meals)
  // carry NO writePerm at all: any trusted member of the
  // business may log them, because logging dies when it
  // needs permission. Reads stay the free view base.
  StockBatch: {
    table: 'stock_batches',
    json: [],
    numeric: ['quantity'],
    bool: [],
    required: ['product_id'],
    planGate: 'restaurant',
    writePerm: 'restaurant.build',
  },
  WasteEntry: {
    table: 'waste_entries',
    json: [],
    numeric: ['quantity', 'unit_cost'],
    bool: [],
    required: ['product_id'],
    planGate: 'restaurant',
    // No writePerm — see the fork note above. Money shaping:
    // unit_cost is stripped and total_cost never attached for
    // anyone but the owner / a restaurant.money holder
    // (shapeWasteMoney, the shapeRecipeMoney pattern).
  },
  TempLog: {
    table: 'temp_logs',
    json: [],
    numeric: ['temperature'],
    bool: ['in_range'],
    required: ['unit_name'],
    planGate: 'restaurant',
    // No writePerm — daily log (see the fork note above).
  },
  EightySixItem: {
    table: 'eighty_six_items',
    json: [],
    numeric: [],
    bool: ['active'],
    required: ['product_id'],
    planGate: 'restaurant',
    // No writePerm — daily log (see the fork note above).
  },
  SupplierInvoice: {
    table: 'supplier_invoices',
    json: ['lines'],
    numeric: ['total'],
    bool: [],
    required: ['supplier_name'],
    planGate: 'restaurant',
    writePerm: 'restaurant.build',
  },
  VendorPriceAlert: {
    table: 'vendor_price_alerts',
    json: [],
    numeric: ['old_cost', 'new_cost'],
    bool: [],
    required: ['product_id'],
    planGate: 'restaurant',
    writePerm: 'restaurant.build',
  },
  BatchRun: {
    table: 'batch_runs',
    json: ['lines'],
    numeric: ['makes', 'output_qty'],
    bool: [],
    required: ['recipe_id'],
    planGate: 'restaurant',
    writePerm: 'restaurant.build',
  },
  StaffMeal: {
    table: 'staff_meals',
    json: [],
    numeric: ['quantity'],
    bool: [],
    required: ['product_id'],
    planGate: 'restaurant',
    // No writePerm — daily log (see the fork note above). The
    // create hook writes the staff_meal stock-out movement.
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
    numeric: ['refund_amount', 'tax_amount'],
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
    if (key === 'trail_actors') continue; // output-only (release 357): resolved actor names, never a column
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
 * Time trails (release 357, Nov 23, 2026 — the owner's spec:
 * every record that moves through stages carries DATE + TIME
 * stamps, and orders record WHO performed each stage). The
 * stage stamps live on the record itself (migration 045) and
 * are written ONLY here, at the transition, from the server's
 * own clock and the caller's session — a stamp the browser
 * sends is stripped, never trusted (the pre-357 client wrote
 * shipped_at / approved_at / applied_at itself, and Packed /
 * Delivered / Rejected / Sent-for-review / Saved / Cancelled
 * had no stamp at all). A stamp fires when a write moves the
 * record INTO the stage (patch.status differs from the stored
 * status); re-saving the same status never re-stamps. A count
 * write that carries lines without entering Applied/Cancelled
 * is a draft save — the save event the count lifecycle already
 * distinguishes — and stamps the Saved stage (the submit and
 * reopen writes carry lines too, and stamp it alongside).
 * Existing records keep honest history: nothing is backfilled,
 * and a trail shows the stamps it truly has.
 */
const TRAIL_STAGES = {
  Order: [
    { key: 'packed', at: 'packed_at', by: 'packed_by', byId: 'packed_by_id', status: 'packed' },
    { key: 'shipped', at: 'shipped_at', by: 'shipped_by', byId: 'shipped_by_id', status: 'shipped' },
    { key: 'delivered', at: 'delivered_at', by: 'delivered_by', byId: 'delivered_by_id', status: 'delivered' },
    { key: 'cancelled', at: 'cancelled_at', by: 'cancelled_by', byId: 'cancelled_by_id', status: 'cancelled' },
  ],
  Return: [
    { key: 'approved', at: 'approved_at', by: 'approved_by', byId: 'approved_by_id', status: 'approved' },
    { key: 'completed', at: 'completed_at', by: 'completed_by', byId: 'completed_by_id', status: 'completed' },
    { key: 'rejected', at: 'rejected_at', by: 'rejected_by', byId: 'rejected_by_id', status: 'rejected' },
  ],
  CountSession: [
    { key: 'review', at: 'review_at', by: 'review_by', byId: 'review_by_id', status: 'review' },
    { key: 'applied', at: 'applied_at', by: 'applied_by', byId: 'applied_by_id', status: 'applied' },
    { key: 'cancelled', at: 'cancelled_at', by: 'cancelled_by', byId: 'cancelled_by_id', status: 'cancelled' },
  ],
};
const TRAIL_SAVED_STAGE = { key: 'saved', at: 'saved_at', by: 'saved_by', byId: 'saved_by_id' };
/** Every client-writable field the trail owns, per entity —
 *  stripped from any incoming write before stamping. */
const TRAIL_FIELDS = Object.fromEntries(
  Object.entries(TRAIL_STAGES).map(([name, stages]) => [
    name,
    [
      ...stages.flatMap((stage) => [stage.at, stage.by, stage.byId]),
      ...(name === 'CountSession' ? [TRAIL_SAVED_STAGE.at, TRAIL_SAVED_STAGE.by, TRAIL_SAVED_STAGE.byId] : []),
    ],
  ]),
);
/** The actor id field per trail stage, for read-time name
 *  resolution (the created stage rides the creator audit id). */
const TRAIL_ACTOR_IDS = Object.fromEntries(
  Object.entries(TRAIL_STAGES).map(([name, stages]) => [
    name,
    [
      ['created', 'created_by_id'],
      ...stages.map((stage) => [stage.key, stage.byId]),
      ...(name === 'CountSession' ? [[TRAIL_SAVED_STAGE.key, TRAIL_SAVED_STAGE.byId]] : []),
    ],
  ]),
);

function stripTrailFields(entityName, values) {
  const fields = TRAIL_FIELDS[entityName];
  if (!fields || !values) return values;
  if (!fields.some((field) => field in values)) return values;
  const out = { ...values };
  for (const field of fields) delete out[field];
  return out;
}

/** Stamp the stages an UPDATE enters (see the block comment
 *  above). `row` is the stored row (public shape) before the
 *  write; `patch` is already trail-stripped. */
async function stampTrailUpdate(pool, access, entityName, row, patch, user) {
  const stages = TRAIL_STAGES[entityName];
  if (!stages || !patch) return patch;
  const entering = patch.status && patch.status !== row.status ? patch.status : null;
  const stage = entering ? stages.find((s) => s.status === entering) : null;
  const isSave =
    entityName === 'CountSession'
    && patch.lines !== undefined
    && entering !== 'applied'
    && entering !== 'cancelled';
  if (!stage && !isSave) return patch;
  const name = await countActorName(pool, access);
  const now = new Date().toISOString();
  const out = { ...patch };
  const put = (s) => {
    out[s.at] = now;
    out[s.by] = name;
    out[s.byId] = user.id;
  };
  if (stage) put(stage);
  if (isSave) put(TRAIL_SAVED_STAGE);
  return out;
}

/** Stamp a CREATE that is born past stage zero: a return the
 *  owner (or a returns.complete holder) brings into the world
 *  already approved or completed (the guardCreate force) passed
 *  its approval in the same act, so the trail says so, with the
 *  creator as the actor. */
async function stampTrailCreate(pool, access, entityName, values, user) {
  const stages = TRAIL_STAGES[entityName];
  if (!stages || entityName !== 'Return' || !values) return values;
  const born = values.status;
  if (born !== 'approved' && born !== 'completed') return values;
  const name = await countActorName(pool, access);
  const now = new Date().toISOString();
  const out = { ...values };
  const put = (s) => {
    out[s.at] = now;
    out[s.by] = name;
    out[s.byId] = user.id;
  };
  put(stages.find((s) => s.key === 'approved'));
  if (born === 'completed') put(stages.find((s) => s.key === 'completed'));
  return out;
}

/**
 * Read-time actor resolution (release 357): each row of a
 * trailed entity gains `trail_actors` — per stage, the actor's
 * CURRENT display name resolved from the stored user id (the
 * owner under their set name, a member under their staff name),
 * '' when an actor was recorded but their account is gone (the
 * client renders the neutral "Former team member" fallback),
 * or null when no actor id was recorded (legacy rows: the
 * client falls back to the stored "…by" name where one exists).
 * Runs for every viewer, owner included — it is freshness, not
 * exposure: a name is not an address, and the creator email
 * itself stays stripped for non-owners exactly as before.
 * `trail_actors` is an output-only field: toDbValues skips it,
 * like created_date / updated_date.
 */
async function shapeTrailActors(pool, access, entityName, rows) {
  const spec = TRAIL_ACTOR_IDS[entityName];
  if (!spec || !rows.length) return rows;
  let map = null;
  for (const row of rows) {
    const actors = {};
    for (const [key, idField] of spec) {
      const id = row[idField];
      if (!id) {
        actors[key] = null;
        continue;
      }
      if (!map) map = await trailActorNameMap(pool, access.business);
      actors[key] = map.get(id) ?? '';
    }
    row.trail_actors = actors;
  }
  return rows;
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
/**
 * Restaurant recipe validation (release 359, Nov 23, 2026).
 * The candidate is the full would-be row (create values, or
 * the stored row merged with the patch); selfId is the row's
 * own id on update, null on create. The rules keep the graph
 * a kitchen can actually cook from: everything named belongs
 * to the business, no recipe uses itself — directly or
 * through other dishes — no dish is its own ingredient, and
 * at most ONE active recipe covers a dish (the one depletion
 * follows when it sells).
 */
async function validateRecipe(pool, business, candidate, selfId) {
  const lines = Array.isArray(candidate.lines) ? candidate.lines : [];
  if (candidate.product_id) {
    const dish = (
      await pool.query('SELECT id FROM products WHERE id = $1 AND business_id = $2', [candidate.product_id, business.id])
    ).rows[0];
    if (!dish) throw err(400, 'invalid_reference', 'The product must belong to this business.');
  }
  if (candidate.location_id) {
    const zone = (
      await pool.query('SELECT id FROM locations WHERE id = $1 AND business_id = $2', [candidate.location_id, business.id])
    ).rows[0];
    if (!zone) throw err(400, 'invalid_reference', 'The location must belong to this business.');
  }
  if (candidate.yield_qty !== undefined && candidate.yield_qty !== null && !(Number(candidate.yield_qty) > 0)) {
    throw err(400, 'invalid_value', 'A recipe must make at least a little of the dish.');
  }
  if (
    candidate.q_factor_pct !== undefined
    && candidate.q_factor_pct !== null
    && !(Number(candidate.q_factor_pct) >= 0 && Number(candidate.q_factor_pct) <= 100)
  ) {
    throw err(400, 'invalid_value', 'The Q factor is a percentage between 0 and 100.');
  }
  for (const line of lines) {
    if (!(Number(line?.quantity) > 0)) {
      throw err(400, 'invalid_quantity', 'Every component needs a quantity greater than zero.');
    }
    if (line.kind === 'recipe') {
      if (!line.recipe_id) throw err(400, 'invalid_reference', 'Every line must name a product in this business.');
      if (selfId && line.recipe_id === selfId) {
        throw err(400, 'recipe_self_ingredient', 'A recipe cannot use itself as an ingredient.');
      }
    } else if (line.product_id && candidate.product_id && line.product_id === candidate.product_id) {
      throw err(400, 'recipe_self_ingredient', 'A dish cannot be an ingredient of its own recipe.');
    }
  }
  await assertProductsInBusiness(
    pool,
    business.id,
    lines.filter((line) => line.kind !== 'recipe').map((line) => line.product_id),
  );
  const { rows: allRecipes } = await pool.query(
    'SELECT id, lines FROM recipes WHERE business_id = $1',
    [business.id],
  );
  const graph = new Map(allRecipes.map((row) => [row.id, parseJsonArray(row.lines)]));
  if (selfId) graph.set(selfId, lines);
  for (const line of lines) {
    if (line.kind !== 'recipe') continue;
    if (!graph.has(line.recipe_id)) {
      throw err(400, 'invalid_reference', 'Every line must name a product in this business.');
    }
  }
  // The graph must stay acyclic: walk every recipe line's
  // subtree looking for the candidate itself.
  if (selfId) {
    const stack = lines.filter((line) => line.kind === 'recipe').map((line) => line.recipe_id);
    const seen = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (id === selfId) {
        throw err(400, 'recipe_circle', 'These recipes would form a circle — a dish cannot be an ingredient of itself, even through other dishes.');
      }
      if (seen.has(id)) continue;
      seen.add(id);
      for (const sub of graph.get(id) || []) {
        if (sub.kind === 'recipe') stack.push(sub.recipe_id);
      }
    }
  }
  if (candidate.status === 'active' && candidate.product_id) {
    const clash = (
      await pool.query(
        `SELECT id FROM recipes WHERE business_id = $1 AND product_id = $2 AND status = 'active' AND id <> $3 LIMIT 1`,
        [business.id, candidate.product_id, selfId || ''],
      )
    ).rows[0];
    if (clash) {
      throw err(400, 'recipe_already_active', 'That dish already has an active recipe. Set the other recipe back to draft first.');
    }
  }
  return lines;
}

/** Par validation (release 359): one par per product per
 *  place — a second row for the same shelf would split the
 *  order guide's math, so it refuses and names the fix. */
async function validatePar(pool, business, candidate, selfId) {
  const product = (
    await pool.query('SELECT id FROM products WHERE id = $1 AND business_id = $2', [candidate.product_id, business.id])
  ).rows[0];
  if (!product) throw err(400, 'invalid_reference', 'The product must belong to this business.');
  if (candidate.location_id) {
    const zone = (
      await pool.query('SELECT id FROM locations WHERE id = $1 AND business_id = $2', [candidate.location_id, business.id])
    ).rows[0];
    if (!zone) throw err(400, 'invalid_reference', 'The location must belong to this business.');
  }
  if (candidate.supplier_id) {
    const supplier = (
      await pool.query('SELECT id FROM suppliers WHERE id = $1 AND business_id = $2', [candidate.supplier_id, business.id])
    ).rows[0];
    if (!supplier) throw err(400, 'invalid_reference', 'The supplier must belong to this business.');
  }
  if (candidate.par_qty !== undefined && candidate.par_qty !== null && !(Number(candidate.par_qty) >= 0)) {
    throw err(400, 'invalid_quantity', 'A par level cannot be negative.');
  }
  if (candidate.pack_size !== undefined && candidate.pack_size !== null && !(Number(candidate.pack_size) > 0)) {
    throw err(400, 'invalid_quantity', 'A pack size must be greater than zero.');
  }
  const clash = (
    await pool.query(
      `SELECT id FROM pars WHERE business_id = $1 AND product_id = $2
       AND COALESCE(location_id, '') = COALESCE($3, '') AND id <> $4 LIMIT 1`,
      [business.id, candidate.product_id, candidate.location_id || null, selfId || ''],
    )
  ).rows[0];
  if (clash) {
    throw err(400, 'par_exists', 'That product already has a par level here. Edit the one that is there.');
  }
}

/**
 * Restaurant operations validation (release 361, Nov 23,
 * 2026) — the guardCreate/guardUpdate style of
 * validateRecipe/validatePar: every product, recipe, PO,
 * supplier and location a row names must belong to the same
 * business, and quantities are greater than zero. Candidates
 * are the full would-be row (create values, or the stored
 * row merged with the patch).
 */
async function assertProductInBusiness(pool, businessId, productId) {
  const found = (
    await pool.query('SELECT * FROM products WHERE id = $1 AND business_id = $2', [productId, businessId])
  ).rows[0];
  if (!found) throw err(400, 'invalid_reference', 'The product must belong to this business.');
  return found;
}

async function assertLocationInBusiness(pool, businessId, locationId) {
  if (!locationId) return null;
  const found = (
    await pool.query('SELECT * FROM locations WHERE id = $1 AND business_id = $2', [locationId, businessId])
  ).rows[0];
  if (!found) throw err(400, 'invalid_reference', 'The location must belong to this business.');
  return found;
}

async function assertSupplierInBusiness(pool, businessId, supplierId) {
  if (!supplierId) return null;
  const found = (
    await pool.query('SELECT id FROM suppliers WHERE id = $1 AND business_id = $2', [supplierId, businessId])
  ).rows[0];
  if (!found) throw err(400, 'invalid_reference', 'The supplier must belong to this business.');
  return found;
}

async function assertRecipeInBusiness(pool, businessId, recipeId) {
  const found = (
    await pool.query('SELECT * FROM recipes WHERE id = $1 AND business_id = $2', [recipeId, businessId])
  ).rows[0];
  if (!found) throw err(400, 'invalid_reference', 'The recipe must belong to this business.');
  return found;
}

function assertPositiveQuantity(value) {
  if (value !== undefined && value !== null && !(Number(value) > 0)) {
    throw err(400, 'invalid_quantity', 'Enter a quantity greater than zero.');
  }
}

async function validateStockBatch(pool, business, candidate) {
  await assertProductInBusiness(pool, business.id, candidate.product_id);
  await assertLocationInBusiness(pool, business.id, candidate.location_id);
  assertPositiveQuantity(candidate.quantity);
}

async function validateWasteEntry(pool, business, candidate) {
  await assertProductInBusiness(pool, business.id, candidate.product_id);
  await assertLocationInBusiness(pool, business.id, candidate.location_id);
  assertPositiveQuantity(candidate.quantity);
}

async function validateTempLog(pool, business, candidate) {
  await assertLocationInBusiness(pool, business.id, candidate.location_id);
}

async function validateEightySixItem(pool, business, candidate) {
  await assertProductInBusiness(pool, business.id, candidate.product_id);
  await assertLocationInBusiness(pool, business.id, candidate.location_id);
}

async function validateSupplierInvoice(pool, business, candidate) {
  await assertSupplierInBusiness(pool, business.id, candidate.supplier_id);
  if (candidate.purchase_order_id) {
    const po = (
      await pool.query('SELECT id FROM purchase_orders WHERE id = $1 AND business_id = $2', [
        candidate.purchase_order_id,
        business.id,
      ])
    ).rows[0];
    if (!po) throw err(400, 'invalid_reference', 'The purchase order must belong to this business.');
  }
  const lines = Array.isArray(candidate.lines) ? candidate.lines : [];
  for (const line of lines) {
    if (!(Number(line?.quantity) > 0)) {
      throw err(400, 'invalid_quantity', 'Every order line needs a quantity greater than zero.');
    }
  }
  await assertProductsInBusiness(pool, business.id, lines.map((line) => line?.product_id));
}

async function validateVendorPriceAlert(pool, business, candidate) {
  await assertProductInBusiness(pool, business.id, candidate.product_id);
  await assertSupplierInBusiness(pool, business.id, candidate.supplier_id);
}

async function validateBatchRun(pool, business, candidate) {
  const recipe = await assertRecipeInBusiness(pool, business.id, candidate.recipe_id);
  // A batch run PRODUCES the recipe's linked prep product:
  // without one there is nothing to put on the shelf.
  if (!recipe.product_id) {
    throw err(400, 'batch_needs_product', 'A batch run needs a recipe with a linked prep product.');
  }
  const product = await assertProductInBusiness(pool, business.id, recipe.product_id);
  if (product.status === 'archived') {
    throw err(400, 'product_archived', `${product.name || 'This product'} is archived, so its stock is frozen. Restore it to active to move its stock again.`);
  }
  await assertLocationInBusiness(pool, business.id, candidate.location_id);
  assertPositiveQuantity(candidate.makes);
  return recipe;
}

async function validateStaffMeal(pool, business, candidate) {
  await assertProductInBusiness(pool, business.id, candidate.product_id);
  await assertLocationInBusiness(pool, business.id, candidate.location_id);
  if (candidate.recipe_id) await assertRecipeInBusiness(pool, business.id, candidate.recipe_id);
  assertPositiveQuantity(candidate.quantity);
}

/**
 * Waste money shaping (release 361): the waste log's money
 * follows the recipe rule (shapeRecipeMoney's pattern) —
 * unit_cost rides the row ONLY for the owner or a
 * restaurant.money tick holder, and the computed total_cost
 * (qty × unit_cost) is attached for exactly those readers.
 * Everyone else's payload carries neither key, so no door
 * can render money it was never sent.
 */
function shapeWasteMoney(access, name, rows) {
  if (name !== 'WasteEntry' || !rows.length) return rows;
  const canSeeMoney = access.isOwner || access.can('restaurant.money');
  for (const row of rows) {
    if (canSeeMoney) {
      row.total_cost = row.unit_cost === null || row.unit_cost === undefined
        ? null
        : Math.round((Number(row.quantity) || 0) * (Number(row.unit_cost) || 0) * 100) / 100;
    } else {
      delete row.unit_cost;
      delete row.total_cost;
    }
  }
  return rows;
}

/**
 * Supplier invoice read shaping (release 361): when the
 * invoice names a purchase order, the row gains the computed
 * 3-way `match` (server/restaurantOps.js — authoritative;
 * the client mirror is only a pre-save preview). No PO →
 * match is null, never an invented comparison.
 */
async function shapeInvoiceMatch(pool, access, name, rows) {
  if (name !== 'SupplierInvoice' || !rows.length) return rows;
  const poDef = entityDef('PurchaseOrder');
  for (const row of rows) {
    if (!row.purchase_order_id) {
      row.match = null;
      continue;
    }
    const po = (
      await pool.query('SELECT * FROM purchase_orders WHERE id = $1 AND business_id = $2', [
        row.purchase_order_id,
        row.business_id,
      ])
    ).rows[0];
    row.match = computeInvoiceMatch(row, po ? publicRow(poDef, po) : null);
  }
  return rows;
}

/**
 * Vendor price alerts from an invoice (release 361): for
 * each invoice line whose billed unit cost differs from the
 * product's current cost, open ONE alert — an open alert for
 * the same invoice + product is never duplicated (a re-save
 * of the invoice must not stack copies). Runs on invoice
 * create and update; the alert's answer (accepted →
 * products.cost = new_cost) lives in the VendorPriceAlert
 * update hook below.
 */
async function insertPriceAlertsForInvoice(pool, invoiceRow, user) {
  const businessId = invoiceRow.business_id;
  const { rows: productRows } = await pool.query('SELECT * FROM products WHERE business_id = $1', [businessId]);
  const productsById = new Map(productRows.map((row) => [row.id, row]));
  const candidates = priceAlertCandidates(invoiceRow, productsById);
  for (const candidate of candidates) {
    const existing = (
      await pool.query(
        `SELECT id FROM vendor_price_alerts
         WHERE business_id = $1 AND invoice_id = $2 AND product_id = $3 AND status = 'open' LIMIT 1`,
        [businessId, invoiceRow.id, candidate.product_id],
      )
    ).rows[0];
    if (existing) continue;
    await pool.query(
      `INSERT INTO vendor_price_alerts
         (id, business_id, product_id, product_name, supplier_id, supplier_name, invoice_id,
          old_cost, new_cost, status, created_by_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        crypto.randomUUID(),
        businessId,
        candidate.product_id,
        candidate.product_name,
        invoiceRow.supplier_id || '',
        invoiceRow.supplier_name || '',
        invoiceRow.id,
        candidate.old_cost,
        candidate.new_cost,
        'open',
        user.id,
        user.email,
      ],
    );
  }
}

/** The location a restaurant stock event lands on: the row's
 *  named location, else the business's first location (the
 *  default-location heal means a business always has one). */
async function resolveOpsLocation(pool, businessId, locationId) {
  if (locationId) {
    const named = (
      await pool.query('SELECT * FROM locations WHERE id = $1 AND business_id = $2', [locationId, businessId])
    ).rows[0];
    if (named) return named;
  }
  const { rows } = await pool.query(
    'SELECT * FROM locations WHERE business_id = $1 ORDER BY created_at ASC LIMIT 1',
    [businessId],
  );
  return rows[0] ?? null;
}

/**
 * Batch run create hook (release 361): the run happens in
 * ONE explicit transaction after the row is inserted (the
 * funnel's create path is not transactional — the 359 sale
 * hook's shape): a 'produce' movement puts yield_qty × makes
 * of the recipe's linked prep product on the shelf at the
 * run's location, then the recipe's FULL expansion is
 * consumed through depleteForRecipeTx keyed to that produce
 * movement. The row is then filled with what actually
 * happened: the consumed lines snapshot, the produce
 * movement's id, the output quantity, and the resolved
 * product/recipe/location names.
 */
async function runBatchRunHook(pool, access, row, user) {
  const def = entityDef('BatchRun');
  const businessId = row.business_id;
  const recipe = (
    await pool.query('SELECT * FROM recipes WHERE id = $1 AND business_id = $2', [row.recipe_id, businessId])
  ).rows[0];
  if (!recipe?.product_id) return row;
  const product = (
    await pool.query('SELECT * FROM products WHERE id = $1 AND business_id = $2', [recipe.product_id, businessId])
  ).rows[0];
  if (!product) return row;
  const location = await resolveOpsLocation(pool, businessId, row.location_id);
  if (!location) return row;
  const makes = Number(row.makes) || 0;
  if (!(makes > 0)) return row;
  const outputQty = yieldQtyOf(recipe) * makes;
  const userName = await countActorName(pool, access);
  let produceMovement = null;
  let consumed = [];
  await withTx(pool, async (client) => {
    const produced = await recordMovementTx(client, {
      businessId,
      product,
      location,
      type: 'produce',
      quantity: outputQty,
      note: `Recipe: ${recipe.name}`,
      reference: row.id,
      userName,
      planKey: access.planKey,
      caller: user,
    });
    produceMovement = produced.movement;
    consumed = await depleteForRecipeTx(client, {
      businessId,
      recipe,
      makes,
      location,
      causeMovement: produceMovement,
      userName,
      caller: user,
    });
  });
  const lines = consumed.map((movement) => ({
    product_id: movement.product_id,
    product_name: movement.product_name,
    quantity: Number(movement.quantity) || 0,
  }));
  const { rows } = await pool.query(
    `UPDATE batch_runs
     SET lines = $1, produce_movement_id = $2, output_qty = $3, product_id = $4, product_name = $5,
         recipe_name = $6, location_id = $7, location_name = $8, updated_at = NOW()
     WHERE id = $9 RETURNING *`,
    [
      JSON.stringify(lines),
      produceMovement.id,
      outputQty,
      product.id,
      product.name,
      recipe.name,
      location.id,
      location.name,
      row.id,
    ],
  );
  return publicRow(def, rows[0]);
}

/**
 * Staff meal create hook (release 361): the meal takes the
 * dish off the shelf as a 'staff_meal' movement (through
 * recordMovementTx, in one explicit transaction after the
 * insert — the 359 hook shape), then depletes the dish's
 * ACTIVE recipe through depleteForRecipeTx keyed to that
 * movement. CLAMPED, honestly: when the dish is at zero the
 * funnel refuses the movement for insufficient stock — that
 * refusal, and only that one, is caught: the meal row still
 * records with movement_id null (the meal happened; the
 * shelf was already empty). Any other refusal (an archived
 * dish, an unknown type) still fails the write. A plain
 * product with no active recipe is just the movement.
 */
async function runStaffMealHook(pool, access, row, user) {
  const def = entityDef('StaffMeal');
  const businessId = row.business_id;
  const product = (
    await pool.query('SELECT * FROM products WHERE id = $1 AND business_id = $2', [row.product_id, businessId])
  ).rows[0];
  if (!product) return row;
  const location = await resolveOpsLocation(pool, businessId, row.location_id);
  if (!location) return row;
  const quantity = Number(row.quantity) || 0;
  if (!(quantity > 0)) return row;
  const userName = await countActorName(pool, access);
  let movement = null;
  let recipe = null;
  await withTx(pool, async (client) => {
    try {
      const written = await recordMovementTx(client, {
        businessId,
        product,
        location,
        type: 'staff_meal',
        quantity,
        note: row.note || '',
        reference: row.id,
        unitCost: Number(product.cost) || 0,
        userName,
        planKey: access.planKey,
        caller: user,
      });
      movement = written.movement;
    } catch (error) {
      if (error?.code !== 'insufficient_stock') throw error;
    }
    if (movement) {
      recipe = await activeRecipeForProduct(client, businessId, product.id);
      if (recipe) {
        await depleteForRecipeTx(client, {
          businessId,
          recipe,
          makes: quantity / yieldQtyOf(recipe),
          location,
          causeMovement: movement,
          userName,
          caller: user,
        });
      }
    }
  });
  const { rows } = await pool.query(
    `UPDATE staff_meals
     SET movement_id = $1, recipe_id = $2, product_name = $3, location_id = $4, location_name = $5,
         updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [movement?.id ?? null, recipe?.id ?? row.recipe_id ?? null, product.name, location.id, location.name, row.id],
  );
  return publicRow(def, rows[0]);
}

/**
 * Waste create hook (release 361): what was thrown away
 * leaves the shelf — a 'write_off' movement through
 * recordMovementTx (one explicit transaction after the
 * insert, the 359 hook shape), reference = the entry. The
 * entry snapshots the product's current cost when the
 * caller sent none, so the log carries its cost whoever
 * logged it (the money shaping decides who may SEE it).
 * CLAMPED like the staff-meal hook: when the shelf holds
 * less than the entry claims, the movement is refused for
 * insufficient stock — that refusal, and only that one, is
 * caught: the entry still records with movement_id null
 * (the waste happened; the count was already off). Any
 * other refusal still fails the write.
 */
async function runWasteHook(pool, access, row, user) {
  const def = entityDef('WasteEntry');
  const businessId = row.business_id;
  const product = (
    await pool.query('SELECT * FROM products WHERE id = $1 AND business_id = $2', [row.product_id, businessId])
  ).rows[0];
  if (!product) return row;
  const location = await resolveOpsLocation(pool, businessId, row.location_id);
  if (!location) return row;
  const quantity = Number(row.quantity) || 0;
  if (!(quantity > 0)) return row;
  const unitCost = row.unit_cost != null ? Number(row.unit_cost) : Number(product.cost) || 0;
  const userName = await countActorName(pool, access);
  let movement = null;
  await withTx(pool, async (client) => {
    try {
      const written = await recordMovementTx(client, {
        businessId,
        product,
        location,
        type: 'write_off',
        quantity,
        note: row.note || '',
        reference: row.id,
        unitCost,
        userName,
        planKey: access.planKey,
        caller: user,
      });
      movement = written.movement;
    } catch (error) {
      if (error?.code !== 'insufficient_stock') throw error;
    }
  });
  const { rows } = await pool.query(
    `UPDATE waste_entries
     SET movement_id = $1, unit_cost = $2, product_name = $3, location_id = $4, location_name = $5,
         updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [movement?.id ?? null, unitCost, product.name, location.id, location.name, row.id],
  );
  return publicRow(def, rows[0]);
}

/**
 * Recipe money shaping (release 359): dish money is money —
 * the owner-only money rule applied to a recipe read. The
 * computed cost figures (per make, per dish, and the food
 * cost percentage against the dish's price) ride the row
 * ONLY for the owner or a member holding the restaurant.money
 * tick; for everyone else the keys never exist on the row.
 * Recipe lines never store costs, so nothing else can leak.
 */
async function shapeRecipeMoney(pool, access, name, rows) {
  if (name !== 'Recipe' || !rows.length) return rows;
  const canSeeMoney = access.isOwner || access.can('restaurant.money');
  if (!canSeeMoney) {
    for (const row of rows) {
      delete row.true_cost;
      delete row.cost_per_make;
      delete row.food_cost_pct;
    }
    return rows;
  }
  const businessId = access.business.id;
  const [{ rows: recipeRows }, { rows: productRows }] = await Promise.all([
    pool.query('SELECT * FROM recipes WHERE business_id = $1', [businessId]),
    // unit + unit_conversions ride along: the cost math
    // converts recipe-line units into stock units
    // (lineStockQty), and a skinny row would silently price
    // a grams line as kilograms (harness find, Nov 23, 2026).
    pool.query('SELECT id, cost, price, unit, unit_conversions FROM products WHERE business_id = $1', [businessId]),
  ]);
  const recipesById = new Map(recipeRows.map((row) => [row.id, row]));
  const productsById = new Map(productRows.map((row) => [row.id, row]));
  const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
  for (const row of rows) {
    const recipe = recipesById.get(row.id) || row;
    row.cost_per_make = round2(recipeCostPerMake(recipesById, productsById, recipe));
    row.true_cost = round2(recipeCostPerUnit(recipesById, productsById, recipe));
    const price = Number(productsById.get(row.product_id)?.price) || 0;
    row.food_cost_pct = price > 0 ? Math.round((row.true_cost / price) * 1000) / 10 : null;
  }
  return rows;
}

/**
 * The generic layer's half of restaurant depletion (release
 * 359): the client funnel (orders shipping, an exchange going
 * out, the Movements page's own reversal button) writes sale
 * movements and sale reversals as plain entity rows, so the
 * follow-the-sale work happens here, once, keyed on the new
 * row's id. The server funnel (recordMovementTx) carries its
 * own hook for the till/sync/door sales. Depletion follows
 * the sale — it is never allowed to fail it (the order
 * address book's house pattern).
 */
async function followSaleMovement(pool, access, row, user) {
  try {
    if (row.type === 'sale' && access.planKey === 'business') {
      const product = (
        await pool.query('SELECT * FROM products WHERE id = $1 AND business_id = $2', [row.product_id, row.business_id])
      ).rows[0];
      const location = (
        await pool.query('SELECT * FROM locations WHERE id = $1 AND business_id = $2', [row.location_id, row.business_id])
      ).rows[0];
      if (product && location) {
        await withTx(pool, (client) =>
          depleteForSaleTx(client, {
            businessId: row.business_id,
            saleMovement: row,
            product,
            location,
            quantity: row.quantity,
            userName: row.user_name || '',
            caller: user,
          }),
        );
      }
    }
    if (row.reversal_of_id) {
      const original = (
        await pool.query('SELECT * FROM stock_movements WHERE id = $1 AND business_id = $2', [row.reversal_of_id, row.business_id])
      ).rows[0];
      if (original?.type === 'sale') {
        await withTx(pool, (client) =>
          restoreDepletionsTx(client, {
            businessId: row.business_id,
            saleMovement: original,
            userName: row.user_name || '',
            caller: user,
          }),
        );
      }
    }
  } catch {
    /* depletion follows the sale; it never blocks it */
  }
}

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
  if (name === 'Recipe') {
    values.status = values.status === 'active' ? 'active' : 'draft';
    await validateRecipe(pool, business, values, null);
  }
  if (name === 'Par') {
    await validatePar(pool, business, values, null);
  }
  if (name === 'StockBatch') {
    await validateStockBatch(pool, business, values);
  }
  if (name === 'WasteEntry') {
    await validateWasteEntry(pool, business, values);
  }
  if (name === 'TempLog') {
    await validateTempLog(pool, business, values);
  }
  if (name === 'EightySixItem') {
    await validateEightySixItem(pool, business, values);
  }
  if (name === 'SupplierInvoice') {
    await validateSupplierInvoice(pool, business, values);
  }
  if (name === 'VendorPriceAlert') {
    await validateVendorPriceAlert(pool, business, values);
  }
  if (name === 'BatchRun') {
    // The run's outcome fields are the server's alone
    // (release 361): the create hook writes what actually
    // happened — the client never names them.
    values.produce_movement_id = null;
    values.output_qty = null;
    values.lines = [];
    await validateBatchRun(pool, business, values);
  }
  if (name === 'StaffMeal') {
    // The stock-out link is the server's alone (release
    // 361): the create hook writes it, never the client.
    values.movement_id = null;
    await validateStaffMeal(pool, business, values);
  }
  if (name === 'WasteEntry') {
    // Same rule (release 361): the write_off link is the
    // create hook's to write, never the client's.
    values.movement_id = null;
  }
  if (name === 'StockMovement') {
    // The cause link is the server's alone (release 359): a
    // depletion row names the sale that caused it, and that
    // link is written by the depletion code, never taken
    // from the client — the trail-stamp rule (357) applied
    // to the restaurant corner.
    delete values.cause_movement_id;
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
  if (name === 'Recipe') {
    await validateRecipe(pool, access.business, { ...row, ...patch }, row.id);
  }
  if (name === 'Par') {
    await validatePar(pool, access.business, { ...row, ...patch }, row.id);
  }
  if (name === 'StockBatch') {
    await validateStockBatch(pool, access.business, { ...row, ...patch });
  }
  if (name === 'WasteEntry') {
    await validateWasteEntry(pool, access.business, { ...row, ...patch });
  }
  if (name === 'TempLog') {
    await validateTempLog(pool, access.business, { ...row, ...patch });
  }
  if (name === 'EightySixItem') {
    await validateEightySixItem(pool, access.business, { ...row, ...patch });
  }
  if (name === 'SupplierInvoice') {
    await validateSupplierInvoice(pool, access.business, { ...row, ...patch });
  }
  if (name === 'VendorPriceAlert') {
    await validateVendorPriceAlert(pool, access.business, { ...row, ...patch });
  }
  if (name === 'BatchRun') {
    // A run that already happened is a record, not a recipe
    // card: its outcome fields never move by edit.
    delete patch.produce_movement_id;
    delete patch.output_qty;
    delete patch.lines;
    await validateBatchRun(pool, access.business, { ...row, ...patch });
  }
  if (name === 'StaffMeal') {
    delete patch.movement_id;
    await validateStaffMeal(pool, access.business, { ...row, ...patch });
  }
  if (name === 'StockMovement') {
    // The cause link is the server's alone (release 359) — a
    // patch that round-trips the row simply loses the field.
    delete patch.cause_movement_id;
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
    if (name === 'Entitlement' && !businessRows.length) {
      // Account inheritance (release 356): a business with no
      // entitlement row of its own READS as the account's row —
      // a synthesized copy of its owner's oldest business's row,
      // wearing this business's id. One subscription covers the
      // account's businesses, so every surface that reads the
      // plan (access gate, switcher trial labels, Subscribe,
      // Plans, Settings summary) sees the one true row on every
      // business. Display only: nothing is stored, and a business
      // that gains its own row is governed by it from that read on.
      const { record, inheritedFrom } = await entitlementInheritance(pool, businessId);
      if (record && inheritedFrom) {
        businessRows = [publicRow(def, { ...record, business_id: businessId })];
      }
    }
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
    // Time-trail actors resolve to current display names for
    // every viewer (release 357) — before the creator strip
    // below, which removes the id this resolution reads.
    businessRows = await shapeTrailActors(pool, access, name, businessRows);
    // Recipe money rides the row only for money holders
    // (release 359) — computed here, absent for everyone else.
    businessRows = await shapeRecipeMoney(pool, access, name, businessRows);
    // Waste money follows the same rule, and a supplier
    // invoice carries its computed 3-way match (release 361).
    businessRows = shapeWasteMoney(access, name, businessRows);
    businessRows = await shapeInvoiceMatch(pool, access, name, businessRows);
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
    await shapeTrailActors(pool, access, name, [shaped]);
    await shapeRecipeMoney(pool, access, name, [shaped]);
    shapeWasteMoney(access, name, [shaped]);
    await shapeInvoiceMatch(pool, access, name, [shaped]);
    await shapeAttribution(pool, access, name, [shaped]);
    return stripCreatedBy(shaped);
  }
  const shaped = publicRow(def, row);
  await shapeTrailActors(pool, access, name, [shaped]);
  await shapeRecipeMoney(pool, access, name, [shaped]);
  shapeWasteMoney(access, name, [shaped]);
  await shapeInvoiceMatch(pool, access, name, [shaped]);
  return shaped;
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
  // Trail stamps are the server's alone (release 357): a stamp
  // field in the create body is stripped, and a return born
  // approved/completed is stamped with its creator at creation.
  values = stripTrailFields(name, values);
  values = await stampTrailCreate(pool, access, name, values, user);
  if (name === 'CountSession') {
    // Attribution is stamped by the server, never taken from
    // the client (rider, Nov 21, 2026): the starter's display
    // name, so the shared board can never show an email.
    values = { ...values, started_by: await countActorName(pool, access) };
  } else {
    values = await stampAttribution(pool, access, name, values);
  }
  let createdRow = await insertRow(pool, def, businessId, user, values);
  await shapeTrailActors(pool, access, name, [createdRow]);
  // Restaurant operations hooks (release 361): a batch run
  // produces + consumes, a staff meal writes its stock-out
  // movement and depletes, and a supplier invoice opens
  // vendor price alerts — each in its own explicit
  // transaction after the insert (the funnel's create path
  // is not transactional; the 359 sale hook's shape). Unlike
  // depletion, these hooks ARE the write's purpose, so their
  // failures surface instead of being swallowed.
  if (name === 'BatchRun') {
    createdRow = await runBatchRunHook(pool, access, createdRow, user);
    await shapeTrailActors(pool, access, name, [createdRow]);
  }
  if (name === 'StaffMeal') {
    createdRow = await runStaffMealHook(pool, access, createdRow, user);
    await shapeTrailActors(pool, access, name, [createdRow]);
  }
  if (name === 'WasteEntry') {
    createdRow = await runWasteHook(pool, access, createdRow, user);
    await shapeTrailActors(pool, access, name, [createdRow]);
  }
  if (name === 'SupplierInvoice') {
    await insertPriceAlertsForInvoice(pool, createdRow, user);
    await shapeInvoiceMatch(pool, access, name, [createdRow]);
  }
  shapeWasteMoney(access, name, [createdRow]);
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
  if (name === 'StockMovement') {
    // Restaurant depletion (release 359): a sale written
    // through the client funnel depletes its recipe's
    // ingredients, and a reversal of a sale restores them —
    // inside followSaleMovement, which never fails the write.
    await followSaleMovement(pool, access, createdRow, user);
  }
  if (name === 'Recipe') {
    await shapeRecipeMoney(pool, access, name, [createdRow]);
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
    const stripped = stripTrailFields(name, row);
    const trailStamped = await stampTrailCreate(pool, access, name, stripped, user);
    const stamped = name === 'CountSession'
      ? { ...trailStamped, started_by: await countActorName(pool, access) }
      : await stampAttribution(pool, access, name, trailStamped);
    const inserted = await insertRow(pool, def, businessId, user, stamped);
    await shapeTrailActors(pool, access, name, [inserted]);
    created.push(inserted);
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
  // Trail stamps are the server's alone (release 357): any
  // stamp field the client sent is stripped, then the stages
  // this write ENTERS are stamped from the server's clock and
  // the caller's session. Runs before the attribution stamp so
  // the trail's "…by" fields are never double-handled (they are
  // gone from the patch by the time attribution looks).
  patch = stripTrailFields(name, patch);
  patch = await stampTrailUpdate(pool, access, name, publicExisting, patch, user);
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
  await shapeTrailActors(pool, access, name, [result]);
  if (name === 'Recipe') {
    await shapeRecipeMoney(pool, access, name, [result]);
  }
  // Restaurant operations update hooks (release 361):
  // answering a price alert 'accepted' writes the new cost
  // onto the product ('dismissed' changes nothing), and an
  // invoice edit re-scans its lines for price alerts and
  // re-shapes the 3-way match on the way out.
  if (name === 'VendorPriceAlert' && result.status === 'accepted') {
    await pool.query(
      'UPDATE products SET cost = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3',
      [result.new_cost, result.product_id, result.business_id],
    );
  }
  if (name === 'EightySixItem' && result.active === false && !result.cleared_at) {
    // Clearing the board stamps who cleared it and when —
    // server-side, on the flip to inactive, once (release
    // 361). The board renders the stamps; an edit to an
    // already-cleared row never restamps them.
    const userName = await countActorName(pool, access);
    const { rows } = await pool.query(
      `UPDATE eighty_six_items SET cleared_at = NOW(), cleared_by = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3 RETURNING cleared_at, cleared_by`,
      [userName, result.id, result.business_id],
    );
    if (rows[0]) {
      result.cleared_at = rows[0].cleared_at;
      result.cleared_by = rows[0].cleared_by;
    }
  }
  if (name === 'SupplierInvoice') {
    await insertPriceAlertsForInvoice(pool, result, user);
    await shapeInvoiceMatch(pool, access, name, [result]);
  }
  shapeWasteMoney(access, name, [result]);
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
