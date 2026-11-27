/**
 * Tip pooling + tip reporting records — HTTP surface
 * (Nov 26, 2026; plan release 373 + its records rider).
 *
 *   GET    /api/businesses/:bid/tips                    any member: { isOwner } (+ the owner's full view for the owner; a member's own published shares otherwise)
 *   PUT    /api/businesses/:bid/tips/settings           owner: save the pool shape
 *   POST   /api/businesses/:bid/tips/preview            owner: split a pool over a period (not saved)
 *   POST   /api/businesses/:bid/tips/runs               owner: save a split as a run (unpublished)
 *   PATCH  /api/businesses/:bid/tips/runs/:rid/publish  owner: publish / unpublish a run's shares to staff
 *   DELETE /api/businesses/:bid/tips/runs/:rid          owner: delete a run and its shares
 *   GET    /api/businesses/:bid/tips/my-shares          any member: their own published shares only
 *   POST   /api/businesses/:bid/tips/report-periods     owner: open a tip-reporting period
 *   DELETE /api/businesses/:bid/tips/report-periods/:pid owner: delete a period and its reports
 *   PUT    /api/businesses/:bid/tips/report-periods/:pid/reports/:staffId owner: save one person's report row
 *   DELETE /api/businesses/:bid/tips/report-periods/:pid/reports/:staffId owner: remove one person's report row
 *   GET    /api/businesses/:bid/tips/year?year=YYYY     owner: the year record with form-ready totals
 *
 * BUSINESS-ONLY: every door sits behind the restaurant
 * corner's plan gate. OWNER-ONLY MONEY: everything except
 * my-shares is the owner's alone — the shares and records
 * are the owner's numbers, published to staff only as the
 * owner sets up (a run's publish switch). The app
 * calculates what the owner sets up and never advises on
 * tip law; the records assemble form-ready totals and file
 * nothing.
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import { businessTimezone, summarizeHours } from './workforceRoutes.js';
import {
  OWNER_MESSAGE,
  cleanPeriod,
  computePoolShares,
  createReportPeriod,
  createRun,
  deleteReport,
  deleteReportPeriod,
  deleteRun,
  getSettings,
  listReportPeriods,
  listRuns,
  myShares,
  saveReport,
  saveSettings,
  setRunPublished,
  yearRecord,
} from './tipPoolingCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] tip-pooling route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

/** Paid clock hours per person over a period, from the
 *  time clock (the workforce engine's own summary: regular
 *  + overtime by workweek), plus the scheduled hours the
 *  roster holds for the same days — the two hour sources
 *  the plan names ("schedule + clock hours already in it"). */
async function hoursByPerson(pool, business, periodStart, periodEnd) {
  const timeZone = businessTimezone(business);
  const from = new Date(new Date(`${periodStart}T00:00:00Z`).getTime() - 2 * 86400000).toISOString();
  const to = new Date(new Date(`${periodEnd}T00:00:00Z`).getTime() + 3 * 86400000).toISOString();
  const { rows: entries } = await pool.query(
    'SELECT * FROM time_entries WHERE business_id = $1 AND clock_in_at >= $2 AND clock_in_at < $3 ORDER BY clock_in_at ASC',
    [business.id, from, to],
  );
  const breaksByEntry = new Map();
  if (entries.length) {
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
  const clock = new Map();
  const byPerson = new Map();
  for (const entry of entries) {
    if (!byPerson.has(entry.staff_member_id)) byPerson.set(entry.staff_member_id, []);
    byPerson.get(entry.staff_member_id).push(entry);
  }
  for (const [staffId, personEntries] of byPerson) {
    const hours = summarizeHours(personEntries, breaksByEntry, timeZone, periodStart, periodEnd);
    clock.set(staffId, Math.round((hours.regularHours + hours.overtimeHours) * 100) / 100);
  }

  const { rows: schedules } = await pool.query(
    'SELECT * FROM work_schedules WHERE business_id = $1',
    [business.id],
  );
  const scheduled = new Map();
  const start = new Date(`${periodStart}T12:00:00Z`);
  const end = new Date(`${periodEnd}T12:00:00Z`);
  const days = Math.min(370, Math.max(0, Math.round((end - start) / 86400000)) + 1);
  for (const row of schedules) {
    const [sh, sm] = String(row.start_time || '0:0').split(':').map(Number);
    const [eh, em] = String(row.end_time || '0:0').split(':').map(Number);
    const minutes = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
    if (!minutes) continue;
    let count = 0;
    for (let i = 0; i < days; i += 1) {
      const day = new Date(start.getTime() + i * 86400000);
      if (day.getUTCDay() === Number(row.weekday)) count += 1;
    }
    if (count) scheduled.set(row.staff_member_id, (scheduled.get(row.staff_member_id) || 0) + (minutes * count) / 60);
  }
  return { clock, scheduled };
}

export function createTipPoolingRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/tips';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    return access;
  }

  async function ownerCtx(req) {
    const access = await ctx(req);
    if (!access.isOwner) throw err(403, 'tip_owner', OWNER_MESSAGE);
    return access;
  }

  async function people(poolInstance, businessId) {
    const { rows } = await poolInstance.query(
      "SELECT * FROM staff_members WHERE business_id = $1 AND status = 'active' ORDER BY full_name ASC",
      [businessId],
    );
    return rows;
  }

  /** The split for a period + amount under a shape: people
   *  with their clock + scheduled hours, and the shares. */
  async function splitFor(access, body) {
    const period = cleanPeriod(body || {});
    const settings = body?.settings ? await saveSettings(pool(), access.business.id, body.settings) : await getSettings(pool(), access.business.id);
    const team = await people(pool(), access.business.id);
    const { clock, scheduled } = await hoursByPerson(pool(), access.business, period.period_start, period.period_end);
    const folks = team.map((person) => ({
      id: person.id,
      full_name: person.full_name,
      role_name: person.role_name || '',
      hours: clock.get(person.id) || 0,
      scheduled_hours: Math.round((scheduled.get(person.id) || 0) * 100) / 100,
    }));
    const split = computePoolShares({
      poolAmount: body?.pool_amount,
      method: body?.method || settings.method,
      people: folks,
      settings,
    });
    const scheduledById = new Map(folks.map((f) => [f.id, f.scheduled_hours]));
    split.shares = split.shares.map((share) => ({ ...share, scheduled_hours: scheduledById.get(share.staff_member_id) || 0 }));
    return { period, settings, split };
  }

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    if (!access.isOwner) {
      return res.json({ isOwner: false, mine: await myShares(pool(), access.business.id, access.staffRow?.id) });
    }
    const [settings, runs, reportPeriods] = await Promise.all([
      getSettings(pool(), access.business.id),
      listRuns(pool(), access.business.id),
      listReportPeriods(pool(), access.business.id),
    ]);
    const team = await people(pool(), access.business.id);
    return res.json({
      isOwner: true,
      settings,
      runs,
      reportPeriods,
      people: team.map((p) => ({ id: p.id, full_name: p.full_name, role_name: p.role_name || '' })),
    });
  }));

  router.put(`${base}/settings`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    res.json({ settings: await saveSettings(pool(), access.business.id, req.body || {}) });
  }));

  router.post(`${base}/preview`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    res.json(await splitFor(access, req.body || {}));
  }));

  router.post(`${base}/runs`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    const { period, split } = await splitFor(access, req.body || {});
    const { run, shares } = await createRun(pool(), access.business.id, { period, split }, { userId: req.user.id });
    res.status(201).json({ run, shares });
  }));

  router.patch(`${base}/runs/:rid/publish`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    const run = await setRunPublished(pool(), access.business.id, req.params.rid, req.body?.published);
    res.json({ run });
  }));

  router.delete(`${base}/runs/:rid`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    await deleteRun(pool(), access.business.id, req.params.rid);
    res.json({ deleted: true });
  }));

  router.get(`${base}/my-shares`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    res.json({ mine: await myShares(pool(), access.business.id, access.staffRow?.id) });
  }));

  router.post(`${base}/report-periods`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    const period = await createReportPeriod(pool(), access.business.id, req.body || {}, { userId: req.user.id });
    res.status(201).json({ period });
  }));

  router.delete(`${base}/report-periods/:pid`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    await deleteReportPeriod(pool(), access.business.id, req.params.pid);
    res.json({ deleted: true });
  }));

  router.put(`${base}/report-periods/:pid/reports/:staffId`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    const team = await people(pool(), access.business.id);
    const person = team.find((p) => p.id === req.params.staffId);
    if (!person) throw err(404, 'not_found', 'Not found.');
    // Hours default to the person's clock hours in the
    // period when the owner did not type their own.
    let body = { ...(req.body || {}), staff_member_id: person.id };
    if (body.hours === undefined || body.hours === null || body.hours === '') {
      const periodRow = (await pool().query(
        'SELECT * FROM tip_report_periods WHERE id = $1 AND business_id = $2 LIMIT 1',
        [req.params.pid, access.business.id],
      )).rows[0];
      if (periodRow) {
        const { clock } = await hoursByPerson(pool(), access.business, periodRow.period_start, periodRow.period_end);
        body = { ...body, hours: clock.get(person.id) || 0 };
      }
    }
    const report = await saveReport(pool(), access.business.id, req.params.pid, body, person.full_name);
    res.json({ report });
  }));

  router.delete(`${base}/report-periods/:pid/reports/:staffId`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    await deleteReport(pool(), access.business.id, req.params.pid, req.params.staffId);
    res.json({ deleted: true });
  }));

  router.get(`${base}/year`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    res.json({ record: await yearRecord(pool(), access.business.id, year) });
  }));

  return router;
}
