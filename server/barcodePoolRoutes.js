/**
 * The barcode pool — HTTP surface (Nov 25, 2026).
 *
 *   POST /api/businesses/:bid/barcode-pool/mint    owner: mint N codes into the pool
 *   GET  /api/businesses/:bid/barcode-pool         owner: the pool at a glance (total / waiting)
 *   GET  /api/businesses/:bid/barcode-pool/check   any member: is this scanned code one of ours?
 *
 * The owner's spec (print-code-pool/spec.md):
 *   - The door is in the Print section, on BOTH plans (no plan
 *     gate anywhere in this surface), and the OWNER mints —
 *     the mint and the summary sit behind the same owner door
 *     as every other owner-only surface.
 *   - NO LIMIT on the quantity minted.
 *   - Minting creates NO inventory: no product, no stock —
 *     the codes wait in the pool (migration 057) until a
 *     product in the same business takes one as its code.
 *   - The check is per-business: a code from ANOTHER business's
 *     pool answers pool:false, exactly like any unknown code,
 *     so the scan keeps its honest no-match and no business
 *     can ever claim another's codes.
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { checkPoolCode, cleanPoolCount, mintPoolCodes, poolSummary } from './barcodePoolCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] barcode pool route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createBarcodePoolRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/barcode-pool';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    return access;
  }

  async function ownerCtx(req) {
    const access = await ctx(req);
    if (!access.isOwner) throw err(403, 'pool_owner_mints', 'Only the owner makes barcodes for the pool.');
    return access;
  }

  router.post(`${base}/mint`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    const count = cleanPoolCount(req.body?.count);
    const codes = await mintPoolCodes(pool(), access.business.id, count, { userId: req.user.id });
    const summary = await poolSummary(pool(), access.business.id);
    res.status(201).json({ codes, ...summary });
  }));

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    res.json(await poolSummary(pool(), access.business.id));
  }));

  router.get(`${base}/check`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const result = await checkPoolCode(pool(), access.business.id, String(req.query.code || ''));
    res.json(result);
  }));

  return router;
}
