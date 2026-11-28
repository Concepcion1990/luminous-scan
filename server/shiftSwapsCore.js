/**
 * Shift swaps, covers and the open-shift pool — plus staff
 * availability (Nov 26, 2026; plan Part 7, item 391,
 * round-2 Gap 2). GENERAL, both plans: this lives with the
 * general workforce tools, and the Restaurant Team & Place
 * shelf cross-links it like the other general features.
 *
 * Doctrines:
 *  - Swaps are STAFF-INITIATED but NOTHING LANDS WITHOUT
 *    MANAGER APPROVAL: this core never touches the stored
 *    schedule; the approval door in the routes rewrites
 *    work_schedules in the same transaction that marks the
 *    swap approved. No silent schedule changes.
 *  - A swap that would push someone into overtime is
 *    FLAGGED BEFORE APPROVAL, riding the labor-watch
 *    warnings engine (release 374): the flag is the
 *    engine's own overtime verdict on the week AS THE SWAP
 *    WOULD LEAVE IT, compared against the week as it stands.
 *  - Availability is the person's OWN record to keep
 *    current: only the person writes their rows, and the
 *    schedule is built against them (the builder sees them,
 *    and a taker whose availability clashes is flagged).
 *  - A "shift" is a row of the recurring week
 *    (work_schedules: one row per person per weekday). An
 *    offer snapshots its shift; if the live schedule has
 *    moved since, approval refuses rather than guessing.
 */
import { computeScheduleWeek, hhmmToMinutes } from './laborWarningsCore.js';

export const NOT_OWN_SHIFT_MESSAGE = 'You can only offer one of your own scheduled shifts.';
export const ALREADY_OFFERED_MESSAGE = 'This shift already has an open swap request.';
export const TRADE_PARTNER_MESSAGE = 'Choose a coworker in the same role to trade with.';
export const PARTNER_NO_SHIFT_MESSAGE = 'That coworker has no shift that day to trade.';
export const NOT_FOUND_MESSAGE = 'Swap request not found.';
export const NOT_OPEN_MESSAGE = 'This swap is no longer open.';
export const ONLY_NAMED_MESSAGE = 'Only the coworker named in this trade can accept it.';
export const SAME_ROLE_POOL_MESSAGE = 'Only a coworker in the same role can take a shift from the pool.';
export const OWN_SHIFT_TAKE_MESSAGE = 'You cannot take your own offered shift.';
export const ONLY_REQUESTER_CANCEL_MESSAGE = 'Only the person who offered this swap can cancel it.';
export const STAFF_DECIDE_MESSAGE = 'Team members cannot decide shift swaps.';
export const MANAGER_SWAP_OWNER_MESSAGE = 'Only the owner can decide a swap involving a manager.';
export const DECLINE_REASON_MESSAGE = 'A declined swap needs a reason, so the team members know why.';
export const SCHEDULE_CHANGED_MESSAGE = 'The schedule changed since this swap was offered, so it cannot go ahead. Ask for a fresh offer.';
export const TAKER_BUSY_MESSAGE = 'The person taking this shift already has a shift that day, so the swap cannot go ahead.';
export const BAD_ACTION_MESSAGE = 'Choose what to do with this swap: accept, approve, decline or cancel.';
export const AVAILABILITY_WEEK_MESSAGE = 'Send your availability as a list of up to 7 days.';
export const AVAILABILITY_DAY_MESSAGE = 'Each availability day needs a weekday (0-6), and any times must be HH:MM with the end after the start.';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/** Roles match the way the team reads them: the stored
 *  role name, trimmed, case-insensitive. Two people are
 *  same-role when their role names match this way. */
export function sameRole(a, b) {
  const left = String(a?.role_name || '').trim().toLowerCase();
  const right = String(b?.role_name || '').trim().toLowerCase();
  return left !== '' && left === right;
}

function rowMatches(row, staffId, weekday, startTime, endTime) {
  return Boolean(row)
    && row.staff_member_id === staffId
    && Number(row.weekday) === Number(weekday)
    && row.start_time === startTime
    && row.end_time === endTime;
}

function findRow(schedules, staffId, weekday) {
  return (schedules || []).find(
    (row) => row.staff_member_id === staffId && Number(row.weekday) === Number(weekday),
  ) || null;
}

/**
 * The schedule as a swap would leave it. Pure.
 *
 * schedules: [{ staff_member_id, weekday, start_time,
 * end_time }] — the business's whole recurring week.
 * swap: the request row (requester_id, kind, weekday,
 * start_time, end_time, target_id, target_weekday,
 * target_start_time, target_end_time).
 * takerId: who ends up working the offered shift — the
 * claimant for a pool offer, the named coworker for a
 * trade.
 *
 * Returns { ok: true, schedules } with the rewritten week,
 * or { ok: false, code } where code is 'schedule_changed'
 * (a snapshotted shift no longer stands as offered) or
 * 'taker_busy' (someone would end up with two shifts on
 * one weekday). The input list is never mutated.
 */
export function applySwapToSchedules(schedules, swap, takerId) {
  const week = (schedules || []).map((row) => ({ ...row }));
  const giverRow = findRow(week, swap.requester_id, swap.weekday);
  if (!rowMatches(giverRow, swap.requester_id, swap.weekday, swap.start_time, swap.end_time)) {
    return { ok: false, code: 'schedule_changed' };
  }
  if (swap.kind === 'trade') {
    const targetRow = findRow(week, swap.target_id, swap.target_weekday);
    if (!rowMatches(targetRow, swap.target_id, swap.target_weekday, swap.target_start_time, swap.target_end_time)) {
      return { ok: false, code: 'schedule_changed' };
    }
    // After the exchange the giver works the target's day
    // and the target works the giver's day; neither may
    // already hold another shift on the day they gain
    // (other than the very row being traded away).
    if (Number(swap.target_weekday) !== Number(swap.weekday)) {
      const giverOther = findRow(week, swap.requester_id, swap.target_weekday);
      if (giverOther) return { ok: false, code: 'taker_busy' };
      const targetOther = findRow(week, swap.target_id, swap.weekday);
      if (targetOther) return { ok: false, code: 'taker_busy' };
    }
    week.splice(week.indexOf(giverRow), 1);
    week.splice(week.indexOf(targetRow), 1);
    week.push({
      staff_member_id: swap.requester_id, weekday: Number(swap.target_weekday),
      start_time: swap.target_start_time, end_time: swap.target_end_time,
    });
    week.push({
      staff_member_id: swap.target_id, weekday: Number(swap.weekday),
      start_time: swap.start_time, end_time: swap.end_time,
    });
    return { ok: true, schedules: week };
  }
  // A cover: the taker takes the offered shift whole. They
  // cannot already hold a shift that weekday.
  const takerRow = findRow(week, takerId, swap.weekday);
  if (takerRow) return { ok: false, code: 'taker_busy' };
  week.splice(week.indexOf(giverRow), 1);
  week.push({
    staff_member_id: takerId, weekday: Number(swap.weekday),
    start_time: swap.start_time, end_time: swap.end_time,
  });
  return { ok: true, schedules: week };
}

/**
 * The pre-approval overtime flag, riding the labor-watch
 * engine (release 374). Pure.
 *
 * Judges the week as it stands and the week as the swap
 * would leave it, both through computeScheduleWeek with
 * the owner's own settings, and flags each person the swap
 * would push INTO an overtime verdict (over the line, or
 * newly within the owner's warn-within band) who did not
 * already carry that verdict. When the swap cannot be
 * applied at all there is nothing to flag — the approval
 * door refuses it for its own reason.
 */
export function swapOvertimeFlags({ settings = {}, people = [], schedules = [], swap, takerId } = {}) {
  const applied = applySwapToSchedules(schedules, swap, takerId);
  if (!applied.ok) return [];
  const verdicts = (week) => {
    const out = new Map();
    for (const warning of week.warnings) {
      if (warning.code === 'overtime_over' || warning.code === 'overtime_near') {
        out.set(warning.staff_member_id, warning);
      }
    }
    return out;
  };
  const before = verdicts(computeScheduleWeek({ settings, people, schedules }));
  const after = verdicts(computeScheduleWeek({ settings, people, schedules: applied.schedules }));
  const rank = { overtime_near: 1, overtime_over: 2 };
  const flags = [];
  for (const [personId, warning] of after) {
    const prior = before.get(personId);
    if (!prior || rank[warning.code] > rank[prior.code]) {
      flags.push({
        staff_member_id: warning.staff_member_id,
        person_name: warning.person_name,
        code: warning.code,
        hours: warning.hours,
        limit: warning.limit,
      });
    }
  }
  return flags;
}

/**
 * One person's availability against one shift. Pure.
 *
 * rows: the person's staff_availability rows. Returns
 * 'unavailable' (they marked the day cannot-work), 'outside'
 * (the shift runs outside the window they set), or null
 * (no clash — including "not set", which is no preference,
 * never a refusal).
 */
export function availabilityConflict(rows, shift) {
  const row = (rows || []).find((r) => Number(r.weekday) === Number(shift.weekday));
  if (!row) return null;
  if (row.available === false) return 'unavailable';
  if (row.start_time && row.end_time) {
    const start = hhmmToMinutes(shift.start_time);
    const end = hhmmToMinutes(shift.end_time);
    const winStart = hhmmToMinutes(row.start_time);
    const winEnd = hhmmToMinutes(row.end_time);
    if (start !== null && end !== null && winStart !== null && winEnd !== null
      && (start < winStart || end > winEnd)) {
      return 'outside';
    }
  }
  return null;
}

/** The person's availability week, cleaned for saving.
 *  Every entry names a weekday once; a cannot-work day
 *  carries no window; a window needs both ends, HH:MM,
 *  end after start. Throws the availability wordings. */
export function cleanAvailabilityDays(input) {
  if (!Array.isArray(input) || input.length > 7) {
    throw err(400, 'availability_shape', AVAILABILITY_WEEK_MESSAGE);
  }
  const seen = new Set();
  const days = [];
  for (const entry of input) {
    const weekday = Number(entry?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday)) {
      throw err(400, 'availability_shape', AVAILABILITY_DAY_MESSAGE);
    }
    seen.add(weekday);
    const available = entry?.available !== false;
    let start = null;
    let end = null;
    if (available && (entry?.start_time || entry?.end_time)) {
      start = hhmmToMinutes(entry?.start_time);
      end = hhmmToMinutes(entry?.end_time);
      if (start === null || end === null || end <= start) {
        throw err(400, 'availability_shape', AVAILABILITY_DAY_MESSAGE);
      }
      start = String(entry.start_time).trim();
      end = String(entry.end_time).trim();
    }
    days.push({
      weekday,
      available,
      start_time: available ? start : null,
      end_time: available ? end : null,
      note: String(entry?.note || '').trim().slice(0, 200),
    });
  }
  return days;
}
