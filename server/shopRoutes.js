/**
 * Shop routes — T3 (plan §5.2, §7 Phase T3).
 *
 *   /api/entities/:name/...   generic Base44-shaped entity API
 *                             (filter/count/get/create/bulk/update/delete)
 *   /api/businesses/:id/...   scan lookup, movements, reserve, reverse,
 *                             import, export, valuation, dashboard,
 *                             alerts, cross-business move, staff, roles,
 *                             locations, products (function wrappers)
 *
 * Every route requires a signed-in user (requireAuth) and resolves
 * business access server-side (server/authz.js). Plan limits are
 * enforced here and in server/entities.js — never trusted from the
 * browser. No billing, no grants, no Stripe (T4 owns money).
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { getPool } from './db.js';
import { sendMail, staffInviteEmail, EmailNotConfigured } from './email.js';
import { resolveAccess, loadBusiness, staffRowForEmail, isTrustedStaffRow } from './authz.js';
import {
  planFor,
  featureAllowed,
  limitsForPlan,
  productLimitMessage,
} from './plans.js';
import {
  entityDef,
  publicRow,
  listEntities,
  countEntities,
  getEntity,
  createEntity,
  bulkCreateEntities,
  updateEntity,
  bulkUpdateEntities,
  deleteEntity,
  assertProductCap,
} from './entities.js';
import {
  recordMovementTx,
  setReservedTx,
  reverseMovementTx,
  getLevel,
  setLevel,
  insertMovement,
  withTx,
  MOVEMENT_TYPES,
} from './movements.js';
import { classifyScan } from './scanCode.js';
import { toCsv, fileSlug, fileStamp } from './csv.js';
import { buildWorkbookBuffer } from './xlsxExport.js';
import { EXPORTS, buildValuation, truncatedFilename, EXPORT_ROW_CAP } from './exportData.js';
import { createStaffMember } from './staff.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({
      error: error.code || 'error',
      message: error.message,
      ...(error.limit !== undefined ? { limit: error.limit, used: error.used } : {}),
    });
  }
  console.error('[twin] shop route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

async function accessOr403(pool, user, businessId, permission) {
  const access = await resolveAccess(pool, user, businessId);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  if (permission && !access.can(permission)) {
    throw err(403, 'forbidden', 'You do not have permission to do that here.');
  }
  return access;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looseCodePattern(code) {
  if (code.length > 40 || !/^[A-Za-z0-9\s\-_/]+$/.test(code)) return null;
  const parts = code.split(/[\s\-_/]+/).filter(Boolean).map(escapeRegex);
  if (parts.length < 2) return null;
  return new RegExp(`^${parts.join('[\\s\\-_/]*')}$`, 'i');
}

/** Server-side product lookup by code — same variants as src/lib/inventory.js. */
async function findProductsByCode(pool, businessId, raw) {
  const code = String(raw || '').trim();
  if (!code) return [];
  const variants = [...new Set([code, code.toUpperCase(), code.replace(/\s+/g, ''), code.replace(/[-\s]/g, '')])].filter(Boolean);
  const { rows } = await pool.query(
    'SELECT * FROM products WHERE business_id = $1 ORDER BY created_at ASC LIMIT 5000',
    [businessId],
  );
  const fields = ['sku', 'upc', 'barcode', 'qr_code', 'isbn'];
  const exact = rows.filter((row) =>
    fields.some((field) => variants.some((variant) => String(row[field] || '') === variant)),
  );
  if (exact.length) return exact.slice(0, 10);
  const pattern = looseCodePattern(code);
  if (!pattern) return [];
  return rows
    .filter((row) => fields.some((field) => pattern.test(String(row[field] || ''))))
    .slice(0, 10);
}

function publicProduct(row) {
  if (!row) return null;
  const def = entityDef('Product');
  return publicRow(def, row);
}

async function loadProductInBusiness(pool, businessId, productId) {
  const { rows } = await pool.query('SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1', [productId, businessId]);
  return rows[0] ?? null;
}

async function loadLocationInBusiness(pool, businessId, locationId) {
  const { rows } = await pool.query('SELECT * FROM locations WHERE id = $1 AND business_id = $2 LIMIT 1', [locationId, businessId]);
  return rows[0] ?? null;
}

export function createShopRouter({ getPool: getPoolFn }) {
  const router = Router();
  // Resolve the pool per request (tests install the pg-mem override
  // before createApp, production sets DATABASE_URL at boot).
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };

  // ---- Generic entities ---------------------------------------------
  router.post('/entities/:name/query', asyncHandler(async (req, res) => {
    const { filter = {}, sort, limit, cursor } = req.body || {};
    const page = await listEntities(pool(), req.user, req.params.name, filter, { sort, limit, cursor });
    return res.json(page);
  }));

  router.post('/entities/:name/count', asyncHandler(async (req, res) => {
    const { filter = {} } = req.body || {};
    const total = await countEntities(pool(), req.user, req.params.name, filter);
    return res.json({ count: total });
  }));

  router.get('/entities/:name/:id', asyncHandler(async (req, res) => {
    const row = await getEntity(pool(), req.user, req.params.name, req.params.id);
    return res.json(row);
  }));

  router.post('/entities/:name/bulk', asyncHandler(async (req, res) => {
    const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
    const created = await bulkCreateEntities(pool(), req.user, req.params.name, rows);
    return res.status(201).json(created);
  }));

  router.patch('/entities/:name/bulk', asyncHandler(async (req, res) => {
    const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
    const updated = await bulkUpdateEntities(pool(), req.user, req.params.name, rows);
    return res.json(updated);
  }));

  router.post('/entities/:name/update-many', asyncHandler(async (req, res) => {
    const { filter = {}, patch = {} } = req.body || {};
    const page = await listEntities(pool(), req.user, req.params.name, filter, { limit: 2000 });
    const updated = [];
    for (const row of page.items) updated.push(await updateEntity(pool(), req.user, req.params.name, row.id, patch));
    return res.json(updated);
  }));

  router.post('/entities/:name/delete-many', asyncHandler(async (req, res) => {
    const { filter = {} } = req.body || {};
    const page = await listEntities(pool(), req.user, req.params.name, filter, { limit: 2000 });
    for (const row of page.items) await deleteEntity(pool(), req.user, req.params.name, row.id);
    return res.json({ ok: true, deleted: page.items.length });
  }));

  router.post('/entities/:name', asyncHandler(async (req, res) => {
    const row = await createEntity(pool(), req.user, req.params.name, req.body || {});
    return res.status(201).json(row);
  }));

  router.patch('/entities/:name/:id', asyncHandler(async (req, res) => {
    const row = await updateEntity(pool(), req.user, req.params.name, req.params.id, req.body || {});
    return res.json(row);
  }));

  router.delete('/entities/:name/:id', asyncHandler(async (req, res) => {
    const result = await deleteEntity(pool(), req.user, req.params.name, req.params.id);
    return res.json(result);
  }));

  // ---- Business-scoped helpers ---------------------------------------
  router.get('/businesses/:bid/entitlement', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    const { rows } = await pool().query('SELECT * FROM entitlements WHERE business_id = $1 LIMIT 1', [req.params.bid]);
    const row = rows[0] ?? null;
    return res.json({ plan: access.planKey, entitlement: row ? publicRow(entityDef('Entitlement'), row) : null });
  }));

  // ---- Scan -----------------------------------------------------------
  router.post('/businesses/:bid/scan/lookup', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    const code = String(req.body?.code ?? req.query?.code ?? '').trim();
    if (!code) return res.status(400).json({ error: 'invalid_code', message: 'A code is required.' });
    const classification = classifyScan(code);
    let products = [];
    if (classification.kind === 'identifier' || classification.kind === 'text') {
      products = (await findProductsByCode(pool(), req.params.bid, code)).map(publicProduct);
    } else if (classification.kind === 'structured' && classification.identifier) {
      products = (await findProductsByCode(pool(), req.params.bid, classification.identifier)).map(publicProduct);
    } else if (classification.kind === 'url' && classification.productRef) {
      products = (await findProductsByCode(pool(), req.params.bid, classification.productRef.value)).map(publicProduct);
    }
    return res.json({ classification, products, plan: access.planKey });
  }));

  router.get('/businesses/:bid/scan/lookup', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    const code = String(req.query?.code ?? '').trim();
    if (!code) return res.status(400).json({ error: 'invalid_code', message: 'A code is required.' });
    const classification = classifyScan(code);
    let products = [];
    if (classification.kind !== 'url') {
      const needle = classification.identifier || code;
      products = (await findProductsByCode(pool(), req.params.bid, needle)).map(publicProduct);
    } else if (classification.productRef) {
      products = (await findProductsByCode(pool(), req.params.bid, classification.productRef.value)).map(publicProduct);
    }
    return res.json({ classification, products, plan: access.planKey });
  }));

  // ---- Movements (atomic server path) ---------------------------------
  router.post('/businesses/:bid/movements', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid, 'scan.use');
    const body = req.body || {};
    const product = await loadProductInBusiness(pool(), req.params.bid, body.product_id);
    const location = await loadLocationInBusiness(pool(), req.params.bid, body.location_id);
    if (!product) throw err(400, 'invalid_reference', 'The product must belong to this business.');
    if (!location) throw err(400, 'invalid_reference', 'The location must belong to this business.');
    if (!MOVEMENT_TYPES[body.type]) throw err(400, 'invalid_type', `Unknown movement type ${body.type}.`);
    let toLocation = null;
    if (body.to_location_id) {
      toLocation = await loadLocationInBusiness(pool(), req.params.bid, body.to_location_id);
      if (!toLocation) throw err(400, 'invalid_reference', 'The destination location must belong to this business.');
      if (body.type !== 'transfer') throw err(400, 'invalid_type', 'A destination location only applies to transfers.');
    }
    const result = await withTx(pool(), (client) =>
      recordMovementTx(client, {
        businessId: req.params.bid,
        product,
        location,
        type: body.type,
        quantity: body.quantity,
        note: body.note,
        scannedCode: body.scanned_code,
        toLocation,
        userName: req.user.email,
        reference: body.reference,
        supplierName: body.supplier_name,
        unitCost: body.unit_cost,
        planKey: access.planKey,
        caller: req.user,
      }),
    );
    return res.status(201).json({
      previous: result.previous,
      next: result.next,
      movement: publicRow(entityDef('StockMovement'), result.movement),
    });
  }));

  router.post('/businesses/:bid/movements/:id/reverse', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid, 'movements.reverse');
    const { rows } = await pool().query(
      'SELECT * FROM stock_movements WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.id, req.params.bid],
    );
    const movement = rows[0];
    if (!movement) throw err(404, 'not_found', 'Movement not found.');
    const result = await withTx(pool(), (client) =>
      reverseMovementTx(client, { businessId: req.params.bid, movement, userName: req.user.email, caller: req.user }),
    );
    return res.json({
      previous: result.previous,
      next: result.next,
      movement: publicRow(entityDef('StockMovement'), result.movement),
    });
  }));

  router.post('/businesses/:bid/reserve', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid, 'scan.use');
    const body = req.body || {};
    const product = await loadProductInBusiness(pool(), req.params.bid, body.product_id);
    const location = await loadLocationInBusiness(pool(), req.params.bid, body.location_id);
    if (!product || !location) throw err(400, 'invalid_reference', 'The product and location must belong to this business.');
    const result = await withTx(pool(), (client) =>
      setReservedTx(client, {
        businessId: req.params.bid,
        product,
        location,
        type: body.type,
        quantity: body.quantity,
        note: body.note,
        reference: body.reference,
        userName: req.user.email,
        caller: req.user,
      }),
    );
    return res.status(201).json({
      previous: result.previous,
      next: result.next,
      movement: publicRow(entityDef('StockMovement'), result.movement),
    });
  }));

  // ---- Import (server-side, plan-enforced) ----------------------------
  router.post('/businesses/:bid/import', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid, 'exports.use');
    const body = req.body || {};
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const batchRef = String(body.batchRef || '').trim();
    if (!rows.length) throw err(400, 'invalid_value', 'No rows to import.');
    if (rows.length > 20000) throw err(400, 'invalid_value', 'One import holds at most 20,000 rows.');
    if (!batchRef) throw err(400, 'invalid_value', 'A batch reference is required.');
    const location = body.location_id
      ? await loadLocationInBusiness(pool(), req.params.bid, body.location_id)
      : null;
    if (body.location_id && !location) throw err(400, 'invalid_reference', 'The location must belong to this business.');
    const already = (
      await pool().query(
        "SELECT id FROM stock_movements WHERE business_id = $1 AND note ILIKE $2 LIMIT 1",
        [req.params.bid, `%Import ${batchRef}%`],
      )
    ).rows[0];
    if (already) throw err(409, 'already_imported', `Import ${batchRef} was already recorded. Nothing was received twice.`);
    const existing = await pool().query('SELECT sku, upc, barcode, isbn FROM products WHERE business_id = $1', [req.params.bid]);
    const takenSkus = new Set(existing.rows.map((r) => String(r.sku || '').toLowerCase()).filter(Boolean));
    const takenCodes = new Set(
      existing.rows.flatMap((r) => [r.upc, r.barcode, r.isbn]).map((c) => String(c || '').toLowerCase()).filter(Boolean),
    );
    const problems = [];
    let created = 0;
    let received = 0;
    let units = 0;
    const limits = limitsForPlan(access.planKey);
    let activeCount = (
      await pool().query(
        "SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1 AND (status IS NULL OR status <> 'archived')",
        [req.params.bid],
      )
    ).rows[0]?.n ?? 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const name = String(row.name || '').trim();
      if (!name) {
        problems.push({ index, name: '', problem: 'A product name is required.' });
        continue;
      }
      const sku = String(row.sku || '').trim();
      const codeValue = String(row.upc || row.barcode || row.isbn || '').trim().toLowerCase();
      if (sku && takenSkus.has(sku.toLowerCase())) {
        problems.push({ index, name, problem: `SKU ${sku} is already in the catalog` });
        continue;
      }
      if (codeValue && takenCodes.has(codeValue)) {
        problems.push({ index, name, problem: 'UPC / barcode already belongs to another product' });
        continue;
      }
      if (limits.products != null && activeCount >= limits.products) {
        problems.push({ index, name, problem: productLimitMessage(limits.products, activeCount) });
        continue;
      }
      const draft = {
        business_id: req.params.bid,
        name,
        sku,
        upc: String(row.upc || '').trim(),
        barcode: String(row.barcode || '').trim(),
        isbn: String(row.isbn || '').trim(),
        author: String(row.author || '').trim(),
        category: String(row.category || '').trim(),
        subcategory: String(row.subcategory || '').trim(),
        tags: Array.isArray(row.tags) ? row.tags : String(row.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
        brand: String(row.brand || '').trim(),
        publisher: String(row.publisher || '').trim(),
        condition: String(row.condition || '').trim(),
        unit: ['each', 'case', 'pair', 'pack', 'kg'].includes(row.unit) ? row.unit : 'each',
        cost: row.cost === '' || row.cost === undefined ? null : Number(row.cost),
        price: row.price === '' || row.price === undefined ? null : Number(row.price),
        reorder_point: Number(row.reorder_point) || 0,
        description: String(row.description || '').trim(),
        status: 'active',
      };
      if (Number.isNaN(draft.cost)) draft.cost = null;
      if (Number.isNaN(draft.price)) draft.price = null;
      const createdRow = await createEntity(pool(), req.user, 'Product', draft);
      created += 1;
      activeCount += 1;
      if (sku) takenSkus.add(sku.toLowerCase());
      if (codeValue) takenCodes.add(codeValue);
      if (codeValue) takenCodes.add(codeValue);
      const qty = Math.abs(Number(row.stock_qty) || 0);
      if (qty > 0 && location) {
        await withTx(pool(), (client) =>
          recordMovementTx(client, {
            businessId: req.params.bid,
            product: createdRow,
            location,
            type: 'receive',
            quantity: qty,
            note: [`Import ${batchRef}`, String(body.note || '')].filter(Boolean).join(' · '),
            reference: String(body.reference || ''),
            supplierName: String(row.supplier_name || ''),
            unitCost: draft.cost ?? 0,
            planKey: access.planKey,
            caller: req.user,
          }),
        );
        received += 1;
        units += qty;
      }
    }
    return res.status(201).json({ created, received, units, skipped: problems.length, problems });
  }));

  // ---- Export (Business only, server-built) ---------------------------
  router.get('/businesses/:bid/export/:dataset', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid, 'exports.use');
    if (!featureAllowed(access.planKey, 'exports')) {
      throw err(403, 'exports_business_only', 'Exports are part of the Business plan. Essentials can import, but not export.');
    }
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const dataset = req.params.dataset;
    if (dataset === 'inventory-workbook') {
      if (format !== 'xlsx') throw err(400, 'invalid_format', 'The full inventory workbook is Excel-only.');
      const sheets = [];
      for (const id of ['products', 'valuation', 'stock-by-location', 'movements']) {
        const built = await EXPORTS[id].build(pool(), req.params.bid);
        sheets.push({ name: EXPORTS[id].title, columns: built.columns, rows: built.rows });
      }
      const buffer = await buildWorkbookBuffer(sheets);
      const filename = `${fileSlug(access.business.name)}-inventory-workbook-${fileStamp()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    }
    const def = EXPORTS[dataset];
    if (!def) throw err(404, 'unknown_dataset', `Unknown export ${dataset}.`);
    const built = await def.build(pool(), req.params.bid);
    const base = `${fileSlug(access.business.name)}-${dataset}-${fileStamp()}`;
    const filename = `${truncatedFilename(base, built.truncated)}.${format}`;
    if (format === 'xlsx') {
      const buffer = await buildWorkbookBuffer([{ name: def.title, columns: built.columns, rows: built.rows }]);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      if (built.truncated) res.setHeader('X-Export-Truncated', '1');
      return res.send(buffer);
    }
    const csv = `\uFEFF${toCsv(built.columns, built.rows)}`;
    res.setHeader('Content-Type', 'text/csv;charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (built.truncated) res.setHeader('X-Export-Truncated', '1');
    return res.send(csv);
  }));

  // ---- Valuation (Business only) ---------------------------------------
  router.get('/businesses/:bid/valuation', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!featureAllowed(access.planKey, 'valuation')) {
      throw err(403, 'plan_gated', 'Stock valuation is part of the Business plan.');
    }
    const { rows } = await buildValuation(pool(), req.params.bid);
    const mapped = rows.map((entry) => ({
      product_id: entry.product.id,
      sku: entry.product.sku || '',
      name: entry.product.name,
      category: entry.product.category || '',
      condition: entry.product.condition || '',
      cost: entry.product.cost ?? null,
      price: entry.product.price ?? null,
      units: entry.units,
      held: entry.held,
      available: Math.max(entry.units - entry.held, 0),
      costValue: entry.costKnown ? Number(entry.cost.toFixed(2)) : null,
      retailValue: entry.priceKnown ? Number(entry.retail.toFixed(2)) : null,
      margin: entry.costKnown && entry.priceKnown ? Number((entry.retail - entry.cost).toFixed(2)) : null,
    }));
    const totals = {
      costValue: Number(mapped.reduce((sum, row) => sum + (row.costValue ?? 0), 0).toFixed(2)),
      retailValue: Number(mapped.reduce((sum, row) => sum + (row.retailValue ?? 0), 0).toFixed(2)),
      incomplete: mapped.some((row) => row.costValue === null || row.retailValue === null),
    };
    return res.json({ rows: mapped, totals });
  }));

  // ---- Dashboard ---------------------------------------------------------
  router.get('/businesses/:bid/dashboard', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    const bid = req.params.bid;
    const [products, levels, locations, movements, orders] = await Promise.all([
      pool().query("SELECT id, name, sku, reorder_point, cost, price FROM products WHERE business_id = $1 AND (status IS NULL OR status <> 'archived')", [bid]),
      pool().query('SELECT product_id, location_id, quantity, reserved FROM stock_levels WHERE business_id = $1', [bid]),
      pool().query('SELECT id, name FROM locations WHERE business_id = $1', [bid]),
      pool().query('SELECT * FROM stock_movements WHERE business_id = $1 ORDER BY created_at DESC LIMIT 8', [bid]),
      pool().query("SELECT id, number, customer_name, status, total FROM orders WHERE business_id = $1 AND status IN ('new','pending','reserved','packed') ORDER BY created_at DESC LIMIT 25", [bid]),
    ]);
    const qtyByProduct = new Map();
    levels.rows.forEach((level) => {
      qtyByProduct.set(level.product_id, (qtyByProduct.get(level.product_id) || 0) + Number(level.quantity ?? 0));
    });
    const productById = new Map(products.rows.map((p) => [p.id, p]));
    let lowStock = 0;
    levels.rows.forEach((level) => {
      const product = productById.get(level.product_id);
      if (product && Number(product.reorder_point) > 0 && Number(level.quantity ?? 0) <= Number(product.reorder_point)) lowStock += 1;
    });
    const totalUnits = [...qtyByProduct.values()].reduce((sum, qty) => sum + qty, 0);
    return res.json({
      plan: access.planKey,
      products: products.rows.length,
      totalUnits,
      lowStock,
      locations: locations.rows.length,
      recentMovements: movements.rows.map((row) => publicRow(entityDef('StockMovement'), row)),
      awaitingOrders: orders.rows,
    });
  }));

  // ---- Alerts (Business only) --------------------------------------------
  async function evaluateAlerts(pool, businessId) {
    const rules = (await pool.query("SELECT * FROM alert_rules WHERE business_id = $1 AND active = TRUE ORDER BY name ASC", [businessId])).rows;
    const products = (await pool.query('SELECT * FROM products WHERE business_id = $1', [businessId])).rows;
    const levels = (await pool.query('SELECT * FROM stock_levels WHERE business_id = $1', [businessId])).rows;
    const movements = (await pool.query('SELECT product_id, type, scanned_code, created_at FROM stock_movements WHERE business_id = $1 ORDER BY created_at DESC', [businessId])).rows;
    const productById = new Map(products.map((p) => [p.id, p]));
    const qtyByProduct = new Map();
    const levelsByProduct = new Map();
    levels.forEach((level) => {
      qtyByProduct.set(level.product_id, (qtyByProduct.get(level.product_id) || 0) + Number(level.quantity ?? 0));
      if (!levelsByProduct.has(level.product_id)) levelsByProduct.set(level.product_id, []);
      levelsByProduct.get(level.product_id).push(level);
    });
    const lastMovementByProduct = new Map();
    const lastScanByProduct = new Map();
    movements.forEach((movement) => {
      if (!lastMovementByProduct.has(movement.product_id)) lastMovementByProduct.set(movement.product_id, movement);
      if (movement.scanned_code && !lastScanByProduct.has(movement.product_id)) lastScanByProduct.set(movement.product_id, movement);
    });
    const now = Date.now();
    const dayMs = 86_400_000;
    const inScope = (rule, product, productLevels) => {
      if (rule.category && product.category !== rule.category) return false;
      const watched = JSON.parse(typeof rule.location_ids === 'string' ? rule.location_ids || '[]' : '[]');
      if (rule.location_id) watched.push(rule.location_id);
      if (watched.length && !productLevels.some((level) => watched.includes(level.location_id))) return false;
      return true;
    };
    const triggered = [];
    for (const rule of rules) {
      const matches = [];
      for (const product of products) {
        const productLevels = levelsByProduct.get(product.id) || [];
        if (!inScope(rule, product, productLevels)) continue;
        const qty = qtyByProduct.get(product.id) || 0;
        const threshold = Number(rule.threshold ?? 0);
        if (rule.kind === 'low_stock') {
          const atOrBelow = threshold > 0 ? threshold : Number(product.reorder_point ?? 0);
          if (qty > 0 && atOrBelow > 0 && qty <= atOrBelow) {
            matches.push({ product_id: product.id, name: product.name, sku: product.sku || '', quantity: qty, detail: `At or below ${atOrBelow}` });
          }
        } else if (rule.kind === 'out_of_stock') {
          if (qty === 0 && productLevels.length) {
            matches.push({ product_id: product.id, name: product.name, sku: product.sku || '', quantity: 0, detail: 'Out of stock' });
          }
        } else if (rule.kind === 'overstock') {
          if (qty >= (threshold || 25)) {
            matches.push({ product_id: product.id, name: product.name, sku: product.sku || '', quantity: qty, detail: `At or above ${threshold || 25}` });
          }
        } else if (rule.kind === 'expiring') {
          if (!product.expiration_date || qty <= 0) continue;
          const days = (new Date(product.expiration_date).getTime() - now) / dayMs;
          if (days >= 0 && days <= (threshold || 30)) {
            matches.push({ product_id: product.id, name: product.name, sku: product.sku || '', quantity: qty, detail: `Expires in ${Math.ceil(days)} days` });
          }
        } else if (rule.kind === 'stale') {
          if (qty <= 0) continue;
          const last = lastMovementByProduct.get(product.id);
          const since = last ? new Date(last.created_at).getTime() : new Date(product.created_at).getTime();
          if ((now - since) / dayMs >= (threshold || 90)) {
            matches.push({ product_id: product.id, name: product.name, sku: product.sku || '', quantity: qty, detail: `No movement in ${Math.floor((now - since) / dayMs)} days` });
          }
        } else if (rule.kind === 'unscanned') {
          if (qty <= 0) continue;
          const last = lastScanByProduct.get(product.id);
          const since = last ? new Date(last.created_at).getTime() : new Date(product.created_at).getTime();
          if ((now - since) / dayMs >= (threshold || 60)) {
            matches.push({ product_id: product.id, name: product.name, sku: product.sku || '', quantity: qty, detail: `Not scanned in ${Math.floor((now - since) / dayMs)} days` });
          }
        }
      }
      if (matches.length) triggered.push({ rule: publicRow(entityDef('AlertRule'), rule), matches });
    }
    return { triggered };
  }

  router.get('/businesses/:bid/alerts', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!featureAllowed(access.planKey, 'alerts')) throw err(403, 'plan_gated', 'Low-stock alerts are part of the Business plan.');
    return res.json(await evaluateAlerts(pool(), req.params.bid));
  }));

  router.post('/businesses/:bid/alerts/evaluate', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!featureAllowed(access.planKey, 'alerts')) throw err(403, 'plan_gated', 'Low-stock alerts are part of the Business plan.');
    return res.json(await evaluateAlerts(pool(), req.params.bid));
  }));

  // ---- Cross-business move / merge (Q-5) ----------------------------------
  // Base44 has NO cross-business move: transfers are location-to-
  // location inside one business only (src/lib/inventory.js
  // recordMovement; Scan.jsx forgets the product on business switch).
  // The twin adds it as a real endpoint because the owner's 6-day
  // test merges inventory from one store into another. Owner-only:
  // the caller must own BOTH businesses. A matching SKU in the
  // target merges into the existing product; otherwise the product
  // is copied (new id, same fields) and the stock is received there.
  router.post('/businesses/:bid/cross-business-move', asyncHandler(async (req, res) => {
    const source = await loadBusiness(pool(), req.params.bid);
    if (!source) throw err(404, 'not_found', 'Business not found.');
    if (source.owner_id !== req.user.id) {
      throw err(403, 'forbidden', 'Only the owner of the business can move its inventory to another business.');
    }
    const targetId = String(req.body?.target_business_id || '').trim();
    const target = await loadBusiness(pool(), targetId);
    if (!target) throw err(400, 'invalid_reference', 'The target business was not found.');
    if (target.owner_id !== req.user.id) {
      throw err(403, 'forbidden', 'You must own the target business too — inventory only moves between your own businesses.');
    }
    if (target.id === source.id) throw err(400, 'invalid_value', 'Choose a different business to move inventory to.');
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) throw err(400, 'invalid_value', 'Choose at least one product to move.');
    const moved = await withTx(pool(), async (client) => {
      const results = [];
      const targetPlan = await planFor(client, target.id);
      for (const item of items) {
        const quantity = Math.abs(Number(item.quantity) || 0);
        if (quantity <= 0) throw err(400, 'invalid_quantity', 'Enter a quantity greater than zero.');
        const productRows = await client.query('SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1', [item.product_id, source.id]);
        const product = productRows.rows[0];
        if (!product) throw err(400, 'invalid_reference', 'A product to move was not found in this business.');
        const locationRows = await client.query('SELECT * FROM locations WHERE id = $1 AND business_id = $2 LIMIT 1', [item.location_id, source.id]);
        const location = locationRows.rows[0];
        if (!location) throw err(400, 'invalid_reference', 'The source location was not found.');
        let toLocation = null;
        if (item.to_location_id) {
          const toRows = await client.query('SELECT * FROM locations WHERE id = $1 AND business_id = $2 LIMIT 1', [item.to_location_id, target.id]);
          toLocation = toRows.rows[0];
          if (!toLocation) throw err(400, 'invalid_reference', 'The target location must belong to the target business.');
        } else {
          const first = await client.query('SELECT * FROM locations WHERE business_id = $1 ORDER BY created_at ASC LIMIT 1', [target.id]);
          toLocation = first.rows[0];
          if (!toLocation) throw err(400, 'invalid_reference', 'The target business needs a location first.');
        }
        const sourceLevel = await getLevel(client, source.id, product.id, location.id);
        const onHand = Number(sourceLevel?.quantity ?? 0);
        if (quantity > onHand) throw err(400, 'insufficient_stock', `Only ${onHand} on hand at ${location.name}.`);
        // Target product: merge into the matching SKU, else copy it.
        let targetProduct = null;
        let merged = false;
        if (String(product.sku || '').trim()) {
          const found = await client.query('SELECT * FROM products WHERE business_id = $1 AND sku = $2 LIMIT 1', [target.id, product.sku]);
          targetProduct = found.rows[0] ?? null;
          merged = Boolean(targetProduct);
        }
        if (!targetProduct) {
          const limits = limitsForPlan(targetPlan);
          if (limits.products != null) {
            const used = await client.query(
              "SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1 AND (status IS NULL OR status <> 'archived')",
              [target.id],
            );
            if ((used.rows[0]?.n ?? 0) + 1 > limits.products) {
              throw Object.assign(
                err(403, 'product_limit', productLimitMessage(limits.products, used.rows[0]?.n ?? 0)),
                { limit: limits.products, used: used.rows[0]?.n ?? 0 },
              );
            }
          }
          const copy = { ...product };
          delete copy.created_at;
          delete copy.updated_at;
          copy.id = crypto.randomUUID();
          copy.business_id = target.id;
          copy.created_by_id = req.user.id;
          copy.created_by = req.user.email;
          const columns = Object.keys(copy);
          const params = columns.map((_, i) => `$${i + 1}`);
          const inserted = await client.query(
            `INSERT INTO products (${columns.join(', ')}) VALUES (${params.join(', ')}) RETURNING *`,
            columns.map((col) => copy[col]),
          );
          // The copy gets a fresh id — the source id must not travel.
          targetProduct = inserted.rows[0];
        }
        await setLevel(client, source.id, product.id, location.id, onHand - quantity, undefined, req.user);
        await insertMovement(client, {
          business_id: source.id,
          product_id: product.id,
          product_name: product.name,
          sku: product.sku || '',
          location_id: location.id,
          location_name: location.name,
          type: 'transfer',
          quantity,
          previous_qty: onHand,
          new_qty: onHand - quantity,
          to_location_id: toLocation.id,
          to_location_name: `${target.name} · ${toLocation.name}`,
          reference: 'cross-business-move',
          note: `Moved to ${target.name}`,
          user_name: req.user.email,
        }, req.user);
        const targetLevel = await getLevel(client, target.id, targetProduct.id, toLocation.id);
        const targetOnHand = Number(targetLevel?.quantity ?? 0);
        await setLevel(client, target.id, targetProduct.id, toLocation.id, targetOnHand + quantity, undefined, req.user);
        await insertMovement(client, {
          business_id: target.id,
          product_id: targetProduct.id,
          product_name: targetProduct.name,
          sku: targetProduct.sku || '',
          location_id: toLocation.id,
          location_name: toLocation.name,
          type: 'receive',
          quantity,
          previous_qty: targetOnHand,
          new_qty: targetOnHand + quantity,
          reference: 'cross-business-move',
          note: `Received from ${source.name}`,
          user_name: req.user.email,
        }, req.user);
        results.push({
          product_id: product.id,
          target_product_id: targetProduct.id,
          quantity,
          merged,
          target_location_id: toLocation.id,
        });
      }
      return results;
    });
    return res.status(201).json({ moved, target_business_id: target.id });
  }));

  // ---- Staff ---------------------------------------------------------------
  router.post('/businesses/:bid/staff', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!access.isOwner && !access.can('staff.manage')) {
      throw err(403, 'forbidden', 'You are not allowed to manage staff here.');
    }
    const row = await createStaffMember(pool(), {
      business: access.business,
      planKey: access.planKey,
      caller: req.user,
      member: req.body?.member || req.body || {},
    });
    return res.status(201).json({ member: publicRow(entityDef('StaffMember'), row) });
  }));

  // Staff list: the owner sees every row; a staff member sees only
  // their own row, by email — including while still Invited (PR #63
  // follow-up (a)). Anyone else gets nothing, not a 403 that leaks
  // whether the business exists.
  router.get('/businesses/:bid/staff', asyncHandler(async (req, res) => {
    const business = await loadBusiness(pool(), req.params.bid);
    if (!business) throw err(404, 'not_found', 'Business not found.');
    if (business.owner_id === req.user.id) {
      const page = await listEntities(pool(), req.user, 'StaffMember', { business_id: req.params.bid }, { sort: 'full_name', limit: 200 });
      return res.json(page);
    }
    const own = await staffRowForEmail(pool(), req.params.bid, req.user.email);
    // Read-by-email only returns a TRUSTED row (owner-created or
    // chained to the owner). An attacker-created row is invisible
    // even to its own email — the owner deletes it instead.
    if (!own || !(await isTrustedStaffRow(pool(), business, own))) {
      throw err(403, 'forbidden', 'You do not have access to this workspace.');
    }
    return res.json({ items: [publicRow(entityDef('StaffMember'), own)], next_cursor: null, total: 1 });
  }));

  // Staff read-by-email: an invited staff member reads their own row
  // without needing active business access first.
  router.get('/businesses/:bid/staff/me', asyncHandler(async (req, res) => {
    const business = await loadBusiness(pool(), req.params.bid);
    if (!business) throw err(404, 'not_found', 'Business not found.');
    const row = await staffRowForEmail(pool(), req.params.bid, req.user.email);
    if (!row) throw err(404, 'not_found', 'No staff record for this login on this business.');
    if (business.owner_id !== req.user.id && !(await isTrustedStaffRow(pool(), business, row))) {
      throw err(403, 'forbidden', 'You can only read your own staff record.');
    }
    return res.json(publicRow(entityDef('StaffMember'), row));
  }));

  router.patch('/businesses/:bid/staff/:id', asyncHandler(async (req, res) => {
    const row = await updateEntity(pool(), req.user, 'StaffMember', req.params.id, req.body || {});
    return res.json(row);
  }));

  router.delete('/businesses/:bid/staff/:id', asyncHandler(async (req, res) => {
    const result = await deleteEntity(pool(), req.user, 'StaffMember', req.params.id);
    return res.json(result);
  }));

  router.post('/businesses/:bid/staff/invite', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!access.isOwner && !access.can('staff.manage')) {
      throw err(403, 'forbidden', 'You are not allowed to manage staff here.');
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) throw err(400, 'invalid_value', 'An email is required.');
    const { rows } = await pool().query(
      'SELECT * FROM staff_members WHERE business_id = $1 AND LOWER(email) = LOWER($2)',
      [req.params.bid, email],
    );
    if (!rows.length) throw err(404, 'not_found', 'No staff record for that email on this business.');
    // Best-effort invite email: the StaffMember row IS the invite, so a
    // missing mailer never blocks the invite itself (T3 sends no real
    // email in tests; the mailer fails closed for auth codes only).
    try {
      await sendMail(staffInviteEmail({ to: email, businessName: access.business.name, inviterName: req.user.email }));
    } catch (error) {
      if (!(error instanceof EmailNotConfigured)) console.error('[twin] staff invite email failed:', error.message);
    }
    return res.json({ ok: true, invited: rows.length });
  }));

  // ---- Function wrappers (ported call sites) -------------------------------
  router.post('/businesses/:bid/products', asyncHandler(async (req, res) => {
    const products = Array.isArray(req.body?.products) ? req.body.products : [];
    if (!products.length) {
      return res.status(400).json({ error: 'invalid_value', message: 'Provide a products list.' });
    }
    // The URL business is authoritative: stamp it onto every row so
    // callers never need to repeat it inside each product.
    const stamped = products.map((row) => ({ ...row, business_id: req.params.bid }));
    const created = await bulkCreateEntities(pool(), req.user, 'Product', stamped, req);
    return res.status(201).json({ created });
  }));

  router.post('/businesses/:bid/locations', asyncHandler(async (req, res) => {
    const row = await createEntity(pool(), req.user, 'Location', {
      ...(req.body?.location || req.body || {}),
      business_id: req.params.bid,
    });
    return res.status(201).json({ location: row });
  }));

  router.post('/businesses/:bid/roles', asyncHandler(async (req, res) => {
    const row = await createEntity(pool(), req.user, 'StaffRole', {
      ...(req.body?.role || req.body || {}),
      business_id: req.params.bid,
    });
    return res.status(201).json({ role: row });
  }));

  return router;
}
