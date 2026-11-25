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
import { sendMail, staffInviteEmail, EmailNotConfigured, resolveAccountLanguage } from './email.js';
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
  ALERTS_VIEW_MESSAGE,
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
import { mintInviteToken } from './inviteLinks.js';
import { ownerPublicName, attributionNameMap, attributionName } from './profilePhotos.js';
import { assertNotInGrace } from './billing.js';
import { assertSubscriptionAccess } from './subscriptionAccess.js';
import {
  enqueuePhotoJob,
  enqueueMissingPhotoJobs,
  photoProgress,
  kickPhotoDrain,
  isPhotoLink,
} from './photoJobs.js';
import {
  orderPurchaseOrder,
  cancelPurchaseOrder,
  sendPurchaseOrder,
  receivePurchaseOrder,
  buildBom,
  disassembleBom,
} from './business.js';
import {
  loadReportSource,
  buildServerReport,
  buildPurchasingSummary,
  reportDefinition,
} from './reports.js';
import {
  buildLabelsPdf,
  buildPackingSlipPdf,
  buildPoPdf,
  buildSupplierDocPdf,
  buildReportPdf,
} from './printPdf.js';
import { photoDataByProductId } from './printPhotos.js';

// Product photos for the print PDFs (print family, Nov 24,
// 2026): resolve the stored photo of each named product in this
// business to a data URL the PDF builders can embed. Ids that
// are not products of this business resolve to nothing.
async function printPhotoMap(db, bid, productIds) {
  const ids = [...new Set((productIds || []).filter(Boolean).map(String))];
  if (!ids.length) return {};
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
  const { rows } = await db.query(
    `SELECT id, photo_urls FROM products WHERE business_id = $1 AND id IN (${placeholders})`,
    [bid, ...ids],
  );
  return photoDataByProductId(db, rows);
}

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

/** Attribution name for server-side writes (owner's
 *  email-exposure rule, Nov 21, 2026): the actor's display name —
 *  the owner's set name or "Owner", a member's staff name —
 *  never their email, which is what movement user_name and its
 *  siblings used to be stamped with. */
async function movementActorName(pool, access) {
  return access.isOwner ? ownerPublicName(pool, access.business) : access.staffRow?.full_name || '';
}

/** Reports read shape (same rule): a non-owner's report source
 *  resolves movement user_name emails to names before grouping,
 *  so the "By" breakdown labels people, not addresses. The
 *  owner's own report is built from the rows exactly as stored. */
async function shapeReportSource(pool, access, source) {
  if (access.isOwner || !Array.isArray(source?.movements)) return source;
  const map = await attributionNameMap(pool, access.business);
  for (const movement of source.movements) {
    if (typeof movement.user_name === 'string' && movement.user_name.includes('@')) {
      movement.user_name = attributionName(map, movement.user_name);
    }
  }
  return source;
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
  // Grace guard (T4): a business past its paid period is read-only.
  // POST/PATCH/DELETE under /businesses/:bid are all writes (the scan
  // lookup POST is a scanner use, so it is blocked too). Entity writes
  // are guarded in server/entities.js; export (a GET) is guarded in
  // its own handler below.
  router.use('/businesses/:bid', async (req, res, next) => {
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return next();
    try {
      await assertNotInGrace(pool(), req.params.bid);
      return next();
    } catch (error) {
      return handleError(res, error);
    }
  });

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
  // One writer, two doors. The generic movement door is the scanner
  // workstation's: it asks for scan.use ("Scan and record stock
  // movements"). The stock-adjustment door serves the catalog lists —
  // the Adjust sheet on the Products / My inventory rows and the row
  // stepper — and asks for products.edit, the same permission the
  // product form enforces (owner catch, Nov 19, 2026: a sales clerk
  // with products.view + scan.use could move counts through the
  // Adjust sheet even though the product form refused her save; the
  // lists are catalog territory, so their stock door carries the
  // catalog permission, in the UI and here alike).
  const writeMovement = (permission, allowedTypes) => asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid, permission);
    const body = req.body || {};
    const product = await loadProductInBusiness(pool(), req.params.bid, body.product_id);
    const location = await loadLocationInBusiness(pool(), req.params.bid, body.location_id);
    if (!product) throw err(400, 'invalid_reference', 'The product must belong to this business.');
    if (!location) throw err(400, 'invalid_reference', 'The location must belong to this business.');
    if (!MOVEMENT_TYPES[body.type]) throw err(400, 'invalid_type', `Unknown movement type ${body.type}.`);
    if (allowedTypes && !allowedTypes.includes(body.type)) {
      // Door-relative wording, shared with the unknown-type
      // refusal above (and its ×52 registry pattern): this door
      // knows only the adjustment types.
      throw err(400, 'invalid_type', `Unknown movement type ${body.type}.`);
    }
    let toLocation = null;
    if (body.to_location_id) {
      toLocation = await loadLocationInBusiness(pool(), req.params.bid, body.to_location_id);
      if (!toLocation) throw err(400, 'invalid_reference', 'The destination location must belong to this business.');
      if (body.type !== 'transfer') throw err(400, 'invalid_type', 'A destination location only applies to transfers.');
    }
    const actorName = await movementActorName(pool(), access);
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
        userName: actorName,
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
  });

  router.post('/businesses/:bid/movements', writeMovement('scan.use', null));

  // The Adjust sheet's whole vocabulary: Add (receive), Remove
  // (sale), Set exact count (count), and the stepper's one-lower
  // correction. Nothing else is a stock adjustment.
  router.post(
    '/businesses/:bid/stock-adjustments',
    writeMovement('products.edit', ['receive', 'sale', 'count', 'correction']),
  );

  router.post('/businesses/:bid/movements/:id/reverse', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid, 'movements.reverse');
    const { rows } = await pool().query(
      'SELECT * FROM stock_movements WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.id, req.params.bid],
    );
    const movement = rows[0];
    if (!movement) throw err(404, 'not_found', 'Movement not found.');
    const actorName = await movementActorName(pool(), access);
    const result = await withTx(pool(), (client) =>
      reverseMovementTx(client, { businessId: req.params.bid, movement, userName: actorName, caller: req.user }),
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
    const actorName = await movementActorName(pool(), access);
    const result = await withTx(pool(), (client) =>
      setReservedTx(client, {
        businessId: req.params.bid,
        product,
        location,
        type: body.type,
        quantity: body.quantity,
        note: body.note,
        reference: body.reference,
        userName: actorName,
        caller: req.user,
      }),
    );
    return res.status(201).json({
      previous: result.previous,
      next: result.next,
      movement: publicRow(entityDef('StockMovement'), result.movement),
    });
  }));

  // ---- Import photos (release 365, rebuilt by release 366) ------------
  // A sheet's photo link is KEPT on the product it belongs to
  // (products.photo_source_url) and a durable photo job is queued
  // for it; the background worker (server/photoJobs.js) fetches it
  // into the app's own photo storage, politely and with retries.
  // Release 365 fetched the links right here, inside this request —
  // one at a time, a 10-second whole-download budget, no second
  // attempt — and the picture CDN's throttling of that rapid stream
  // cost the owner's real catalog more than half its photos, with
  // the links stored nowhere to retry from (Nov 24, 2026). The
  // import now answers as soon as the products and stock land:
  // photos arrive on their own, and a link that cannot be fetched
  // ends as a named problem ON the product, never a silent skip
  // and never a failed import (owner ruling, Nov 23, 2026).
  // The generated-SKU identity, mirroring src/lib/csvImport.js and
  // server/entities.js slug rules exactly: a row with no SKU of its
  // own is judged by this base, so a re-import recognizes the
  // products the first import created instead of twinning them.
  const importSlugSku = (name) =>
    String(name || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);

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
    const photoProblems = [];
    // The catalog as it stood when the send arrived: a SKU-less row
    // is judged against this snapshot by its generated identity.
    const catalogSkus = new Set(takenSkus);
    let created = 0;
    let received = 0;
    let units = 0;
    let photosQueued = 0;
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
      let sku = String(row.sku || '').trim();
      const codeValue = String(row.upc || row.barcode || row.isbn || '').trim().toLowerCase();
      if (sku && takenSkus.has(sku.toLowerCase())) {
        problems.push({ index, name, problem: `SKU ${sku} is already in the catalog` });
        continue;
      }
      if (!sku) {
        // No SKU of its own: judge the row by the identity the
        // importer itself derives. Already home → named skip, never
        // a twin. Genuinely new → the generated SKU is assigned
        // here, suffixed against everything taken, exactly as the
        // client's dry run resolved it.
        const identity = importSlugSku(name);
        if (identity && catalogSkus.has(identity.toLowerCase())) {
          problems.push({ index, name, problem: `SKU ${identity} is already in the catalog` });
          continue;
        }
        if (identity) {
          sku = identity;
          let attempt = 2;
          while (takenSkus.has(sku.toLowerCase())) {
            sku = `${identity}-${attempt}`;
            attempt += 1;
          }
        }
      }
      if (codeValue && takenCodes.has(codeValue)) {
        problems.push({ index, name, problem: 'UPC / barcode already belongs to another product' });
        continue;
      }
      if (limits.products != null && activeCount >= limits.products) {
        problems.push({ index, name, problem: productLimitMessage(limits.products, activeCount, { neutral: !access.isOwner }) });
        continue;
      }
      // The row's photo link (release 366): kept on the product
      // itself whether or not any fetch ever succeeds, so a photo
      // that does not arrive can always be brought in later. A
      // link that is not a web address at all is named as the
      // product's photo problem right here — it is known now, and
      // no fetch is queued for it.
      const photoLink = String(row.photo || '').trim();
      const draft = {
        business_id: req.params.bid,
        name,
        sku,
        photo_source_url: isPhotoLink(photoLink) ? photoLink : '',
        photo_problem: photoLink && !isPhotoLink(photoLink) ? 'The photo link is not a web address.' : '',
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
      // One row's failure is that row's problem — named in the
      // result, never a silent skip and never a reason to fail the
      // rows around it. Every refusal that CAN be known ahead of
      // any write (access, batch, location, a spent batch) has
      // already thrown above, before a single row landed: a refused
      // send lands zero rows (owner ruling, Nov 23, 2026).
      let createdRow;
      try {
        createdRow = await createEntity(pool(), req.user, 'Product', draft);
      } catch (rowErr) {
        problems.push({ index, name, problem: rowErr?.message || 'This row could not be created.' });
        continue;
      }
      created += 1;
      activeCount += 1;
      if (sku) takenSkus.add(sku.toLowerCase());
      if (codeValue) takenCodes.add(codeValue);
      const qty = Math.abs(Number(row.stock_qty) || 0);
      if (qty > 0 && location) {
        try {
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
        } catch (rowErr) {
          problems.push({
            index,
            name,
            problem: `The product was created, but its opening stock could not be recorded: ${rowErr?.message || 'unknown error'}`,
          });
        }
      }
      if (photoLink && !isPhotoLink(photoLink)) {
        photoProblems.push({ index, name, problem: 'The photo link is not a web address.' });
      }
      if (isPhotoLink(photoLink)) {
        // Queue the photo; do NOT fetch it here (release 366).
        // The worker brings it in on its own — the import answers
        // as soon as the products and stock have landed.
        try {
          const job = await enqueuePhotoJob(pool(), {
            businessId: req.params.bid,
            productId: createdRow.id,
            sourceUrl: photoLink,
            origin: `${req.protocol}://${req.get('host')}`,
          });
          if (job) photosQueued += 1;
        } catch {
          // A queue failure must never fail the row that already
          // landed: the link is stored on the product, and the
          // recovery door can queue it again at any time.
        }
      }
    }
    if (photosQueued > 0) kickPhotoDrain(pool());
    // The import's own story (owner ruling, Nov 15, 2026): one
    // activity row per committed Create import, so the Overview
    // feed and the full history can say "Imported N products" even
    // when every row arrived at zero and no stock moved. An
    // activity record only — never a stock movement.
    if (created > 0) {
      await pool().query(
        `INSERT INTO import_events (id, business_id, kind, product_count, batch_ref, file_name, created_by_id, created_by)
         VALUES ($1, $2, 'create', $3, $4, $5, $6, $7)`,
        [
          crypto.randomUUID(),
          req.params.bid,
          created,
          batchRef,
          String(body.fileName || ''),
          req.user?.id || null,
          req.user?.email || '',
        ],
      );
    }
    return res.status(201).json({ created, received, units, skipped: problems.length, problems, photoProblems, photosQueued });
  }));

  // ---- Photo progress + recovery (release 366) -------------------------
  // The visible truth about the business's import photos, and the
  // owner's door for bringing the missing ones in. Both ride the
  // import door's own gate (accessOr403 'exports.use' — the same
  // roles the importer answers to; no new enrollment tick).
  router.get('/businesses/:bid/photo-jobs', asyncHandler(async (req, res) => {
    await accessOr403(pool(), req.user, req.params.bid, 'exports.use');
    const progress = await photoProgress(pool(), req.params.bid);
    return res.json(progress);
  }));

  router.post('/businesses/:bid/photo-jobs/recover', asyncHandler(async (req, res) => {
    await accessOr403(pool(), req.user, req.params.bid, 'exports.use');
    const { missing, enqueued } = await enqueueMissingPhotoJobs(pool(), {
      businessId: req.params.bid,
      origin: `${req.protocol}://${req.get('host')}`,
    });
    if (enqueued > 0) kickPhotoDrain(pool());
    const progress = await photoProgress(pool(), req.params.bid);
    // missing/enqueued report the moment the owner asked (the
    // kick above may already be landing photos, so the live
    // recount must not overwrite them); the progress fields ride
    // along as the freshest counts.
    return res.json({ ...progress, missing, enqueued });
  }));

  // ---- Export (Business only, server-built) ---------------------------
  router.get('/businesses/:bid/export/:dataset', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid, 'exports.use');
    // Export is blocked in grace for every plan (no plan can export
    // from the read-only view — the paid-through window was the time).
    await assertNotInGrace(pool(), req.params.bid);
    if (!featureAllowed(access.planKey, 'exports')) {
      throw err(403, 'exports_business_only', 'Exports are part of the Business plan. Essentials can import, but not export.');
    }
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const dataset = req.params.dataset;
    // A non-owner's export resolves attribution emails to names
    // (the movements "By" and PO "Received by" columns); the
    // owner's own export is unchanged (Nov 21, 2026).
    const exportNameMap = access.isOwner ? null : await attributionNameMap(pool(), access.business);
    // Time trails (release 357): every exported file carries
    // its Exported-at stamp INSIDE the file — one instant for
    // the whole response. XLSX: a trailing footer row per sheet
    // (server/xlsxExport.js). CSV: a trailing stamp line after
    // the last data row — never a leading line, which a
    // header-first reader would mistake for the header row.
    const exportedAt = new Date().toISOString();
    if (dataset === 'inventory-workbook') {
      if (format !== 'xlsx') throw err(400, 'invalid_format', 'The full inventory workbook is Excel-only.');
      const sheets = [];
      for (const id of ['products', 'valuation', 'stock-by-location', 'movements']) {
        const built = await EXPORTS[id].build(pool(), req.params.bid, exportNameMap);
        sheets.push({ name: EXPORTS[id].title, columns: built.columns, rows: built.rows });
      }
      const buffer = await buildWorkbookBuffer(sheets, { exportedAt });
      const filename = `${fileSlug(access.business.name)}-inventory-workbook-${fileStamp()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader(
        'X-Export-Rows',
        String(sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0)),
      );
      return res.send(buffer);
    }
    const def = EXPORTS[dataset];
    if (!def) throw err(404, 'unknown_dataset', `Unknown export ${dataset}.`);
    const built = await def.build(pool(), req.params.bid, exportNameMap);
    const base = `${fileSlug(access.business.name)}-${dataset}-${fileStamp()}`;
    const filename = `${truncatedFilename(base, built.truncated)}.${format}`;
    res.setHeader('X-Export-Rows', String(built.rows.length));
    if (format === 'xlsx') {
      const buffer = await buildWorkbookBuffer([{ name: def.title, columns: built.columns, rows: built.rows }], { exportedAt });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      if (built.truncated) res.setHeader('X-Export-Truncated', '1');
      return res.send(buffer);
    }
    const csv = `\uFEFF${toCsv(built.columns, built.rows)}\r\nExported at: ${exportedAt}`;
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
    // The per-person layer (owner ruling, Nov 20, 2026): on
    // Business the alerts belong to the owner, and to a member
    // only with the owner's alerts.view enrollment tick — the
    // endpoints refuse an unticked member exactly as the
    // doors hide them.
    if (!access.isOwner && !access.can('alerts.view')) throw err(403, 'alerts_view_not_granted', ALERTS_VIEW_MESSAGE);
    return res.json(await evaluateAlerts(pool(), req.params.bid));
  }));

  router.post('/businesses/:bid/alerts/evaluate', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!featureAllowed(access.planKey, 'alerts')) throw err(403, 'plan_gated', 'Low-stock alerts are part of the Business plan.');
    if (!access.isOwner && !access.can('alerts.view')) throw err(403, 'alerts_view_not_granted', ALERTS_VIEW_MESSAGE);
    return res.json(await evaluateAlerts(pool(), req.params.bid));
  }));

  // ---- Purchase orders + builds (T5 business flows) ---------------------
  // Status moves and stock changes run through server/business.js in
  // one transaction each — never through a direct entity edit.
  router.post('/businesses/:bid/purchase-orders/:id/order', asyncHandler(async (req, res) => {
    const order = await orderPurchaseOrder(pool(), req.user, req.params.bid, req.params.id);
    return res.json({ order });
  }));

  router.post('/businesses/:bid/purchase-orders/:id/cancel', asyncHandler(async (req, res) => {
    const order = await cancelPurchaseOrder(pool(), req.user, req.params.bid, req.params.id);
    return res.json({ order });
  }));

  // Send the order to its supplier by email (Business only; the mail
  // and PDF carry the business's own name only — see business.js).
  router.post('/businesses/:bid/purchase-orders/:id/send', asyncHandler(async (req, res) => {
    const order = await sendPurchaseOrder(pool(), req.user, req.params.bid, req.params.id);
    return res.json({ order });
  }));

  router.post('/businesses/:bid/purchase-orders/:id/receive', asyncHandler(async (req, res) => {
    const result = await receivePurchaseOrder(pool(), req.user, req.params.bid, req.params.id, req.body || {});
    return res.json(result);
  }));

  router.post('/businesses/:bid/boms/:id/build', asyncHandler(async (req, res) => {
    const result = await buildBom(pool(), req.user, req.params.bid, req.params.id, req.body || {});
    return res.json(result);
  }));

  router.post('/businesses/:bid/boms/:id/disassemble', asyncHandler(async (req, res) => {
    const result = await disassembleBom(pool(), req.user, req.params.bid, req.params.id, req.body || {});
    return res.json(result);
  }));

  // ---- Reports (T5, Business only, server-built) ------------------------
  router.get('/businesses/:bid/reports', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    await assertNotInGrace(pool(), req.params.bid);
    if (!featureAllowed(access.planKey, 'reports')) {
      throw err(403, 'plan_gated', 'Advanced reports are part of the Business plan.');
    }
    const source = await shapeReportSource(pool(), access, await loadReportSource(pool(), req.params.bid));
    const report = buildServerReport({
      reportId: String(req.query.type || 'stock'),
      groupBy: String(req.query.groupBy || ''),
      source,
      from: String(req.query.from || ''),
      to: String(req.query.to || ''),
      locationId: String(req.query.locationId || ''),
      category: String(req.query.category || ''),
      language: access.business.language,
    });
    return res.json(report);
  }));

  router.get('/businesses/:bid/reports/purchasing', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    await assertNotInGrace(pool(), req.params.bid);
    if (!featureAllowed(access.planKey, 'purchasing')) {
      throw err(403, 'plan_gated', 'Purchasing summaries are part of the Business plan.');
    }
    return res.json(await buildPurchasingSummary(pool(), req.params.bid, access.business.language));
  }));

  // ---- Print PDFs (T5) ---------------------------------------------------
  // Labels print on BOTH plans — the connection (Bluetooth, Wi-Fi,
  // Ethernet, USB) is how you reach the printer, and label printing
  // is not plan-gated. Documents (packing slips, purchase orders,
  // supplier docs, reports) are export-gated: Business only, enforced
  // here server-side whatever the connection. Nothing prints from
  // grace (read-only: see products only, no export).
  function pdfResponse(res, buffer, filename) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    return res.send(buffer);
  }

  router.get('/businesses/:bid/print/labels', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    await assertNotInGrace(pool(), req.params.bid);
    // No cap on how many labels print (print family ruling, Nov 24,
    // 2026: "however many are selected, that many print" — the old
    // slice(0, 50) silently dropped every label past the fiftieth).
    const ids = String(req.query.product_ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (!ids.length) throw err(400, 'invalid_value', 'Choose at least one product to print.');
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
    const { rows } = await pool().query(
      // One placeholder per id (not = ANY($2::text[])): the array form
      // does not bind under pg-mem, and this form works on real Postgres too.
      `SELECT * FROM products WHERE business_id = $1 AND id IN (${placeholders})`,
      [req.params.bid, ...ids],
    );
    if (!rows.length) throw err(404, 'not_found', 'No products found for those labels.');
    // Each label carries its product's photo (print family,
    // Nov 24, 2026), resolved from the stored photo bytes.
    const photoDataById = await photoDataByProductId(pool(), rows);
    const buffer = buildLabelsPdf(
      rows.map((row) => ({ ...row, photoData: photoDataById[row.id] || '' })),
      {
        copies: req.query.copies,
        businessName: access.business.name,
        language: access.business.language,
      },
    );
    return pdfResponse(res, buffer, `${fileSlug(access.business.name)}-labels-${fileStamp()}.pdf`);
  }));

  router.get('/businesses/:bid/print/packing-slip', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    await assertNotInGrace(pool(), req.params.bid);
    if (!featureAllowed(access.planKey, 'exports')) {
      throw err(403, 'documents_business_only', 'Packing slips are part of the Business plan.');
    }
    const { rows } = await pool().query(
      'SELECT * FROM orders WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.query.order_id, req.params.bid],
    );
    if (!rows[0]) throw err(404, 'not_found', 'Order not found.');
    const order = publicRow(entityDef('Order'), rows[0]);
    const photoDataById = await printPhotoMap(
      pool(),
      req.params.bid,
      (order.lines || []).map((line) => line.product_id),
    );
    return pdfResponse(
      res,
      buildPackingSlipPdf(order, access.business, { photoDataById }),
      `${fileSlug(access.business.name)}-packing-slip-${fileStamp()}.pdf`,
    );
  }));

  router.get('/businesses/:bid/print/po', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    await assertNotInGrace(pool(), req.params.bid);
    if (!featureAllowed(access.planKey, 'exports')) {
      throw err(403, 'documents_business_only', 'Purchase-order documents are part of the Business plan.');
    }
    const { rows } = await pool().query(
      'SELECT * FROM purchase_orders WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.query.po_id, req.params.bid],
    );
    if (!rows[0]) throw err(404, 'not_found', 'Purchase order not found.');
    const order = publicRow(entityDef('PurchaseOrder'), rows[0]);
    const mode = req.query.mode === 'packing' ? 'packing' : 'po';
    const photoDataById = await printPhotoMap(
      pool(),
      req.params.bid,
      (order.lines || []).map((line) => line.product_id),
    );
    return pdfResponse(
      res,
      buildPoPdf(order, access.business, { mode, photoDataById }),
      `${fileSlug(access.business.name)}-po-${fileStamp()}.pdf`,
    );
  }));

  router.get('/businesses/:bid/print/supplier-doc', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    await assertNotInGrace(pool(), req.params.bid);
    if (!featureAllowed(access.planKey, 'exports')) {
      throw err(403, 'documents_business_only', 'Supplier documents are part of the Business plan.');
    }
    const { rows } = await pool().query(
      'SELECT * FROM suppliers WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.query.supplier_id, req.params.bid],
    );
    if (!rows[0]) throw err(404, 'not_found', 'Supplier not found.');
    const supplier = publicRow(entityDef('Supplier'), rows[0]);
    const { rows: poRows } = await pool().query(
      "SELECT * FROM purchase_orders WHERE business_id = $1 AND supplier_id = $2 AND status IN ('ordered', 'partial') ORDER BY created_at DESC",
      [req.params.bid, supplier.id],
    );
    const openOrders = poRows.map((row) => publicRow(entityDef('PurchaseOrder'), row));
    return pdfResponse(
      res,
      buildSupplierDocPdf(supplier, access.business, openOrders),
      `${fileSlug(access.business.name)}-supplier-${fileStamp()}.pdf`,
    );
  }));

  router.get('/businesses/:bid/print/report', asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    await assertNotInGrace(pool(), req.params.bid);
    if (!featureAllowed(access.planKey, 'reports')) {
      throw err(403, 'plan_gated', 'Reports are part of the Business plan.');
    }
    const source = await shapeReportSource(pool(), access, await loadReportSource(pool(), req.params.bid));
    const report = buildServerReport({
      reportId: String(req.query.type || 'stock'),
      groupBy: String(req.query.groupBy || ''),
      source,
      from: String(req.query.from || ''),
      to: String(req.query.to || ''),
      locationId: String(req.query.locationId || ''),
      category: String(req.query.category || ''),
      language: access.business.language,
    });
    // Grouped by product, each row's key IS a product id — those
    // rows print with the product's photo (print family, Nov 24,
    // 2026); other groupings' keys are names and resolve to none.
    const photoDataById = await printPhotoMap(
      pool(),
      req.params.bid,
      (report?.rows || []).map((row) => row.key),
    );
    return pdfResponse(
      res,
      buildReportPdf(report, access.business, {
        from: String(req.query.from || ''),
        to: String(req.query.to || ''),
        photoDataById,
      }),
      `${fileSlug(access.business.name)}-report-${fileStamp()}.pdf`,
    );
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
    // Subscription gate (2026-11-13): the move WRITES the target's
    // data, so the target workspace must be entitled too — the path
    // middleware only assessed the source (:bid).
    await assertSubscriptionAccess(pool(), req.user, target.id, { write: true });
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) throw err(400, 'invalid_value', 'Choose at least one product to move.');
    // Owner-only door (checked above): both movement rows carry
    // the owner's display name, never their email (Nov 21, 2026).
    const actorName = await ownerPublicName(pool(), source);
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
          user_name: actorName,
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
          user_name: actorName,
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
      actor: {
        userId: req.user.id,
        staffId: access.staffRow?.id ?? null,
        name: access.isOwner ? await ownerPublicName(pool(), access.business) : access.staffRow?.full_name || req.user.email,
      },
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
    // Single-use invite links (owner's ruling, Nov 22, 2026 —
    // server/inviteLinks.js): EVERY send of this email mints a
    // fresh token for the row, superseding any earlier link.
    // This endpoint is both the first send (StaffMemberDialog)
    // and the resend (StaffMemberCard's Resend invite), so a
    // resend always issues a working fresh link and kills the
    // old one. Minting happens whether or not the mailer is
    // configured: the link state is the truth, the email is
    // its courier.
    const inviteToken = await mintInviteToken(pool(), rows[0].id);
    // Best-effort invite email: the StaffMember row IS the invite, so a
    // missing mailer never blocks the invite itself (T3 sends no real
    // email in tests; the mailer fails closed for auth codes only).
    try {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const registerUrl = `${protocol}://${req.get('host')}/register?email=${encodeURIComponent(email)}&invite=${encodeURIComponent(inviteToken)}`;
      // The invite is sent BY a person: it speaks the inviter's
      // account language first (migration 052) — the invitee has
      // no language of their own yet — and the business's
      // language only as the fallback.
      const inviteLang = (await resolveAccountLanguage(pool(), req.user.id)) || access.business.language;
      await sendMail(staffInviteEmail({ to: email, businessName: access.business.name, inviterName: req.user.email, lang: inviteLang, registerUrl }));
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
