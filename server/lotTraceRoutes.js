/**
 * Lot codes, the recall finder and supplier traceability —
 * HTTP surface (Nov 26, 2026; plan Part 7, item 392).
 *
 *   GET  /api/businesses/:bid/lot-trace            the board: batches, pulls, receiving checks, products, suppliers, locations
 *   POST /api/businesses/:bid/lot-trace/receive    record one item's delivery (supplier + lot per item, catch weight, temp, refusal)
 *   POST /api/businesses/:bid/lot-trace/checks     log a receiving check (any member — a daily log)
 *   POST /api/businesses/:bid/lot-trace/pull       pull a lot: lock the batch, keep the record, flow the rest to waste
 *   GET  /api/businesses/:bid/lot-trace/recall     ?lot= — the recall finder's answer
 *   GET  /api/businesses/:bid/lot-trace/trace      ?supplier=&lot= — the traceability log's lines
 *
 * BUSINESS-ONLY: every door sits behind the restaurant
 * corner's plan gate, and the feature is invisible on
 * Essentials. Stock doors (receive, pull) ride the stock
 * door — the owner, a manager, or a restaurant.build
 * holder; the receiving check log is a DAILY LOG (the
 * waste/temp-log doctrine): any member may log, because
 * logging dies when it needs permission.
 *
 * THE RECORDS: receiving writes the batch (stock_batches,
 * migration 048 + 070) and a 'receive' movement that CARRIES
 * THE LOT (stock_movements.lot_code); a pull writes its own
 * record (lot_pulls), locks the batch (status 'pulled',
 * quantity zeroed by a 'write_off' movement), and flows
 * what was left into the costed waste log with reason
 * 'recall' and the lot named. Nothing is deleted, ever —
 * a recall is exactly when the trail must survive.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import { assertNotInGrace, withTx } from './billing.js';
import { recordMovementTx } from './movements.js';
import { personLevel } from './workforceRoutes.js';
import {
  LOT_ALREADY_PULLED_MESSAGE,
  LOT_BATCH_MESSAGE,
  LOT_STOCK_DOOR_MESSAGE,
  cleanLotQuery,
  cleanPull,
  cleanReceiving,
  cleanReceivingCheck,
  costPerWeight,
  recallAnswer,
  traceLines,
} from './lotTraceCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] lot-trace route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function canStockLots(access) {
  if (!access) return false;
  if (access.isOwner) return true;
  if (personLevel(access.staffRow) === 'manager') return true;
  return typeof access.can === 'function' ? access.can('restaurant.build') : false;
}

export function createLotTraceRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/lot-trace';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    return access;
  }

  const actorName = (req, access) => (access.isOwner ? 'Owner' : access.staffRow?.full_name || req.user.email);

  async function loadProduct(businessId, productId, client = null) {
    const q = client || pool();
    const { rows } = await q.query('SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1', [productId, businessId]);
    return rows[0] || null;
  }

  async function loadLocation(businessId, locationId, client = null) {
    const q = client || pool();
    if (locationId) {
      const { rows } = await q.query('SELECT * FROM locations WHERE id = $1 AND business_id = $2 LIMIT 1', [locationId, businessId]);
      if (rows[0]) return rows[0];
    }
    const { rows } = await q.query(
      'SELECT * FROM locations WHERE business_id = $1 AND active = TRUE ORDER BY created_at ASC LIMIT 1',
      [businessId],
    );
    return rows[0] || null;
  }

  async function sources(businessId) {
    const [batches, movements, pulls, waste, checks] = await Promise.all([
      pool().query('SELECT * FROM stock_batches WHERE business_id = $1 ORDER BY created_at DESC LIMIT 500', [businessId]),
      pool().query("SELECT * FROM stock_movements WHERE business_id = $1 AND lot_code <> '' ORDER BY created_at DESC LIMIT 500", [businessId]),
      pool().query('SELECT * FROM lot_pulls WHERE business_id = $1 ORDER BY created_at DESC LIMIT 300', [businessId]),
      pool().query("SELECT * FROM waste_entries WHERE business_id = $1 AND lot_code <> '' ORDER BY created_at DESC LIMIT 300", [businessId]),
      pool().query('SELECT * FROM receiving_checks WHERE business_id = $1 ORDER BY created_at DESC LIMIT 300', [businessId]),
    ]);
    return {
      batches: batches.rows, movements: movements.rows, pulls: pulls.rows,
      waste: waste.rows, checks: checks.rows,
    };
  }

  const publicBatch = (row) => ({
    ...row,
    quantity: Number(row.quantity) || 0,
    actual_weight: row.actual_weight !== null && row.actual_weight !== undefined ? Number(row.actual_weight) : null,
    // Catch-weight truth rides the row when the delivery
    // carried both a cost and an actual weight.
    cost_per_weight: row.actual_weight ? costPerWeight(Number(row.quantity) * (Number(row.unit_cost) || 0), row.actual_weight) : null,
  });

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const businessId = access.business.id;
    const [data, products, suppliers, locations] = await Promise.all([
      sources(businessId),
      pool().query("SELECT id, name, sku, upc, barcode, unit, cost, supplier_id, supplier_name FROM products WHERE business_id = $1 AND active = TRUE ORDER BY name ASC LIMIT 500", [businessId]),
      pool().query('SELECT id, name FROM suppliers WHERE business_id = $1 ORDER BY name ASC LIMIT 300', [businessId]),
      pool().query('SELECT id, name FROM locations WHERE business_id = $1 AND active = TRUE ORDER BY name ASC LIMIT 200', [businessId]),
    ]);
    res.json({
      canStock: canStockLots(access),
      batches: data.batches.map((row) => {
        const productCost = products.rows.find((p) => p.id === row.product_id)?.cost;
        return publicBatch({ ...row, unit_cost: productCost });
      }),
      pulls: data.pulls,
      checks: data.checks,
      products: products.rows,
      suppliers: suppliers.rows,
      locations: locations.rows,
    });
  }));

  router.post(`${base}/receive`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    if (!canStockLots(access)) throw err(403, 'lot_stock_forbidden', LOT_STOCK_DOOR_MESSAGE);
    await assertNotInGrace(pool(), req.params.bid);
    const input = cleanReceiving(req.body || {});
    const businessId = access.business.id;
    const userName = actorName(req, access);

    let receivedCost = null;
    const result = await withTx(pool(), async (client) => {
      const product = await loadProduct(businessId, input.product_id, client);
      if (!product) throw err(400, 'lot_product_needed', 'Choose the product this delivery belongs to.');
      receivedCost = Number(product.cost) || 0;
      const location = await loadLocation(businessId, input.location_id, client);
      const supplierName = input.supplier_name || product.supplier_name || '';
      const supplierId = input.supplier_id || product.supplier_id || '';

      // The receiving check rides EVERY receiving: the temp
      // and any refusal are the back-door record (the rider).
      const checkId = crypto.randomUUID();
      let batch = null;
      let movement = null;

      if (!input.refused) {
        // Stock in through the movement funnel, then stamp
        // the lot onto the movement so the lot is CARRIED
        // THROUGH movements from its first step.
        const written = await recordMovementTx(client, {
          businessId,
          product,
          location,
          type: 'receive',
          quantity: input.quantity,
          note: input.note || '',
          reference: input.lot_code,
          supplierName,
          unitCost: Number(product.cost) || 0,
          userName,
          planKey: access.planKey,
          caller: req.user,
        });
        movement = written.movement;
        await client.query('UPDATE stock_movements SET lot_code = $1 WHERE id = $2', [input.lot_code, movement.id]);

        const batchId = crypto.randomUUID();
        const { rows } = await client.query(
          `INSERT INTO stock_batches
             (id, business_id, product_id, product_name, sku, location_id, location_name, quantity,
              expires_on, note, lot_code, supplier_id, supplier_name, status, actual_weight, weight_unit,
              created_by_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$15,$16,$17) RETURNING *`,
          [batchId, businessId, product.id, product.name, product.sku || '', location?.id ?? null, location?.name || '',
            input.quantity, input.expires_on, input.note || '', input.lot_code, supplierId, supplierName,
            input.actual_weight, input.weight_unit || product.unit || '', req.user.id, userName],
        );
        batch = rows[0];
      }

      await client.query(
        `INSERT INTO receiving_checks
           (id, business_id, product_id, product_name, sku, supplier_id, supplier_name, lot_code,
            location_id, location_name, temperature, scale, refused, refusal_reason, actual_weight,
            weight_unit, batch_id, note, created_by_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [checkId, businessId, product.id, product.name, product.sku || '', supplierId, supplierName,
          input.lot_code, location?.id ?? null, location?.name || '', input.temperature, input.scale,
          input.refused, input.refusal_reason, input.actual_weight, input.weight_unit || product.unit || '',
          batch?.id ?? null, input.note || '', req.user.id, userName],
      );
      return { batch, movementId: movement?.id ?? null, checkId };
    });

    res.json({
      ok: true,
      refused: input.refused,
      batch: result.batch ? publicBatch({ ...result.batch, unit_cost: receivedCost }) : null,
      movementId: result.movementId,
      checkId: result.checkId,
    });
  }));

  router.post(`${base}/checks`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const input = cleanReceivingCheck(req.body || {});
    const businessId = access.business.id;
    const userName = actorName(req, access);
    const product = await loadProduct(businessId, input.product_id);
    if (!product) throw err(400, 'lot_product_needed', 'Choose the product this delivery belongs to.');
    const location = await loadLocation(businessId, input.location_id);
    const id = crypto.randomUUID();
    const { rows } = await pool().query(
      `INSERT INTO receiving_checks
         (id, business_id, product_id, product_name, sku, supplier_id, supplier_name, lot_code,
          location_id, location_name, temperature, scale, refused, refusal_reason, actual_weight,
          weight_unit, batch_id, note, created_by_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [id, businessId, product.id, product.name, product.sku || '',
        input.supplier_id || product.supplier_id || '', input.supplier_name || product.supplier_name || '',
        input.lot_code, location?.id ?? null, location?.name || '', input.temperature, input.scale,
        input.refused, input.refusal_reason, input.actual_weight, input.weight_unit || product.unit || '',
        null, input.note || '', req.user.id, userName],
    );
    res.json({ ok: true, check: rows[0] });
  }));

  router.post(`${base}/pull`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    if (!canStockLots(access)) throw err(403, 'lot_stock_forbidden', LOT_STOCK_DOOR_MESSAGE);
    await assertNotInGrace(pool(), req.params.bid);
    const input = cleanPull(req.body || {});
    const businessId = access.business.id;
    const userName = actorName(req, access);

    const pull = await withTx(pool(), async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM stock_batches WHERE id = $1 AND business_id = $2 LIMIT 1',
        [input.batch_id, businessId],
      );
      const batch = rows[0];
      if (!batch) throw err(404, 'lot_batch_not_found', LOT_BATCH_MESSAGE);
      if (batch.status === 'pulled') throw err(400, 'lot_already_pulled', LOT_ALREADY_PULLED_MESSAGE);

      const product = await loadProduct(businessId, batch.product_id, client);
      const location = await loadLocation(businessId, batch.location_id, client);
      const remaining = Number(batch.quantity) || 0;
      let movement = null;
      let waste = null;

      if (product && location && remaining > 0) {
        // What was left flows into the costed waste log
        // with its reason, on a 'write_off' movement that
        // carries the lot — the shelf is set to zero for
        // this batch honestly, never silently.
        const written = await recordMovementTx(client, {
          businessId,
          product,
          location,
          type: 'write_off',
          quantity: remaining,
          note: input.reason,
          reference: batch.lot_code || batch.id,
          supplierName: batch.supplier_name || '',
          unitCost: Number(product.cost) || 0,
          userName,
          planKey: access.planKey,
          caller: req.user,
        });
        movement = written.movement;
        await client.query('UPDATE stock_movements SET lot_code = $1 WHERE id = $2', [batch.lot_code || '', movement.id]);

        const wasteId = crypto.randomUUID();
        const { rows: wasteRows } = await client.query(
          `INSERT INTO waste_entries
             (id, business_id, product_id, product_name, sku, location_id, location_name, quantity,
              reason, unit_cost, movement_id, note, lot_code, created_by_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'recall',$10,$11,$12,$13,$14,$15) RETURNING *`,
          [wasteId, businessId, product.id, product.name, product.sku || '', location.id, location.name,
            remaining, Number(product.cost) || 0, movement.id, input.reason, batch.lot_code || '', req.user.id, userName],
        );
        waste = wasteRows[0];
      }

      // The batch LOCKS: pulled, and its remaining quantity
      // is gone from the batch record itself.
      await client.query(
        "UPDATE stock_batches SET status = 'pulled', quantity = 0, updated_at = NOW() WHERE id = $1",
        [batch.id],
      );

      const pullId = crypto.randomUUID();
      const { rows: pullRows } = await client.query(
        `INSERT INTO lot_pulls
           (id, business_id, batch_id, product_id, product_name, sku, lot_code, supplier_id,
            supplier_name, location_id, location_name, quantity, reason, waste_entry_id,
            movement_id, created_by_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [pullId, businessId, batch.id, batch.product_id, batch.product_name, batch.sku || '',
          batch.lot_code || '', batch.supplier_id || '', batch.supplier_name || '',
          batch.location_id, batch.location_name || '', remaining, input.reason,
          waste?.id ?? null, movement?.id ?? null, req.user.id, userName],
      );
      return pullRows[0];
    });

    res.json({ ok: true, pull });
  }));

  router.get(`${base}/recall`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const lot = cleanLotQuery(req.query.lot);
    const data = await sources(access.business.id);
    res.json(recallAnswer(data, lot));
  }));

  router.get(`${base}/trace`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const data = await sources(access.business.id);
    const lines = traceLines(data, { supplier: req.query.supplier || '', lot: req.query.lot || '' });
    res.json({ lines });
  }));

  return router;
}
