/**
 * Clock administration — the clock build (Nov 21, 2026), from the
 * owner's rulings of Nov 20, 2026 (~9:14 PM + ~9:24 PM):
 *
 *   - THE TICK. One enrollment tick, `staff.clock`, covers the
 *     whole family: opening/closing call-in windows and correcting
 *     time entries. It follows the established grant pattern
 *     (src/lib/staff.js): stored in the member's own permissions,
 *     in no preset, off by default, held by the owner by birth.
 *     It takes effect only for a MANAGER-level member — a staff
 *     row's stored tick stays inert, enforced everywhere the tick
 *     is consulted. (One tick for the family: the owner was read
 *     back "one family" on Nov 21, 2026 and did not correct it;
 *     the publish record says so, so she can split it later.)
 *
 *   - THE CALL-IN WINDOW. A member may clock in only when a
 *     scheduled shift covers now, or when a call-in window is
 *     open for them. The window is per person, opened by the
 *     owner or a ticked manager, stays open until the person
 *     clocks out (the 10-minute grace then follows), admits the
 *     person through the shift bracket while open (see
 *     server/staffWindow.js), and can be closed early by the
 *     opener's side. Nothing closes it automatically.
 *
 *   - THE MISSED CLOCK-OUT. An open entry whose scheduled shift
 *     end has passed is flagged — computed live wherever entries
 *     are read — and the owner plus every ticked manager are
 *     belled exactly once (time_entries.missed_flagged_at is the
 *     claim ledger, migration 038). Detection runs on a short
 *     in-process cadence and lazily when a clock admin reads the
 *     entries; both paths claim through the same statement, so
 *     the bell can never ring twice.
 *
 * This module imports neither workforceRoutes.js nor
 * trainingCore.js (both sit above it in the import graph); the
 * small helpers it needs are mirrored, as elsewhere in this
 * codebase, with the source named.
 */
import crypto from 'node:crypto';
import { parseJsonArray, presetRoleById } from './authz.js';
import { permissionsForPlan, planFor } from './plans.js';
import {
  businessTimezone,
  localParts,
  hhmmToMinutes,
  zonedTimeToUtc,
  memberLevel,
} from './staffWindow.js';

export const CLOCK_ADMIN_TICK = 'staff.clock';

/** The permission set a staff row actually lives under (mirrors
 *  trainingCore.effectivePermissions / authz permissionsOfRole). */
function effectivePermissions(row, customRoles, planKey) {
  const stored = parseJsonArray(row?.permissions);
  if (stored.length) return permissionsForPlan(planKey, stored);
  const preset = presetRoleById(row?.role_id);
  if (preset) return permissionsForPlan(planKey, preset.permissions);
  const custom = (customRoles || []).find((role) => role.id === row?.role_id);
  if (custom) return permissionsForPlan(planKey, parseJsonArray(custom.permissions));
  return [];
}

/** True when this member row is a manager the owner trusted with
 *  the clock tick. The owner is not a member row — callers check
 *  access.isOwner separately, as everywhere else. */
export async function memberHasClockTick(pool, business, memberRow) {
  if (!memberRow || memberLevel(memberRow) !== 'manager') return false;
  const planKey = await planFor(pool, business.id);
  const { rows: customRoles } = await pool.query(
    'SELECT * FROM staff_roles WHERE business_id = $1',
    [business.id],
  );
  return effectivePermissions(memberRow, customRoles, planKey).includes(CLOCK_ADMIN_TICK);
}

// ---- Call-in windows ------------------------------------------------------

/** The member's open call-in window, or null. */
export async function openCallInWindow(pool, businessId, memberId) {
  const { rows } = await pool.query(
    `SELECT * FROM call_in_windows
      WHERE business_id = $1 AND staff_member_id = $2 AND closed_at IS NULL
      ORDER BY opened_at DESC LIMIT 1`,
    [businessId, memberId],
  );
  return rows[0] ?? null;
}

/** Every open call-in window in the business, newest first. */
export async function openCallInWindows(pool, businessId) {
  const { rows } = await pool.query(
    `SELECT * FROM call_in_windows
      WHERE business_id = $1 AND closed_at IS NULL
      ORDER BY opened_at DESC`,
    [businessId],
  );
  return rows;
}

/**
 * Open the window for a member (idempotent: an already-open
 * window is returned as-is). openedBy: { userId, staffId, name }.
 */
export async function openCallIn(pool, businessId, memberId, openedBy) {
  const existing = await openCallInWindow(pool, businessId, memberId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO call_in_windows (id, business_id, staff_member_id, opened_by_id, opened_by_staff_id, opened_by_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, businessId, memberId, openedBy?.userId || null, openedBy?.staffId || null, openedBy?.name || ''],
  );
  return rows[0];
}

/**
 * Close the member's open window, if any. reason is one of
 * 'clock_out' | 'closed_early' | 'corrected'. Returns the closed
 * row, or null when no window was open.
 */
export async function closeCallIn(pool, businessId, memberId, { byId = null, byStaffId = null, byName = '', reason = 'closed_early' } = {}) {
  const { rows } = await pool.query(
    `UPDATE call_in_windows
        SET closed_at = NOW(), closed_by_id = $3, closed_by_staff_id = $4, closed_by_name = $5, close_reason = $6
      WHERE business_id = $1 AND staff_member_id = $2 AND closed_at IS NULL
      RETURNING *`,
    [businessId, memberId, byId, byStaffId, byName, reason],
  );
  return rows[0] ?? null;
}

// ---- Missed clock-out ------------------------------------------------------

function formatLocalTime(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/**
 * The missed-clock-out fact for one entry, or null: the entry is
 * still open AND the scheduled shift for its clock-in day has
 * ended (business-local). An entry with no scheduled shift that
 * day (a call-in entry, or a legacy unscheduled one) has no
 * scheduled end to miss — it is never flagged; its window/entry
 * rules are the ones the owner wrote for it.
 * Returns { shift_start, shift_end, shift_date } as ISO instants
 * plus the business-local date string.
 */
export async function missedClockOutInfo(pool, business, entry, now = new Date()) {
  if (!entry || entry.clock_out_at) return null;
  const timeZone = businessTimezone(business);
  const inLocal = localParts(new Date(entry.clock_in_at), timeZone);
  const { rows } = await pool.query(
    'SELECT * FROM work_schedules WHERE business_id = $1 AND staff_member_id = $2 AND weekday = $3 LIMIT 1',
    [business.id, entry.staff_member_id, inLocal.weekday],
  );
  const shift = rows[0];
  if (!shift) return null;
  const start = hhmmToMinutes(shift.start_time);
  const end = hhmmToMinutes(shift.end_time);
  if (start === null || end === null) return null;
  const shiftEnd = zonedTimeToUtc(inLocal.dateStr, end, timeZone);
  if (now.getTime() <= shiftEnd.getTime()) return null;
  return {
    shift_start: zonedTimeToUtc(inLocal.dateStr, start, timeZone).toISOString(),
    shift_end: shiftEnd.toISOString(),
    shift_date: inLocal.dateStr,
  };
}

/** Bell one user (the workforce_notifications row pattern). */
async function ringClockBell(pool, business, { recipientUserId, recipientStaffId, recipientRole, actorStaffId, actorName, event, detail, entryId }) {
  if (!recipientUserId) return;
  await pool.query(
    `INSERT INTO workforce_notifications
       (id, business_id, recipient_user_id, recipient_staff_id, recipient_role, actor_staff_id, actor_name, event, detail, entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      crypto.randomUUID(), business.id, recipientUserId, recipientStaffId, recipientRole,
      actorStaffId, actorName, event, detail, entryId || null,
    ],
  );
}

/**
 * Claim + bell every newly-missed open entry in one business.
 * The claim is a single UPDATE ... WHERE missed_flagged_at IS
 * NULL, so the sweep and the lazy read path can race without
 * ever ringing twice. Returns how many entries were newly
 * flagged. Never throws into a caller that passes a logger.
 */
export async function flagMissedClockOuts(pool, business, { now = new Date(), logger = console } = {}) {
  let flagged = 0;
  try {
    const { rows: openEntries } = await pool.query(
      `SELECT * FROM time_entries
        WHERE business_id = $1 AND clock_out_at IS NULL AND missed_flagged_at IS NULL
        ORDER BY clock_in_at ASC`,
      [business.id],
    );
    if (!openEntries.length) return 0;
    const timeZone = businessTimezone(business);
    // Recipients: the owner, plus every manager holding the tick.
    const recipients = [{ userId: business.owner_id, staffId: null, role: 'owner' }];
    const { rows: team } = await pool.query(
      "SELECT * FROM staff_members WHERE business_id = $1 AND status = 'active'",
      [business.id],
    );
    for (const member of team) {
      if (!(await memberHasClockTick(pool, business, member))) continue;
      const user = (
        await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [member.email])
      ).rows[0];
      if (user) recipients.push({ userId: user.id, staffId: member.id, role: 'manager' });
    }
    const peopleById = new Map(team.map((member) => [member.id, member]));
    for (const entry of openEntries) {
      const info = await missedClockOutInfo(pool, business, entry, now);
      if (!info) continue;
      const claimed = await pool.query(
        `UPDATE time_entries SET missed_flagged_at = NOW()
          WHERE id = $1 AND missed_flagged_at IS NULL RETURNING id`,
        [entry.id],
      );
      if (!claimed.rows.length) continue;
      flagged += 1;
      const person = peopleById.get(entry.staff_member_id);
      const name = person?.full_name || 'A team member';
      const detail = `${name} never clocked out — their shift on ${info.shift_date} was ${formatLocalTime(new Date(info.shift_start), timeZone)} – ${formatLocalTime(new Date(info.shift_end), timeZone)}.`;
      for (const recipient of recipients) {
        await ringClockBell(pool, business, {
          recipientUserId: recipient.userId,
          recipientStaffId: recipient.staffId,
          recipientRole: recipient.role,
          actorStaffId: entry.staff_member_id,
          actorName: name,
          event: 'missed_clock_out',
          detail,
          entryId: entry.id,
        });
      }
    }
  } catch (error) {
    logger.error(`[twin] missed clock-out flagging failed for business ${business?.id}: ${error.message}`);
  }
  return flagged;
}

/** The sweep: every business holding an open entry gets a pass. */
export async function runMissedClockOutSweep(pool, { now = new Date(), logger = console } = {}) {
  const summary = { ranAt: now.toISOString(), flagged: 0, businesses: 0 };
  const { rows } = await pool.query(
    'SELECT DISTINCT business_id FROM time_entries WHERE clock_out_at IS NULL AND missed_flagged_at IS NULL',
  );
  for (const row of rows) {
    const business = (
      await pool.query('SELECT * FROM businesses WHERE id = $1 LIMIT 1', [row.business_id])
    ).rows[0];
    if (!business) continue;
    summary.businesses += 1;
    summary.flagged += await flagMissedClockOuts(pool, business, { now, logger });
  }
  return summary;
}

export const MISSED_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
export const MISSED_SWEEP_BOOT_DELAY_MS = 45 * 1000;

/**
 * Start the missed-clock-out bell watch: a boot run shortly
 * after listen, then a tick every 15 minutes (the flag itself
 * is computed live on every entries read; this cadence only
 * governs how fast the BELL lands when nobody is looking).
 * Failure-isolated and overlap-guarded, in the sweep
 * scheduler's shape. Timers are unref'd.
 */
export function startMissedClockOutScheduler({ getPoolFn, logger = console, intervalMs = MISSED_SWEEP_INTERVAL_MS, bootDelayMs = MISSED_SWEEP_BOOT_DELAY_MS } = {}) {
  let running = false;
  let stopped = false;
  const runOnce = async (source = 'tick') => {
    if (running) return null;
    running = true;
    try {
      const pool = typeof getPoolFn === 'function' ? getPoolFn() : null;
      if (!pool) return null;
      return await runMissedClockOutSweep(pool, { logger });
    } catch (error) {
      logger.error(`[twin] missed clock-out sweep (${source}) failed: ${error.message}`);
      return null;
    } finally {
      running = false;
    }
  };
  const bootTimer = setTimeout(() => { if (!stopped) void runOnce('boot'); }, bootDelayMs);
  bootTimer.unref?.();
  const intervalTimer = setInterval(() => { if (!stopped) void runOnce('interval'); }, intervalMs);
  intervalTimer.unref?.();
  logger.log(`[twin] missed clock-out watch enabled (boot run in ${Math.round(bootDelayMs / 1000)}s, then every ${Math.round(intervalMs / 60000)} minutes).`);
  return {
    enabled: true,
    runOnce,
    stop() {
      stopped = true;
      clearTimeout(bootTimer);
      clearInterval(intervalTimer);
    },
  };
}
