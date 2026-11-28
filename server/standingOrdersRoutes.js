/**
 * Standing orders + supplier price book — HTTP surface
 * (Nov 26, 2026; plan release 377: Gap 8b + Q-fire 3).
 *
 *   GET    /api/businesses/:bid/standing-orders          any member: templates + the price book
 *   POST   /api/businesses/:bid/standing-orders          purchasing door: set one up
 *   PUT    /api/businesses/:bid/standing-orders/:sid     purchasing door: edit one
 *   DELETE /api/businesses/:bid/standing-orders/:sid     purchasing door: remove one
 *   POST   /api/businesses/:bid/standing-orders/:sid/draft
 *          purchasing door: make this week's DRAFT purchase
 *          order — a draft for owner confirmation, never
 *          sent by the app (no silent changes, money edition)
 *
 * BUSINESS-ONLY: every door sits behind the restaurant
 * corner's plan gate. The price book is computed at read
 * time from the business's own invoices and orders.
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import {
  ORDER_MESSAGE,
  canOrder,
  createStandingOrder,
  deleteStandingOrder,
  fetchPriceBook,
  listStandingOrders,
  makeDraftOrder,
  updateStandingOrder,
} from './standingOrdersCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] standing orders route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createStandingOrdersRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/standing-orders';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    return access;
  }

  async function orderCtx(req) {
    const access = await ctx(req);
    if (!canOrder(access)) throw err(403, 'standing_orders_forbidden', ORDER_MESSAGE);
    return access;
  }

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const [standingOrders, priceBook] = await Promise.all([
      listStandingOrders(pool(), access.business.id),
      fetchPriceBook(pool(), access.business.id),
    ]);
    res.json({ isOwner: Boolean(access.isOwner), canOrder: canOrder(access), standingOrders, priceBook });
  }));

  router.post(base, asyncHandler(async (req, res) => {
    const access = await orderCtx(req);
    const standingOrder = await createStandingOrder(pool(), access.business.id, req.body || {}, { userId: req.user.id });
    res.status(201).json({ standingOrder });
  }));

  router.put(`${base}/:sid`, asyncHandler(async (req, res) => {
    const access = await orderCtx(req);
    const standingOrder = await updateStandingOrder(pool(), access.business.id, req.params.sid, req.body || {});
    res.json({ standingOrder });
  }));

  router.delete(`${base}/:sid`, asyncHandler(async (req, res) => {
    const access = await orderCtx(req);
    await deleteStandingOrder(pool(), access.business.id, req.params.sid);
    res.json({ deleted: true });
  }));

  router.post(`${base}/:sid/draft`, asyncHandler(async (req, res) => {
    const access = await orderCtx(req);
    const draft = await makeDraftOrder(pool(), access.business.id, req.params.sid, { userId: req.user.id });
    res.status(201).json({ draft });
  }));

  return router;
}
