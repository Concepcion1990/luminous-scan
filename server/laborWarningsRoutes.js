/**
 * Labor target + overtime/break warnings — HTTP surface
 * (Nov 26, 2026; plan release 374, Gap 13, Q4 ruled
 * Nov 25, 2026).
 *
 *   GET /api/businesses/:bid/labor-watch          any member: the owner's watch numbers, the schedule week's warnings (+ the labor target face on Business/restaurant plans), and the warnings from hours already worked
 *   PUT /api/businesses/:bid/labor-watch/settings owner: save the watch numbers
 *
 * THE WARNINGS ARE GENERAL — both plans, no plan gate on
 * this router at all. The LABOR TARGET face is RESTAURANT
 * (Business-only): on a plan without the restaurant
 * feature the response carries no target, no expected
 * sales, no projected cost and no labor % at all — the
 * framing does not exist there — and a settings save from
 * such a plan cannot set the target fields.
 *
 * ALL THRESHOLDS ARE OWNER-SET: the settings write is the
 * owner's alone, and the engine watches the owner's own
 * numbers; it legislates nothing. A staff member sees only
 * their own rows; a manager sees the team, like the
 * schedule builder itself.
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import { businessTimezone, entryMinutes, localParts, personLevel, weekStartSunday } from './workforceRoutes.js';
import {
  OWNER_MESSAGE,
  computeClockWarnings,
  computeScheduleWeek,
  getSettings,
  round2,
  saveSettings,
} from './laborWarningsCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] labor-warnings route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createLaborWarningsRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/labor-watch';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    return access;
  }

  async function buildView(access) {
    const businessId = access.business.id;
    const settings = await getSettings(pool(), businessId);
    const hasLaborTarget = featureAllowed(access.planKey, 'restaurant');
    const level = access.isOwner ? 'owner' : personLevel(access.staffRow);
    const seesTeam = level !== 'staff';

    const { rows: team } = await pool().query(
      "SELECT * FROM staff_members WHERE business_id = $1 AND status = 'active' ORDER BY full_name ASC",
      [businessId],
    );
    const visible = seesTeam ? team : team.filter((p) => p.id === access.staffRow?.id);
    const visibleIds = new Set(visible.map((p) => p.id));

    const { rows: profiles } = await pool().query(
      'SELECT * FROM pay_profiles WHERE business_id = $1',
      [businessId],
    );
    const profileById = new Map(profiles.map((p) => [p.staff_member_id, p]));
    const people = visible.map((person) => {
      const profile = profileById.get(person.id) || {};
      return {
        id: person.id,
        full_name: person.full_name,
        role_name: person.role_name || '',
        pay_type: profile.pay_type || 'hourly',
        hourly_rate: Number(profile.hourly_rate || 0),
        annual_salary: Number(profile.annual_salary || 0),
      };
    });

    const { rows: schedules } = await pool().query(
      'SELECT * FROM work_schedules WHERE business_id = $1',
      [businessId],
    );
    const week = computeScheduleWeek({
      settings,
      people,
      schedules: schedules.filter((s) => visibleIds.has(s.staff_member_id)),
    });

    // Hours already worked: the last 28 days of clock
    // entries, folded into per-person days and workweeks in
    // the business's own timezone.
    const timeZone = businessTimezone(access.business);
    const since = new Date(Date.now() - 28 * 86400000).toISOString();
    const { rows: entries } = await pool().query(
      'SELECT * FROM time_entries WHERE business_id = $1 AND clock_in_at >= $2 ORDER BY clock_in_at ASC',
      [businessId, since],
    );
    const visibleEntries = entries.filter((e) => visibleIds.has(e.staff_member_id));
    const breaksByEntry = new Map();
    if (visibleEntries.length) {
      const placeholders = visibleEntries.map((_, i) => `$${i + 2}`).join(', ');
      const { rows: breaks } = await pool().query(
        `SELECT * FROM time_breaks WHERE business_id = $1 AND entry_id IN (${placeholders})`,
        [businessId, ...visibleEntries.map((e) => e.id)],
      );
      for (const brk of breaks) {
        if (!breaksByEntry.has(brk.entry_id)) breaksByEntry.set(brk.entry_id, []);
        breaksByEntry.get(brk.entry_id).push(brk);
      }
    }
    const nameById = new Map(people.map((p) => [p.id, p.full_name]));
    const dayMap = new Map();
    const weekMap = new Map();
    for (const entry of visibleEntries) {
      const local = localParts(new Date(entry.clock_in_at), timeZone);
      const { paidMinutes, breakMinutes } = entryMinutes(entry, breaksByEntry.get(entry.id) || []);
      const dayKey = `${entry.staff_member_id}|${local.dateStr}`;
      const day = dayMap.get(dayKey) || {
        staff_member_id: entry.staff_member_id, person_name: nameById.get(entry.staff_member_id) || '',
        date: local.dateStr, paid: 0, breaks: 0,
      };
      day.paid += paidMinutes; day.breaks += breakMinutes;
      dayMap.set(dayKey, day);
      const weekKey = `${entry.staff_member_id}|${weekStartSunday(local.dateStr)}`;
      const wk = weekMap.get(weekKey) || {
        staff_member_id: entry.staff_member_id, person_name: nameById.get(entry.staff_member_id) || '', paid: 0,
      };
      wk.paid += paidMinutes;
      weekMap.set(weekKey, wk);
    }
    const clockWarnings = computeClockWarnings({
      settings,
      days: [...dayMap.values()].map((d) => ({ ...d, hours: round2(d.paid / 60), break_minutes: Math.round(d.breaks) })),
      weekly: [...weekMap.values()].map((w) => ({ ...w, hours: round2(w.paid / 60) })),
    });

    if (!hasLaborTarget) {
      // Business-only invisibility for the restaurant face:
      // no target numbers, no projected cost, no labor %.
      return {
        isOwner: Boolean(access.isOwner),
        hasLaborTarget: false,
        settings: { ...settings, labor_target_pct: null, expected_sales: null },
        week: {
          settings: { ...week.settings, labor_target_pct: null, expected_sales: null },
          people: week.people.map(({ projected_cost: _cost, ...rest }) => rest),
          warnings: week.warnings,
          totals: { scheduled_hours: week.totals.scheduled_hours },
        },
        clockWarnings,
      };
    }
    return {
      isOwner: Boolean(access.isOwner),
      hasLaborTarget: true,
      settings,
      week,
      clockWarnings,
    };
  }

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    res.json(await buildView(access));
  }));

  router.put(`${base}/settings`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    if (!access.isOwner) throw err(403, 'labor_owner', OWNER_MESSAGE);
    let input = req.body || {};
    if (!featureAllowed(access.planKey, 'restaurant')) {
      const existing = await getSettings(pool(), access.business.id);
      input = { ...input, labor_target_pct: existing.labor_target_pct, expected_sales: existing.expected_sales };
    }
    const settings = await saveSettings(pool(), access.business.id, input);
    res.json({ settings });
  }));

  return router;
}
