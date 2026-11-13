/**
 * Workforce routes — scheduling, time clock, time-off, tasks,
 * payroll, cash-up and direct deposit (Workforce phase).
 *
 *   GET   /api/businesses/:bid/workforce/context
 *   GET   /api/businesses/:bid/workforce/people
 *   GET   /api/businesses/:bid/workforce/settings
 *   PATCH /api/businesses/:bid/workforce/settings            owner
 *   GET   /api/businesses/:bid/workforce/schedules
 *   PUT   /api/businesses/:bid/workforce/schedules/:staffId  owner / manager(→staff)
 *   GET   /api/businesses/:bid/workforce/clock/status
 *   POST  /api/businesses/:bid/workforce/clock/in
 *   POST  /api/businesses/:bid/workforce/clock/out           { note }
 *   POST  /api/businesses/:bid/workforce/clock/break-out     { break_type }
 *   POST  /api/businesses/:bid/workforce/clock/break-in
 *   GET   /api/businesses/:bid/workforce/entries
 *   GET   /api/businesses/:bid/workforce/notifications
 *   PATCH /api/businesses/:bid/workforce/notifications/:id
 *   GET   /api/businesses/:bid/workforce/time-off
 *   POST  /api/businesses/:bid/workforce/time-off
 *   PATCH /api/businesses/:bid/workforce/time-off/:id        hierarchy decide
 *   GET   /api/businesses/:bid/workforce/tasks
 *   POST  /api/businesses/:bid/workforce/tasks               manager / owner
 *   PATCH /api/businesses/:bid/workforce/tasks/:id
 *   GET   /api/businesses/:bid/workforce/payroll/context
 *   GET   /api/businesses/:bid/workforce/payroll/config      owner / manager
 *   PUT   /api/businesses/:bid/workforce/payroll/config      owner
 *   GET   /api/businesses/:bid/workforce/payroll/profiles
 *   PUT   /api/businesses/:bid/workforce/payroll/profiles/:staffId  owner
 *   GET   /api/businesses/:bid/workforce/payroll/preview     owner / manager
 *   POST  /api/businesses/:bid/workforce/payroll/runs        owner
 *   GET   /api/businesses/:bid/workforce/payroll/runs        owner / manager
 *   GET   /api/businesses/:bid/workforce/payroll/runs/:id    owner / manager
 *   GET   /api/businesses/:bid/workforce/payroll/my-stubs
 *   POST  /api/businesses/:bid/workforce/payroll/stubs/:id/push
 *   GET   /api/businesses/:bid/workforce/cash-ups            owner / manager
 *   POST  /api/businesses/:bid/workforce/cash-ups            owner / manager
 *   GET   /api/businesses/:bid/workforce/dd
 *   POST  /api/businesses/:bid/workforce/dd/invite           owner
 *   POST  /api/businesses/:bid/workforce/dd/submit
 *   GET   /api/businesses/:bid/workforce/dd/details/:staffId owner
 *   GET   /api/businesses/:bid/workforce/messages/threads
 *   POST  /api/businesses/:bid/workforce/messages/threads    get-or-create
 *   GET   /api/businesses/:bid/workforce/messages/threads/:id
 *   POST  /api/businesses/:bid/workforce/messages/threads/:id/messages
 *   PATCH /api/businesses/:bid/workforce/messages/threads/:id/read
 *   GET   /api/businesses/:bid/workforce/messages/unread
 *
 * Hierarchy (owner's spec): the OWNER sets the MANAGER's schedule,
 * pushes the MANAGER's stub and decides the MANAGER's time-off;
 * the MANAGER does those for STAFF. Staff clock THEMSELVES in and
 * out (an owner switch can turn self-clocking off). Every level is
 * derived server-side from the caller's staff row — never trusted
 * from the client.
 *
 * A "manager" is a staff row whose role is the preset Manager role
 * or a role named Manager. Workforce is on BOTH plans (the owner's
 * decision) — the only caps are the existing plan staff seats.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess, staffRowForEmail } from './authz.js';
import { assertNotInGrace } from './billing.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] workforce route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

async function accessOr403(pool, user, businessId) {
  const access = await resolveAccess(pool, user, businessId);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  return access;
}

// ---- People + levels -------------------------------------------------

export function personLevel(row) {
  if (!row) return 'staff';
  const name = String(row.role_name || '').trim().toLowerCase();
  if (row.role_id === 'preset-manager' || name === 'manager') return 'manager';
  return 'staff';
}

function callerLevel(access) {
  if (access.isOwner) return 'owner';
  return personLevel(access.staffRow);
}

async function people(pool, businessId, { activeOnly = true } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM staff_members WHERE business_id = $1 ${activeOnly ? "AND status = 'active'" : ''}
     ORDER BY full_name ASC`,
    [businessId],
  );
  return rows;
}

function publicPerson(row) {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role_name: row.role_name || '',
    status: row.status,
    level: personLevel(row),
  };
}

async function personOr404(pool, businessId, staffId) {
  const { rows } = await pool.query(
    'SELECT * FROM staff_members WHERE id = $1 AND business_id = $2 LIMIT 1',
    [staffId, businessId],
  );
  if (!rows[0]) throw err(404, 'not_found', 'That team member is not in this business.');
  return rows[0];
}

// ---- Business-local time ----------------------------------------------
// Shift windows are judged in the business's own timezone, in
// minutes-since-local-midnight space — no absolute-instant math, so
// DST and offsets never skew a 10-minute window. Shifts are
// same-day (end after start).

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function businessTimezone(business) {
  const tz = String(business?.timezone || '').trim();
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function localParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  const hour = Number(parts.hour) % 24;
  return {
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
    minutes: hour * 60 + Number(parts.minute),
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function hhmmToMinutes(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatLocalTime(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** Sunday (YYYY-MM-DD) of the week containing a YYYY-MM-DD date. */
export function weekStartSunday(dateStr) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

// ---- Settings -----------------------------------------------------------

async function workforceSettings(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM workforce_settings WHERE business_id = $1 LIMIT 1',
    [businessId],
  );
  return rows[0] ?? { business_id: businessId, self_clock_enabled: true, dd_enabled: false };
}

// ---- Notifications ------------------------------------------------------
// The real-time push as records: created at event time, read on the
// next fetch (the cross-store inbox pattern). Staff events notify
// the owner AND every manager; a manager's own events notify the
// owner only.

const EVENT_VERBS = {
  clock_in: 'clocked in',
  break_out: 'checked out for a break',
  break_in: 'checked back in from a break',
  clock_out: 'clocked out',
};

async function notifyClockEvent(pool, business, actorRow, event, entryId, when, timeZone) {
  const detail = `${actorRow.full_name} ${EVENT_VERBS[event] || event} at ${formatLocalTime(when, timeZone)}`;
  const recipients = [{ userId: business.owner_id, staffId: null, role: 'owner' }];
  if (personLevel(actorRow) !== 'manager') {
    const team = await people(pool, business.id);
    for (const member of team) {
      if (personLevel(member) !== 'manager' || member.id === actorRow.id) continue;
      const user = (
        await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [member.email])
      ).rows[0];
      if (user) recipients.push({ userId: user.id, staffId: member.id, role: 'manager' });
    }
  }
  for (const recipient of recipients) {
    await pool.query(
      `INSERT INTO workforce_notifications
         (id, business_id, recipient_user_id, recipient_staff_id, recipient_role, actor_staff_id, actor_name, event, detail, entry_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        crypto.randomUUID(), business.id, recipient.userId, recipient.staffId, recipient.role,
        actorRow.id, actorRow.full_name, event, detail, entryId || null,
      ],
    );
  }
}

// ---- Notification fan-out (Workforce inbox follow-up) ---------------------
// The same one-row-per-recipient-user pattern as the clock events,
// for everything else a team member waits on: time-off answers,
// tasks, pay stubs, schedule changes, new messages. entry_id doubles
// as the related-record reference (the request / task / stub /
// thread id), the same column that carries the clock entry id for
// clock events.

async function userForStaffRow(poolInstance, row) {
  if (!row) return null;
  const { rows } = await poolInstance.query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [row.email],
  );
  return rows[0] ?? null;
}

async function notifyUser(poolInstance, business, {
  recipientUserId,
  recipientStaffId = null,
  recipientRole = 'staff',
  actorStaffId = null,
  actorName = '',
  event,
  detail,
  refId = null,
}) {
  if (!recipientUserId) return;
  await poolInstance.query(
    `INSERT INTO workforce_notifications
       (id, business_id, recipient_user_id, recipient_staff_id, recipient_role, actor_staff_id, actor_name, event, detail, entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      crypto.randomUUID(), business.id, recipientUserId, recipientStaffId, recipientRole,
      actorStaffId, actorName, event, detail, refId,
    ],
  );
}

/** The owner plus every manager of the business, as recipients. */
async function leadershipRecipients(poolInstance, business) {
  const out = [{ userId: business.owner_id, staffId: null, role: 'owner' }];
  const team = await people(poolInstance, business.id);
  for (const member of team) {
    if (personLevel(member) !== 'manager') continue;
    const user = await userForStaffRow(poolInstance, member);
    if (user) out.push({ userId: user.id, staffId: member.id, role: 'manager' });
  }
  return out;
}

/** YYYY-MM-DD out of a DATE value, whether the driver hands back a string or a Date. */
function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function actorNameOf(access, user, me) {
  return access.isOwner ? 'Owner' : me?.full_name || user.email;
}

// ---- Payroll math ---------------------------------------------------------

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Paid/break minutes for one entry; an open entry counts to `now`. */
export function entryMinutes(entry, breaks, now = new Date()) {
  const start = new Date(entry.clock_in_at);
  const end = entry.clock_out_at ? new Date(entry.clock_out_at) : now;
  let breakMinutes = 0;
  for (const brk of breaks) {
    const bStart = new Date(brk.out_at);
    const bEnd = brk.in_at ? new Date(brk.in_at) : end;
    breakMinutes += Math.max(0, (bEnd - bStart) / 60000);
  }
  const total = Math.max(0, (end - start) / 60000);
  return { paidMinutes: Math.max(0, total - breakMinutes), breakMinutes };
}

/**
 * Hours for one person over a period, grouped by workweek
 * (Sunday–Saturday, by the business-local clock-in date):
 * the first 40 hours in a week are regular, the rest overtime.
 */
export function summarizeHours(entries, breaksByEntry, timeZone, periodStart, periodEnd) {
  const weeks = new Map();
  let breakMinutes = 0;
  for (const entry of entries) {
    const local = localParts(new Date(entry.clock_in_at), timeZone);
    if (local.dateStr < periodStart || local.dateStr > periodEnd) continue;
    const { paidMinutes, breakMinutes: entryBreaks } = entryMinutes(entry, breaksByEntry.get(entry.id) || []);
    breakMinutes += entryBreaks;
    const key = weekStartSunday(local.dateStr);
    weeks.set(key, (weeks.get(key) || 0) + paidMinutes);
  }
  let regularMinutes = 0;
  let overtimeMinutes = 0;
  for (const minutes of weeks.values()) {
    regularMinutes += Math.min(minutes, 40 * 60);
    overtimeMinutes += Math.max(0, minutes - 40 * 60);
  }
  return {
    regularHours: round2(regularMinutes / 60),
    overtimeHours: round2(overtimeMinutes / 60),
    breakMinutes: Math.round(breakMinutes),
  };
}

export function parseCustomDeductions(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((d) => d && typeof d.name === 'string' && (d.kind === 'percent' || d.kind === 'flat'))
      .slice(0, 5)
      .map((d) => ({ name: d.name.slice(0, 60), kind: d.kind, value: Math.max(0, Number(d.value) || 0) }));
  } catch {
    return [];
  }
}

async function payrollConfig(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM payroll_config WHERE business_id = $1 LIMIT 1',
    [businessId],
  );
  const row = rows[0];
  return {
    federal_pct: Number(row?.federal_pct ?? 0),
    state_pct: Number(row?.state_pct ?? 0),
    social_security_pct: Number(row?.social_security_pct ?? 6.2),
    medicare_pct: Number(row?.medicare_pct ?? 1.45),
    custom_deductions: parseCustomDeductions(row?.custom_deductions ?? '[]'),
  };
}

/** The full stub math for one person + profile over a period. */
export function computeStubMath({ profile, hours, config, periodStart, periodEnd, bonus = 0, tips = 0 }) {
  let gross;
  if (profile.pay_type === 'salary') {
    const days =
      (new Date(`${periodEnd}T12:00:00Z`) - new Date(`${periodStart}T12:00:00Z`)) / 86400000 + 1;
    gross = round2((Number(profile.annual_salary || 0) * days) / 365);
  } else {
    const rate = Number(profile.hourly_rate || 0);
    gross = round2(hours.regularHours * rate + hours.overtimeHours * rate * 1.5);
  }
  const taxable = round2(gross + Number(bonus || 0) + Number(tips || 0));
  const deductions = [];
  const pctItem = (name, pct) => {
    deductions.push({ name, kind: 'percent', value: Number(pct), amount: round2((taxable * Number(pct)) / 100) });
  };
  pctItem('Federal income tax', config.federal_pct);
  pctItem('State tax', config.state_pct);
  pctItem('Social Security', config.social_security_pct);
  pctItem('Medicare', config.medicare_pct);
  for (const custom of config.custom_deductions) {
    deductions.push({
      name: custom.name,
      kind: custom.kind,
      value: custom.value,
      amount: custom.kind === 'percent' ? round2((taxable * custom.value) / 100) : round2(custom.value),
    });
  }
  const totalDeductions = round2(deductions.reduce((sum, d) => sum + d.amount, 0));
  return { gross, taxable, deductions, totalDeductions, net: round2(taxable - totalDeductions) };
}

async function hoursForPeriod(pool, business, staffId, periodStart, periodEnd) {
  const timeZone = businessTimezone(business);
  const from = new Date(new Date(`${periodStart}T00:00:00Z`).getTime() - 2 * 86400000).toISOString();
  const to = new Date(new Date(`${periodEnd}T00:00:00Z`).getTime() + 3 * 86400000).toISOString();
  const { rows: entries } = await pool.query(
    `SELECT * FROM time_entries
      WHERE business_id = $1 AND staff_member_id = $2 AND clock_in_at >= $3 AND clock_in_at < $4
      ORDER BY clock_in_at ASC`,
    [business.id, staffId, from, to],
  );
  const breaksByEntry = new Map();
  if (entries.length) {
    // One placeholder per id (not = ANY(...)): the array form
    // misbehaves against pg-mem — see shopRoutes.js for the same
    // lesson learned in T3.
    const placeholders = entries.map((_, i) => `$${i + 2}`).join(', ');
    const { rows: breaks } = await pool.query(
      `SELECT * FROM time_breaks WHERE business_id = $1 AND entry_id IN (${placeholders})`,
      [business.id, ...entries.map((e) => e.id)],
    );
    for (const brk of breaks) {
      if (!breaksByEntry.has(brk.entry_id)) breaksByEntry.set(brk.entry_id, []);
      breaksByEntry.get(brk.entry_id).push(brk);
    }
  }
  return summarizeHours(entries, breaksByEntry, timeZone, periodStart, periodEnd);
}

async function profileFor(pool, businessId, staffId) {
  const { rows } = await pool.query(
    'SELECT * FROM pay_profiles WHERE business_id = $1 AND staff_member_id = $2 LIMIT 1',
    [businessId, staffId],
  );
  if (!rows[0]) return null;
  return {
    pay_type: rows[0].pay_type,
    hourly_rate: Number(rows[0].hourly_rate || 0),
    annual_salary: Number(rows[0].annual_salary || 0),
  };
}

function publicStub(row) {
  return {
    ...row,
    regular_hours: Number(row.regular_hours || 0),
    overtime_hours: Number(row.overtime_hours || 0),
    gross: Number(row.gross || 0),
    bonus: Number(row.bonus || 0),
    tips: Number(row.tips || 0),
    total_deductions: Number(row.total_deductions || 0),
    net: Number(row.net || 0),
    deductions: (() => {
      try {
        return JSON.parse(row.deductions || '[]');
      } catch {
        return [];
      }
    })(),
  };
}

function maskNumber(value) {
  const text = String(value || '');
  return text ? `****${text.slice(-4)}` : '';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDateStr(value) {
  return DATE_RE.test(String(value || '')) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}
function money(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw err(400, 'invalid_value', `${field} must be a number of 0 or more.`);
  return n;
}

export function createWorkforceRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/workforce';

  async function ctx(req) {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    return { access, level: callerLevel(access), me: access.staffRow };
  }
  function requirePerson(access) {
    if (!access.staffRow) {
      throw err(400, 'no_staff_profile', 'Only team members with a staff profile can do this.');
    }
    return access.staffRow;
  }

  // ---- Context / people / settings -------------------------------------

  router.get(`${base}/context`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    const settings = await workforceSettings(pool(), req.params.bid);
    return res.json({
      is_owner: access.isOwner,
      level,
      my_staff_id: me?.id || null,
      my_name: me?.full_name || req.user.email,
      self_clock_enabled: settings.self_clock_enabled !== false,
      dd_enabled: settings.dd_enabled === true,
      plan: access.planKey,
    });
  }));

  router.get(`${base}/people`, asyncHandler(async (req, res) => {
    await ctx(req);
    const team = await people(pool(), req.params.bid, { activeOnly: false });
    return res.json({ people: team.map(publicPerson) });
  }));

  router.get(`${base}/settings`, asyncHandler(async (req, res) => {
    await ctx(req);
    const settings = await workforceSettings(pool(), req.params.bid);
    return res.json({
      self_clock_enabled: settings.self_clock_enabled !== false,
      dd_enabled: settings.dd_enabled === true,
    });
  }));

  router.patch(`${base}/settings`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the business owner can change workforce settings.');
    await assertNotInGrace(pool(), req.params.bid);
    const body = req.body || {};
    const current = await workforceSettings(pool(), req.params.bid);
    const selfClock = body.self_clock_enabled === undefined ? current.self_clock_enabled !== false : body.self_clock_enabled === true;
    const dd = body.dd_enabled === undefined ? current.dd_enabled === true : body.dd_enabled === true;
    await pool().query(
      `INSERT INTO workforce_settings (business_id, self_clock_enabled, dd_enabled, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (business_id) DO UPDATE SET self_clock_enabled = $2, dd_enabled = $3, updated_at = NOW()`,
      [req.params.bid, selfClock, dd],
    );
    return res.json({ self_clock_enabled: selfClock, dd_enabled: dd });
  }));

  // ---- Schedules ----------------------------------------------------------

  router.get(`${base}/schedules`, asyncHandler(async (req, res) => {
    const { level, me } = await ctx(req);
    let query = 'SELECT * FROM work_schedules WHERE business_id = $1';
    const params = [req.params.bid];
    if (level === 'staff') {
      query += ' AND staff_member_id = $2';
      params.push(me?.id || 'none');
    }
    query += ' ORDER BY staff_member_id, weekday';
    const { rows } = await pool().query(query, params);
    return res.json({ schedules: rows });
  }));

  router.put(`${base}/schedules/:staffId`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const target = await personOr404(pool(), req.params.bid, req.params.staffId);
    const targetLevel = personLevel(target);
    if (level === 'staff') throw err(403, 'forbidden', 'Team members cannot edit schedules.');
    if (level === 'manager' && targetLevel !== 'staff') {
      throw err(403, 'forbidden', 'Only the owner can set the manager\u2019s schedule.');
    }
    const shifts = req.body?.shifts;
    if (!Array.isArray(shifts) || shifts.length > 7) {
      throw err(400, 'invalid_value', 'Send the week as a list of up to 7 shifts.');
    }
    const seen = new Set();
    for (const shift of shifts) {
      const weekday = Number(shift?.weekday);
      const start = hhmmToMinutes(shift?.start_time);
      const end = hhmmToMinutes(shift?.end_time);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || start === null || end === null) {
        throw err(400, 'invalid_value', 'Each shift needs a weekday (0-6) and HH:MM start and end times.');
      }
      if (end <= start) throw err(400, 'invalid_value', 'A shift must end after it starts (same-day shifts only).');
      if (seen.has(weekday)) throw err(400, 'invalid_value', 'One shift per weekday.');
      seen.add(weekday);
    }
    await pool().query('DELETE FROM work_schedules WHERE business_id = $1 AND staff_member_id = $2', [
      req.params.bid,
      target.id,
    ]);
    for (const shift of shifts) {
      await pool().query(
        `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time, created_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [crypto.randomUUID(), req.params.bid, target.id, Number(shift.weekday), shift.start_time, shift.end_time, req.user.id],
      );
    }
    const { rows } = await pool().query(
      'SELECT * FROM work_schedules WHERE business_id = $1 AND staff_member_id = $2 ORDER BY weekday',
      [req.params.bid, target.id],
    );
    // The person scheduled hears that their schedule changed.
    const targetUser = await userForStaffRow(pool(), target);
    if (targetUser && targetUser.id !== req.user.id) {
      const actor = actorNameOf(access, req.user, me);
      await notifyUser(pool(), access.business, {
        recipientUserId: targetUser.id,
        recipientStaffId: target.id,
        recipientRole: targetLevel,
        actorStaffId: me?.id || null,
        actorName: actor,
        event: 'schedule_set',
        detail: `Your schedule was updated by ${actor}.`,
        refId: target.id,
      });
    }
    return res.json({ schedules: rows });
  }));

  // ---- Time clock -----------------------------------------------------------

  async function openEntry(businessId, staffId) {
    const { rows } = await pool().query(
      `SELECT * FROM time_entries WHERE business_id = $1 AND staff_member_id = $2 AND clock_out_at IS NULL
       ORDER BY clock_in_at DESC LIMIT 1`,
      [businessId, staffId],
    );
    return rows[0] ?? null;
  }
  async function openBreak(entryId) {
    const { rows } = await pool().query(
      'SELECT * FROM time_breaks WHERE entry_id = $1 AND in_at IS NULL ORDER BY out_at DESC LIMIT 1',
      [entryId],
    );
    return rows[0] ?? null;
  }
  async function shiftFor(poolInstance, businessId, staffId, weekday) {
    const { rows } = await poolInstance.query(
      'SELECT * FROM work_schedules WHERE business_id = $1 AND staff_member_id = $2 AND weekday = $3 LIMIT 1',
      [businessId, staffId, weekday],
    );
    return rows[0] ?? null;
  }
  async function clockGate(req, access) {
    const settings = await workforceSettings(pool(), req.params.bid);
    if (settings.self_clock_enabled === false) {
      throw err(403, 'self_clock_disabled', 'Self clock-in is turned off for this business.');
    }
    await assertNotInGrace(pool(), req.params.bid);
    return requirePerson(access);
  }

  router.get(`${base}/clock/status`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    const me = requirePerson(access);
    const timeZone = businessTimezone(access.business);
    const now = localParts(new Date(), timeZone);
    const entry = await openEntry(req.params.bid, me.id);
    const brk = entry ? await openBreak(entry.id) : null;
    const shift = await shiftFor(pool(), req.params.bid, me.id, now.weekday);
    const settings = await workforceSettings(pool(), req.params.bid);
    return res.json({
      open_entry: entry,
      open_break: brk,
      today_shift: shift,
      self_clock_enabled: settings.self_clock_enabled !== false,
      server_now: new Date().toISOString(),
    });
  }));

  router.post(`${base}/clock/in`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    const me = await clockGate(req, access);
    const businessId = req.params.bid;
    if (await openEntry(businessId, me.id)) {
      throw err(400, 'already_clocked_in', 'You are already clocked in.');
    }
    const timeZone = businessTimezone(access.business);
    const now = new Date();
    const local = localParts(now, timeZone);
    const shift = await shiftFor(pool(), businessId, me.id, local.weekday);
    if (shift) {
      const start = hhmmToMinutes(shift.start_time);
      if (local.minutes < start - 10) {
        throw err(400, 'clock_too_early', 'You can clock in up to 10 minutes before your shift starts.');
      }
    }
    const id = crypto.randomUUID();
    const inserted = await pool().query(
      `INSERT INTO time_entries (id, business_id, staff_member_id, clock_in_at, unscheduled)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, businessId, me.id, now.toISOString(), !shift],
    );
    await notifyClockEvent(pool(), access.business, me, 'clock_in', id, now, timeZone);
    return res.status(201).json({ entry: inserted.rows[0] });
  }));

  router.post(`${base}/clock/out`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    const me = await clockGate(req, access);
    const businessId = req.params.bid;
    const entry = await openEntry(businessId, me.id);
    if (!entry) throw err(400, 'not_clocked_in', 'You are not clocked in.');
    const timeZone = businessTimezone(access.business);
    const now = new Date();
    const inLocal = localParts(new Date(entry.clock_in_at), timeZone);
    const outLocal = localParts(now, timeZone);
    const shift = entry.unscheduled ? null : await shiftFor(pool(), businessId, me.id, inLocal.weekday);
    let earlyDeparture = false;
    if (shift && inLocal.dateStr === outLocal.dateStr) {
      const end = hhmmToMinutes(shift.end_time);
      if (outLocal.minutes > end + 10) {
        throw err(400, 'clock_too_late', 'You can clock out up to 10 minutes after your shift ends. Ask your manager or the owner for help with this entry.');
      }
      if (outLocal.minutes < end) {
        const note = String(req.body?.note || '').trim();
        if (!note) {
          throw err(400, 'note_required', 'Leaving before your shift ends needs a note — write what happened in the notes under the clock-out button.');
        }
        earlyDeparture = true;
        await pool().query('UPDATE time_entries SET early_note = $1 WHERE id = $2', [note.slice(0, 1000), entry.id]);
      }
    }
    // A break still open when the day ends closes with the shift.
    await pool().query('UPDATE time_breaks SET in_at = $1 WHERE entry_id = $2 AND in_at IS NULL', [
      now.toISOString(),
      entry.id,
    ]);
    const updated = await pool().query(
      'UPDATE time_entries SET clock_out_at = $1, early_departure = $2 WHERE id = $3 RETURNING *',
      [now.toISOString(), earlyDeparture, entry.id],
    );
    await notifyClockEvent(pool(), access.business, me, 'clock_out', entry.id, now, timeZone);
    return res.json({ entry: updated.rows[0] });
  }));

  const BREAK_TYPES = { break15: 15, lunch30: 30, lunch60: 60 };

  router.post(`${base}/clock/break-out`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    const me = await clockGate(req, access);
    const businessId = req.params.bid;
    const entry = await openEntry(businessId, me.id);
    if (!entry) throw err(400, 'not_clocked_in', 'Clock in before checking out for a break.');
    if (await openBreak(entry.id)) throw err(400, 'already_on_break', 'You are already checked out on a break.');
    const type = String(req.body?.break_type || 'break15');
    if (!(type in BREAK_TYPES)) throw err(400, 'invalid_value', 'Choose a break type: break15, lunch30 or lunch60.');
    const now = new Date();
    const id = crypto.randomUUID();
    const inserted = await pool().query(
      `INSERT INTO time_breaks (id, entry_id, business_id, break_type, planned_minutes, out_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, entry.id, businessId, type, BREAK_TYPES[type], now.toISOString()],
    );
    await notifyClockEvent(pool(), access.business, me, 'break_out', entry.id, now, businessTimezone(access.business));
    return res.status(201).json({ break: inserted.rows[0] });
  }));

  router.post(`${base}/clock/break-in`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    const me = await clockGate(req, access);
    const entry = await openEntry(req.params.bid, me.id);
    if (!entry) throw err(400, 'not_clocked_in', 'You are not clocked in.');
    const brk = await openBreak(entry.id);
    if (!brk) throw err(400, 'not_on_break', 'You are not on a break right now.');
    const now = new Date();
    const updated = await pool().query('UPDATE time_breaks SET in_at = $1 WHERE id = $2 RETURNING *', [
      now.toISOString(),
      brk.id,
    ]);
    await notifyClockEvent(pool(), access.business, me, 'break_in', entry.id, now, businessTimezone(access.business));
    return res.json({ break: updated.rows[0] });
  }));

  router.get(`${base}/entries`, asyncHandler(async (req, res) => {
    const { level, me } = await ctx(req);
    let query = 'SELECT * FROM time_entries WHERE business_id = $1';
    const params = [req.params.bid];
    if (level === 'staff') {
      query += ' AND staff_member_id = $2';
      params.push(me?.id || 'none');
    } else if (req.query.staff_id) {
      query += ' AND staff_member_id = $2';
      params.push(String(req.query.staff_id));
    }
    query += ' ORDER BY clock_in_at DESC LIMIT 300';
    const { rows } = await pool().query(query, params);
    const ids = rows.map((r) => r.id);
    const breaksByEntry = new Map();
    if (ids.length) {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
      const { rows: breaks } = await pool().query(
        `SELECT * FROM time_breaks WHERE entry_id IN (${placeholders})`,
        ids,
      );
      for (const brk of breaks) {
        if (!breaksByEntry.has(brk.entry_id)) breaksByEntry.set(brk.entry_id, []);
        breaksByEntry.get(brk.entry_id).push(brk);
      }
    }
    return res.json({
      entries: rows.map((entry) => ({ ...entry, breaks: breaksByEntry.get(entry.id) || [] })),
    });
  }));

  // ---- Notifications inbox ---------------------------------------------------

  router.get(`${base}/notifications`, asyncHandler(async (req, res) => {
    await ctx(req);
    const { rows } = await pool().query(
      `SELECT * FROM workforce_notifications WHERE business_id = $1 AND recipient_user_id = $2
       ORDER BY created_at DESC LIMIT 100`,
      [req.params.bid, req.user.id],
    );
    return res.json({ notifications: rows, unread: rows.filter((r) => !r.is_read).length });
  }));

  router.patch(`${base}/notifications/:id`, asyncHandler(async (req, res) => {
    await ctx(req);
    const updated = await pool().query(
      `UPDATE workforce_notifications SET is_read = $1 WHERE id = $2 AND business_id = $3 AND recipient_user_id = $4 RETURNING *`,
      [req.body?.is_read === false ? false : true, req.params.id, req.params.bid, req.user.id],
    );
    if (!updated.rows[0]) throw err(404, 'not_found', 'Notification not found.');
    return res.json({ notification: updated.rows[0] });
  }));

  // ---- Time off ----------------------------------------------------------------

  router.get(`${base}/time-off`, asyncHandler(async (req, res) => {
    const { level, me } = await ctx(req);
    let query = 'SELECT * FROM time_off_requests WHERE business_id = $1';
    const params = [req.params.bid];
    if (level === 'staff') {
      query += ' AND staff_member_id = $2';
      params.push(me?.id || 'none');
    }
    query += ' ORDER BY created_at DESC LIMIT 200';
    const { rows } = await pool().query(query, params);
    return res.json({ requests: rows });
  }));

  router.post(`${base}/time-off`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const me = requirePerson(access);
    const start = String(req.body?.start_date || '');
    const end = String(req.body?.end_date || '');
    if (!isDateStr(start) || !isDateStr(end) || end < start) {
      throw err(400, 'invalid_value', 'Choose a start and end date, end on or after the start.');
    }
    const inserted = await pool().query(
      `INSERT INTO time_off_requests (id, business_id, staff_member_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        crypto.randomUUID(), req.params.bid, me.id, start, end,
        String(req.body?.reason || '').trim().slice(0, 1000),
      ],
    );
    const request = inserted.rows[0];
    // Fan-out: a staff request rings the owner AND every manager;
    // a manager's own request rings the owner only (the hierarchy).
    const recipients = personLevel(me) === 'manager'
      ? [{ userId: access.business.owner_id, staffId: null, role: 'owner' }]
      : await leadershipRecipients(pool(), access.business);
    const reasonText = String(request.reason || '').trim();
    const detail =
      `${me.full_name} requested time off from ${start} to ${end}` +
      (reasonText ? ` — ${reasonText.slice(0, 200)}` : '');
    for (const recipient of recipients) {
      await notifyUser(pool(), access.business, {
        recipientUserId: recipient.userId,
        recipientStaffId: recipient.staffId,
        recipientRole: recipient.role,
        actorStaffId: me.id,
        actorName: me.full_name,
        event: 'time_off_requested',
        detail,
        refId: request.id,
      });
    }
    return res.status(201).json({ request });
  }));

  router.patch(`${base}/time-off/:id`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const status = String(req.body?.status || '');
    if (!['approved', 'declined'].includes(status)) {
      throw err(400, 'invalid_value', 'Decide approved or declined.');
    }
    const reason = String(req.body?.decision_reason || '').trim();
    if (status === 'declined' && !reason) {
      throw err(400, 'reason_required', 'A declined request needs a reason, so the team member knows why.');
    }
    const { rows } = await pool().query(
      'SELECT * FROM time_off_requests WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.id, req.params.bid],
    );
    const request = rows[0];
    if (!request) throw err(404, 'not_found', 'Time-off request not found.');
    if (request.status !== 'pending') throw err(400, 'already_decided', 'This request was already decided.');
    const requester = await personOr404(pool(), req.params.bid, request.staff_member_id);
    const requesterLevel = personLevel(requester);
    if (level === 'staff') throw err(403, 'forbidden', 'Team members cannot decide time-off requests.');
    if (requesterLevel === 'manager' && level !== 'owner') {
      throw err(403, 'forbidden', 'Only the owner can decide the manager\u2019s time-off requests.');
    }
    const updated = await pool().query(
      `UPDATE time_off_requests SET status = $1, decision_reason = $2, decided_by_id = $3, decided_at = NOW()
       WHERE id = $4 RETURNING *`,
      [status, reason.slice(0, 1000), req.user.id, req.params.id],
    );
    // The requester hears the answer, with the reason attached.
    const requesterUser = await userForStaffRow(pool(), requester);
    if (requesterUser) {
      await notifyUser(pool(), access.business, {
        recipientUserId: requesterUser.id,
        recipientStaffId: requester.id,
        recipientRole: requesterLevel,
        actorStaffId: me?.id || null,
        actorName: actorNameOf(access, req.user, me),
        event: 'time_off_decided',
        detail:
          `Your time-off request for ${dateOnly(request.start_date)} to ${dateOnly(request.end_date)} was ${status}` +
          (reason ? ` — ${reason.slice(0, 200)}` : ''),
        refId: request.id,
      });
    }
    return res.json({ request: updated.rows[0] });
  }));

  // ---- Tasks ---------------------------------------------------------------------

  router.get(`${base}/tasks`, asyncHandler(async (req, res) => {
    const { level, me } = await ctx(req);
    let query = 'SELECT * FROM work_tasks WHERE business_id = $1';
    const params = [req.params.bid];
    if (level === 'staff') {
      query += ' AND staff_member_id = $2';
      params.push(me?.id || 'none');
    }
    query += ' ORDER BY (status = \'done\'), due_date NULLS LAST, created_at DESC LIMIT 300';
    const { rows } = await pool().query(query, params);
    return res.json({ tasks: rows });
  }));

  router.post(`${base}/tasks`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    if (level === 'staff') throw err(403, 'forbidden', 'Team members cannot assign tasks.');
    const target = await personOr404(pool(), req.params.bid, String(req.body?.staff_member_id || ''));
    if (level === 'manager' && personLevel(target) !== 'staff') {
      throw err(403, 'forbidden', 'Managers assign tasks to staff; only the owner assigns to a manager.');
    }
    const title = String(req.body?.title || '').trim();
    if (!title) throw err(400, 'invalid_value', 'Give the task a title.');
    const due = req.body?.due_date ? String(req.body.due_date) : null;
    if (due !== null && !isDateStr(due)) throw err(400, 'invalid_value', 'Due date must be a date.');
    const inserted = await pool().query(
      `INSERT INTO work_tasks (id, business_id, staff_member_id, title, notes, due_date, created_by_id, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        crypto.randomUUID(), req.params.bid, target.id, title.slice(0, 200),
        String(req.body?.notes || '').trim().slice(0, 1000), due, req.user.id,
        access.isOwner ? 'Owner' : me?.full_name || req.user.email,
      ],
    );
    const task = inserted.rows[0];
    // The assignee hears they have a new task.
    const assigneeUser = await userForStaffRow(pool(), target);
    if (assigneeUser && assigneeUser.id !== req.user.id) {
      await notifyUser(pool(), access.business, {
        recipientUserId: assigneeUser.id,
        recipientStaffId: target.id,
        recipientRole: personLevel(target),
        actorStaffId: me?.id || null,
        actorName: task.created_by_name,
        event: 'task_assigned',
        detail:
          `${task.created_by_name} assigned you a task: ${task.title}` +
          (task.due_date ? ` (due ${dateOnly(task.due_date)})` : ''),
        refId: task.id,
      });
    }
    return res.status(201).json({ task });
  }));

  router.patch(`${base}/tasks/:id`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const { rows } = await pool().query(
      'SELECT * FROM work_tasks WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.id, req.params.bid],
    );
    const task = rows[0];
    if (!task) throw err(404, 'not_found', 'Task not found.');
    if (level === 'staff' && task.staff_member_id !== me?.id) {
      throw err(403, 'forbidden', 'You can only update your own tasks.');
    }
    const status = String(req.body?.status || '');
    if (!['open', 'done'].includes(status)) throw err(400, 'invalid_value', 'Status is open or done.');
    const updated = await pool().query(
      `UPDATE work_tasks SET status = $1, done_at = CASE WHEN $1 = 'done' THEN NOW() ELSE NULL END
       WHERE id = $2 RETURNING *`,
      [status, req.params.id],
    );
    // Finishing a task rings the person who assigned it — and only them.
    if (status === 'done' && task.status !== 'done' && task.created_by_id && task.created_by_id !== req.user.id) {
      let recipientRole = 'manager';
      let recipientStaffId = null;
      if (task.created_by_id === access.business.owner_id) {
        recipientRole = 'owner';
      } else {
        const creator = (
          await pool().query('SELECT email FROM users WHERE id = $1 LIMIT 1', [task.created_by_id])
        ).rows[0];
        const creatorRow = creator ? await staffRowForEmail(pool(), req.params.bid, creator.email) : null;
        if (creatorRow) {
          recipientStaffId = creatorRow.id;
          recipientRole = personLevel(creatorRow);
        }
      }
      const actor = actorNameOf(access, req.user, me);
      await notifyUser(pool(), access.business, {
        recipientUserId: task.created_by_id,
        recipientStaffId,
        recipientRole,
        actorStaffId: me?.id || null,
        actorName: actor,
        event: 'task_done',
        detail: `${actor} finished the task: ${task.title}`,
        refId: task.id,
      });
    }
    return res.json({ task: updated.rows[0] });
  }));

  // ---- Payroll ----------------------------------------------------------------

  router.get(`${base}/payroll/context`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    const settings = await workforceSettings(pool(), req.params.bid);
    return res.json({
      is_owner: access.isOwner,
      level,
      // The IRS forms box is the owner's alone (owner's spec).
      show_irs_box: access.isOwner,
      dd_enabled: settings.dd_enabled === true,
      plan: access.planKey,
    });
  }));

  router.get(`${base}/payroll/config`, asyncHandler(async (req, res) => {
    const { level } = await ctx(req);
    if (level === 'staff') throw err(403, 'forbidden', 'Payroll settings are for the owner and manager.');
    return res.json({ config: await payrollConfig(pool(), req.params.bid) });
  }));

  router.put(`${base}/payroll/config`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the owner sets the tax and deduction settings.');
    await assertNotInGrace(pool(), req.params.bid);
    const body = req.body || {};
    const pct = (value, field) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw err(400, 'invalid_value', `${field} must be a percentage between 0 and 100.`);
      }
      return n;
    };
    const custom = parseCustomDeductions(JSON.stringify(body.custom_deductions ?? []));
    for (const d of custom) {
      if (d.kind === 'percent' && d.value > 100) {
        throw err(400, 'invalid_value', 'A percentage deduction cannot be over 100.');
      }
    }
    const config = {
      federal_pct: pct(body.federal_pct ?? 0, 'Federal tax'),
      state_pct: pct(body.state_pct ?? 0, 'State tax'),
      social_security_pct: pct(body.social_security_pct ?? 6.2, 'Social Security'),
      medicare_pct: pct(body.medicare_pct ?? 1.45, 'Medicare'),
      custom_deductions: custom,
    };
    await pool().query(
      `INSERT INTO payroll_config (business_id, federal_pct, state_pct, social_security_pct, medicare_pct, custom_deductions, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (business_id) DO UPDATE SET federal_pct = $2, state_pct = $3,
         social_security_pct = $4, medicare_pct = $5, custom_deductions = $6, updated_at = NOW()`,
      [req.params.bid, config.federal_pct, config.state_pct, config.social_security_pct, config.medicare_pct, JSON.stringify(custom)],
    );
    return res.json({ config });
  }));

  router.get(`${base}/payroll/profiles`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    const team = await people(pool(), req.params.bid, { activeOnly: false });
    const visible = access.isOwner ? team : team.filter((row) => row.id === me?.id);
    const out = [];
    for (const person of visible) {
      const profile = await profileFor(pool(), req.params.bid, person.id);
      out.push({ person: publicPerson(person), profile });
    }
    return res.json({ profiles: out });
  }));

  router.put(`${base}/payroll/profiles/:staffId`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the owner sets pay rates.');
    await assertNotInGrace(pool(), req.params.bid);
    const target = await personOr404(pool(), req.params.bid, req.params.staffId);
    const payType = String(req.body?.pay_type || 'hourly');
    if (!['hourly', 'salary'].includes(payType)) {
      throw err(400, 'invalid_value', 'Pay type is hourly or salary.');
    }
    const hourly = money(req.body?.hourly_rate ?? 0, 'Hourly rate');
    const salary = money(req.body?.annual_salary ?? 0, 'Annual salary');
    await pool().query(
      `INSERT INTO pay_profiles (business_id, staff_member_id, pay_type, hourly_rate, annual_salary, updated_by_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (business_id, staff_member_id) DO UPDATE SET pay_type = $3, hourly_rate = $4,
         annual_salary = $5, updated_by_id = $6, updated_at = NOW()`,
      [req.params.bid, target.id, payType, hourly, salary, req.user.id],
    );
    return res.json({ profile: await profileFor(pool(), req.params.bid, target.id) });
  }));

  router.get(`${base}/payroll/preview`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    if (level === 'staff') throw err(403, 'forbidden', 'Payroll runs are for the owner and manager.');
    const start = String(req.query.start || '');
    const end = String(req.query.end || '');
    if (!isDateStr(start) || !isDateStr(end) || end < start) {
      throw err(400, 'invalid_value', 'Choose a pay period (start and end dates).');
    }
    const config = await payrollConfig(pool(), req.params.bid);
    const team = await people(pool(), req.params.bid);
    const rows = [];
    for (const person of team) {
      const profile = await profileFor(pool(), req.params.bid, person.id);
      const hours = await hoursForPeriod(pool(), access.business, person.id, start, end);
      const math = profile
        ? computeStubMath({ profile, hours, config, periodStart: start, periodEnd: end })
        : null;
      rows.push({
        person: publicPerson(person),
        profile,
        regular_hours: hours.regularHours,
        overtime_hours: hours.overtimeHours,
        break_minutes: hours.breakMinutes,
        gross: math?.gross ?? null,
        net: math?.net ?? null,
      });
    }
    return res.json({ period: { start, end }, config, people: rows });
  }));

  router.post(`${base}/payroll/runs`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the owner runs payroll.');
    await assertNotInGrace(pool(), req.params.bid);
    const start = String(req.body?.period_start || '');
    const end = String(req.body?.period_end || '');
    if (!isDateStr(start) || !isDateStr(end) || end < start) {
      throw err(400, 'invalid_value', 'Choose a pay period (start and end dates).');
    }
    const adjustments = req.body?.adjustments && typeof req.body.adjustments === 'object' ? req.body.adjustments : {};
    const config = await payrollConfig(pool(), req.params.bid);
    const team = await people(pool(), req.params.bid);
    const runId = crypto.randomUUID();
    await pool().query(
      'INSERT INTO payroll_runs (id, business_id, period_start, period_end, created_by_id) VALUES ($1, $2, $3, $4, $5)',
      [runId, req.params.bid, start, end, req.user.id],
    );
    const stubs = [];
    const missingProfiles = [];
    for (const person of team) {
      const profile = await profileFor(pool(), req.params.bid, person.id);
      const hours = await hoursForPeriod(pool(), access.business, person.id, start, end);
      if (!profile) {
        if (hours.regularHours + hours.overtimeHours > 0) missingProfiles.push(person.full_name);
        continue;
      }
      const adj = adjustments[person.id] || {};
      const bonus = money(adj.bonus ?? 0, 'Bonus');
      const tips = money(adj.tips ?? 0, 'Tips');
      const math = computeStubMath({ profile, hours, config, periodStart: start, periodEnd: end, bonus, tips });
      const inserted = await pool().query(
        `INSERT INTO pay_stubs
           (id, run_id, business_id, staff_member_id, person_name, pay_type, regular_hours, overtime_hours,
            gross, bonus, tips, deductions, total_deductions, net)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [
          crypto.randomUUID(), runId, req.params.bid, person.id, person.full_name, profile.pay_type,
          hours.regularHours, hours.overtimeHours, math.gross, bonus, tips,
          JSON.stringify(math.deductions), math.totalDeductions, math.net,
        ],
      );
      stubs.push(publicStub(inserted.rows[0]));
    }
    const { rows: runRows } = await pool().query('SELECT * FROM payroll_runs WHERE id = $1', [runId]);
    return res.status(201).json({ run: runRows[0], stubs, missing_profiles: missingProfiles });
  }));

  router.get(`${base}/payroll/runs`, asyncHandler(async (req, res) => {
    const { level } = await ctx(req);
    if (level === 'staff') throw err(403, 'forbidden', 'Payroll runs are for the owner and manager.');
    const { rows } = await pool().query(
      `SELECT r.*, (SELECT COUNT(*)::int FROM pay_stubs s WHERE s.run_id = r.id) AS stub_count
         FROM payroll_runs r WHERE r.business_id = $1 ORDER BY r.created_at DESC LIMIT 100`,
      [req.params.bid],
    );
    return res.json({ runs: rows });
  }));

  router.get(`${base}/payroll/runs/:id`, asyncHandler(async (req, res) => {
    const { level } = await ctx(req);
    if (level === 'staff') throw err(403, 'forbidden', 'Payroll runs are for the owner and manager.');
    const { rows } = await pool().query(
      'SELECT * FROM payroll_runs WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.id, req.params.bid],
    );
    if (!rows[0]) throw err(404, 'not_found', 'Payroll run not found.');
    const { rows: stubs } = await pool().query(
      'SELECT * FROM pay_stubs WHERE run_id = $1 ORDER BY person_name ASC',
      [req.params.id],
    );
    return res.json({ run: rows[0], stubs: stubs.map(publicStub) });
  }));

  router.get(`${base}/payroll/my-stubs`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    const me = requirePerson(access);
    const { rows } = await pool().query(
      `SELECT s.*, r.period_start, r.period_end FROM pay_stubs s
         JOIN payroll_runs r ON r.id = s.run_id
        WHERE s.business_id = $1 AND s.staff_member_id = $2 AND s.pushed = TRUE
        ORDER BY s.created_at DESC LIMIT 100`,
      [req.params.bid, me.id],
    );
    return res.json({ stubs: rows.map(publicStub) });
  }));

  router.post(`${base}/payroll/stubs/:id/push`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    if (level === 'staff') throw err(403, 'forbidden', 'Team members cannot send pay stubs.');
    const { rows } = await pool().query(
      'SELECT * FROM pay_stubs WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.id, req.params.bid],
    );
    const stub = rows[0];
    if (!stub) throw err(404, 'not_found', 'Pay stub not found.');
    const person = await personOr404(pool(), req.params.bid, stub.staff_member_id);
    if (level === 'manager' && personLevel(person) !== 'staff') {
      throw err(403, 'forbidden', 'Only the owner can send the manager\u2019s pay stub.');
    }
    const updated = await pool().query(
      'UPDATE pay_stubs SET pushed = TRUE, pushed_by_id = $1, pushed_at = NOW() WHERE id = $2 RETURNING *',
      [req.user.id, req.params.id],
    );
    // The stub's owner hears it has arrived.
    const recipientUser = await userForStaffRow(pool(), person);
    if (recipientUser && recipientUser.id !== req.user.id) {
      const { rows: runRows } = await pool().query(
        'SELECT period_start, period_end FROM payroll_runs WHERE id = $1 LIMIT 1',
        [stub.run_id],
      );
      const run = runRows[0];
      await notifyUser(pool(), access.business, {
        recipientUserId: recipientUser.id,
        recipientStaffId: person.id,
        recipientRole: personLevel(person),
        actorStaffId: me?.id || null,
        actorName: actorNameOf(access, req.user, me),
        event: 'stub_pushed',
        detail: run
          ? `Your pay stub for ${dateOnly(run.period_start)} to ${dateOnly(run.period_end)} is ready.`
          : 'Your pay stub is ready.',
        refId: stub.id,
      });
    }
    return res.json({ stub: publicStub(updated.rows[0]) });
  }));

  // ---- Cash drawer / cash-up ------------------------------------------------------

  router.get(`${base}/cash-ups`, asyncHandler(async (req, res) => {
    const { level } = await ctx(req);
    if (level === 'staff') throw err(403, 'forbidden', 'The cash drawer is for the owner and manager.');
    const { rows } = await pool().query(
      'SELECT * FROM cash_ups WHERE business_id = $1 ORDER BY date DESC, created_at DESC LIMIT 100',
      [req.params.bid],
    );
    return res.json({
      cash_ups: rows.map((row) => ({
        ...row,
        denominations: (() => {
          try {
            return JSON.parse(row.denominations || '{}');
          } catch {
            return {};
          }
        })(),
      })),
    });
  }));

  router.post(`${base}/cash-ups`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    if (level === 'staff') throw err(403, 'forbidden', 'The cash drawer is for the owner and manager.');
    await assertNotInGrace(pool(), req.params.bid);
    const body = req.body || {};
    const date = String(body.date || '');
    if (!isDateStr(date)) throw err(400, 'invalid_value', 'Choose the date of this cash-up.');
    const floatAmount = money(body.float_amount ?? 0, 'Float');
    const cashSales = money(body.cash_sales ?? 0, 'Cash sales');
    const cashRefunds = money(body.cash_refunds ?? 0, 'Cash refunds');
    const payouts = money(body.payouts ?? 0, 'Payouts');
    const cardPayments = money(body.card_payments ?? 0, 'Card payments');
    const denominations = body.denominations && typeof body.denominations === 'object' ? body.denominations : {};
    let counted = 0;
    const cleanDenoms = {};
    for (const [value, count] of Object.entries(denominations)) {
      const denom = Number(value);
      const n = Number(count);
      if (!Number.isFinite(denom) || denom <= 0 || !Number.isInteger(n) || n < 0) {
        throw err(400, 'invalid_value', 'Denominations are bill/coin values with whole counts.');
      }
      cleanDenoms[value] = n;
      counted += denom * n;
    }
    counted = round2(counted);
    const expected = round2(floatAmount + cashSales - cashRefunds - payouts);
    const inserted = await pool().query(
      `INSERT INTO cash_ups
         (id, business_id, date, float_amount, cash_sales, cash_refunds, payouts, card_payments,
          denominations, counted_total, expected_total, over_short, counted_by_id, counted_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        crypto.randomUUID(), req.params.bid, date, floatAmount, cashSales, cashRefunds, payouts,
        cardPayments, JSON.stringify(cleanDenoms), counted, expected, round2(counted - expected),
        req.user.id, access.isOwner ? 'Owner' : me?.full_name || req.user.email,
      ],
    );
    const row = inserted.rows[0];
    return res.status(201).json({
      cash_up: {
        ...row,
        counted_total: Number(row.counted_total),
        expected_total: Number(row.expected_total),
        over_short: Number(row.over_short),
        denominations: cleanDenoms,
      },
    });
  }));

  // ---- Direct deposit ---------------------------------------------------------------

  router.get(`${base}/dd`, asyncHandler(async (req, res) => {
    const { access, me } = await ctx(req);
    const settings = await workforceSettings(pool(), req.params.bid);
    let mine = null;
    if (me) {
      const { rows } = await pool().query(
        'SELECT * FROM direct_deposit_details WHERE business_id = $1 AND staff_member_id = $2 LIMIT 1',
        [req.params.bid, me.id],
      );
      if (rows[0]) {
        mine = {
          status: rows[0].status,
          bank_name: rows[0].bank_name,
          account_type: rows[0].account_type,
          routing_masked: maskNumber(rows[0].routing_number),
          account_masked: maskNumber(rows[0].account_number),
        };
      }
    }
    let team = null;
    if (access.isOwner) {
      const { rows } = await pool().query(
        `SELECT d.*, m.full_name FROM direct_deposit_details d
           JOIN staff_members m ON m.id = d.staff_member_id
          WHERE d.business_id = $1 ORDER BY m.full_name ASC`,
        [req.params.bid],
      );
      team = rows.map((row) => ({
        staff_member_id: row.staff_member_id,
        full_name: row.full_name,
        status: row.status,
        bank_name: row.bank_name,
        account_type: row.account_type,
        routing_masked: maskNumber(row.routing_number),
        account_masked: maskNumber(row.account_number),
        submitted_at: row.submitted_at,
      }));
    }
    return res.json({ enabled: settings.dd_enabled === true, mine, team });
  }));

  router.post(`${base}/dd/invite`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the owner manages direct deposit.');
    await assertNotInGrace(pool(), req.params.bid);
    const target = await personOr404(pool(), req.params.bid, String(req.body?.staff_member_id || ''));
    await pool().query(
      `INSERT INTO direct_deposit_details (business_id, staff_member_id, status, requested_at, updated_at)
       VALUES ($1, $2, 'invited', NOW(), NOW())
       ON CONFLICT (business_id, staff_member_id) DO UPDATE SET requested_at = NOW(), updated_at = NOW()`,
      [req.params.bid, target.id],
    );
    return res.status(201).json({ invited: target.id });
  }));

  router.post(`${base}/dd/submit`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const me = requirePerson(access);
    const settings = await workforceSettings(pool(), req.params.bid);
    if (settings.dd_enabled !== true) {
      throw err(400, 'dd_disabled', 'Direct deposit is not turned on for this business yet.');
    }
    const { rows } = await pool().query(
      'SELECT * FROM direct_deposit_details WHERE business_id = $1 AND staff_member_id = $2 LIMIT 1',
      [req.params.bid, me.id],
    );
    if (!rows[0]) {
      throw err(400, 'not_invited', 'Ask the owner to send you the direct deposit request first.');
    }
    const bankName = String(req.body?.bank_name || '').trim();
    const accountType = String(req.body?.account_type || 'checking');
    const routing = String(req.body?.routing_number || '').replace(/\D/g, '');
    const account = String(req.body?.account_number || '').replace(/\D/g, '');
    if (!bankName) throw err(400, 'invalid_value', 'Enter your bank name.');
    if (!['checking', 'savings'].includes(accountType)) {
      throw err(400, 'invalid_value', 'Account type is checking or savings.');
    }
    if (!/^\d{9}$/.test(routing)) throw err(400, 'invalid_value', 'The routing number is 9 digits.');
    if (!/^\d{4,17}$/.test(account)) throw err(400, 'invalid_value', 'Check the account number and try again.');
    await pool().query(
      `UPDATE direct_deposit_details
          SET status = 'submitted', bank_name = $1, account_type = $2, routing_number = $3,
              account_number = $4, submitted_at = NOW(), updated_at = NOW()
        WHERE business_id = $5 AND staff_member_id = $6`,
      [bankName.slice(0, 120), accountType, routing, account, req.params.bid, me.id],
    );
    return res.json({
      submitted: true,
      routing_masked: maskNumber(routing),
      account_masked: maskNumber(account),
    });
  }));

  router.get(`${base}/dd/details/:staffId`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    if (!access.isOwner) {
      throw err(403, 'forbidden', 'Bank details are only ever visible to the business owner.');
    }
    const { rows } = await pool().query(
      'SELECT * FROM direct_deposit_details WHERE business_id = $1 AND staff_member_id = $2 LIMIT 1',
      [req.params.bid, req.params.staffId],
    );
    if (!rows[0]) throw err(404, 'not_found', 'No direct deposit details for that team member.');
    return res.json({ details: rows[0] });
  }));

  // ---- Messages (Workforce inbox follow-up) ----------------------------------
  // One-to-one conversations between people in the business, living
  // in the same inbox as the notifications above. A participant key
  // is the staff_member_id — or 'owner' for the business owner, who
  // is not a staff row. PRIVACY (the owner's rule): only the two
  // participants can read or post in a thread. The owner may LIST
  // and READ every thread in their own business (oversight of their
  // store) but posts only in threads they are part of. Posting also
  // drops a workforce_notifications row for the other participant,
  // so their bell rings.

  const OWNER_KEY = 'owner';

  function myKey(access, me) {
    return access.isOwner ? OWNER_KEY : me?.id || null;
  }

  function threadParticipants(thread) {
    return [
      {
        key: thread.participant_a_key,
        user_id: thread.participant_a_user_id,
        staff_id: thread.participant_a_staff_id,
        name: thread.participant_a_name,
        role: thread.participant_a_role,
      },
      {
        key: thread.participant_b_key,
        user_id: thread.participant_b_user_id,
        staff_id: thread.participant_b_staff_id,
        name: thread.participant_b_name,
        role: thread.participant_b_role,
      },
    ];
  }

  async function participantForKey(business, key) {
    if (key === OWNER_KEY) {
      return { key, user_id: business.owner_id, staff_id: null, name: 'Owner', role: 'owner' };
    }
    const row = await personOr404(pool(), business.id, key);
    if (row.status !== 'active') {
      throw err(400, 'invalid_value', 'That team member is not active in this business.');
    }
    const user = await userForStaffRow(pool(), row);
    if (!user) {
      throw err(400, 'no_account', 'That team member has not signed in yet, so there is nowhere to send messages.');
    }
    return { key, user_id: user.id, staff_id: row.id, name: row.full_name, role: personLevel(row) };
  }

  async function threadOr404(threadId, businessId) {
    const { rows } = await pool().query(
      'SELECT * FROM message_threads WHERE id = $1 AND business_id = $2 LIMIT 1',
      [threadId, businessId],
    );
    if (!rows[0]) throw err(404, 'not_found', 'Conversation not found.');
    return rows[0];
  }

  async function threadUnread(threadId, userId) {
    const { rows } = await pool().query(
      `SELECT COUNT(*)::int AS count FROM messages
        WHERE thread_id = $1 AND sender_user_id != $2 AND read_at IS NULL`,
      [threadId, userId],
    );
    return rows[0]?.count ?? 0;
  }

  async function publicThread(thread, access, me, userId) {
    const participants = threadParticipants(thread);
    const key = myKey(access, me);
    const mine = participants.some((p) => p.key === key);
    const { rows: lastRows } = await pool().query(
      'SELECT body, sender_name, sender_user_id, created_at FROM messages WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 1',
      [thread.id],
    );
    return {
      id: thread.id,
      business_id: thread.business_id,
      participants,
      other: mine ? participants.find((p) => p.key !== key) : null,
      is_mine: mine,
      can_post: mine,
      oversight: !mine && access.isOwner,
      last_message: lastRows[0] ?? null,
      last_message_at: thread.last_message_at,
      unread: mine ? await threadUnread(thread.id, userId) : null,
      created_at: thread.created_at,
    };
  }

  router.get(`${base}/messages/threads`, asyncHandler(async (req, res) => {
    const { access, me } = await ctx(req);
    const key = myKey(access, me);
    let rows;
    if (access.isOwner) {
      // Oversight: the owner sees every conversation in their store.
      ({ rows } = await pool().query(
        `SELECT * FROM message_threads WHERE business_id = $1
          ORDER BY last_message_at DESC NULLS LAST, created_at DESC LIMIT 200`,
        [req.params.bid],
      ));
    } else {
      if (!key) throw err(400, 'no_staff_profile', 'Only team members with a staff profile can do this.');
      ({ rows } = await pool().query(
        `SELECT * FROM message_threads
          WHERE business_id = $1 AND (participant_a_key = $2 OR participant_b_key = $2)
          ORDER BY last_message_at DESC NULLS LAST, created_at DESC LIMIT 200`,
        [req.params.bid, key],
      ));
    }
    const threads = [];
    let unreadTotal = 0;
    for (const thread of rows) {
      const pub = await publicThread(thread, access, me, req.user.id);
      unreadTotal += pub.unread || 0;
      threads.push(pub);
    }
    return res.json({ threads, unread_total: unreadTotal });
  }));

  router.post(`${base}/messages/threads`, asyncHandler(async (req, res) => {
    const { access, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const myParticipant = await participantForKey(access.business, myKey(access, me));
    const targetKey = req.body?.with_owner === true ? OWNER_KEY : String(req.body?.staff_member_id || '');
    if (!targetKey) throw err(400, 'invalid_value', 'Choose who to message.');
    if (targetKey === myParticipant.key) {
      throw err(400, 'invalid_value', 'You cannot message yourself.');
    }
    const other = await participantForKey(access.business, targetKey);
    const [a, b] = [myParticipant, other].sort((x, y) => (x.key < y.key ? -1 : 1));
    const existing = await pool().query(
      `SELECT * FROM message_threads
        WHERE business_id = $1 AND participant_a_key = $2 AND participant_b_key = $3 LIMIT 1`,
      [req.params.bid, a.key, b.key],
    );
    if (existing.rows[0]) {
      return res.json({ thread: await publicThread(existing.rows[0], access, me, req.user.id), created: false });
    }
    const inserted = await pool().query(
      `INSERT INTO message_threads
         (id, business_id, participant_a_key, participant_b_key, participant_a_user_id, participant_b_user_id,
          participant_a_staff_id, participant_b_staff_id, participant_a_name, participant_b_name,
          participant_a_role, participant_b_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        crypto.randomUUID(), req.params.bid, a.key, b.key, a.user_id, b.user_id,
        a.staff_id, b.staff_id, a.name, b.name, a.role, b.role,
      ],
    );
    return res.status(201).json({ thread: await publicThread(inserted.rows[0], access, me, req.user.id), created: true });
  }));

  router.get(`${base}/messages/threads/:threadId`, asyncHandler(async (req, res) => {
    const { access, me } = await ctx(req);
    const thread = await threadOr404(req.params.threadId, req.params.bid);
    const participants = threadParticipants(thread);
    const mine = participants.some((p) => p.key === myKey(access, me));
    if (!mine && !access.isOwner) {
      throw err(403, 'forbidden', 'This conversation is private to the two people in it.');
    }
    const { rows } = await pool().query(
      'SELECT * FROM messages WHERE thread_id = $1 ORDER BY created_at ASC LIMIT 500',
      [thread.id],
    );
    return res.json({
      thread: await publicThread(thread, access, me, req.user.id),
      messages: rows.map((m) => ({ ...m, mine: m.sender_user_id === req.user.id })),
    });
  }));

  router.post(`${base}/messages/threads/:threadId/messages`, asyncHandler(async (req, res) => {
    const { access, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const thread = await threadOr404(req.params.threadId, req.params.bid);
    const participants = threadParticipants(thread);
    const key = myKey(access, me);
    const sender = participants.find((p) => p.key === key);
    if (!sender) {
      throw err(
        403,
        'forbidden',
        access.isOwner
          ? 'You can read every conversation in your business, but you can only post in your own.'
          : 'This conversation is private to the two people in it.',
      );
    }
    const body = String(req.body?.body || '').trim();
    if (!body) throw err(400, 'invalid_value', 'Write a message first.');
    const inserted = await pool().query(
      `INSERT INTO messages (id, thread_id, business_id, sender_user_id, sender_staff_id, sender_name, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        crypto.randomUUID(), thread.id, req.params.bid, req.user.id,
        sender.staff_id, sender.name, body.slice(0, 2000),
      ],
    );
    await pool().query(
      'UPDATE message_threads SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
      [thread.id],
    );
    // The other person's bell rings.
    const other = participants.find((p) => p.key !== key);
    await notifyUser(pool(), access.business, {
      recipientUserId: other.user_id,
      recipientStaffId: other.staff_id,
      recipientRole: other.role,
      actorStaffId: sender.staff_id,
      actorName: sender.name,
      event: 'message',
      detail: `New message from ${sender.name}`,
      refId: thread.id,
    });
    return res.status(201).json({ message: { ...inserted.rows[0], mine: true } });
  }));

  router.patch(`${base}/messages/threads/:threadId/read`, asyncHandler(async (req, res) => {
    const { access, me } = await ctx(req);
    const thread = await threadOr404(req.params.threadId, req.params.bid);
    const participants = threadParticipants(thread);
    if (!participants.some((p) => p.key === myKey(access, me))) {
      throw err(403, 'forbidden', 'Only the people in a conversation can mark it read.');
    }
    await pool().query(
      'UPDATE messages SET read_at = NOW() WHERE thread_id = $1 AND sender_user_id != $2 AND read_at IS NULL',
      [thread.id, req.user.id],
    );
    return res.json({ unread: await threadUnread(thread.id, req.user.id) });
  }));

  router.get(`${base}/messages/unread`, asyncHandler(async (req, res) => {
    const { access, me } = await ctx(req);
    const key = myKey(access, me);
    if (!key) return res.json({ unread: 0 });
    const { rows } = await pool().query(
      `SELECT COUNT(*)::int AS count FROM messages m
         JOIN message_threads t ON t.id = m.thread_id
        WHERE t.business_id = $1 AND (t.participant_a_key = $2 OR t.participant_b_key = $2)
          AND m.sender_user_id != $3 AND m.read_at IS NULL`,
      [req.params.bid, key, req.user.id],
    );
    return res.json({ unread: rows[0]?.count ?? 0 });
  }));

  return router;
}
