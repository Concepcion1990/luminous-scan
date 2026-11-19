/**
 * The shift window — the owner's ruling, Nov 19, 2026.
 *
 * A non-owner member's access to a business is bracketed by the
 * schedule posted for them (by the owner, or by a manager for
 * staff; the owner's own posted schedule brackets a manager the
 * same way). Only the owner stands outside the bracket — nobody
 * schedules the owner.
 *
 *   - The door opens 10 minutes before the scheduled shift start.
 *   - No scheduled shift that day = no window that day.
 *   - Clocking out starts a 10-minute grace window (time to check
 *     your times); when it ends, the session is over — enforced
 *     here, server-side, on every request (sessions are server
 *     rows, re-checked per request), plus a client timer that
 *     signs the UI out at the same moment.
 *   - Clocking back in cancels the pending auto-logout.
 *
 * The schedule is weekly-recurring with at most ONE shift per
 * weekday (the schedule writer enforces that), so a day carries
 * at most one window: [start − 10min, end]. Split shifts do not
 * exist in this schema; if they ever do, each shift's window is
 * computed by the same rule.
 *
 * FORGOTTEN CLOCK-OUT (surfaced for the owner's ruling, not
 * decided here): a member who never clocks out keeps an open
 * time entry, and an open entry means "at work" — access stays
 * open. No scheduled-end bracket was invented. (The clock itself
 * already refuses a self clock-out more than 10 minutes after
 * the shift ends and sends the member to a manager or the owner.)
 *
 * This module deliberately does NOT import workforceRoutes.js
 * (which imports sessions.js, which imports this module): the
 * small timezone helpers are mirrored here so requireAuth can
 * enforce the window without an import cycle.
 */
import { staffRowForEmail, isTrustedStaffRow } from './authz.js';

export const WINDOW_EARLY_MINUTES = 10;
const GRACE_DEFAULT_MS = 10 * 60 * 1000;

/**
 * The clock-out grace length. Production is 10 minutes; the env
 * override exists so the test harness can prove the mechanism
 * with a short window without waiting (the same pattern as the
 * other harness knobs). Anything unset/invalid = 10 minutes.
 */
export function autoLogoutGraceMs() {
  const value = Number(process.env.STAFF_AUTO_LOGOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : GRACE_DEFAULT_MS;
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function businessTimezone(business) {
  const tz = String(business?.timezone || '').trim();
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function localParts(date, timeZone) {
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

function hhmmToMinutes(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Milliseconds the zone is ahead of UTC at the given instant. */
function tzOffsetMs(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant of a business-local date (YYYY-MM-DD) + minutes into it. */
function zonedTimeToUtc(dateStr, minutes, timeZone) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day) + minutes * 60 * 1000;
  let utc = guess - tzOffsetMs(new Date(guess), timeZone);
  utc = guess - tzOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

function addDays(dateStr, count) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + count)).toISOString().slice(0, 10);
}

function weekdayOfDateStr(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The member row the window applies to, or null when the user
 * stands outside the bracket for their active business: no
 * active business, they own it, they have no trusted staff row
 * there, or their row is neither active nor invited (a suspended
 * member is governed by the seat block, not the window).
 */
export async function windowMember(pool, user) {
  const businessId = user?.active_business_id || null;
  if (!businessId) return null;
  const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1 LIMIT 1', [businessId]);
  const business = rows[0];
  if (!business || business.owner_id === user.id) return null;
  const row = await staffRowForEmail(pool, businessId, user.email);
  if (!row || !['active', 'invited'].includes(row.status || 'active')) return null;
  if (!(await isTrustedStaffRow(pool, business, row))) return null;
  return { business, member: row };
}

/**
 * Full window state for the user's active business.
 * { applies: false } when the bracket does not apply; otherwise
 * { applies: true, allowed, nextShiftStart (Date|null),
 *   autoLogoutAt (Date|null), memberId, businessId }.
 */
export async function staffWindowState(pool, user, now = new Date()) {
  const found = await windowMember(pool, user);
  if (!found) return { applies: false };
  const { business, member } = found;
  const businessId = business.id;
  const timeZone = businessTimezone(business);
  const local = localParts(now, timeZone);

  const { rows: scheduleRows } = await pool.query(
    'SELECT * FROM work_schedules WHERE business_id = $1 AND staff_member_id = $2',
    [businessId, member.id],
  );
  const schedules = new Map();
  for (const shift of scheduleRows) {
    if (!schedules.has(shift.weekday)) schedules.set(shift.weekday, shift);
  }

  const { rows: openRows } = await pool.query(
    `SELECT id FROM time_entries
      WHERE business_id = $1 AND staff_member_id = $2 AND clock_out_at IS NULL
      ORDER BY clock_in_at DESC LIMIT 1`,
    [businessId, member.id],
  );
  const hasOpenEntry = openRows.length > 0;

  const deadline = member.auto_logout_at ? new Date(member.auto_logout_at) : null;

  const todayShift = schedules.get(local.weekday) || null;
  let insideToday = false;
  let consumedToday = false;
  if (todayShift) {
    const start = hhmmToMinutes(todayShift.start_time);
    const end = hhmmToMinutes(todayShift.end_time);
    if (start !== null && end !== null) {
      insideToday = local.minutes >= start - WINDOW_EARLY_MINUTES && local.minutes <= end;
      const windowStart = zonedTimeToUtc(local.dateStr, start - WINDOW_EARLY_MINUTES, timeZone);
      const shiftEnd = zonedTimeToUtc(local.dateStr, end, timeZone);
      const { rows: doneRows } = await pool.query(
        `SELECT id FROM time_entries
          WHERE business_id = $1 AND staff_member_id = $2 AND clock_out_at IS NOT NULL
            AND clock_in_at >= $3 AND clock_in_at <= $4 LIMIT 1`,
        [businessId, member.id, windowStart.toISOString(), shiftEnd.toISOString()],
      );
      consumedToday = doneRows.length > 0;
    }
  }

  const allowed =
    hasOpenEntry ||
    (deadline !== null && now.getTime() < deadline.getTime()) ||
    (insideToday && !consumedToday);

  let nextShiftStart = null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const dateStr = addDays(local.dateStr, offset);
    const shift = schedules.get(weekdayOfDateStr(dateStr));
    if (!shift) continue;
    if (offset === 0 && consumedToday) continue;
    const start = hhmmToMinutes(shift.start_time);
    const end = hhmmToMinutes(shift.end_time);
    if (start === null || end === null) continue;
    const endInstant = zonedTimeToUtc(dateStr, end, timeZone);
    if (endInstant.getTime() <= now.getTime()) continue;
    nextShiftStart = zonedTimeToUtc(dateStr, start, timeZone);
    break;
  }

  return {
    applies: true,
    allowed,
    nextShiftStart,
    autoLogoutAt: deadline,
    memberId: member.id,
    businessId,
  };
}

/** The pending auto-logout instant for /auth/me (null when none). */
export async function autoLogoutAtFor(pool, user) {
  const found = await windowMember(pool, user);
  if (!found?.member?.auto_logout_at) return null;
  return new Date(found.member.auto_logout_at).toISOString();
}

/** Clock-out: start the grace window on the member's row. */
export async function startAutoLogout(pool, businessId, memberId, now = new Date()) {
  const deadline = new Date(now.getTime() + autoLogoutGraceMs());
  await pool.query('UPDATE staff_members SET auto_logout_at = $1 WHERE id = $2 AND business_id = $3', [
    deadline.toISOString(),
    memberId,
    businessId,
  ]);
  return deadline;
}

/** Clock-in: clocking back in cancels the pending auto-logout. */
export async function cancelAutoLogout(pool, businessId, memberId) {
  await pool.query(
    'UPDATE staff_members SET auto_logout_at = NULL WHERE id = $1 AND business_id = $2 AND auto_logout_at IS NOT NULL',
    [memberId, businessId],
  );
}

/**
 * The member's level, mirroring workforceRoutes' personLevel
 * (manager iff the preset-manager role or a role named manager).
 * Mirrored rather than imported — workforceRoutes imports
 * sessions.js, which imports this module.
 */
export function memberLevel(row) {
  if (!row) return 'staff';
  const roleName = String(row.role_name || '').trim().toLowerCase();
  return row.role_id === 'preset-manager' || roleName === 'manager' ? 'manager' : 'staff';
}

/**
 * The staff welcome (owner's addition, Nov 19, 2026): EVERY
 * person the owner hires — manager, viewer, clerk, any role —
 * sees a one-time welcome page at their first sign-in (her
 * ruling, confirmed the same morning: "it doesn't matter what
 * your role is"). The owner herself never gets it: she wasn't
 * hired, and windowMember already returns null for her.
 */
export async function staffWelcomePending(pool, user) {
  const found = await windowMember(pool, user);
  if (!found) return false;
  return !found.member.welcome_seen_at;
}

/** Mark the welcome seen for the member's row in the active business. */
export async function markStaffWelcomeSeen(pool, user) {
  const found = await windowMember(pool, user);
  if (!found) return false;
  await pool.query(
    'UPDATE staff_members SET welcome_seen_at = NOW() WHERE id = $1 AND business_id = $2 AND welcome_seen_at IS NULL',
    [found.member.id, found.business.id],
  );
  return true;
}
