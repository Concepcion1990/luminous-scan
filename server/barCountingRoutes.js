/**
 * Bar counting — HTTP surface (Nov 26, 2026; plan release
 * 379: Gap 10, the no-hardware version).
 *
 *   GET  /api/businesses/:bid/bar-counting          any member: the switch + the sheet by storage area
 *   POST /api/businesses/:bid/bar-counting/toggle   OWNER only: turn the bar section on or off
 *   POST /api/businesses/:bid/bar-counting/count    counts door: save a bar count as a count session
 *
 * BUSINESS-ONLY: every door sits behind the restaurant
 * corner's plan gate. The section stays hidden until the
 * owner turns it on (anti-clutter rule 3); while it is
 * off the read carries no sheet and no count can be saved.
 * A saved bar count is an ordinary count session — review
 * and apply run on the Counts page, and the applied
 * differences feed the theoretical-vs-actual variance.
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import {
  BAR_COUNT_MESSAGE,
  BAR_OWNER_MESSAGE,
  canBarCount,
  canToggleBar,
  listBarCounting,
  saveBarCount,
  setBarCountingEnabled,
} from './barCountingCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] bar counting route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createBarCountingRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/bar-counting';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    return access;
  }

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const data = await listBarCounting(pool(), access.business.id);
    res.json({ isOwner: Boolean(access.isOwner), canCount: canBarCount(access), ...data });
  }));

  router.post(`${base}/toggle`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    if (!canToggleBar(access)) throw err(403, 'bar_counting_forbidden', BAR_OWNER_MESSAGE);
    const result = await setBarCountingEnabled(pool(), access.business.id, req.body?.enabled === true);
    res.json(result);
  }));

  router.post(`${base}/count`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    if (!canBarCount(access)) throw err(403, 'bar_counting_forbidden', BAR_COUNT_MESSAGE);
    const result = await saveBarCount(pool(), access.business.id, req.body || {}, { userId: req.user.id });
    res.status(201).json(result);
  }));

  return router;
}
