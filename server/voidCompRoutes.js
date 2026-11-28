/**
 * Void & comp log — HTTP surface (Nov 26, 2026; plan
 * Part 7, owner-ruled addition G-C, gap-check round 3).
 *
 *   GET  /api/businesses/:bid/void-comp   the register (owner / manager)
 *   POST /api/businesses/:bid/void-comp   record one void or comp (owner / manager)
 *
 * BUSINESS-ONLY: every door sits behind the restaurant
 * corner's plan gate, and the feature is invisible on
 * Essentials.
 *
 * OWNER/MANAGER MONEY (the build's ruling): voids and
 * comps are money. Every door refuses a caller who is
 * neither the owner nor a manager BEFORE any row is read
 * or written — the level is derived server-side from the
 * caller's access (the house personLevel test), never
 * trusted from the client, and a plain staff member's
 * read carries nothing at all.
 *
 * HAND-ENTERED, HONESTLY: until a live till feed exists,
 * a person types each entry — these doors are the typing.
 * Nothing here claims an entry arrived from a till.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import { assertNotInGrace } from './billing.js';
import { personLevel } from './workforceRoutes.js';
import {
  VOIDCOMP_MONEY_MESSAGE,
  cleanVoidCompEntry,
  shapeVoidCompEntry,
  voidCompTotals,
} from './voidCompCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] void-comp route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

/** Owner/manager money: the owner, or a manager-level
 *  member (the house personLevel test — preset-manager
 *  role, or a role named "manager"). */
export function canSeeVoidComp(access) {
  if (!access) return false;
  if (access.isOwner) return true;
  return personLevel(access.staffRow) === 'manager';
}

export function createVoidCompRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/void-comp';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    if (!canSeeVoidComp(access)) throw err(403, 'voidcomp_money_only', VOIDCOMP_MONEY_MESSAGE);
    return access;
  }

  const actorName = (req, access) => (access.isOwner ? 'Owner' : access.staffRow?.full_name || req.user.email);

  async function loadLog(businessId) {
    const { rows } = await pool().query(
      'SELECT * FROM void_comp_entries WHERE business_id = $1 ORDER BY created_at DESC LIMIT 300',
      [businessId],
    );
    const entries = rows.map(shapeVoidCompEntry);
    return { entries, totals: voidCompTotals(entries) };
  }

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    return res.json({
      ...(await loadLog(access.business.id)),
      isOwner: Boolean(access.isOwner),
      isManager: !access.isOwner,
    });
  }));

  router.post(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const clean = cleanVoidCompEntry(req.body || {});
    const inserted = await pool().query(
      `INSERT INTO void_comp_entries
         (id, business_id, kind, amount, reason, approver, created_by_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        crypto.randomUUID(), access.business.id, clean.kind, clean.amount, clean.reason,
        clean.approver, req.user.id, actorName(req, access),
      ],
    );
    return res.status(201).json({ entry: shapeVoidCompEntry(inserted.rows[0]) });
  }));

  return router;
}
