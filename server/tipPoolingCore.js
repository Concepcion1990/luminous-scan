/**
 * Tip pooling + tip reporting records — the engine core
 * (Nov 26, 2026; plan release 373, Gap 3, with its round-2
 * records rider, round-2 Gap 10).
 *
 * Tip pooling: the owner sets the pool shape — by hours, by
 * role percentage, or by points — and the app splits the
 * pool from the schedule + clock hours already in it, shows
 * each person their share, and feeds the numbers into the
 * payroll preview.
 *
 * Tip reporting records (the rider): the year record — per
 * person, per period, tips reported — with the IRS 8%
 * arithmetic run so the owner (or their accountant) has the
 * form-ready totals Form 8027 asks for.
 *
 * Doctrines:
 *  - BUSINESS-ONLY, Restaurant Corner, Team & Place shelf
 *    (the plan gate lives in the routes).
 *  - OWNER-ONLY MONEY: the pool setup, the shares and the
 *    records are the owner's numbers. A staff member sees
 *    ONLY their own share, and only once the owner has
 *    published that run.
 *  - The app calculates what the owner sets up and never
 *    advises on tip law — no legal copy anywhere here.
 *  - RECORDS ONLY: the app assembles numbers and
 *    form-ready totals; it never files anything. The
 *    allocation methods offered are the IRS's own published
 *    ones (gross receipts, hours worked, good-faith
 *    agreement), presented as arithmetic the owner chooses.
 *  - Per-business private: every read and write is scoped
 *    to one business; a record of another business is
 *    simply not found.
 */
import crypto from 'node:crypto';

export const POOL_METHODS = ['hours', 'role', 'points'];
export const ALLOCATION_METHODS = ['gross_receipts', 'hours', 'good_faith'];

export const OWNER_MESSAGE = 'Only the owner can set up tip pooling and tip records.';
export const PERIOD_MESSAGE = 'Choose a period (start and end dates).';
export const POOL_MESSAGE = 'Enter the tip pool amount.';
export const REPORT_MESSAGE = 'Enter the tips reported for each person.';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanDate(value) {
  const raw = String(value || '').trim();
  if (!DATE_RE.test(raw)) return null;
  const parsed = new Date(`${raw}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

export function cleanPeriod(input) {
  const start = cleanDate(input?.period_start ?? input?.start);
  const end = cleanDate(input?.period_end ?? input?.end);
  if (!start || !end || end < start) throw err(400, 'tip_period', PERIOD_MESSAGE);
  return { period_start: start, period_end: end };
}

function cleanMoney(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}

function cleanNumberMap(raw, { max = 100000, cap = 100 } = {}) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw || '{}'); } catch { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [key, value] of Object.entries(parsed).slice(0, cap)) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) out[String(key).slice(0, 120)] = Math.min(round2(n), max);
  }
  return out;
}

/** The owner's pool shape, cleaned: one of the three
 *  methods, the per-role percentages, the per-person
 *  points. Anything unrecognized falls back to 'hours'
 *  with empty maps — never an invented split. */
export function cleanSettings(input) {
  return {
    method: POOL_METHODS.includes(input?.method) ? input.method : 'hours',
    role_percentages: cleanNumberMap(input?.role_percentages, { max: 100 }),
    points: cleanNumberMap(input?.points, { max: 10000 }),
  };
}

export function parseSettings(row) {
  if (!row) return { method: 'hours', role_percentages: {}, points: {} };
  return cleanSettings({
    method: row.method,
    role_percentages: row.role_percentages,
    points: row.points,
  });
}

/**
 * Split one pool among people. Pure.
 *
 * people: [{ id, full_name, role_name, hours }] — hours are
 * the person's paid clock hours in the period (regular +
 * overtime, from the time clock).
 *
 *  - hours: each person's weight is their clock hours.
 *  - role: each role carries the owner's percentage of the
 *    pool; inside a role the money follows clock hours, or
 *    splits equally when nobody in the role has clock
 *    hours. Weights are normalized, so percentages that do
 *    not add to 100 still split the whole pool by their
 *    proportions.
 *  - points: each person's weight is the points the owner
 *    set for them.
 *
 * Shares are rounded to cents and the rounding remainder
 * lands on the largest share, so the shares always add up
 * to the pool exactly (when anyone has weight). A person
 * with no weight gets no share; when nobody has weight the
 * whole pool is unallocated and every share is 0.
 */
export function computePoolShares({ poolAmount, method, people = [], settings = {} } = {}) {
  const pool = cleanMoney(poolAmount);
  if (pool === null || pool <= 0) throw err(400, 'tip_pool_amount', POOL_MESSAGE);
  const shape = cleanSettings({ ...settings, method });
  const rolePcts = shape.role_percentages;
  const points = shape.points;

  const byRole = new Map();
  for (const person of people) {
    const role = String(person.role_name || '');
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(person);
  }

  const weights = people.map((person) => {
    const hours = Math.max(0, Number(person.hours) || 0);
    if (shape.method === 'points') return Math.max(0, Number(points[person.id]) || 0);
    if (shape.method === 'role') {
      const pct = Math.max(0, Number(rolePcts[String(person.role_name || '')]) || 0);
      if (pct <= 0) return 0;
      const rolePeople = byRole.get(String(person.role_name || '')) || [];
      const roleHours = rolePeople.reduce((sum, p) => sum + Math.max(0, Number(p.hours) || 0), 0);
      const inside = roleHours > 0 ? hours / roleHours : 1 / Math.max(1, rolePeople.length);
      return pct * inside;
    }
    return hours;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const shares = people.map((person, i) => {
    const weight = weights[i];
    const share = totalWeight > 0 ? round2((pool * weight) / totalWeight) : 0;
    return {
      staff_member_id: person.id,
      person_name: person.full_name || '',
      role_name: person.role_name || '',
      hours: round2(Math.max(0, Number(person.hours) || 0)),
      basis: round2(weight),
      share_amount: share,
    };
  });
  if (totalWeight > 0 && shares.length) {
    const drift = round2(pool - shares.reduce((sum, s) => sum + s.share_amount, 0));
    if (drift !== 0) {
      let largest = 0;
      for (let i = 1; i < shares.length; i += 1) {
        if (shares[i].share_amount > shares[largest].share_amount) largest = i;
      }
      shares[largest].share_amount = round2(shares[largest].share_amount + drift);
    }
  }
  return { method: shape.method, pool_amount: pool, totalWeight: round2(totalWeight), shares };
}

/** One person's tip-report row, cleaned. Tips reported is
 *  the required figure; the rest default to 0 (never an
 *  invented number). A good-faith allocation amount rides
 *  only when the owner entered one. */
export function cleanReport(input) {
  const tips = cleanMoney(input?.tips_reported);
  if (tips === null) throw err(400, 'tip_report', REPORT_MESSAGE);
  return {
    staff_member_id: String(input?.staff_member_id || '').slice(0, 120),
    tips_reported: tips,
    gross_receipts: cleanMoney(input?.gross_receipts) ?? 0,
    hours: Math.max(0, round2(Number(input?.hours) || 0)),
    allocation_amount: cleanMoney(input?.allocation_amount),
  };
}

export function cleanReportPeriod(input) {
  const period = cleanPeriod(input);
  return {
    ...period,
    gross_receipts: cleanMoney(input?.gross_receipts) ?? 0,
    allocation_method: ALLOCATION_METHODS.includes(input?.allocation_method) ? input.allocation_method : 'hours',
  };
}

/**
 * The Form 8027 arithmetic for one period — pure. The form
 * asks for the establishment's gross receipts, the total
 * tips employees reported, and 8% of gross receipts; when
 * the reported tips fall short of that 8%, the shortfall is
 * allocated among the employees by the method the owner
 * chose:
 *  - gross_receipts: in proportion to each person's gross
 *    receipts;
 *  - hours: in proportion to each person's hours;
 *  - good_faith: the amounts the owner entered under their
 *    good-faith agreement, taken as entered.
 * Arithmetic only — the app assembles the totals and files
 * nothing.
 */
export function computeForm8027({ grossReceipts = 0, reports = [], method = 'hours' } = {}) {
  const gross = cleanMoney(grossReceipts) ?? 0;
  const eightPercent = round2(gross * 0.08);
  const rows = (reports || []).map((r) => ({
    staff_member_id: r.staff_member_id,
    person_name: r.person_name || '',
    tips_reported: cleanMoney(r.tips_reported) ?? 0,
    gross_receipts: cleanMoney(r.gross_receipts) ?? 0,
    hours: Math.max(0, round2(Number(r.hours) || 0)),
    allocation_amount: cleanMoney(r.allocation_amount),
  }));
  const totalReported = round2(rows.reduce((sum, r) => sum + r.tips_reported, 0));
  const shortfall = round2(Math.max(0, eightPercent - totalReported));

  const basisOf = (r) => (method === 'gross_receipts' ? r.gross_receipts : r.hours);
  const totalBasis = rows.reduce((sum, r) => sum + basisOf(r), 0);
  const perPerson = rows.map((r) => {
    let allocated = 0;
    if (method === 'good_faith') allocated = r.allocation_amount ?? 0;
    else if (shortfall > 0 && totalBasis > 0) allocated = round2((shortfall * basisOf(r)) / totalBasis);
    return { ...r, allocated };
  });
  if (method !== 'good_faith' && shortfall > 0 && totalBasis > 0 && perPerson.length) {
    const drift = round2(shortfall - perPerson.reduce((sum, r) => sum + r.allocated, 0));
    if (drift !== 0) {
      let largest = 0;
      for (let i = 1; i < perPerson.length; i += 1) {
        if (basisOf(perPerson[i]) > basisOf(perPerson[largest])) largest = i;
      }
      perPerson[largest].allocated = round2(perPerson[largest].allocated + drift);
    }
  }
  const totalAllocated = round2(perPerson.reduce((sum, r) => sum + r.allocated, 0));
  return {
    gross_receipts: gross,
    eight_percent: eightPercent,
    total_reported: totalReported,
    shortfall,
    total_allocated: totalAllocated,
    allocation_method: method,
    per_person: perPerson,
  };
}

/** The year record: every period of one year folded into
 *  per-person totals plus the establishment's form-ready
 *  totals for the year. Pure over computed periods:
 *  [{ period, totals: computeForm8027(...) }]. */
export function summarizeYear(year, periods = []) {
  const byPerson = new Map();
  let gross = 0;
  let reported = 0;
  let allocated = 0;
  for (const entry of periods || []) {
    gross += Number(entry.totals?.gross_receipts) || 0;
    reported += Number(entry.totals?.total_reported) || 0;
    allocated += Number(entry.totals?.total_allocated) || 0;
    for (const person of entry.totals?.per_person || []) {
      const cur = byPerson.get(person.staff_member_id) || {
        staff_member_id: person.staff_member_id,
        person_name: person.person_name || '',
        tips_reported: 0,
        gross_receipts: 0,
        hours: 0,
        allocated: 0,
      };
      cur.person_name = person.person_name || cur.person_name;
      cur.tips_reported = round2(cur.tips_reported + person.tips_reported);
      cur.gross_receipts = round2(cur.gross_receipts + person.gross_receipts);
      cur.hours = round2(cur.hours + person.hours);
      cur.allocated = round2(cur.allocated + person.allocated);
      byPerson.set(person.staff_member_id, cur);
    }
  }
  const grossTotal = round2(gross);
  return {
    year: Number(year),
    gross_receipts: grossTotal,
    eight_percent: round2(grossTotal * 0.08),
    total_reported: round2(reported),
    shortfall: round2(Math.max(0, round2(grossTotal * 0.08) - round2(reported))),
    total_allocated: round2(allocated),
    periods: (periods || []).length,
    per_person: [...byPerson.values()].sort((a, b) => a.person_name.localeCompare(b.person_name)),
  };
}

/* --------------------------------------------------- DB doors */

export async function getSettings(pool, businessId) {
  const { rows } = await pool.query('SELECT * FROM tip_pool_settings WHERE business_id = $1 LIMIT 1', [businessId]);
  return parseSettings(rows[0]);
}

export async function saveSettings(pool, businessId, input) {
  const clean = cleanSettings(input);
  await pool.query(
    `INSERT INTO tip_pool_settings (business_id, method, role_percentages, points, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (business_id) DO UPDATE SET method = $2, role_percentages = $3, points = $4, updated_at = NOW()`,
    [businessId, clean.method, JSON.stringify(clean.role_percentages), JSON.stringify(clean.points)],
  );
  return clean;
}

export async function createRun(pool, businessId, { period, split }, { userId = null } = {}) {
  const runId = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO tip_pool_runs (id, business_id, period_start, period_end, pool_amount, method, published, created_by_id)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7) RETURNING *`,
    [runId, businessId, period.period_start, period.period_end, split.pool_amount, split.method, userId],
  );
  const shares = [];
  for (const share of split.shares) {
    const { rows: shareRows } = await pool.query(
      `INSERT INTO tip_pool_shares (id, run_id, business_id, staff_member_id, person_name, role_name, hours, basis, share_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [crypto.randomUUID(), runId, businessId, share.staff_member_id, share.person_name, share.role_name, share.hours, share.basis, share.share_amount],
    );
    shares.push(shareRows[0]);
  }
  return { run: rows[0], shares };
}

export async function listRuns(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM tip_pool_runs WHERE business_id = $1 ORDER BY period_start DESC, created_at DESC',
    [businessId],
  );
  const out = [];
  for (const run of rows) {
    const { rows: shares } = await pool.query(
      'SELECT * FROM tip_pool_shares WHERE business_id = $1 AND run_id = $2 ORDER BY person_name ASC',
      [businessId, run.id],
    );
    out.push({ run, shares });
  }
  return out;
}

export async function setRunPublished(pool, businessId, runId, published) {
  const { rows } = await pool.query(
    'UPDATE tip_pool_runs SET published = $3 WHERE id = $1 AND business_id = $2 RETURNING *',
    [runId, businessId, Boolean(published)],
  );
  if (!rows[0]) throw err(404, 'not_found', 'Not found.');
  return rows[0];
}

export async function deleteRun(pool, businessId, runId) {
  await pool.query('DELETE FROM tip_pool_shares WHERE business_id = $1 AND run_id = $2', [businessId, runId]);
  const { rowCount } = await pool.query('DELETE FROM tip_pool_runs WHERE id = $1 AND business_id = $2', [runId, businessId]);
  if (!rowCount) throw err(404, 'not_found', 'Not found.');
}

/** A staff member's own published shares — the ONLY staff
 *  read in this feature. Unpublished runs never appear. */
export async function myShares(pool, businessId, staffMemberId) {
  if (!staffMemberId) return [];
  const { rows } = await pool.query(
    `SELECT s.*, r.period_start, r.period_end, r.method
       FROM tip_pool_shares s
       JOIN tip_pool_runs r ON r.id = s.run_id
      WHERE s.business_id = $1 AND s.staff_member_id = $2 AND r.published = TRUE
      ORDER BY r.period_start DESC`,
    [businessId, staffMemberId],
  );
  return rows;
}

/** Pool shares summed per person for the payroll preview:
 *  every run fully inside the preview period. */
export async function poolTipsForPeriod(pool, businessId, periodStart, periodEnd) {
  const { rows } = await pool.query(
    `SELECT s.staff_member_id, SUM(s.share_amount)::numeric AS total
       FROM tip_pool_shares s
       JOIN tip_pool_runs r ON r.id = s.run_id
      WHERE s.business_id = $1 AND r.period_start >= $2 AND r.period_end <= $3
      GROUP BY s.staff_member_id`,
    [businessId, periodStart, periodEnd],
  );
  return new Map(rows.map((r) => [r.staff_member_id, round2(Number(r.total) || 0)]));
}

export async function createReportPeriod(pool, businessId, input, { userId = null } = {}) {
  const clean = cleanReportPeriod(input);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO tip_report_periods (id, business_id, period_start, period_end, gross_receipts, allocation_method, created_by_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, businessId, clean.period_start, clean.period_end, clean.gross_receipts, clean.allocation_method, userId],
  );
  return rows[0];
}

export async function getReportPeriod(pool, businessId, periodId) {
  const row = (await pool.query(
    'SELECT * FROM tip_report_periods WHERE id = $1 AND business_id = $2 LIMIT 1',
    [periodId, businessId],
  )).rows[0];
  if (!row) throw err(404, 'not_found', 'Not found.');
  return row;
}

export async function deleteReportPeriod(pool, businessId, periodId) {
  await getReportPeriod(pool, businessId, periodId);
  await pool.query('DELETE FROM tip_reports WHERE business_id = $1 AND period_id = $2', [businessId, periodId]);
  await pool.query('DELETE FROM tip_report_periods WHERE id = $1 AND business_id = $2', [periodId, businessId]);
}

export async function listReports(pool, businessId, periodId) {
  const { rows } = await pool.query(
    'SELECT * FROM tip_reports WHERE business_id = $1 AND period_id = $2 ORDER BY person_name ASC',
    [businessId, periodId],
  );
  return rows;
}

/** Save one person's report row for a period (insert or
 *  replace — one row per person per period). The person's
 *  name is snapshotted from the caller's people list. */
export async function saveReport(pool, businessId, periodId, input, personName = '') {
  await getReportPeriod(pool, businessId, periodId);
  const clean = cleanReport(input);
  if (!clean.staff_member_id) throw err(400, 'tip_report', REPORT_MESSAGE);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO tip_reports (id, period_id, business_id, staff_member_id, person_name, tips_reported, gross_receipts, hours, allocation_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (period_id, staff_member_id) DO UPDATE SET
       person_name = $5, tips_reported = $6, gross_receipts = $7, hours = $8, allocation_amount = $9, updated_at = NOW()
     RETURNING *`,
    [id, periodId, businessId, clean.staff_member_id, personName, clean.tips_reported, clean.gross_receipts, clean.hours, clean.allocation_amount],
  );
  return rows[0];
}

export async function deleteReport(pool, businessId, periodId, staffMemberId) {
  const { rowCount } = await pool.query(
    'DELETE FROM tip_reports WHERE business_id = $1 AND period_id = $2 AND staff_member_id = $3',
    [businessId, periodId, staffMemberId],
  );
  if (!rowCount) throw err(404, 'not_found', 'Not found.');
}

/** One period with its reports and its 8027 totals. */
export async function reportPeriodView(pool, businessId, periodRow) {
  const reports = await listReports(pool, businessId, periodRow.id);
  const totals = computeForm8027({
    grossReceipts: Number(periodRow.gross_receipts) || 0,
    reports,
    method: periodRow.allocation_method,
  });
  return { period: periodRow, reports, totals };
}

export async function listReportPeriods(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM tip_report_periods WHERE business_id = $1 ORDER BY period_start DESC',
    [businessId],
  );
  const out = [];
  for (const row of rows) out.push(await reportPeriodView(pool, businessId, row));
  return out;
}

/** The year record for one calendar year (periods starting
 *  in that year), with per-person and establishment totals. */
export async function yearRecord(pool, businessId, year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw err(400, 'tip_period', PERIOD_MESSAGE);
  const { rows } = await pool.query(
    'SELECT * FROM tip_report_periods WHERE business_id = $1 AND period_start >= $2 AND period_start <= $3 ORDER BY period_start ASC',
    [businessId, `${y}-01-01`, `${y}-12-31`],
  );
  const views = [];
  for (const row of rows) views.push(await reportPeriodView(pool, businessId, row));
  return { ...summarizeYear(y, views), period_views: views };
}
