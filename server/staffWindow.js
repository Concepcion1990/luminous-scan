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
 * The missed clock-out FLAG and its bell live in
 * server/clockAdmin.js (the clock build, Nov 21, 2026); the
 * bracket rule itself is unchanged — an open entry still admits.
 *
 * THE CALL-IN WINDOW (the clock build, Nov 21, 2026 — owner's
 * rulings Nov 20, 2026): a member with no shift covering now may
 * still be let in when a call-in window is open for them (opened
 * by the owner, or by a manager holding the staff.clock tick —
 * server/clockAdmin.js). An open window admits exactly like an
 * open clock-in entry: it is the person's sign-in path as well
 * as their clock-in path. It closes when they clock out (the
 * grace above then runs) or when the opener closes it early;
 * nothing closes it automatically.
 *
 * WHICH BUSINESS JUDGES (the auto-logout defect, proven by the
 * owner's hand Nov 21, 2026): the bracket used to be judged ONLY
 * against users.active_business_id. That field is set only when
 * the client explicitly switches workspaces — a member who
 * enters through the invite door and works in the business
 * client-side can carry a null (or stale) active id forever, so
 * windowMember found nobody, the bracket silently never
 * applied, and the promised 10-minute auto-logout never fired
 * (she clocked out at 11:29 AM and was still signed in at
 * 1:23 PM). The harness never saw it because it set the field
 * by hand. Now: the active business still judges when it holds
 * the member's row (the normal switched-in case, unchanged);
 * otherwise the member's own staff businesses judge — a single
 * one directly, several by "any open door admits" (the same
 * philosophy as the business-switch escape hatch in
 * sessions.js). A business the user OWNS never judges them.
 *
 * This module deliberately does NOT import workforceRoutes.js
 * (which imports sessions.js, which imports this module): the
 * small timezone helpers are mirrored here so requireAuth can
 * enforce the window without an import cycle.
 */
import { staffRowForEmail, isTrustedStaffRow } from './authz.js';
import { businessInFailedPaymentViewOnly } from './failedPayment.js';

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
export function zonedTimeToUtc(dateStr, minutes, timeZone) {
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
 * The member row the window applies to in ONE business, or null
 * when the user stands outside the bracket there: they own it,
 * they have no trusted staff row there, or their row is neither
 * active nor invited (a suspended member is governed by the
 * seat block, not the window).
 */
async function memberInBusiness(pool, user, business) {
  if (!business || business.owner_id === user.id) return null;
  const row = await staffRowForEmail(pool, business.id, user.email);
  if (!row || !['active', 'invited'].includes(row.status || 'active')) return null;
  if (!(await isTrustedStaffRow(pool, business, row))) return null;
  return { business, member: row };
}

/**
 * Every business where this user is a bracketed member: their
 * trusted, active-or-invited staff rows in businesses they do
 * not own. The active business (when it is one of them) comes
 * first. Small by construction — a person works at a handful of
 * businesses at most.
 */
export async function windowCandidates(pool, user) {
  if (!user?.email) return [];
  const { rows } = await pool.query(
    `SELECT * FROM staff_members
      WHERE LOWER(email) = LOWER($1) AND status IN ('active', 'invited')`,
    [user.email],
  );
  const out = [];
  for (const row of rows) {
    const { rows: bizRows } = await pool.query('SELECT * FROM businesses WHERE id = $1 LIMIT 1', [row.business_id]);
    const found = await memberInBusiness(pool, user, bizRows[0]);
    if (found) out.push(found);
  }
  const activeId = user.active_business_id || null;
  out.sort((a, b) => (a.business.id === activeId ? -1 : 0) - (b.business.id === activeId ? -1 : 0));
  return out;
}

/**
 * The member row the window applies to, or null. The ACTIVE
 * business judges when it holds the member's row (the normal
 * switched-in case) and judges STRICTLY (the 314 law, schedule
 * or no schedule); otherwise, when the person is a member of
 * exactly one business, that business judges through the
 * fallback the Nov 21, 2026 auto-logout defect demanded,
 * because a member who never explicitly switched workspaces
 * otherwise stood outside the bracket forever (see the header
 * note) — the fallback binds only where the business holds a
 * schedule, a deadline, an open entry, or an open window for
 * them (see stateForMember).
 */
export async function windowMember(pool, user) {
  const businessId = user?.active_business_id || null;
  if (businessId) {
    const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1 LIMIT 1', [businessId]);
    const found = await memberInBusiness(pool, user, rows[0]);
    if (found) return { ...found, strict: true };
  }
  const candidates = await windowCandidates(pool, user);
  return candidates.length === 1 ? { ...candidates[0], strict: false } : null;
}

/**
 * Full window state for ONE business + member: the shift bracket
 * plus the call-in window. { applies: true, allowed,
 * nextShiftStart (Date|null), autoLogoutAt (Date|null),
 * callInOpen, hasOpenEntry, memberId, businessId }.
 */
async function stateForMember(pool, business, member, now, strict = false) {
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

  // The call-in window (clock build, Nov 21, 2026): an open
  // window admits exactly like an open entry — it is the
  // person's sign-in path as well as their clock-in path.
  const { rows: windowRows } = await pool.query(
    `SELECT id FROM call_in_windows
      WHERE business_id = $1 AND staff_member_id = $2 AND closed_at IS NULL
      ORDER BY opened_at DESC LIMIT 1`,
    [businessId, member.id],
  );
  const callInOpen = windowRows.length > 0;

  const deadline = member.auto_logout_at ? new Date(member.auto_logout_at) : null;

  // The bracket binds a member to their SHIFTS — with one
  // careful edge, settled against the 314 pins on both sides.
  // Judged through the ACTIVE business (strict: the member is
  // switched into the shop the bracket guards), the 314 law
  // stands exactly: the bracket binds whenever a trusted row
  // exists there, schedule or no schedule — no shift today
  // refuses, and names no next shift. Judged only through the
  // candidate fallback (the auto-logout defect shape: the
  // member's active id is null or stale, so 314 never judged
  // them at all), the bracket binds only when this business
  // holds something to bind TO — a schedule row, an armed
  // auto-logout deadline, an open entry, or an open call-in
  // window. With none of those, the fallback member stands
  // outside it: the invited hire's first sign-in IS their
  // activation, a pre-roster member's welcome and training
  // must stay reachable, and membership healing at sign-in
  // must not be locked out by the very door it repairs (the
  // t3 staff-entry invariants codify all three). An armed
  // deadline binds in both modes regardless: the deadline is
  // a promise made at clock-out, and a deleted schedule must
  // not unmake it.
  if (!strict && scheduleRows.length === 0 && !deadline && !hasOpenEntry && !callInOpen) {
    return {
      applies: false,
      allowed: true,
      nextShiftStart: null,
      autoLogoutAt: null,
      callInOpen,
      hasOpenEntry,
      insideShift: false,
      memberId: member.id,
      businessId,
    };
  }

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
    callInOpen ||
    (deadline !== null && now.getTime() < deadline.getTime()) ||
    (insideToday && !consumedToday);

  // Release 345 (the bracket fix): a LAPSED deadline is spent,
  // not pending. When this member is admitted by live work — a
  // fresh unconsumed shift, an open entry, an open call-in
  // window — the old deadline's promise was already kept by the
  // lockout it imposed after the earlier clock-out; carrying it
  // into the new work period served it to /auth/me as a live
  // auto-logout, and the client timer evicted a rightfully
  // admitted member on the spot (the owner's Nov 22, 2026
  // Staff 1 bounce: Saturday's clock-out deadline, still on the
  // row Sunday inside her shift). Treat it as spent — clear the
  // row (cancelAutoLogout semantics) and surface no deadline.
  // A FUTURE deadline is untouched: the mid-session grace still
  // dies at its deadline (339). A lapsed deadline on a member
  // who is NOT admitted by work is likewise untouched — the
  // refusal path never reaches this clearing.
  let liveDeadline = deadline;
  if (
    deadline !== null &&
    now.getTime() >= deadline.getTime() &&
    (hasOpenEntry || callInOpen || (insideToday && !consumedToday))
  ) {
    await cancelAutoLogout(pool, businessId, member.id);
    liveDeadline = null;
  }

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
    autoLogoutAt: liveDeadline,
    callInOpen,
    hasOpenEntry,
    insideShift: insideToday && !consumedToday,
    memberId: member.id,
    businessId,
  };
}

/**
 * Full window state for the user. { applies: false } when the
 * bracket does not apply anywhere; otherwise the state of the
 * business that judges (see windowMember) — or, when the user
 * is a member of several businesses and the active one is not
 * among them, the merge of all of them: any open door admits,
 * the refusal names the earliest next shift, and the surfaced
 * auto-logout deadline is the earliest grace deadline only
 * when grace is the sole thing keeping the session alive.
 */
export async function staffWindowState(pool, user, now = new Date()) {
  // The failed-payment view-only days (owner's ruling Nov 20,
  // 2026; release 341): while a business sits in its 15 view-only
  // days, the bracket does NOT gate its people — staff can sign
  // in outside any shift to look and to retrieve their own pay
  // stubs and information. A business in view-only simply stands
  // outside the bracket, like a business the user owns.
  const judged = await windowMember(pool, user);
  if (judged) {
    if (await businessInFailedPaymentViewOnly(pool, judged.business.id, now)) return { applies: false };
    return stateForMember(pool, judged.business, judged.member, now, judged.strict);
  }
  const candidates = await windowCandidates(pool, user);
  if (!candidates.length) return { applies: false };
  const states = [];
  for (const candidate of candidates) {
    if (await businessInFailedPaymentViewOnly(pool, candidate.business.id, now)) continue;
    const state = await stateForMember(
      pool, candidate.business, candidate.member, now,
      candidate.business.id === (user?.active_business_id || null),
    );
    if (state.applies) states.push(state);
  }
  if (!states.length) return { applies: false };
  const allowed = states.some((state) => state.allowed);
  let nextShiftStart = null;
  for (const state of states) {
    if (state.nextShiftStart && (!nextShiftStart || state.nextShiftStart.getTime() < nextShiftStart.getTime())) {
      nextShiftStart = state.nextShiftStart;
    }
  }
  const admittedByWork = states.some((state) => state.hasOpenEntry || state.callInOpen || state.insideShift);
  let autoLogoutAt = null;
  if (allowed && !admittedByWork) {
    for (const state of states) {
      if (state.autoLogoutAt && state.autoLogoutAt.getTime() > now.getTime()) {
        if (!autoLogoutAt || state.autoLogoutAt.getTime() < autoLogoutAt.getTime()) {
          autoLogoutAt = state.autoLogoutAt;
        }
      }
    }
  }
  return {
    applies: true,
    allowed,
    nextShiftStart,
    autoLogoutAt,
    callInOpen: states.some((state) => state.callInOpen),
    hasOpenEntry: states.some((state) => state.hasOpenEntry),
    memberId: null,
    businessId: null,
  };
}

/**
 * The pending auto-logout instant for /auth/me (null when
 * none). Release 345: a deadline that is not in the future is
 * not pending — it is spent, and serving it verbatim made the
 * client timer sign a rightfully admitted member out the
 * instant they signed in (the Nov 22, 2026 Staff 1 bounce).
 */
export async function autoLogoutAtFor(pool, user, now = new Date()) {
  const found = await windowMember(pool, user);
  if (!found?.member?.auto_logout_at) return null;
  const deadline = new Date(found.member.auto_logout_at);
  if (!(deadline.getTime() > now.getTime())) return null;
  return deadline.toISOString();
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
