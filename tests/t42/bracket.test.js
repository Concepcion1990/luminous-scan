/**
 * Release 345 — THE BRACKET FIX (Nov 22, 2026).
 *
 * The owner's hand-hit stop: Staff 1 clocked out Saturday
 * ~11:29 AM; the clock-out armed staff_members.auto_logout_at
 * ≈ 11:39 AM and only a clock-in ever clears it. Sunday 4:53 PM,
 * INSIDE her Sun–Thu 10 AM–6 PM shift, she signed in — the login
 * POST succeeded (the bracket's admit math was always right) —
 * but /auth/me served the stale, long-past deadline verbatim
 * (autoLogoutAtFor never checked whether it was past), the
 * client timer saw remaining <= 0 and signed her out on the
 * spot, silently, every time. She could never stay in long
 * enough to clock in and clear it. Diagnosis:
 * ~/workspace/bracket-admit-diagnosis-nov22/diagnosis.md.
 *
 * The fix (server-side, two halves):
 *   1. autoLogoutAtFor returns null when the deadline is not
 *      in the future — a lapsed deadline is spent, not pending.
 *   2. stateForMember: admission on live work (a fresh
 *      unconsumed shift, an open entry, an open call-in window)
 *      treats a lapsed deadline as spent — the row is cleared
 *      (cancelAutoLogout semantics) and no deadline is surfaced.
 *
 * Pins:
 *   (1) the EXACT failure shape, production form (active id
 *       NULL): prior-day completed entry + prior-day lapsed
 *       deadline + fresh unconsumed shift today → login 200,
 *       /auth/me auto_logout_at null, the row cleared, the
 *       session SURVIVES, clock-in works.
 *   (2) the same shape, strict form (switched-in member).
 *   (3) non-regression: a FUTURE deadline is still served by
 *       /auth/me, and when it lapses mid-session the session
 *       still dies on the next move (339).
 *   (4) non-regression: consumed shift today + lapsed deadline
 *       still refuses, next shift named (339).
 *   (5) non-regression: the 341 view-only bracket exemption —
 *       a view-only business's staff sign in outside any shift.
 *
 * Real Express app over HTTP against pg-mem, same as every
 * phase; timezone trick shared with t37.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  pool,
  req,
  close,
  cookieFrom,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
  login,
} from './helpers.js';
import { autoLogoutAtFor, zonedTimeToUtc } from '../../server/staffWindow.js';

after(close);
beforeEach(() => resetRateLimits());

const WF = (bid) => `/api/businesses/${bid}/workforce`;

async function addTeamMember(business, ownerId, email, { manager = false, name, permissions = [], setActive = true } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, $7, 'active', $8)`,
    [
      id,
      business.id,
      name || (manager ? 'Manny Manager' : 'Sam Staff'),
      email,
      manager ? 'preset-manager' : 'preset-sales',
      manager ? 'Manager' : 'Sales clerk',
      JSON.stringify(permissions),
      ownerId,
    ],
  );
  const account = await registerVerifiedUser(email);
  if (setActive) {
    await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [business.id, account.user.id]);
  }
  return { staffId: id, email, cookie: account.cookie, user: account.user, password: account.password };
}

const TZ_CANDIDATES = [
  'Pacific/Kiritimati', 'Pacific/Auckland', 'Australia/Sydney', 'Asia/Tokyo',
  'Asia/Shanghai', 'Asia/Jakarta', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/Moscow',
  'Europe/Paris', 'UTC', 'Atlantic/Azores', 'America/Sao_Paulo', 'America/New_York',
  'America/Mexico_City', 'America/Denver', 'America/Los_Angeles', 'Pacific/Honolulu',
];
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localNow(tz) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())) parts[p.type] = p.value;
  return { weekday: WEEKDAY_INDEX[parts.weekday], minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}
function pickTimezone() {
  for (const tz of TZ_CANDIDATES) {
    const { minutes } = localNow(tz);
    if (minutes >= 480 && minutes <= 900) return tz;
  }
  return 'UTC';
}
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

function localDateStr(tz, when = new Date()) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(when)) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function setup(tz, emailPrefix) {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness(`${emailPrefix}@example.com`);
  await pool.query('UPDATE businesses SET timezone = $1 WHERE id = $2', [tz, business.id]);
  return { ownerCookie, business, owner };
}

async function setShift(businessId, staffId, weekday, startMins, endMins) {
  await pool.query(
    `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (business_id, staff_member_id, weekday) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
    [crypto.randomUUID(), businessId, staffId, weekday, hhmm(startMins), hhmm(endMins)],
  );
}

/**
 * The Staff 1 shape, planted on a fixture member: YESTERDAY the
 * member worked a shift (completed entry, clock-in inside the
 * shift window) and clocked out; the clock-out's deadline
 * (clock-out + 10 min) still sits on the row, long past. TODAY
 * a fresh shift covers now and is unconsumed.
 */
async function plantStaleDeadlineShape(tz, business, staff) {
  const { weekday, minutes } = localNow(tz);
  const todayStr = localDateStr(tz);
  const yesterday = new Date(`${todayStr}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = localDateStr(tz, yesterday);
  const yesterdayWeekday = (weekday + 6) % 7;

  await setShift(business.id, staff.staffId, yesterdayWeekday, 540, 1020);
  const clockInAt = zonedTimeToUtc(yesterdayStr, 600, tz);
  const clockOutAt = zonedTimeToUtc(yesterdayStr, 660, tz);
  await pool.query(
    `INSERT INTO time_entries (id, business_id, staff_member_id, clock_in_at, clock_out_at, unscheduled)
     VALUES ($1, $2, $3, $4, $5, false)`,
    [crypto.randomUUID(), business.id, staff.staffId, clockInAt.toISOString(), clockOutAt.toISOString()],
  );
  const deadline = new Date(clockOutAt.getTime() + 10 * 60_000);
  await pool.query('UPDATE staff_members SET auto_logout_at = $1 WHERE id = $2', [deadline.toISOString(), staff.staffId]);

  await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 180);
  return { deadline };
}

async function storedDeadline(staffId) {
  const { rows } = await pool.query('SELECT auto_logout_at FROM staff_members WHERE id = $1', [staffId]);
  return rows[0].auto_logout_at;
}

// ---- (1) the exact failure shape, production form ----------------------------

test('345 shape (fallback): prior-day lapsed deadline + fresh unconsumed shift → admitted, /auth/me serves null, row cleared, session survives, clock-in works', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'bkx-fallback-owner');
  const staff = await addTeamMember(business, owner.id, 'bkx-fallback@example.com', { setActive: false });
  const { rows } = await pool.query('SELECT active_business_id FROM users WHERE id = $1', [staff.user.id]);
  assert.equal(rows[0].active_business_id, null, 'fixture is the production shape: the active id was never set');
  const { deadline } = await plantStaleDeadlineShape(tz, business, staff);
  assert.ok(Date.parse(await storedDeadline(staff.staffId)) === deadline.getTime(), 'the stale deadline sits on the row before sign-in');

  const session = await login(staff.email, staff.password);
  assert.equal(session.status, 200, 'the login door admits her — it always did');
  const cookie = cookieFrom(session.setCookie);

  const me = await req('/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.auto_logout_at, null, '/auth/me serves NO deadline — a lapsed deadline is spent, not pending');

  assert.equal(await storedDeadline(staff.staffId), null, 'admission on live work cleared the spent deadline from the row');

  const meAgain = await req('/api/auth/me', { cookie });
  assert.equal(meAgain.status, 200, 'the session SURVIVES — no instant eviction');
  const list = await req('/api/businesses', { cookie });
  assert.equal(list.status, 200, 'authed calls keep working');

  const inRes = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
  assert.equal(inRes.status, 201, 'clock-in works — the trap is gone (clocking in was the only cure, and it was unreachable)');
});

// ---- (2) the same shape, strict form ------------------------------------------

test('345 shape (strict): a switched-in member with the same stale deadline is admitted and stays in', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'bkx-strict-owner');
  const staff = await addTeamMember(business, owner.id, 'bkx-strict@example.com', { setActive: true });
  await plantStaleDeadlineShape(tz, business, staff);

  const session = await login(staff.email, staff.password);
  assert.equal(session.status, 200);
  const cookie = cookieFrom(session.setCookie);
  const me = await req('/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.auto_logout_at, null);
  assert.equal(await storedDeadline(staff.staffId), null, 'the strict path clears the spent deadline too');
  const inRes = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
  assert.equal(inRes.status, 201);
});

// ---- (3) non-regression: future deadline served; mid-session lapse kills -----

test('non-regression: a FUTURE deadline is still served by /auth/me, and the session still dies when it lapses mid-session', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'bkx-grace-owner');
  const staff = await addTeamMember(business, owner.id, 'bkx-grace@example.com');
  const { weekday, minutes } = localNow(tz);
  await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 180);

  const session = await login(staff.email, staff.password);
  assert.equal(session.status, 200);
  const cookie = cookieFrom(session.setCookie);
  const inRes = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
  assert.equal(inRes.status, 201);
  const outRes = await req(`${WF(business.id)}/clock/out`, { method: 'POST', body: { note: 'Done' }, cookie });
  assert.equal(outRes.status, 200);
  assert.ok(outRes.json.auto_logout_at, 'clock-out arms the grace deadline');

  const me = await req('/api/auth/me', { cookie });
  assert.equal(me.status, 200, 'inside the grace the session lives');
  assert.ok(me.json.auto_logout_at, 'a FUTURE deadline is still served — the fix only retires lapsed ones');
  assert.ok(Math.abs(Date.parse(me.json.auto_logout_at) - Date.parse(outRes.json.auto_logout_at)) < 5000, 'the served deadline is the armed one');
  assert.equal(await autoLogoutAtFor(pool, staff.user), me.json.auto_logout_at, 'autoLogoutAtFor serves the live deadline verbatim');

  // The deadline lapses WHILE she is signed in (the 339
  // mid-session behavior the owner hand-proved): the getter
  // now reports nothing pending, and the bracket kills the
  // session on its next move — and it stays dead.
  await pool.query('UPDATE staff_members SET auto_logout_at = NOW() - INTERVAL \'1 minute\' WHERE id = $1', [staff.staffId]);
  assert.equal(await autoLogoutAtFor(pool, staff.user), null, 'once lapsed, the getter serves null');
  const meDead = await req('/api/auth/me', { cookie });
  assert.equal(meDead.status, 401);
  assert.equal(meDead.json.error, 'staff_outside_window');
  const again = await req('/api/auth/me', { cookie });
  assert.equal(again.status, 401, 'the session row is revoked — it stays dead');
});

// ---- (4) non-regression: consumed shift + lapsed deadline still refuses ------

test('non-regression: consumed shift today + lapsed deadline still refuses at the login door, next shift named', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'bkx-consumed-owner');
  const staff = await addTeamMember(business, owner.id, 'bkx-consumed@example.com');
  const { weekday, minutes } = localNow(tz);
  await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 180);
  await setShift(business.id, staff.staffId, (weekday + 1) % 7, 540, 1020);

  const session = await login(staff.email, staff.password);
  const cookie = cookieFrom(session.setCookie);
  const inRes = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
  assert.equal(inRes.status, 201);
  const outRes = await req(`${WF(business.id)}/clock/out`, { method: 'POST', body: { note: 'Done' }, cookie });
  assert.equal(outRes.status, 200);

  await pool.query('UPDATE staff_members SET auto_logout_at = NOW() - INTERVAL \'1 minute\' WHERE id = $1', [staff.staffId]);
  const relogin = await login(staff.email, staff.password);
  assert.equal(relogin.status, 403, 'the consumed shift still locks her out — the fix must not resurrect a spent shift');
  assert.equal(relogin.json.error, 'staff_outside_window');
  assert.ok(relogin.json.next_shift_start, 'the refusal still names the next shift');
  assert.ok(await storedDeadline(staff.staffId), 'a refused admission does NOT clear the deadline — clearing belongs to admission on live work only');
});

// ---- (5) non-regression: the 341 view-only exemption --------------------------

test('non-regression: a view-only business (341) stands outside the bracket — staff sign in outside any shift', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'bkx-viewonly-owner');
  const staff = await addTeamMember(business, owner.id, 'bkx-viewonly@example.com');
  const { weekday } = localNow(tz);
  await setShift(business.id, staff.staffId, (weekday + 1) % 7, 540, 1020); // no shift today at all

  // The business sits in its 15 view-only days: failure 20
  // days ago, 14-day grace ended 6 days ago, day-15 cancel
  // already effective (the post-sweep row shape from t39).
  const DAY = 86_400_000;
  const failedAt = new Date(Date.now() - 20 * DAY).toISOString();
  const graceEnds = new Date(Date.now() - 6 * DAY).toISOString();
  const viewOnlyEnds = new Date(Date.now() + 9 * DAY).toISOString();
  await pool.query(
    `INSERT INTO subscriptions (id, business_id, owner_id, plan, status, cancellation_effective_at, grace_ends_at, payment_failed_at, payment_grace_ends_at)
     VALUES ($1, $2, $3, 'essentials', 'canceled', $4, $5, $6, $7)`,
    [crypto.randomUUID(), business.id, owner.id, graceEnds, viewOnlyEnds, failedAt, graceEnds],
  );

  const session = await login(staff.email, staff.password);
  assert.equal(session.status, 200, 'view-only days do not gate sign-in — the bracket exemption holds');
  const cookie = cookieFrom(session.setCookie);
  const me = await req('/api/auth/me', { cookie });
  assert.equal(me.status, 200, 'and the session lives for reads (pay stubs and information)');
});
