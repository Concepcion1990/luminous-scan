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
 *   PATCH /api/businesses/:bid/workforce/entries/:entryId   owner / ticked manager
 *   GET   /api/businesses/:bid/workforce/call-in             owner / ticked manager
 *   POST  /api/businesses/:bid/workforce/call-in/:staffId    owner / ticked manager
 *   DELETE /api/businesses/:bid/workforce/call-in/:staffId   owner / ticked manager
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
 *   PUT   /api/businesses/:bid/workforce/payroll/profiles/:staffId  owner / hiring manager
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
 *   POST  /api/businesses/:bid/workforce/dd/send-back        owner
 *   GET   /api/businesses/:bid/workforce/dd/details/:staffId owner
 *   GET   /api/businesses/:bid/workforce/messages/threads
 *   POST  /api/businesses/:bid/workforce/messages/threads    get-or-create
 *   GET   /api/businesses/:bid/workforce/messages/threads/:id
 *   POST  /api/businesses/:bid/workforce/messages/threads/:id/messages
 *   POST  /api/businesses/:bid/workforce/messages/threads/:id/voice   voice note (converted to MP3 server-side)
 *   GET   /api/businesses/:bid/workforce/messages/threads/:id/voice/:messageId/file
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
import { resolveAccess, staffRowForEmail, parseJsonArray } from './authz.js';
import { startAutoLogout, cancelAutoLogout, zonedTimeToUtc } from './staffWindow.js';
import {
  CLOCK_ADMIN_TICK,
  openCallInWindow,
  openCallInWindows,
  openCallIn,
  closeCallIn,
  missedClockOutInfo,
  flagMissedClockOuts,
} from './clockAdmin.js';
import { assertNotInGrace, withTx } from './billing.js';
import { parseVoiceDataUrl, convertVoiceToMp3, VOICE_MAX_DURATION_MS } from './voiceNote.js';
import { approvedPhotoKeys, ownerDisplayName, ownerPublicName } from './profilePhotos.js';
import { trainingCompleteForPerson } from './trainingCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    // error.payload carries structured extras the client renders
    // itself (the clock-in gate's next_shift_start, in the
    // staff_outside_window shape).
    return res.status(error.status).json({
      error: error.code || 'error',
      message: error.message,
      ...(error.payload || {}),
    });
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

// The caller's OWN details-on-file card (owner ruling, Nov 21,
// 2026: the card is for everyone, owner down to viewer). The
// owner has no staff row — their card reads their own account
// record (display_name + personal_address on users) and carries
// owner: true so the client renders the owner's editable variant.
// A member's card reads their own staff row only. Either way the
// payload is the caller's own details and nobody else's, ever.
async function ownProfile(pool, req, access, me) {
  if (access.isOwner) {
    const { rows } = await pool.query(
      'SELECT display_name, personal_address FROM users WHERE id = $1 LIMIT 1',
      [req.user.id],
    );
    return {
      full_name: String(rows[0]?.display_name || '').trim(),
      personal_address: rows[0]?.personal_address || '',
      owner: true,
    };
  }
  if (!me) return null;
  return { full_name: me.full_name, personal_address: me.personal_address || '' };
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

/** A YYYY-MM-DD date shifted by whole days (UTC date math). */
export function addDaysStr(dateStr, count) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + count)).toISOString().slice(0, 10);
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
  // Who may set pay rates (owner ruling, Nov 19, 2026): the
  // owner always, or a manager trusted with hiring — i.e. whose
  // stored permissions carry staff.manage. Everyone else can
  // only ever see their OWN rate.
  function canSetPay(access) {
    if (access.isOwner) return true;
    return parseJsonArray(access.staffRow?.permissions).includes('staff.manage');
  }
  function requirePerson(access) {
    if (!access.staffRow) {
      throw err(400, 'no_staff_profile', 'Only team members with a staff profile can do this.');
    }
    return access.staffRow;
  }

  // ---- Clock administration (the clock build, Nov 21, 2026) ---------------
  // One tick (staff.clock, server/clockAdmin.js) covers call-in
  // windows and time-entry corrections: the owner by birth, or a
  // MANAGER the owner ticked — server-enforced here, never
  // trusted from the client. The hierarchy mirrors schedules: a
  // manager acts on staff only; a manager's own call-ins and
  // entries are the owner's to manage.

  function canClockAdmin(access, level) {
    if (access.isOwner) return true;
    return level === 'manager' && access.can(CLOCK_ADMIN_TICK);
  }

  function assertClockAdmin(access, level, target) {
    if (!canClockAdmin(access, level)) {
      throw err(403, 'clock_admin_not_granted', 'Only the owner, or a manager the owner has trusted with call-ins and clock corrections, can do that.');
    }
    if (level === 'manager' && personLevel(target) === 'manager') {
      throw err(403, 'forbidden', 'Only the owner can manage a manager’s call-ins and time entries.');
    }
  }

  /** The next scheduled shift start for a member (an instant),
   *  or null when the week ahead holds none. */
  async function nextShiftStartFor(business, memberId, now) {
    const timeZone = businessTimezone(business);
    const local = localParts(now, timeZone);
    const { rows } = await pool().query(
      'SELECT * FROM work_schedules WHERE business_id = $1 AND staff_member_id = $2',
      [business.id, memberId],
    );
    const byWeekday = new Map(rows.map((shift) => [shift.weekday, shift]));
    for (let offset = 0; offset <= 7; offset += 1) {
      const dateStr = addDaysStr(local.dateStr, offset);
      const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
      const shift = byWeekday.get(weekday);
      if (!shift) continue;
      const start = hhmmToMinutes(shift.start_time);
      const end = hhmmToMinutes(shift.end_time);
      if (start === null || end === null) continue;
      if (zonedTimeToUtc(dateStr, end, timeZone).getTime() <= now.getTime()) continue;
      return zonedTimeToUtc(dateStr, start, timeZone);
    }
    return null;
  }

  /** The name stamped on a call-in window record: the owner's
   *  set name (or "Owner"), else the acting manager's staff
   *  name — names, never emails (the Nov 21, 2026 rule). */
  async function clockActorName(access, me) {
    if (access.isOwner) return ownerPublicName(pool(), access.business);
    return me?.full_name || '';
  }

  /** An entry as the clients render it: its breaks, plus the
   *  live missed-clock-out fact (null when it is not missed). */
  async function shapeEntry(business, entry, breaks) {
    return {
      ...entry,
      breaks,
      missed_clock_out: await missedClockOutInfo(pool(), business, entry),
    };
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
      // The owner's display name (Nov 21, 2026): the name the
      // owner set for themselves, or null — surfaces fall back
      // to the word "Owner" only while it is null.
      owner_name: await ownerDisplayName(pool(), access.business),
      self_clock_enabled: settings.self_clock_enabled !== false,
      dd_enabled: settings.dd_enabled === true,
      plan: access.planKey,
      // Clock administration (Nov 21, 2026): the owner, or a
      // manager holding the staff.clock tick — the Staff page
      // hangs its call-in + time-fix doors on this one boolean;
      // the server re-checks on every write regardless.
      clock_admin: canClockAdmin(access, level),
    });
  }));

  router.get(`${base}/people`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    const team = await people(pool(), req.params.bid, { activeOnly: false });
    // The people list feeds name pickers (schedule, tasks,
    // messages): a non-owner never receives the team's email
    // addresses in the payload (audit B2, Nov 21, 2026). The
    // owner's payload is unchanged.
    const shaped = team.map((row) => {
      const person = publicPerson(row);
      if (!access.isOwner) delete person.email;
      return person;
    });
    return res.json({ people: shaped });
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
    // A caller with no staff profile (the owner, most days) has
    // no clock of their own: say so in the shape the tab already
    // understands — self-clock off, nothing open — instead of
    // refusing. The refusal left the Time clock tab on its
    // loading line forever for exactly the person who comes to
    // READ the team's entries (the clock build, Nov 21, 2026;
    // the entries list below this status is the owner's view of
    // the missed-clock-out flags). Members are untouched.
    if (!access.staffRow) {
      return res.json({
        open_entry: null,
        open_break: null,
        today_shift: null,
        call_in_open: false,
        self_clock_enabled: false,
        server_now: new Date().toISOString(),
      });
    }
    const me = access.staffRow;
    const timeZone = businessTimezone(access.business);
    const now = localParts(new Date(), timeZone);
    const entry = await openEntry(req.params.bid, me.id);
    const brk = entry ? await openBreak(entry.id) : null;
    const shift = await shiftFor(pool(), req.params.bid, me.id, now.weekday);
    const settings = await workforceSettings(pool(), req.params.bid);
    const callIn = await openCallInWindow(pool(), req.params.bid, me.id);
    return res.json({
      open_entry: entry,
      open_break: brk,
      today_shift: shift,
      // The call-in window (Nov 21, 2026): open for this person
      // right now — their door in, shift or no shift.
      call_in_open: Boolean(callIn),
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
    // THE CALL-IN GATE (owner's ruling, Nov 20, 2026; proven
    // missing by her hand Nov 21, 2026, when Staff 1 clocked in
    // on an unscheduled Saturday): clock-in needs a scheduled
    // shift covering now — the same [start − 10, end] span the
    // bracket uses — or an open call-in window. An open window
    // admits even ahead of a later shift (the owner or a ticked
    // manager opened the door on purpose); without one, the
    // too-early refusal stands as before, and anything else is
    // refused plainly, naming the next scheduled shift when the
    // schedule knows one (the staff_outside_window shape).
    const callInWindow = await openCallInWindow(pool(), businessId, me.id);
    let shiftCoversNow = false;
    if (shift) {
      const start = hhmmToMinutes(shift.start_time);
      const end = hhmmToMinutes(shift.end_time);
      shiftCoversNow =
        start !== null && end !== null && local.minutes >= start - 10 && local.minutes <= end;
      if (!callInWindow && start !== null && local.minutes < start - 10) {
        throw err(400, 'clock_too_early', 'You can clock in up to 10 minutes before your shift starts.');
      }
    }
    if (!shiftCoversNow && !callInWindow) {
      const refusal = err(
        403,
        'clock_in_not_scheduled',
        'You are not scheduled to work right now, and no call-in window is open for you.',
      );
      const next = await nextShiftStartFor(access.business, me.id, now);
      refusal.payload = { next_shift_start: next ? next.toISOString() : null };
      throw refusal;
    }
    const calledIn = Boolean(callInWindow) && !shiftCoversNow;
    const id = crypto.randomUUID();
    const inserted = await pool().query(
      `INSERT INTO time_entries (id, business_id, staff_member_id, clock_in_at, unscheduled, called_in)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, businessId, me.id, now.toISOString(), !shift, calledIn],
    );
    // Clocking back in cancels the pending auto-logout (the
    // shift window, Nov 19, 2026 — server/staffWindow.js).
    await cancelAutoLogout(pool(), businessId, me.id);
    await notifyClockEvent(pool(), access.business, me, 'clock_in', id, now, timeZone);
    return res.status(201).json({ entry: inserted.rows[0], auto_logout_at: null });
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
    // Clocking out starts the 10-minute grace window; when it
    // ends, the app signs this member out on its own (the shift
    // window, Nov 19, 2026 — server/staffWindow.js). Everyone who
    // can clock is a non-owner member by construction (the clock
    // gate refuses the owner), so this arms for staff and
    // managers alike — exactly the bracket the owner ruled.
    const autoLogoutAt = await startAutoLogout(pool(), businessId, me.id, now);
    // A call-in window lives until this person clocks out
    // (owner's ruling, Nov 20, 2026): the clock-out closes it,
    // and the grace above is what follows.
    await closeCallIn(pool(), businessId, me.id, {
      byId: req.user.id,
      byStaffId: me.id,
      byName: me.full_name,
      reason: 'clock_out',
    });
    await notifyClockEvent(pool(), access.business, me, 'clock_out', entry.id, now, timeZone);
    return res.json({ entry: updated.rows[0], auto_logout_at: autoLogoutAt.toISOString() });
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
    const { access, level, me } = await ctx(req);
    // The missed-clock-out bell (Nov 21, 2026): when a clock
    // admin is the one looking, any newly-missed entry is
    // claimed and belled on the spot — the 15-minute sweep is
    // the backstop for when nobody is looking. The claim makes
    // the two paths race-safe; the flag itself is computed live
    // below either way.
    if (canClockAdmin(access, level)) {
      await flagMissedClockOuts(pool(), access.business, {});
    }
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
    const shaped = [];
    for (const entry of rows) {
      shaped.push(await shapeEntry(access.business, entry, breaksByEntry.get(entry.id) || []));
    }
    return res.json({ entries: shaped });
  }));

  // ---- Call-in windows + time-entry corrections -----------------------------
  // The clock build (Nov 21, 2026). Windows are opened/closed by
  // the owner or a ticked manager (assertClockAdmin); corrections
  // live on the same tick. The Staff page hangs its doors on the
  // context's clock_admin boolean; every write re-checks here.

  router.get(`${base}/call-in`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    if (!canClockAdmin(access, level)) {
      throw err(403, 'clock_admin_not_granted', 'Only the owner, or a manager the owner has trusted with call-ins and clock corrections, can do that.');
    }
    const windows = await openCallInWindows(pool(), req.params.bid);
    return res.json({ windows });
  }));

  router.post(`${base}/call-in/:staffId`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    const target = await personOr404(pool(), req.params.bid, req.params.staffId);
    assertClockAdmin(access, level, target);
    await assertNotInGrace(pool(), req.params.bid);
    const opened = await openCallIn(pool(), req.params.bid, target.id, {
      userId: req.user.id,
      staffId: me?.id || null,
      name: await clockActorName(access, me),
    });
    return res.status(201).json({ window: opened });
  }));

  router.delete(`${base}/call-in/:staffId`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    const target = await personOr404(pool(), req.params.bid, req.params.staffId);
    assertClockAdmin(access, level, target);
    await assertNotInGrace(pool(), req.params.bid);
    const closed = await closeCallIn(pool(), req.params.bid, target.id, {
      byId: req.user.id,
      byStaffId: me?.id || null,
      byName: await clockActorName(access, me),
      reason: 'closed_early',
    });
    return res.json({ window: closed });
  }));

  // One correction door: set/change the clock-in, the clock-out
  // (empty string clears it — the entry re-opens), and any of the
  // entry's break out/in times. Times arrive as business-local
  // wall clock ("YYYY-MM-DDTHH:MM") and are read in the business's
  // own timezone, the same frame the schedule is written in.
  router.patch(`${base}/entries/:entryId`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    const businessId = req.params.bid;
    const { rows: entryRows } = await pool().query(
      'SELECT * FROM time_entries WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.entryId, businessId],
    );
    const entry = entryRows[0];
    if (!entry) throw err(404, 'not_found', 'Time entry not found.');
    const target = await personOr404(pool(), businessId, entry.staff_member_id);
    assertClockAdmin(access, level, target);
    await assertNotInGrace(pool(), businessId);
    const timeZone = businessTimezone(access.business);
    const parseLocal = (value) => {
      if (value === '' || value === null || value === undefined) return null;
      const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
      if (!match || !isDateStr(match[1])) {
        throw err(400, 'invalid_value', 'Send each time as a valid date and time.');
      }
      const minutes = Number(match[2]) * 60 + Number(match[3]);
      return new Date(zonedTimeToUtc(match[1], minutes, timeZone).getTime() + Number(match[4] || 0) * 1000);
    };
    const body = req.body || {};
    const wasOpen = !entry.clock_out_at;
    const nextIn = body.clock_in_at === undefined ? new Date(entry.clock_in_at) : parseLocal(body.clock_in_at);
    if (!nextIn) throw err(400, 'invalid_value', 'Send each time as a valid date and time.');
    let nextOut;
    if (body.clock_out_at === undefined) nextOut = entry.clock_out_at ? new Date(entry.clock_out_at) : null;
    else nextOut = parseLocal(body.clock_out_at);
    if (nextOut && nextOut.getTime() <= nextIn.getTime()) {
      throw err(400, 'invalid_value', 'The clock-out time must be after the clock-in time.');
    }
    const { rows: breakRows } = await pool().query(
      'SELECT * FROM time_breaks WHERE entry_id = $1 ORDER BY out_at ASC',
      [entry.id],
    );
    const breakById = new Map(breakRows.map((brk) => [brk.id, brk]));
    const breakUpdates = [];
    if (body.breaks !== undefined) {
      if (!Array.isArray(body.breaks)) {
        throw err(400, 'invalid_value', 'Send each time as a valid date and time.');
      }
      for (const patch of body.breaks) {
        const brk = breakById.get(String(patch?.id || ''));
        if (!brk) throw err(400, 'invalid_value', 'Send each time as a valid date and time.');
        const outAt = patch.out_at === undefined ? new Date(brk.out_at) : parseLocal(patch.out_at);
        if (!outAt) throw err(400, 'invalid_value', 'Send each time as a valid date and time.');
        let inAt;
        if (patch.in_at === undefined) inAt = brk.in_at ? new Date(brk.in_at) : null;
        else inAt = parseLocal(patch.in_at);
        if (
          outAt.getTime() < nextIn.getTime() ||
          (inAt && inAt.getTime() < outAt.getTime()) ||
          (nextOut && outAt.getTime() > nextOut.getTime()) ||
          (nextOut && inAt && inAt.getTime() > nextOut.getTime())
        ) {
          throw err(400, 'invalid_value', 'Break times must fall between the clock-in and clock-out times.');
        }
        breakUpdates.push({ id: brk.id, out_at: outAt, in_at: inAt });
      }
    }
    const updated = await withTx(pool(), async (client) => {
      const { rows } = await client.query(
        'UPDATE time_entries SET clock_in_at = $1, clock_out_at = $2 WHERE id = $3 RETURNING *',
        [nextIn.toISOString(), nextOut ? nextOut.toISOString() : null, entry.id],
      );
      for (const patch of breakUpdates) {
        await client.query('UPDATE time_breaks SET out_at = $1, in_at = $2 WHERE id = $3', [
          patch.out_at.toISOString(),
          patch.in_at ? patch.in_at.toISOString() : null,
          patch.id,
        ]);
      }
      return rows[0];
    });
    // The correction lands like the act it replaces: closing an
    // open entry closes the person's call-in window and starts
    // their 10-minute grace; re-opening a closed entry cancels a
    // pending auto-logout, exactly as clocking back in does.
    const isOpen = !updated.clock_out_at;
    if (wasOpen && !isOpen) {
      await closeCallIn(pool(), businessId, target.id, {
        byId: req.user.id,
        byStaffId: me?.id || null,
        byName: await clockActorName(access, me),
        reason: 'corrected',
      });
      await startAutoLogout(pool(), businessId, target.id, new Date());
    } else if (!wasOpen && isOpen) {
      await cancelAutoLogout(pool(), businessId, target.id);
    }
    const { rows: freshBreaks } = await pool().query(
      'SELECT * FROM time_breaks WHERE entry_id = $1 ORDER BY out_at ASC',
      [entry.id],
    );
    return res.json({ entry: await shapeEntry(access.business, updated, freshBreaks) });
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
    // A task may be a TRAINING task (owner ruling, Nov 20, 2026):
    // its Done button checks the person's real training before it
    // strikes. The title alone also marks it — her task is named
    // "First training" — so the two doors agree.
    const kind = req.body?.kind === 'training' || title.trim().toLowerCase() === 'first training'
      ? 'training'
      : 'task';
    const inserted = await pool().query(
      `INSERT INTO work_tasks (id, business_id, staff_member_id, title, notes, due_date, created_by_id, created_by_name, kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        crypto.randomUUID(), req.params.bid, target.id, title.slice(0, 200),
        String(req.body?.notes || '').trim().slice(0, 1000), due, req.user.id,
        access.isOwner ? 'Owner' : me?.full_name || req.user.email, kind,
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
    // THE TRAINING GATE (owner ruling, Nov 20, 2026): a training
    // task's Done CHECKS the person's real training first. If any
    // of it is unfinished, Done refuses — the task does not
    // strike — and the caller shows the stop dialog with a door
    // back to the training. Only genuine completion lets it
    // strike. (Reopening is never gated.)
    if (status === 'done' && task.status !== 'done' && task.kind === 'training') {
      const assignee = await personOr404(pool(), req.params.bid, task.staff_member_id);
      const complete = await trainingCompleteForPerson(pool(), access.business, assignee, access.planKey);
      if (!complete) {
        throw err(409, 'training_incomplete', 'Not yet — this person still has training to finish.');
      }
    }
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
    const { access, level, me } = await ctx(req);
    const settings = await workforceSettings(pool(), req.params.bid);
    return res.json({
      is_owner: access.isOwner,
      // Pay rates may also be set by a manager trusted with
      // hiring (owner ruling, Nov 19, 2026).
      can_set_pay: canSetPay(access),
      level,
      // The IRS forms box is the owner's alone (owner's spec).
      show_irs_box: access.isOwner,
      dd_enabled: settings.dd_enabled === true,
      plan: access.planKey,
      // The member's OWN details on file (Nov 21, 2026): their
      // full name + home address, read-only on their own Payroll
      // page — the view migration 030 promised. This is the
      // caller's own staff row and nothing else's: nobody's
      // payload ever carries another member's address from here.
      //
      // The card is for EVERYONE, owner down to viewer (owner
      // ruling, Nov 21, 2026): the owner has no staff row, so
      // their card is fed from their OWN account record instead —
      // users.display_name (migration 034) + users.personal_address
      // (migration 036). It is still only ever the caller's own
      // details: the owner's user row for the owner, the member's
      // staff row for a member.
      me_profile: await ownProfile(pool(), req, access, me),
    });
  }));

  // The owner's own details on file — the one card its owner may
  // edit (owner ruling, Nov 21, 2026). The owner is the authority,
  // so they keep their own name + home address current right on
  // their Payroll card; members' cards stay read-only (their
  // changes go through the owner/manager, as the card says).
  // Account-level write: display_name is the same owner name the
  // header and Messages speak (release 335), so this door and
  // the Settings owner-name door write the one same value.
  router.put(`${base}/payroll/my-details`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    if (!access.isOwner) {
      throw err(403, 'forbidden', 'Only the business owner can update these details.');
    }
    await assertNotInGrace(pool(), req.params.bid);
    const fullName = String(req.body?.full_name ?? '').trim();
    if (fullName.length > 80) {
      throw err(400, 'invalid_value', 'Keep your name to 80 characters or fewer.');
    }
    const address = String(req.body?.personal_address ?? '').trim();
    if (address.length > 1000) {
      throw err(400, 'invalid_value', 'Keep your home address to 1000 characters or fewer.');
    }
    await pool().query(
      'UPDATE users SET display_name = $1, personal_address = $2, updated_at = NOW() WHERE id = $3',
      [fullName || null, address || null, req.user.id],
    );
    return res.json({ me_profile: await ownProfile(pool(), req, access, null) });
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
    // Those who may set pay (owner, or a hiring manager) see the
    // whole team's rates; everyone else sees only their own.
    const visible = canSetPay(access) ? team : team.filter((row) => row.id === me?.id);
    const out = [];
    for (const person of visible) {
      const profile = await profileFor(pool(), req.params.bid, person.id);
      out.push({ person: publicPerson(person), profile });
    }
    return res.json({ profiles: out });
  }));

  router.put(`${base}/payroll/profiles/:staffId`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    if (!canSetPay(access)) throw err(403, 'forbidden', 'Only the owner or a manager with hiring permission sets pay rates.');
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
      // The preview math needs names and hours, not addresses:
      // a manager's payload drops each person's email (audit B3,
      // Nov 21, 2026); the owner's payload is unchanged.
      const personView = publicPerson(person);
      if (!access.isOwner) delete personView.email;
      // The missed clock-out flag rides the preview too (Nov 21,
      // 2026): an open entry in this period whose scheduled
      // shift has already ended. The hours keep counting to now
      // either way — the flag is what says the number is not
      // final until the entry is corrected from the Staff page.
      const { rows: openRows } = await pool().query(
        'SELECT * FROM time_entries WHERE business_id = $1 AND staff_member_id = $2 AND clock_out_at IS NULL',
        [req.params.bid, person.id],
      );
      const missedClockOuts = [];
      for (const openEntry of openRows) {
        const info = await missedClockOutInfo(pool(), access.business, openEntry);
        if (info && info.shift_date >= start && info.shift_date <= end) {
          missedClockOuts.push({ entry_id: openEntry.id, clock_in_at: openEntry.clock_in_at, ...info });
        }
      }
      rows.push({
        person: personView,
        profile,
        regular_hours: hours.regularHours,
        overtime_hours: hours.overtimeHours,
        break_minutes: hours.breakMinutes,
        gross: math?.gross ?? null,
        net: math?.net ?? null,
        missed_clock_outs: missedClockOuts,
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
          // A submitted form the owner sent back presents as
          // 'correction_requested' (the flag on the details row).
          status: rows[0].status === 'submitted' && rows[0].correction_requested
            ? 'correction_requested'
            : rows[0].status,
          full_name: me.full_name,
          bank_name: rows[0].bank_name,
          account_type: rows[0].account_type,
          routing_masked: maskNumber(rows[0].routing_number),
          account_masked: maskNumber(rows[0].account_number),
          signature_name: rows[0].signature_name || '',
          signature_style: rows[0].signature_style || '',
          signed_at: rows[0].signed_at || null,
        };
      }
    }
    let team = null;
    if (access.isOwner) {
      const { rows } = await pool().query(
        `SELECT d.*, m.full_name
           FROM direct_deposit_details d
           JOIN staff_members m ON m.id = d.staff_member_id
          WHERE d.business_id = $1 ORDER BY m.full_name ASC`,
        [req.params.bid],
      );
      const counts = await pool().query(
        `SELECT staff_member_id, COUNT(*)::int AS n FROM direct_deposit_submissions
          WHERE business_id = $1 GROUP BY staff_member_id`,
        [req.params.bid],
      );
      const countByMember = new Map(counts.rows.map((r) => [r.staff_member_id, r.n]));
      team = rows.map((row) => ({
        staff_member_id: row.staff_member_id,
        full_name: row.full_name,
        status: row.status === 'submitted' && row.correction_requested
          ? 'correction_requested'
          : row.status,
        bank_name: row.bank_name,
        account_type: row.account_type,
        routing_masked: maskNumber(row.routing_number),
        account_masked: maskNumber(row.account_number),
        submitted_at: row.submitted_at,
        signed_at: row.signed_at || null,
        submission_count: countByMember.get(row.staff_member_id) || 0,
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
    // The request rings the member's bell (Nov 21, 2026): sending
    // the ask should feel like sending — the member learns of it
    // where they already look, not only by opening Payroll.
    const targetUser = await userForStaffRow(pool(), target);
    if (targetUser) {
      await notifyUser(pool(), access.business, {
        recipientUserId: targetUser.id,
        recipientStaffId: target.id,
        recipientRole: personLevel(target),
        actorStaffId: null,
        actorName: await ownerPublicName(pool(), access.business),
        event: 'dd_invited',
        detail: 'The owner asked you to add your direct deposit details — open Payroll to fill in and sign your form.',
        refId: target.id,
      });
    }
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
    // The signature step (owner's flow, Nov 19, 2026): the member
    // types their name and chooses a style — that IS their
    // electronic signature on the form. No signature, no submit:
    // an unsigned form is not the completed form she ruled on.
    const signatureName = String(req.body?.signature_name || '').trim().slice(0, 80);
    const signatureStyle = String(req.body?.signature_style || '');
    if (!signatureName) {
      throw err(400, 'invalid_value', 'Type your name to sign your direct deposit form.');
    }
    if (!['script', 'italic', 'simple'].includes(signatureStyle)) {
      throw err(400, 'invalid_value', 'Choose a signature style.');
    }
    // A re-submit while a form already stands (the member fixing
    // their own typo, or answering a send-back) is a CORRECTION:
    // it writes a new sealed record and supersedes the old one —
    // the sealed record itself is never edited (Nov 21, 2026).
    const isCorrection = rows[0].status === 'submitted';
    const cleanBankName = bankName.slice(0, 120);
    await withTx(pool(), async (client) => {
      await client.query(
        `UPDATE direct_deposit_details
            SET status = 'submitted', correction_requested = FALSE, bank_name = $1, account_type = $2, routing_number = $3,
                account_number = $4, signature_name = $5, signature_style = $6,
                signed_at = NOW(), submitted_at = NOW(), updated_at = NOW()
          WHERE business_id = $7 AND staff_member_id = $8`,
        [cleanBankName, accountType, routing, account, signatureName, signatureStyle, req.params.bid, me.id],
      );
      await client.query(
        `UPDATE direct_deposit_submissions SET superseded_at = NOW()
          WHERE business_id = $1 AND staff_member_id = $2 AND superseded_at IS NULL`,
        [req.params.bid, me.id],
      );
      await client.query(
        `INSERT INTO direct_deposit_submissions
           (id, business_id, staff_member_id, bank_name, account_type, routing_number,
            account_number, signature_name, signature_style, signed_at, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [
          crypto.randomUUID(), req.params.bid, me.id, cleanBankName, accountType, routing,
          account, signatureName, signatureStyle,
        ],
      );
    });
    // Arrival (owner's ruling): the owner's bell rings when a
    // form lands — and again when a corrected form replaces it.
    await notifyUser(pool(), access.business, {
      recipientUserId: access.business.owner_id,
      recipientStaffId: null,
      recipientRole: 'owner',
      actorStaffId: me.id,
      actorName: me.full_name,
      event: isCorrection ? 'dd_corrected' : 'dd_submitted',
      detail: isCorrection
        ? `${me.full_name} sent a corrected direct deposit form.`
        : `${me.full_name} sent their direct deposit form.`,
      refId: me.id,
    });
    return res.json({
      submitted: true,
      corrected: isCorrection,
      routing_masked: maskNumber(routing),
      account_masked: maskNumber(account),
    });
  }));

  // The owner's half of the correction path: send a submitted form
  // back so the member can fix it. The sealed record is NOT
  // touched — it stands until the member's corrected form
  // supersedes it. The member's bell rings with the ask.
  router.post(`${base}/dd/send-back`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the owner manages direct deposit.');
    await assertNotInGrace(pool(), req.params.bid);
    const target = await personOr404(pool(), req.params.bid, String(req.body?.staff_member_id || ''));
    const { rows } = await pool().query(
      'SELECT * FROM direct_deposit_details WHERE business_id = $1 AND staff_member_id = $2 LIMIT 1',
      [req.params.bid, target.id],
    );
    if (!rows[0] || rows[0].status !== 'submitted') {
      throw err(400, 'invalid_value', 'That team member has not sent their details yet.');
    }
    await pool().query(
      `UPDATE direct_deposit_details
          SET correction_requested = TRUE, updated_at = NOW()
        WHERE business_id = $1 AND staff_member_id = $2`,
      [req.params.bid, target.id],
    );
    const targetUser = await userForStaffRow(pool(), target);
    if (targetUser) {
      await notifyUser(pool(), access.business, {
        recipientUserId: targetUser.id,
        recipientStaffId: target.id,
        recipientRole: personLevel(target),
        actorStaffId: null,
        actorName: await ownerPublicName(pool(), access.business),
        event: 'dd_correction_requested',
        detail: 'The owner sent your direct deposit form back so you can fix it — open Payroll to check your details, sign, and send it again.',
        refId: target.id,
      });
    }
    return res.json({ sent_back: target.id });
  }));

  // The owner's form read — the screen behind Payroll's "View
  // signed form" (Nov 21, 2026; this endpoint existed owner-only
  // since the Workforce phase but no screen called it). It returns
  // the current details, the CURRENT sealed submission in full
  // (the operative signed form, full numbers — owner only), and
  // the superseded history MASKED: the chain stays honest without
  // spreading old numbers around.
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
    const member = await personOr404(pool(), req.params.bid, req.params.staffId);
    const { rows: submissions } = await pool().query(
      `SELECT * FROM direct_deposit_submissions
        WHERE business_id = $1 AND staff_member_id = $2
        ORDER BY submitted_at DESC, created_at DESC`,
      [req.params.bid, req.params.staffId],
    );
    const current = submissions.find((s) => !s.superseded_at) || null;
    const form = current
      ? {
          bank_name: current.bank_name,
          account_type: current.account_type,
          routing_number: current.routing_number,
          account_number: current.account_number,
          signature_name: current.signature_name,
          signature_style: current.signature_style,
          signed_at: current.signed_at,
          submitted_at: current.submitted_at,
        }
      : null;
    const history = submissions
      .filter((s) => s.superseded_at)
      .map((s) => ({
        bank_name: s.bank_name,
        account_type: s.account_type,
        routing_masked: maskNumber(s.routing_number),
        account_masked: maskNumber(s.account_number),
        signature_name: s.signature_name,
        signed_at: s.signed_at,
        submitted_at: s.submitted_at,
        superseded_at: s.superseded_at,
      }));
    return res.json({
      details: rows[0],
      member_name: member.full_name,
      form,
      history,
    });
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
      // The owner's display name (Nov 21, 2026): once the owner
      // sets a real name it replaces the word "Owner" here, and
      // publicThread below re-resolves it live for threads that
      // were created before the name was set.
      return { key, user_id: business.owner_id, staff_id: null, name: await ownerPublicName(pool(), business), role: 'owner' };
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

  // READ RECEIPTS WITH THE OWNER EXCEPTION (the owner's ruling,
  // Nov 19, 2026): a message's read_at may be shown to a viewer
  // ONLY when the person who did the reading is not the business
  // owner — or the viewer IS the owner. Staff and managers see
  // each other's read marks both ways; the owner sees when staff
  // read the owner's messages; but a staff member must NEVER
  // learn whether the owner read theirs, under any code path.
  // This shaper is the single choke point: every message that
  // leaves these routes passes through it.
  function shapeMessageForViewer(message, thread, access, viewerUserId, ownerName = null) {
    const participants = threadParticipants(thread);
    const reader = participants.find((p) => p.user_id !== message.sender_user_id);
    const hideRead = Boolean(reader) && reader.key === OWNER_KEY && !access.isOwner;
    // The owner's name is resolved live (Nov 21, 2026): a message
    // the owner sent before setting their display name still
    // shows the name they go by now, never a stale "Owner".
    const ownerParticipant = participants.find((p) => p.key === OWNER_KEY);
    const senderName =
      ownerName && ownerParticipant && message.sender_user_id === ownerParticipant.user_id
        ? ownerName
        : message.sender_name;
    return {
      ...message,
      sender_name: senderName,
      read_at: hideRead ? null : message.read_at,
      mine: message.sender_user_id === viewerUserId,
    };
  }

  async function publicThread(thread, access, me, userId, extras = null) {
    // Faces + the owner's name (Nov 21, 2026): participants carry
    // `photo` — true only when that person holds an APPROVED
    // profile photo (a pending one is invisible by law) — and the
    // owner's participant name is the live display name, so a
    // thread opened before the name was set still shows it.
    const photoKeys = extras?.photoKeys ?? (await approvedPhotoKeys(pool(), thread.business_id));
    const ownerName = extras?.ownerName ?? (await ownerPublicName(pool(), access.business));
    const participants = threadParticipants(thread).map((p) => ({
      ...p,
      name: p.key === OWNER_KEY ? ownerName : p.name,
      photo: photoKeys.has(p.key),
    }));
    const key = myKey(access, me);
    const mine = participants.some((p) => p.key === key);
    const { rows: lastRows } = await pool().query(
      'SELECT body, kind, sender_name, sender_user_id, created_at FROM messages WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 1',
      [thread.id],
    );
    const last = lastRows[0] ?? null;
    const ownerParticipant = participants.find((p) => p.key === OWNER_KEY);
    return {
      id: thread.id,
      business_id: thread.business_id,
      participants,
      other: mine ? participants.find((p) => p.key !== key) : null,
      is_mine: mine,
      can_post: mine,
      oversight: !mine && access.isOwner,
      last_message: last
        ? {
            ...last,
            sender_name:
              ownerParticipant && last.sender_user_id === ownerParticipant.user_id
                ? ownerName
                : last.sender_name,
            mine: last.sender_user_id === userId,
          }
        : null,
      last_message_at: thread.last_message_at,
      unread: mine ? await threadUnread(thread.id, userId) : null,
      created_at: thread.created_at,
    };
  }

  /** One photo/name read per request, shared by every thread the
   *  request shapes (the list route shapes up to 200). */
  async function threadExtras(businessId, business) {
    return {
      photoKeys: await approvedPhotoKeys(pool(), businessId),
      ownerName: await ownerPublicName(pool(), business),
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
    const extras = await threadExtras(req.params.bid, access.business);
    const threads = [];
    let unreadTotal = 0;
    for (const thread of rows) {
      const pub = await publicThread(thread, access, me, req.user.id, extras);
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
      `SELECT m.*, vn.duration_ms AS voice_duration_ms
         FROM messages m
         LEFT JOIN message_voice_notes vn ON vn.message_id = m.id
        WHERE m.thread_id = $1 ORDER BY m.created_at ASC LIMIT 500`,
      [thread.id],
    );
    const extras = await threadExtras(req.params.bid, access.business);
    return res.json({
      thread: await publicThread(thread, access, me, req.user.id, extras),
      messages: rows.map((m) => shapeMessageForViewer(m, thread, access, req.user.id, extras.ownerName)),
    });
  }));

  router.post(`${base}/messages/threads/:threadId/messages`, asyncHandler(async (req, res) => {
    const { access, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const thread = await threadOr404(req.params.threadId, req.params.bid);
    const participants = threadParticipants(thread);
    const key = myKey(access, me);
    const sender = participants.find((p) => p.key === key);
    // The owner's stored participant name is a snapshot from the
    // thread's creation; new messages carry the name they go by
    // now (Nov 21, 2026).
    if (sender && sender.key === OWNER_KEY) {
      sender.name = await ownerPublicName(pool(), access.business);
    }
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
    return res.status(201).json({ message: shapeMessageForViewer(inserted.rows[0], thread, access, req.user.id) });
  }));

  // ---- Voice notes -----------------------------------------------------------
  // A voice note is a message whose body is a recording of the
  // sender's own voice. The phone's browser records in its own
  // container (WebM on Android, MP4 on iPhone); the server
  // converts it to MP3 — the one format every phone plays —
  // before anything is stored (server/voiceNote.js). The bytes
  // live in Postgres and are served only from the file route
  // below, behind the same conversation-access check as the
  // thread itself: the two participants, or the owner reading
  // in oversight. The owner still cannot POST voice (or text)
  // into a conversation that is not theirs.

  async function messageSenderOr403(req, access, me) {
    const thread = await threadOr404(req.params.threadId, req.params.bid);
    const participants = threadParticipants(thread);
    const key = myKey(access, me);
    const sender = participants.find((p) => p.key === key);
    // The owner's stored participant name is a snapshot from the
    // thread's creation; new messages carry the name they go by
    // now (Nov 21, 2026).
    if (sender && sender.key === OWNER_KEY) {
      sender.name = await ownerPublicName(pool(), access.business);
    }
    if (!sender) {
      throw err(
        403,
        'forbidden',
        access.isOwner
          ? 'You can read every conversation in your business, but you can only post in your own.'
          : 'This conversation is private to the two people in it.',
      );
    }
    return { thread, participants, key, sender };
  }

  router.post(`${base}/messages/threads/:threadId/voice`, asyncHandler(async (req, res) => {
    const { access, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const { thread, participants, key, sender } = await messageSenderOr403(req, access, me);
    const parsed = parseVoiceDataUrl(req.body?.dataUrl);
    if (!parsed) {
      throw err(400, 'invalid_value', 'Send a voice recording of a few minutes at most.');
    }
    const durationMs = Math.min(
      Math.max(0, Math.round(Number(req.body?.duration_ms) || 0)),
      VOICE_MAX_DURATION_MS,
    );
    let mp3;
    try {
      mp3 = await convertVoiceToMp3(parsed.bytes, parsed.ext);
    } catch {
      throw err(400, 'invalid_value', "That recording could not be prepared — please record it again.");
    }
    const messageId = crypto.randomUUID();
    const inserted = await pool().query(
      `INSERT INTO messages (id, thread_id, business_id, sender_user_id, sender_staff_id, sender_name, body, kind)
       VALUES ($1, $2, $3, $4, $5, $6, '', 'voice') RETURNING *`,
      [messageId, thread.id, req.params.bid, req.user.id, sender.staff_id, sender.name],
    );
    await pool().query(
      `INSERT INTO message_voice_notes (message_id, business_id, content_type, size_bytes, duration_ms, data_base64)
       VALUES ($1, $2, 'audio/mpeg', $3, $4, $5)`,
      [messageId, req.params.bid, mp3.length, durationMs, mp3.toString('base64')],
    );
    await pool().query(
      'UPDATE message_threads SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
      [thread.id],
    );
    const other = participants.find((p) => p.key !== key);
    await notifyUser(pool(), access.business, {
      recipientUserId: other.user_id,
      recipientStaffId: other.staff_id,
      recipientRole: other.role,
      actorStaffId: sender.staff_id,
      actorName: sender.name,
      event: 'message',
      detail: `New voice note from ${sender.name}`,
      refId: thread.id,
    });
    return res.status(201).json({
      message: {
        ...shapeMessageForViewer(inserted.rows[0], thread, access, req.user.id),
        voice_duration_ms: durationMs,
      },
    });
  }));

  router.get(`${base}/messages/threads/:threadId/voice/:messageId/file`, asyncHandler(async (req, res) => {
    const { access, me } = await ctx(req);
    const thread = await threadOr404(req.params.threadId, req.params.bid);
    const participants = threadParticipants(thread);
    const mine = participants.some((p) => p.key === myKey(access, me));
    if (!mine && !access.isOwner) {
      throw err(403, 'forbidden', 'This conversation is private to the two people in it.');
    }
    const { rows } = await pool().query(
      `SELECT vn.content_type, vn.data_base64 FROM message_voice_notes vn
         JOIN messages m ON m.id = vn.message_id
        WHERE vn.message_id = $1 AND vn.business_id = $2 AND m.thread_id = $3 LIMIT 1`,
      [req.params.messageId, req.params.bid, thread.id],
    );
    const note = rows[0];
    if (!note) throw err(404, 'not_found', 'Voice note not found.');
    res.setHeader('Content-Type', note.content_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline; filename="voice-note.mp3"');
    return res.send(Buffer.from(note.data_base64, 'base64'));
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
