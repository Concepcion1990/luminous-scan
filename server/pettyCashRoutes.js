/**
 * Petty cash + bank deposit log — HTTP surface
 * (Nov 26, 2026; plan Part 7, owner-ruled addition G-A,
 * gap-check G1).
 *
 *   GET  /api/businesses/:bid/petty-cash   both logs (owner only)
 *   POST /api/businesses/:bid/petty-cash   record one petty-cash taking (owner only)
 *   POST /api/businesses/:bid/petty-cash/deposits   record one bank deposit (owner only)
 *
 * GENERAL, BOTH PLANS: the two records live beside the
 * existing manager cash-up / cash count (the Payroll
 * page's cash drawer, server/workforceRoutes.js) — one
 * small money door in the cash-up family, no new page,
 * no plan gate (workforce is on both plans).
 *
 * OWNER-ONLY MONEY (the build's ruling): the tin and the
 * bank run are the owner's books. Every door refuses a
 * non-owner BEFORE any row is read or written — the
 * level is derived server-side from the caller's access,
 * never trusted from the client, and a non-owner's read
 * carries nothing at all.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';
import {
  PETTY_OWNER_MESSAGE,
  cleanPettyEntry,
  cleanDeposit,
  shapePettyEntry,
  shapeDeposit,
  pettyTotals,
} from './pettyCashCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] petty-cash route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createPettyCashRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/petty-cash';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!access.isOwner) throw err(403, 'petty_owner_only', PETTY_OWNER_MESSAGE);
    return access;
  }

  async function loadLogs(businessId) {
    const [petty, deposits] = await Promise.all([
      pool().query(
        'SELECT * FROM petty_cash_entries WHERE business_id = $1 ORDER BY entry_date DESC, created_at DESC LIMIT 300',
        [businessId],
      ),
      pool().query(
        'SELECT * FROM bank_deposits WHERE business_id = $1 ORDER BY deposit_date DESC, created_at DESC LIMIT 300',
        [businessId],
      ),
    ]);
    const pettyRows = petty.rows.map(shapePettyEntry);
    const depositRows = deposits.rows.map(shapeDeposit);
    return {
      petty_cash: pettyRows,
      deposits: depositRows,
      totals: pettyTotals(pettyRows, depositRows),
    };
  }

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    return res.json(await loadLogs(access.business.id));
  }));

  router.post(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const clean = cleanPettyEntry(req.body || {});
    const inserted = await pool().query(
      `INSERT INTO petty_cash_entries
         (id, business_id, entry_date, amount, purpose, receipt_back, initials, created_by_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        crypto.randomUUID(), access.business.id, clean.entry_date, clean.amount, clean.purpose,
        clean.receipt_back, clean.initials, req.user.id, 'Owner',
      ],
    );
    return res.status(201).json({ entry: shapePettyEntry(inserted.rows[0]) });
  }));

  router.post(`${base}/deposits`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const clean = cleanDeposit(req.body || {});
    const inserted = await pool().query(
      `INSERT INTO bank_deposits
         (id, business_id, deposit_date, amount, bag_ref, initials, created_by_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        crypto.randomUUID(), access.business.id, clean.deposit_date, clean.amount, clean.bag_ref,
        clean.initials, req.user.id, 'Owner',
      ],
    );
    return res.status(201).json({ deposit: shapeDeposit(inserted.rows[0]) });
  }));

  return router;
}
