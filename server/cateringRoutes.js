/**
 * Catering & private events, the simple version — HTTP
 * surface (Nov 26, 2026; plan release 375, Gap 11).
 *
 *   GET    /api/businesses/:bid/catering                 any member: the event book (money only for the owner)
 *   POST   /api/businesses/:bid/catering                 owner/manager: book an event
 *   PUT    /api/businesses/:bid/catering/:eid            owner/manager: edit an event (money fields owner-only)
 *   DELETE /api/businesses/:bid/catering/:eid            owner/manager: remove an event
 *   GET    /api/businesses/:bid/catering/:eid/prep       any member: the food this event pulls into prep
 *   GET    /api/businesses/:bid/catering/prep/upcoming   any member: every upcoming booked event with its pull (the Prep page's feed)
 *
 * BUSINESS-ONLY: every door sits behind the restaurant
 * corner's plan gate. OWNER-ONLY MONEY: deposits and
 * balances ride a response only for the owner — a manager
 * or staff member's book, event sheet and prep rows carry
 * no money keys at all. The book is kept by the owner or a
 * manager; staff read it and work from the sheet.
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import { personLevel } from './workforceRoutes.js';
import {
  OWNER_MESSAGE,
  createEvent,
  deleteEvent,
  eventPrepFor,
  getEvent,
  listEvents,
  upcomingEventPrep,
  updateEvent,
} from './cateringCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] catering route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createCateringRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/catering';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    return access;
  }

  async function writerCtx(req) {
    const access = await ctx(req);
    const level = access.isOwner ? 'owner' : personLevel(access.staffRow);
    if (level === 'staff') throw err(403, 'catering_owner', OWNER_MESSAGE);
    return access;
  }

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const events = await listEvents(pool(), access.business.id, { isOwner: Boolean(access.isOwner) });
    const level = access.isOwner ? 'owner' : personLevel(access.staffRow);
    res.json({ isOwner: Boolean(access.isOwner), canWrite: level !== 'staff', events });
  }));

  router.get(`${base}/prep/upcoming`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.today || ''))
      ? String(req.query.today)
      : new Date().toISOString().slice(0, 10);
    res.json({ upcoming: await upcomingEventPrep(pool(), access.business.id, today) });
  }));

  router.get(`${base}/:eid`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    res.json({ event: await getEvent(pool(), access.business.id, req.params.eid, { isOwner: Boolean(access.isOwner) }) });
  }));

  router.get(`${base}/:eid/prep`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    res.json({ prep: await eventPrepFor(pool(), access.business.id, req.params.eid) });
  }));

  router.post(base, asyncHandler(async (req, res) => {
    const access = await writerCtx(req);
    let input = req.body || {};
    if (!access.isOwner) {
      // Money is the owner's alone to set: a manager books
      // the event, its money starts unset.
      input = { ...input, event_total: 0, deposit: 0 };
    }
    const created = await createEvent(pool(), access.business.id, input, { userId: req.user.id });
    if (access.isOwner) return res.status(201).json({ event: created });
    const { event_total: _total, deposit: _deposit, balance_due: _balance, ...event } = created;
    return res.status(201).json({ event });
  }));

  router.put(`${base}/:eid`, asyncHandler(async (req, res) => {
    const access = await writerCtx(req);
    const event = await updateEvent(pool(), access.business.id, req.params.eid, req.body || {}, {
      isOwner: Boolean(access.isOwner),
    });
    res.json({ event });
  }));

  router.delete(`${base}/:eid`, asyncHandler(async (req, res) => {
    const access = await writerCtx(req);
    await deleteEvent(pool(), access.business.id, req.params.eid);
    res.json({ deleted: true });
  }));

  return router;
}
