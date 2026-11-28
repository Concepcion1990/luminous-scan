/**
 * All-locations rollup + cross-location push — HTTP
 * surface (Nov 26, 2026; plan release 380: Gap 14 + the
 * Part 7 rider).
 *
 *   GET  /api/businesses/:bid/locations-rollup            owner: the rollup + push sources
 *   POST /api/businesses/:bid/locations-rollup/push-recipe  owner: copy one recipe to other locations
 *   POST /api/businesses/:bid/locations-rollup/push-prices  owner: copy the price set to other locations
 *
 * BUSINESS-ONLY by nature (multi-business IS Business):
 * every door sits behind the restaurant corner's plan
 * gate, and every door is the OWNER's alone — the rollup
 * is the multi-business owner's page and the push is an
 * explicit owner action, business to business, inside the
 * owner's own account only.
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import {
  ROLLUP_OWNER_MESSAGE,
  buildRollup,
  copyPrices,
  copyRecipe,
} from './locationsRollupCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] locations rollup route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createLocationsRollupRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/locations-rollup';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    if (!access.isOwner) throw err(403, 'locations_rollup_forbidden', ROLLUP_OWNER_MESSAGE);
    return access;
  }

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const data = await buildRollup(pool(), req.user, access.business.id);
    res.json({ isOwner: true, ...data });
  }));

  router.post(`${base}/push-recipe`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const result = await copyRecipe(pool(), req.user, access.business.id, req.body || {});
    res.status(201).json(result);
  }));

  router.post(`${base}/push-prices`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const result = await copyPrices(pool(), req.user, access.business.id, req.body || {});
    res.status(201).json(result);
  }));

  return router;
}
