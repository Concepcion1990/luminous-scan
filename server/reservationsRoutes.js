/**
 * Reservations book + walk-in waitlist — HTTP surface
 * (Nov 26, 2026; plan release 376 with its two riders).
 *
 *   GET    /api/businesses/:bid/reservations?from&to     any member: the book over a date range
 *   GET    /api/businesses/:bid/reservations/today?date  any member: one day's list (the Today page's feed)
 *   POST   /api/businesses/:bid/reservations             host door: book a reservation
 *   PUT    /api/businesses/:bid/reservations/:rid        host door: edit a booking (status rides here)
 *   DELETE /api/businesses/:bid/reservations/:rid        host door: remove a booking
 *   POST   /api/businesses/:bid/reservations/digest      host door: send today's digest to the team
 *   GET    /api/businesses/:bid/waitlist                 any member: tonight's queue + its kept record
 *   POST   /api/businesses/:bid/waitlist                 host door: add a party to the queue
 *   PUT    /api/businesses/:bid/waitlist/:wid            host door: move a party (seated / no-show / dropped)
 *   POST   /api/businesses/:bid/waitlist/:wid/ready      host door: "your table is ready" (text gated, email live)
 *
 * BUSINESS-ONLY: every door sits behind the restaurant
 * corner's plan gate. HOST DOOR: writes ride the
 * owner-grant tick `reservations.host` (owner and
 * managers always; the tick is off by default for
 * everyone else). The digest rides the existing team
 * messaging — one workforce_notifications row per team
 * member, the inbox fan-out every team event uses — so
 * the whole team opens the same today's list.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import { smsConfigured } from './smsGate.js';
import {
  HOST_MESSAGE,
  canTakeReservations,
  createReservation,
  createWaitlistEntry,
  deleteReservation,
  digestText,
  listReservations,
  listWaitlist,
  notifyWaitlistReady,
  reservationsOn,
  updateReservation,
  updateWaitlistEntry,
} from './reservationsCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] reservations route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanDateParam(value) {
  const raw = String(value || '');
  return DATE_RE.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}

export function createReservationsRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const book = '/businesses/:bid/reservations';
  const queue = '/businesses/:bid/waitlist';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    return access;
  }

  async function hostCtx(req) {
    const access = await ctx(req);
    if (!canTakeReservations(access)) throw err(403, 'reservations_host', HOST_MESSAGE);
    return access;
  }

  const doors = (access) => ({
    isOwner: Boolean(access.isOwner),
    canHost: canTakeReservations(access),
    textAvailable: smsConfigured(),
  });

  router.get(book, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const reservations = await listReservations(pool(), access.business.id, {
      from: req.query.from ? String(req.query.from) : null,
      to: req.query.to ? String(req.query.to) : null,
    });
    res.json({ ...doors(access), reservations });
  }));

  router.get(`${book}/today`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const date = cleanDateParam(req.query.date);
    const reservations = await reservationsOn(pool(), access.business.id, date);
    res.json({ ...doors(access), date, reservations });
  }));

  router.post(`${book}/digest`, asyncHandler(async (req, res) => {
    const access = await hostCtx(req);
    const date = cleanDateParam(req.body?.date || req.query.date);
    const todays = await reservationsOn(pool(), access.business.id, date);
    const detail = digestText(todays, date, access.business.language || 'en');
    // The team-messaging fan-out: the owner plus every
    // active team member who has an account to land in —
    // one inbox row each, the workforce pattern.
    const recipients = [{ userId: access.business.owner_id, staffId: null, role: 'owner' }];
    const team = (await pool().query(
      "SELECT * FROM staff_members WHERE business_id = $1 AND status = 'active' ORDER BY full_name ASC",
      [access.business.id],
    )).rows;
    for (const member of team) {
      const user = (await pool().query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
        [member.email],
      )).rows[0];
      if (user && user.id !== access.business.owner_id) {
        recipients.push({ userId: user.id, staffId: member.id, role: 'staff' });
      }
    }
    for (const recipient of recipients) {
      await pool().query(
        `INSERT INTO workforce_notifications
           (id, business_id, recipient_user_id, recipient_staff_id, recipient_role, actor_staff_id, actor_name, event, detail, entry_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [crypto.randomUUID(), access.business.id, recipient.userId, recipient.staffId,
          recipient.role, null, '', 'reservations_digest', detail, null],
      );
    }
    res.json({ sent: recipients.length, date, reservations: todays.length });
  }));

  router.post(book, asyncHandler(async (req, res) => {
    const access = await hostCtx(req);
    const reservation = await createReservation(pool(), access.business.id, req.body || {}, { userId: req.user.id });
    res.status(201).json({ reservation });
  }));

  router.put(`${book}/:rid`, asyncHandler(async (req, res) => {
    const access = await hostCtx(req);
    const reservation = await updateReservation(pool(), access.business.id, req.params.rid, req.body || {});
    res.json({ reservation });
  }));

  router.delete(`${book}/:rid`, asyncHandler(async (req, res) => {
    const access = await hostCtx(req);
    await deleteReservation(pool(), access.business.id, req.params.rid);
    res.json({ deleted: true });
  }));

  router.get(queue, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const entries = await listWaitlist(pool(), access.business.id);
    res.json({ ...doors(access), entries });
  }));

  router.post(queue, asyncHandler(async (req, res) => {
    const access = await hostCtx(req);
    const entry = await createWaitlistEntry(pool(), access.business.id, req.body || {}, { userId: req.user.id });
    res.status(201).json({ entry });
  }));

  router.put(`${queue}/:wid`, asyncHandler(async (req, res) => {
    const access = await hostCtx(req);
    const entry = await updateWaitlistEntry(pool(), access.business.id, req.params.wid, req.body || {});
    res.json({ entry });
  }));

  router.post(`${queue}/:wid/ready`, asyncHandler(async (req, res) => {
    const access = await hostCtx(req);
    const result = await notifyWaitlistReady(pool(), access.business, req.params.wid);
    res.json(result);
  }));

  return router;
}
