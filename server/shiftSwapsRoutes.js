/**
 * Shift swaps, covers and the open-shift pool — plus staff
 * availability — HTTP surface (Nov 26, 2026; plan Part 7,
 * item 391, round-2 Gap 2).
 *
 *   GET   /api/businesses/:bid/shift-swaps               the board: offers, requests, flags
 *   POST  /api/businesses/:bid/shift-swaps               offer a shift (pool or trade)
 *   PATCH /api/businesses/:bid/shift-swaps/:id           { action: accept | approve | decline | cancel, decision_reason }
 *   GET   /api/businesses/:bid/shift-swaps/availability  availability rows (team for leadership, own for staff)
 *   PUT   /api/businesses/:bid/shift-swaps/availability  save MY availability (own record only)
 *
 * GENERAL — both plans, no plan gate on this router at all:
 * the feature lives with the general workforce tools (her
 * Q1–Q4 pattern), and the Restaurant Team & Place shelf
 * cross-links it like the other general features.
 *
 * Doctrines (the core carries the math; these doors carry
 * the authority):
 *  - Staff initiate; NOTHING lands without manager
 *    approval. work_schedules is rewritten only inside the
 *    approval transaction, in the same breath that marks
 *    the swap approved — no silent schedule changes.
 *  - The hierarchy mirrors time-off: a manager decides
 *    staff swaps; a swap involving a manager is the
 *    owner's to decide.
 *  - The overtime flag rides the labor-watch engine
 *    (release 374): every open swap on the board carries
 *    the engine's verdict on the week as the swap would
 *    leave it, computed BEFORE any approval.
 *  - Availability is the person's own record: the PUT door
 *    writes the caller's rows and nobody else's, ever.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace, withTx } from './billing.js';
import { personLevel } from './workforceRoutes.js';
import { getSettings } from './laborWarningsCore.js';
import {
  ALREADY_OFFERED_MESSAGE,
  BAD_ACTION_MESSAGE,
  DECLINE_REASON_MESSAGE,
  MANAGER_SWAP_OWNER_MESSAGE,
  NOT_FOUND_MESSAGE,
  NOT_OPEN_MESSAGE,
  NOT_OWN_SHIFT_MESSAGE,
  ONLY_NAMED_MESSAGE,
  ONLY_REQUESTER_CANCEL_MESSAGE,
  OWN_SHIFT_TAKE_MESSAGE,
  PARTNER_NO_SHIFT_MESSAGE,
  SAME_ROLE_POOL_MESSAGE,
  SCHEDULE_CHANGED_MESSAGE,
  STAFF_DECIDE_MESSAGE,
  TAKER_BUSY_MESSAGE,
  TRADE_PARTNER_MESSAGE,
  applySwapToSchedules,
  availabilityConflict,
  cleanAvailabilityDays,
  sameRole,
  swapOvertimeFlags,
} from './shiftSwapsCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] shift-swaps route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createShiftSwapsRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/shift-swaps';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    return { access, level: access.isOwner ? 'owner' : personLevel(access.staffRow), me: access.staffRow };
  }

  function requirePerson(access) {
    if (!access.staffRow) {
      throw err(400, 'no_staff_profile', 'Only team members with a staff profile can do this.');
    }
    return access.staffRow;
  }

  async function team(businessId) {
    const { rows } = await pool().query(
      "SELECT * FROM staff_members WHERE business_id = $1 AND status = 'active' ORDER BY full_name ASC",
      [businessId],
    );
    return rows;
  }

  async function personOr404(businessId, staffId) {
    const { rows } = await pool().query(
      'SELECT * FROM staff_members WHERE id = $1 AND business_id = $2 LIMIT 1',
      [staffId, businessId],
    );
    if (!rows[0]) throw err(404, 'not_found', 'That team member is not in this business.');
    return rows[0];
  }

  async function scheduleRows(businessId, client = null) {
    const q = client || pool();
    const { rows } = await q.query('SELECT * FROM work_schedules WHERE business_id = $1', [businessId]);
    return rows;
  }

  async function availabilityRows(businessId) {
    const { rows } = await pool().query('SELECT * FROM staff_availability WHERE business_id = $1', [businessId]);
    return rows;
  }

  // ---- Notifications (the workforce inbox pattern: one row
  // per recipient user, created at event time) ---------------

  async function userForStaffRow(row) {
    if (!row) return null;
    const { rows } = await pool().query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [row.email]);
    return rows[0] ?? null;
  }

  async function notifyUser(business, { recipientUserId, recipientStaffId = null, recipientRole = 'staff', actorStaffId = null, actorName = '', event, detail, refId = null }) {
    if (!recipientUserId) return;
    await pool().query(
      `INSERT INTO workforce_notifications
         (id, business_id, recipient_user_id, recipient_staff_id, recipient_role, actor_staff_id, actor_name, event, detail, entry_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [crypto.randomUUID(), business.id, recipientUserId, recipientStaffId, recipientRole, actorStaffId, actorName, event, detail, refId],
    );
  }

  async function notifyPerson(business, person, opts) {
    const user = await userForStaffRow(person);
    if (user) {
      await notifyUser(business, { ...opts, recipientUserId: user.id, recipientStaffId: person.id, recipientRole: personLevel(person) });
    }
  }

  async function notifyLeadership(business, actor, opts) {
    await notifyUser(business, { ...opts, recipientUserId: business.owner_id, recipientStaffId: null, recipientRole: 'owner' });
    const folks = await team(business.id);
    for (const member of folks) {
      if (personLevel(member) !== 'manager' || member.id === actor?.id) continue;
      await notifyPerson(business, member, opts);
    }
  }

  function actorNameOf(access, user, me) {
    return access.isOwner ? 'Owner' : me?.full_name || user.email;
  }

  const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function shiftText(swap) {
    return `${WEEKDAY_SHORT[Number(swap.weekday)] || ''} ${swap.start_time} – ${swap.end_time}`;
  }

  // ---- The board ------------------------------------------------

  async function shapeSwaps(access, level, me, swaps) {
    const businessId = access.business.id;
    const folks = await team(businessId);
    const byId = new Map(folks.map((p) => [p.id, p]));
    const settings = await getSettings(pool(), businessId);
    const schedules = await scheduleRows(businessId);
    const availability = await availabilityRows(businessId);
    const availByPerson = new Map();
    for (const row of availability) {
      if (!availByPerson.has(row.staff_member_id)) availByPerson.set(row.staff_member_id, []);
      availByPerson.get(row.staff_member_id).push(row);
    }
    const people = folks.map((p) => ({
      id: p.id, full_name: p.full_name, role_name: p.role_name || '',
      pay_type: 'hourly', hourly_rate: 0, annual_salary: 0,
    }));
    const nameOf = (id) => byId.get(id)?.full_name || '';

    return swaps.map((swap) => {
      const takerId = swap.accepted_by_id || swap.target_id
        || (swap.kind === 'pool' && swap.status === 'pending' && me && swap.requester_id !== me.id ? me.id : null);
      const open = swap.status === 'pending' || swap.status === 'accepted';
      const flags = open && takerId
        ? swapOvertimeFlags({ settings, people, schedules, swap, takerId })
        : [];
      const takerConflict = open && takerId
        ? availabilityConflict(availByPerson.get(takerId) || [], swap)
        : null;
      const viewerConflict = open && me && swap.requester_id !== me.id
        && (swap.kind === 'pool' || swap.target_id === me.id)
        ? availabilityConflict(availByPerson.get(me.id) || [], swap)
        : null;
      return {
        ...swap,
        requester_name: nameOf(swap.requester_id),
        requester_role: byId.get(swap.requester_id)?.role_name || '',
        target_name: swap.target_id ? nameOf(swap.target_id) : '',
        taker_id: takerId,
        taker_name: takerId ? nameOf(takerId) : '',
        overtime_flags: flags,
        taker_availability_conflict: takerConflict,
        viewer_availability_conflict: viewerConflict,
      };
    });
  }

  router.get(base, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    let query = 'SELECT * FROM shift_swap_requests WHERE business_id = $1';
    const params = [req.params.bid];
    if (level === 'staff') {
      query += ` AND (requester_id = $2 OR target_id = $2 OR accepted_by_id = $2
                      OR (kind = 'pool' AND status = 'pending'))`;
      params.push(me?.id || 'none');
    }
    query += ' ORDER BY created_at DESC LIMIT 200';
    const { rows } = await pool().query(query, params);
    const swaps = await shapeSwaps(access, level, me, rows);
    // The shift days a trade can name: leadership sees the
    // team's week (they build it); a team member sees their
    // own week plus their same-role coworkers' — exactly the
    // people they may trade with, nothing wider.
    const folks = await team(req.params.bid);
    const myRole = me ? folks.find((p) => p.id === me.id) : null;
    const visibleIds = new Set(
      level !== 'staff'
        ? folks.map((p) => p.id)
        : folks.filter((p) => p.id === me?.id || (myRole && sameRole(myRole, p))).map((p) => p.id),
    );
    const schedules = await scheduleRows(req.params.bid);
    const teamShifts = schedules
      .filter((s) => visibleIds.has(s.staff_member_id))
      .map((s) => ({
        staff_member_id: s.staff_member_id, weekday: Number(s.weekday),
        start_time: s.start_time, end_time: s.end_time,
      }));
    return res.json({ swaps, team_shifts: teamShifts, level, my_staff_id: me?.id || null });
  }));

  router.post(base, asyncHandler(async (req, res) => {
    const { access, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const person = requirePerson(access);
    const kind = String(req.body?.kind || '');
    const weekday = Number(req.body?.weekday);
    const schedules = await scheduleRows(req.params.bid);
    const mine = schedules.find((s) => s.staff_member_id === person.id && Number(s.weekday) === weekday);
    if (!mine || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw err(400, 'swap_shift', NOT_OWN_SHIFT_MESSAGE);
    }
    const { rows: open } = await pool().query(
      `SELECT id FROM shift_swap_requests WHERE business_id = $1 AND requester_id = $2 AND weekday = $3
         AND status IN ('pending', 'accepted') LIMIT 1`,
      [req.params.bid, person.id, weekday],
    );
    if (open.length) throw err(400, 'swap_open', ALREADY_OFFERED_MESSAGE);

    let target = null;
    let targetShift = null;
    if (kind === 'trade') {
      const targetId = String(req.body?.target_id || '');
      target = targetId ? await personOr404(req.params.bid, targetId).catch(() => null) : null;
      if (!target || target.id === person.id || target.status !== 'active' || !sameRole(person, target)) {
        throw err(400, 'swap_trade', TRADE_PARTNER_MESSAGE);
      }
      const targetWeekday = Number(req.body?.target_weekday);
      targetShift = schedules.find((s) => s.staff_member_id === target.id && Number(s.weekday) === targetWeekday) || null;
      if (!targetShift) throw err(400, 'swap_trade', PARTNER_NO_SHIFT_MESSAGE);
    } else if (kind !== 'pool') {
      throw err(400, 'swap_trade', TRADE_PARTNER_MESSAGE);
    }

    const inserted = await pool().query(
      `INSERT INTO shift_swap_requests
         (id, business_id, requester_id, kind, weekday, start_time, end_time,
          target_id, target_weekday, target_start_time, target_end_time, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        crypto.randomUUID(), req.params.bid, person.id, kind, weekday, mine.start_time, mine.end_time,
        target?.id || null,
        targetShift ? Number(targetShift.weekday) : null,
        targetShift?.start_time || null,
        targetShift?.end_time || null,
        String(req.body?.note || '').trim().slice(0, 500),
      ],
    );
    const swap = inserted.rows[0];
    const detail = kind === 'trade'
      ? `${person.full_name} offered to trade their ${shiftText(swap)} shift for your ${WEEKDAY_SHORT[Number(swap.target_weekday)]} ${swap.target_start_time} – ${swap.target_end_time} shift.`
      : `${person.full_name} offered their ${shiftText(swap)} shift to the pool.`;
    if (kind === 'trade' && target) {
      await notifyPerson(access.business, target, {
        actorStaffId: person.id, actorName: person.full_name, event: 'swap_offered', detail, refId: swap.id,
      });
    } else {
      await notifyLeadership(access.business, person, {
        actorStaffId: person.id, actorName: person.full_name, event: 'swap_offered', detail, refId: swap.id,
      });
    }
    const [shaped] = await shapeSwaps(access, access.isOwner ? 'owner' : personLevel(person), person, [swap]);
    return res.status(201).json({ swap: shaped });
  }));

  router.patch(`${base}/:id`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const action = String(req.body?.action || '');
    if (!['accept', 'approve', 'decline', 'cancel'].includes(action)) {
      throw err(400, 'swap_action', BAD_ACTION_MESSAGE);
    }
    const { rows } = await pool().query(
      'SELECT * FROM shift_swap_requests WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.id, req.params.bid],
    );
    const swap = rows[0];
    if (!swap) throw err(404, 'not_found', NOT_FOUND_MESSAGE);
    const requester = await personOr404(req.params.bid, swap.requester_id);
    const actor = actorNameOf(access, req.user, me);

    if (action === 'cancel') {
      if (!me || swap.requester_id !== me.id) throw err(403, 'forbidden', ONLY_REQUESTER_CANCEL_MESSAGE);
      if (swap.status !== 'pending' && swap.status !== 'accepted') throw err(400, 'swap_closed', NOT_OPEN_MESSAGE);
      const updated = await pool().query(
        `UPDATE shift_swap_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [swap.id],
      );
      if (swap.status === 'accepted') {
        await notifyLeadership(access.business, me, {
          actorStaffId: me.id, actorName: me.full_name, event: 'swap_cancelled',
          detail: `${me.full_name} cancelled their offered ${shiftText(swap)} shift.`, refId: swap.id,
        });
      }
      const [shaped] = await shapeSwaps(access, level, me, updated.rows);
      return res.json({ swap: shaped });
    }

    if (action === 'accept') {
      const person = requirePerson(access);
      if (swap.status !== 'pending') throw err(400, 'swap_closed', NOT_OPEN_MESSAGE);
      if (swap.requester_id === person.id) throw err(400, 'swap_own', OWN_SHIFT_TAKE_MESSAGE);
      if (swap.kind === 'trade') {
        if (swap.target_id !== person.id) throw err(403, 'forbidden', ONLY_NAMED_MESSAGE);
      } else if (!sameRole(requester, person)) {
        throw err(403, 'forbidden', SAME_ROLE_POOL_MESSAGE);
      }
      const updated = await pool().query(
        `UPDATE shift_swap_requests SET status = 'accepted', accepted_by_id = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [person.id, swap.id],
      );
      await notifyLeadership(access.business, person, {
        actorStaffId: person.id, actorName: person.full_name, event: 'swap_accepted',
        detail: `${person.full_name} can take the ${shiftText(swap)} shift offered by ${requester.full_name}. It is waiting for a manager's approval.`,
        refId: swap.id,
      });
      await notifyPerson(access.business, requester, {
        actorStaffId: person.id, actorName: person.full_name, event: 'swap_accepted',
        detail: `${person.full_name} can take your ${shiftText(swap)} shift. It is waiting for a manager's approval.`,
        refId: swap.id,
      });
      const [shaped] = await shapeSwaps(access, level, me, updated.rows);
      return res.json({ swap: shaped });
    }

    // The named coworker may refuse a trade before accepting
    // it — that refusal is theirs at any level and needs no
    // reason. Every other decline is a leadership decision.
    if (action === 'decline' && swap.kind === 'trade' && swap.status === 'pending' && me && swap.target_id === me.id) {
      const updated = await pool().query(
        `UPDATE shift_swap_requests SET status = 'declined', decided_by_id = $1, decided_at = NOW(), updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [req.user.id, swap.id],
      );
      await notifyPerson(access.business, requester, {
        actorStaffId: me.id, actorName: me.full_name, event: 'swap_decided',
        detail: `${me.full_name} cannot trade for your ${shiftText(swap)} shift.`,
        refId: swap.id,
      });
      const [shaped] = await shapeSwaps(access, level, me, updated.rows);
      return res.json({ swap: shaped });
    }

    // Manager decisions: decline (pending or accepted) and
    // approve (accepted only — approval is the door that
    // rewrites the schedule).
    if (level === 'staff') throw err(403, 'forbidden', STAFF_DECIDE_MESSAGE);
    const involvesManager = personLevel(requester) === 'manager'
      || (swap.target_id && personLevel(await personOr404(req.params.bid, swap.target_id)) === 'manager')
      || (swap.accepted_by_id && personLevel(await personOr404(req.params.bid, swap.accepted_by_id)) === 'manager');
    if (involvesManager && level !== 'owner') {
      throw err(403, 'forbidden', MANAGER_SWAP_OWNER_MESSAGE);
    }

    if (action === 'decline') {
      // A leadership decline always carries a reason, so
      // the team members know why.
      const reason = String(req.body?.decision_reason || '').trim();
      if (!reason) throw err(400, 'reason_required', DECLINE_REASON_MESSAGE);
      if (swap.status !== 'pending' && swap.status !== 'accepted') throw err(400, 'swap_closed', NOT_OPEN_MESSAGE);
      const updated = await pool().query(
        `UPDATE shift_swap_requests SET status = 'declined', decision_reason = $1, decided_by_id = $2, decided_at = NOW(), updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [reason.slice(0, 1000), req.user.id, swap.id],
      );
      await notifyPerson(access.business, requester, {
        actorStaffId: me?.id || null, actorName: actor, event: 'swap_decided',
        detail: `Your offered ${shiftText(swap)} shift swap was declined${reason ? ` — ${reason.slice(0, 200)}` : ''}.`,
        refId: swap.id,
      });
      const takerId = swap.accepted_by_id || swap.target_id;
      if (takerId && takerId !== swap.requester_id) {
        await notifyPerson(access.business, await personOr404(req.params.bid, takerId), {
          actorStaffId: me?.id || null, actorName: actor, event: 'swap_decided',
          detail: `The ${shiftText(swap)} shift swap with ${requester.full_name} was declined${reason ? ` — ${reason.slice(0, 200)}` : ''}.`,
          refId: swap.id,
        });
      }
      const [shaped] = await shapeSwaps(access, level, me, updated.rows);
      return res.json({ swap: shaped });
    }

    // action === 'approve': the ONLY door that rewrites the
    // schedule, in the same transaction as the decision.
    if (swap.status !== 'accepted') throw err(400, 'swap_closed', NOT_OPEN_MESSAGE);
    const takerId = swap.accepted_by_id || swap.target_id;
    const taker = await personOr404(req.params.bid, takerId);
    const updated = await withTx(pool(), async (client) => {
      const schedules = await scheduleRows(req.params.bid, client);
      const applied = applySwapToSchedules(schedules, swap, takerId);
      if (!applied.ok) {
        throw err(400, 'swap_blocked', applied.code === 'taker_busy' ? TAKER_BUSY_MESSAGE : SCHEDULE_CHANGED_MESSAGE);
      }
      const rewrite = async (staffId, weekday, keep) => {
        await client.query(
          'DELETE FROM work_schedules WHERE business_id = $1 AND staff_member_id = $2 AND weekday = $3',
          [req.params.bid, staffId, weekday],
        );
        if (keep) {
          await client.query(
            `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time, created_by_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [crypto.randomUUID(), req.params.bid, staffId, weekday, keep.start_time, keep.end_time, req.user.id],
          );
        }
      };
      if (swap.kind === 'trade') {
        await rewrite(swap.requester_id, Number(swap.weekday), null);
        await rewrite(swap.target_id, Number(swap.target_weekday), null);
        await rewrite(swap.requester_id, Number(swap.target_weekday), { start_time: swap.target_start_time, end_time: swap.target_end_time });
        await rewrite(swap.target_id, Number(swap.weekday), { start_time: swap.start_time, end_time: swap.end_time });
      } else {
        await rewrite(swap.requester_id, Number(swap.weekday), null);
        await rewrite(takerId, Number(swap.weekday), { start_time: swap.start_time, end_time: swap.end_time });
      }
      const result = await client.query(
        `UPDATE shift_swap_requests SET status = 'approved', decided_by_id = $1, decided_at = NOW(), updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [req.user.id, swap.id],
      );
      return result.rows[0];
    });
    for (const person of [requester, taker]) {
      await notifyPerson(access.business, person, {
        actorStaffId: me?.id || null, actorName: actor, event: 'swap_decided',
        detail: `The ${shiftText(swap)} shift swap was approved — the schedule is updated.`,
        refId: swap.id,
      });
    }
    const [shaped] = await shapeSwaps(access, level, me, [updated]);
    return res.json({ swap: shaped });
  }));

  // ---- Availability --------------------------------------------

  router.get(`${base}/availability`, asyncHandler(async (req, res) => {
    const { level, me } = await ctx(req);
    const rows = await availabilityRows(req.params.bid);
    const visible = level === 'staff' ? rows.filter((r) => r.staff_member_id === me?.id) : rows;
    return res.json({ availability: visible, my_staff_id: me?.id || null, level });
  }));

  router.put(`${base}/availability`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const person = requirePerson(access);
    const days = cleanAvailabilityDays(req.body?.days);
    await withTx(pool(), async (client) => {
      await client.query('DELETE FROM staff_availability WHERE business_id = $1 AND staff_member_id = $2', [req.params.bid, person.id]);
      for (const day of days) {
        await client.query(
          `INSERT INTO staff_availability (business_id, staff_member_id, weekday, available, start_time, end_time, note, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [req.params.bid, person.id, day.weekday, day.available, day.start_time, day.end_time, day.note],
        );
      }
    });
    const { rows } = await pool().query(
      'SELECT * FROM staff_availability WHERE business_id = $1 AND staff_member_id = $2 ORDER BY weekday',
      [req.params.bid, person.id],
    );
    return res.json({ availability: rows });
  }));

  return router;
}
