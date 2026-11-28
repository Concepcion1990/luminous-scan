/**
 * Spill & breakage log — HTTP surface (Nov 26, 2026;
 * plan Part 7, item 392A, owner-ruled addition).
 *
 *   GET  /api/businesses/:bid/spill-log   the log: entries, products, locations, the bar switch
 *   POST /api/businesses/:bid/spill-log   record one spill or breakage (any member — a daily log)
 *
 * BUSINESS-ONLY: every door sits behind the restaurant
 * corner's plan gate, and the feature is invisible on
 * Essentials. FAMILY DISCIPLINE: the log lives with the
 * bar-counting family — while the owner has bar counting
 * OFF for the business (businesses.bar_counting_enabled,
 * migration 067), the read carries no entries and no
 * entry can be recorded, refused with the bar family's
 * own off wording.
 *
 * LOGGING IS A DAILY LOG (the waste log family's
 * doctrine): any signed-in member of the business may
 * record a spill — logging dies when it needs permission.
 *
 * LOSS, THE WASTE LOG'S WAY: recording an entry, in ONE
 * transaction, (1) writes ONE 'write_off' movement
 * through recordMovementTx — the app's existing movement
 * funnel, reference = the spill entry — clamped exactly
 * like the waste hook: when the shelf holds less than
 * the entry claims, that refusal (insufficient_stock) and
 * only that one is caught and the entry still records
 * with movement_id NULL; and (2) writes the costed
 * waste_entries row (reason 'spill' | 'breakage', the
 * entry's reason as its note, the product's current cost
 * as its unit cost), so the variance page and the
 * accounting ledger see the loss once, in the family's
 * own books. No second depletion path exists.
 *
 * MONEY: the pour cost is shaped owner-only at read
 * (publicSpill in the core) — non-owners never receive
 * unit_cost or total_cost.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import { assertNotInGrace, withTx } from './billing.js';
import { recordMovementTx } from './movements.js';
import { BAR_OFF_MESSAGE } from './barCountingCore.js';
import { SPILL_PRODUCT_MESSAGE, cleanSpillEntry, publicSpill } from './spillLogCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] spill-log route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createSpillLogRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/spill-log';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    return access;
  }

  const actorName = (req, access) => (access.isOwner ? 'Owner' : access.staffRow?.full_name || req.user.email);

  async function barEnabled(businessId) {
    const { rows } = await pool().query(
      'SELECT bar_counting_enabled FROM businesses WHERE id = $1',
      [businessId],
    );
    return rows[0]?.bar_counting_enabled === true;
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

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const businessId = access.business.id;
    const enabled = await barEnabled(businessId);
    if (!enabled) {
      return res.json({ enabled, isOwner: Boolean(access.isOwner), entries: [], products: [], locations: [] });
    }
    const [entries, products, locations] = await Promise.all([
      pool().query('SELECT * FROM spill_entries WHERE business_id = $1 ORDER BY created_at DESC LIMIT 300', [businessId]),
      pool().query("SELECT id, name, sku, unit FROM products WHERE business_id = $1 AND active = TRUE ORDER BY name ASC LIMIT 500", [businessId]),
      pool().query('SELECT id, name FROM locations WHERE business_id = $1 AND active = TRUE ORDER BY name ASC LIMIT 200', [businessId]),
    ]);
    return res.json({
      enabled,
      isOwner: Boolean(access.isOwner),
      entries: entries.rows.map((row) => publicSpill(row, access.isOwner)),
      products: products.rows,
      locations: locations.rows,
    });
  }));

  router.post(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const businessId = access.business.id;
    if (!(await barEnabled(businessId))) throw err(403, 'bar_counting_off', BAR_OFF_MESSAGE);
    await assertNotInGrace(pool(), req.params.bid);
    const input = cleanSpillEntry(req.body || {});
    const userName = actorName(req, access);

    const entry = await withTx(pool(), async (client) => {
      const { rows: productRows } = await client.query(
        'SELECT * FROM products WHERE id = $1 AND business_id = $2 LIMIT 1',
        [input.product_id, businessId],
      );
      const product = productRows[0];
      if (!product) throw err(400, 'spill_product_needed', SPILL_PRODUCT_MESSAGE);
      const location = await loadLocation(businessId, input.location_id, client);
      const unitCost = Number(product.cost) || 0;
      const spillId = crypto.randomUUID();

      // (1) The stock-out, through the movement funnel —
      // clamped like the waste hook (see the header).
      let movement = null;
      if (location) {
        try {
          const written = await recordMovementTx(client, {
            businessId,
            product,
            location,
            type: 'write_off',
            quantity: input.quantity,
            note: input.reason,
            reference: spillId,
            unitCost,
            userName,
            planKey: access.planKey,
            caller: req.user,
          });
          movement = written.movement;
        } catch (error) {
          if (error?.code !== 'insufficient_stock') throw error;
        }
      }

      // (2) The costed waste-log row, in the family's own
      // books: reason 'spill' or 'breakage'.
      const wasteId = crypto.randomUUID();
      await client.query(
        `INSERT INTO waste_entries
           (id, business_id, product_id, product_name, sku, location_id, location_name, quantity,
            reason, unit_cost, movement_id, note, lot_code, created_by_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'',$13,$14)`,
        [wasteId, businessId, product.id, product.name, product.sku || '',
          location?.id ?? null, location?.name || '', input.quantity,
          input.kind === 'breakage' ? 'breakage' : 'spill', unitCost,
          movement?.id ?? null, input.reason, req.user.id, userName],
      );

      const { rows } = await client.query(
        `INSERT INTO spill_entries
           (id, business_id, product_id, product_name, sku, location_id, location_name, quantity,
            kind, reason, unit_cost, movement_id, waste_entry_id, created_by_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [spillId, businessId, product.id, product.name, product.sku || '',
          location?.id ?? null, location?.name || '', input.quantity,
          input.kind, input.reason, unitCost, movement?.id ?? null, wasteId,
          req.user.id, userName],
      );
      return rows[0];
    });

    return res.status(201).json({ ok: true, entry: publicSpill(entry, access.isOwner) });
  }));

  return router;
}
