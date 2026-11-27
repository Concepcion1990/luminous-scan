/**
 * Labor target + overtime/break warnings — the engine core
 * (Nov 26, 2026; plan release 374, Gap 13, Q4 ruled Nov 25,
 * 2026).
 *
 * Two faces, one engine:
 *  - WARNINGS (GENERAL, both plans): while the week is being
 *    built, and as clock hours land, the app warns BEFORE
 *    they bite — approaching the owner's overtime line, a
 *    break the owner's settings call for not taken, hours
 *    outside the owner's window.
 *  - LABOR TARGET (RESTAURANT, Business-only): projected
 *    labor cost and labor % live against the owner's target
 *    while the week is built, riding the same schedule data.
 *    The routes strip every labor-target field for plans
 *    without the restaurant feature, so the target framing
 *    never exists outside Business.
 *
 * Doctrines:
 *  - ALL THRESHOLDS ARE OWNER-SET. The app watches; it does
 *    not legislate. There is no hard-coded law in here and
 *    no legal copy anywhere in the feature: every number —
 *    the overtime line, how close is "approaching", when a
 *    break is expected and how long it is, the hours window,
 *    the labor target, the expected sales it is measured
 *    against — is a number the owner typed for their own
 *    place, or it is unset and the watch for it is off.
 *  - Warnings warn; they never block a save, a clock-in or
 *    anything else (no silent changes, warning edition).
 *  - Per-business private: every read and write is scoped
 *    to one business.
 */
export const OWNER_MESSAGE = 'Only the owner can set the labor watch numbers.';
export const SETTINGS_MESSAGE = 'Check the labor watch numbers and try again.';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function cleanNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw err(400, 'labor_settings', SETTINGS_MESSAGE);
  return integer ? Math.round(n) : round2(n);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanTime(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();
  if (!TIME_RE.test(raw)) throw err(400, 'labor_settings', SETTINGS_MESSAGE);
  return raw;
}

export function hhmmToMinutes(value) {
  const match = TIME_RE.exec(String(value || ''));
  if (!match) return null;
  const [h, m] = String(value).split(':').map(Number);
  return h * 60 + m;
}

/** The owner's watch numbers, cleaned. Every field is
 *  nullable: null means the owner has not set that watch,
 *  and the engine stays silent about it — never a default
 *  dressed up as a rule. */
export function cleanSettings(input) {
  return {
    overtime_hours: cleanNumber(input?.overtime_hours, { max: 168 }),
    warn_within_hours: cleanNumber(input?.warn_within_hours, { max: 84 }),
    break_after_hours: cleanNumber(input?.break_after_hours, { max: 24 }),
    break_minutes: cleanNumber(input?.break_minutes, { max: 480, integer: true }),
    window_start: cleanTime(input?.window_start),
    window_end: cleanTime(input?.window_end),
    labor_target_pct: cleanNumber(input?.labor_target_pct, { max: 100 }),
    expected_sales: cleanNumber(input?.expected_sales),
  };
}

export function parseSettings(row) {
  if (!row) return cleanSettings({});
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    overtime_hours: num(row.overtime_hours),
    warn_within_hours: num(row.warn_within_hours),
    break_after_hours: num(row.break_after_hours),
    break_minutes: num(row.break_minutes),
    window_start: row.window_start || null,
    window_end: row.window_end || null,
    labor_target_pct: num(row.labor_target_pct),
    expected_sales: num(row.expected_sales),
  };
}

function shiftMinutes(shift) {
  const start = hhmmToMinutes(shift.start_time);
  const end = hhmmToMinutes(shift.end_time);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

/** The weekly overtime verdict for one person's hours,
 *  against the owner's own lines. Pure. */
export function overtimeWarning(settings, person, hours) {
  const limit = settings.overtime_hours;
  if (limit === null || limit === undefined || !(hours > 0)) return null;
  if (hours > limit) {
    return { code: 'overtime_over', staff_member_id: person.id, person_name: person.full_name || '', hours: round2(hours), limit };
  }
  const within = settings.warn_within_hours;
  if (within !== null && within !== undefined && hours >= limit - within) {
    return { code: 'overtime_near', staff_member_id: person.id, person_name: person.full_name || '', hours: round2(hours), limit };
  }
  return null;
}

/**
 * The schedule week, projected. Pure.
 *
 * people: [{ id, full_name, role_name, pay_type,
 * hourly_rate, annual_salary }]
 * schedules: [{ staff_member_id, weekday, start_time,
 * end_time }] — the recurring week the schedule builder
 * holds (work_schedules).
 *
 * Projected cost follows the payroll shape: hourly people
 * cost their scheduled hours at their rate, with the hours
 * past the owner's overtime line at time-and-a-half when
 * the owner has set a line (with no line set, every hour is
 * at the plain rate — the app invents no premium); salaried
 * people cost one week of salary (annual × 7 / 365, the
 * payroll run's own day math).
 *
 * Labor % is projected cost over the owner's expected sales
 * for the week; with no expected sales typed there is no
 * percentage — never a guessed denominator.
 */
export function computeScheduleWeek({ settings: rawSettings = {}, people = [], schedules = [] } = {}) {
  const settings = cleanSettings(rawSettings);
  const byPerson = new Map();
  for (const person of people) {
    byPerson.set(person.id, { person, shifts: [], hours: 0, warnings: [] });
  }
  for (const shift of schedules || []) {
    const slot = byPerson.get(shift.staff_member_id);
    if (!slot) continue;
    const minutes = shiftMinutes(shift);
    if (!minutes) continue;
    const hours = round2(minutes / 60);
    slot.shifts.push({ weekday: Number(shift.weekday), start_time: shift.start_time, end_time: shift.end_time, hours });
    slot.hours = round2(slot.hours + hours);

    if (settings.break_after_hours !== null && hours > settings.break_after_hours) {
      slot.warnings.push({
        code: 'break', staff_member_id: slot.person.id, person_name: slot.person.full_name || '',
        weekday: Number(shift.weekday), hours, limit: settings.break_after_hours, minutes: settings.break_minutes,
      });
    }
    const startMin = hhmmToMinutes(shift.start_time);
    const endMin = hhmmToMinutes(shift.end_time);
    const winStart = settings.window_start ? hhmmToMinutes(settings.window_start) : null;
    const winEnd = settings.window_end ? hhmmToMinutes(settings.window_end) : null;
    if ((winStart !== null && startMin < winStart) || (winEnd !== null && endMin > winEnd)) {
      slot.warnings.push({
        code: 'window', staff_member_id: slot.person.id, person_name: slot.person.full_name || '',
        weekday: Number(shift.weekday), hours, start: settings.window_start, end: settings.window_end,
      });
    }
  }

  let totalHours = 0;
  let totalCost = 0;
  const folks = [];
  for (const slot of byPerson.values()) {
    const { person } = slot;
    const weekly = overtimeWarning(settings, person, slot.hours);
    if (weekly) slot.warnings.push(weekly);
    let cost = 0;
    let overtimeHours = 0;
    if (person.pay_type === 'salary') {
      cost = round2(((Number(person.annual_salary) || 0) * 7) / 365);
    } else {
      const rate = Number(person.hourly_rate) || 0;
      if (settings.overtime_hours !== null) {
        overtimeHours = round2(Math.max(0, slot.hours - settings.overtime_hours));
        cost = round2((slot.hours - overtimeHours) * rate + overtimeHours * rate * 1.5);
      } else {
        cost = round2(slot.hours * rate);
      }
    }
    totalHours = round2(totalHours + slot.hours);
    totalCost = round2(totalCost + cost);
    folks.push({
      staff_member_id: person.id,
      person_name: person.full_name || '',
      role_name: person.role_name || '',
      scheduled_hours: slot.hours,
      projected_cost: cost,
      overtime_hours: overtimeHours,
      warnings: slot.warnings,
    });
  }
  folks.sort((a, b) => a.person_name.localeCompare(b.person_name));

  const laborPct = settings.expected_sales !== null && settings.expected_sales > 0
    ? round2((totalCost / settings.expected_sales) * 100)
    : null;
  const target = settings.labor_target_pct;
  return {
    settings,
    people: folks,
    warnings: folks.flatMap((f) => f.warnings),
    totals: {
      scheduled_hours: totalHours,
      projected_cost: totalCost,
      labor_pct: laborPct,
      labor_target_pct: target,
      over_target: laborPct !== null && target !== null ? laborPct > target : null,
      variance_pct: laborPct !== null && target !== null ? round2(laborPct - target) : null,
    },
  };
}

/**
 * Warnings from hours already worked (the clock face).
 * Pure.
 *
 * days: [{ staff_member_id, person_name, date, hours,
 * break_minutes }] — one row per person per worked day,
 * break_minutes being the break time the clock recorded
 * that day.
 * weekly: [{ staff_member_id, person_name, hours }] — one
 * row per person per workweek, judged against the same
 * overtime lines as the schedule.
 *
 * A day warns about a break when the day ran longer than
 * the owner's break-after line and the break recorded was
 * shorter than the break length the owner set (any break
 * at all counts when the owner set no length).
 */
export function computeClockWarnings({ settings: rawSettings = {}, days = [], weekly = [] } = {}) {
  const settings = cleanSettings(rawSettings);
  const warnings = [];
  for (const day of days || []) {
    if (settings.break_after_hours === null) continue;
    const hours = Math.max(0, Number(day.hours) || 0);
    if (hours <= settings.break_after_hours) continue;
    const recorded = Math.max(0, Number(day.break_minutes) || 0);
    const required = settings.break_minutes !== null ? settings.break_minutes : 1;
    if (recorded < required) {
      warnings.push({
        code: 'clock_break', staff_member_id: day.staff_member_id, person_name: day.person_name || '',
        date: day.date || '', hours: round2(hours), limit: settings.break_after_hours, minutes: recorded,
      });
    }
  }
  for (const person of weekly || []) {
    const warning = overtimeWarning(settings, { id: person.staff_member_id, full_name: person.person_name }, Math.max(0, Number(person.hours) || 0));
    if (warning) warnings.push({ ...warning, code: warning.code === 'overtime_over' ? 'clock_overtime_over' : 'clock_overtime_near' });
  }
  return warnings;
}

/* --------------------------------------------------- DB doors */

export async function getSettings(pool, businessId) {
  const { rows } = await pool.query('SELECT * FROM labor_watch_settings WHERE business_id = $1 LIMIT 1', [businessId]);
  return parseSettings(rows[0]);
}

export async function saveSettings(pool, businessId, input) {
  const clean = cleanSettings(input);
  await pool.query(
    `INSERT INTO labor_watch_settings
       (business_id, overtime_hours, warn_within_hours, break_after_hours, break_minutes,
        window_start, window_end, labor_target_pct, expected_sales, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (business_id) DO UPDATE SET
       overtime_hours = $2, warn_within_hours = $3, break_after_hours = $4, break_minutes = $5,
       window_start = $6, window_end = $7, labor_target_pct = $8, expected_sales = $9, updated_at = NOW()`,
    [businessId, clean.overtime_hours, clean.warn_within_hours, clean.break_after_hours, clean.break_minutes,
      clean.window_start, clean.window_end, clean.labor_target_pct, clean.expected_sales],
  );
  return clean;
}
