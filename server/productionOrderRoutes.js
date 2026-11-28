/**
 * Order by production — HTTP surface (Nov 26, 2026; plan
 * release 378: Gap 8c).
 *
 *   GET  /api/businesses/:bid/production-order         any member: the plans on offer
 *   POST /api/businesses/:bid/production-order/plan    any member: the worked-out plan
 *   POST /api/businesses/:bid/production-order/draft   purchasing door: make the DRAFT
 *          purchase orders — drafts for owner confirmation,
 *          never sent by the app (no silent changes,
 *          money edition)
 *
 * BUSINESS-ONLY: every door sits behind the restaurant
 * corner's plan gate. Working out a plan writes nothing;
 * making drafts rides the purchasing door, the standing
 * orders' door (release 377).
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import { canOrder } from './standingOrdersCore.js';
import { PRODUCTION_MESSAGE } from './productionOrderCore.js';
import {
  listProductionSources,
  makeProductionDrafts,
  planProduction,
} from './productionOrderCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] production order route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function createProductionOrderRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/production-order';

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
    if (!canOrder(access)) throw err(403, 'production_order_forbidden', PRODUCTION_MESSAGE);
    return access;
  }

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const sources = await listProductionSources(pool(), access.business.id, todayLocal());
    res.json({ isOwner: Boolean(access.isOwner), canOrder: canOrder(access), ...sources });
  }));

  router.post(`${base}/plan`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const plan = await planProduction(pool(), access.business.id, req.body || {});
    res.json({ plan });
  }));

  router.post(`${base}/draft`, asyncHandler(async (req, res) => {
    const access = await orderCtx(req);
    const result = await makeProductionDrafts(pool(), access.business.id, req.body || {}, { userId: req.user.id });
    res.status(201).json(result);
  }));

  return router;
}
