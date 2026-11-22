/**
 * The Nov 21, 2026 clock build — server proofs:
 *   (a) the call-in gate: clock-in refused when no shift covers
 *       now and no call-in window is open (next shift named);
 *   (a) the call-in window: owner/ticked-manager opens it, it
 *       admits sign-in + clock-in, stays open, closes on
 *       clock-out, and the opener can close it early;
 *   (b) the missed clock-out: flagged live on entries + payroll,
 *       owner and ticked managers belled exactly once;
 *   (b) corrections from the Staff page door (PATCH entries):
 *       owner always, ticked manager for staff only, everyone
 *       else 403, times validated;
 *   (c) the ONE tick (staff.clock) gates all of it, with its
 *       training wired (catalog + scope);
 *   (d) the auto-logout defect: the 314 bracket judged only
 *       users.active_business_id, which the invite/staff-entry
 *       flow never sets — a member in the production shape
 *       (active id NULL) is now judged by their staff business:
 *       refused outside the window, admitted inside it, and a
 *       past-deadline session dies on its next move.
 *
 * Real Express app over HTTP against pg-mem, same as every
 * phase; timezone trick shared with t7 (a zone whose local time
 * is mid-morning so windows are expressible).
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
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
import { staffWindowState, zonedTimeToUtc } from '../../server/staffWindow.js';
import { TRAINING_LESSONS, MODULE_BY_PERMISSION } from '../../server/trainingCatalog.js';
import { LESSON_REQUIREMENTS } from '../../server/trainingScope.js';

after(close);
beforeEach(() => resetRateLimits());

const WF = (bid) => `/api/businesses/${bid}/workforce`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function clearShift(businessId, staffId, weekday) {
  await pool.query(
    'DELETE FROM work_schedules WHERE business_id = $1 AND staff_member_id = $2 AND weekday = $3',
    [businessId, staffId, weekday],
  );
}

function localDateStr(tz, when = new Date()) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(when)) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// ---- (d) the bracket judges the production shape (active id NULL) -----------

test('bracket fallback: a member with active_business_id NULL is refused outside the window, admitted inside it', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'clk-fallback-owner');
  const staff = await addTeamMember(business, owner.id, 'clk-fallback@example.com', { setActive: false });
  const { rows } = await pool.query('SELECT active_business_id FROM users WHERE id = $1', [staff.user.id]);
  assert.equal(rows[0].active_business_id, null, 'fixture is the production shape: the active id was never set');
  const { weekday, minutes } = localNow(tz);
  await setShift(business.id, staff.staffId, weekday, minutes + 120, minutes + 300);

  const refused = await login(staff.email, staff.password);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, 'staff_outside_window');
  assert.ok(refused.json.next_shift_start, 'the refusal names the next shift start');

  await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 180);
  const admitted = await login(staff.email, staff.password);
  assert.equal(admitted.status, 200, 'inside the shift the same member signs in — the fallback judges, not just refuses');
});

test('bracket fallback: a past-deadline member with active_business_id NULL dies on the next move and stays dead', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'clk-deadline-owner');
  const staff = await addTeamMember(business, owner.id, 'clk-deadline@example.com', { setActive: false });
  const { weekday, minutes } = localNow(tz);
  await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 180);
  const session = await login(staff.email, staff.password);
  assert.equal(session.status, 200);
  const cookie = cookieFrom(session.setCookie);

  const inRes = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
  assert.equal(inRes.status, 201);
  const outRes = await req(`${WF(business.id)}/clock/out`, { method: 'POST', body: { note: 'Done' }, cookie });
  assert.equal(outRes.status, 200);
  assert.ok(outRes.json.auto_logout_at, 'clock-out arms the deadline even for the production shape');

  // The deadline passes (the member never acts again — the
  // owner's Nov 21 proof). The next move must be refused and
  // the session row revoked, not merely warned.
  await pool.query('UPDATE staff_members SET auto_logout_at = NOW() - INTERVAL \'1 minute\' WHERE id = $1', [staff.staffId]);
  const meDead = await req('/api/auth/me', { cookie });
  assert.equal(meDead.status, 401);
  assert.equal(meDead.json.error, 'staff_outside_window');
  const again = await req('/api/auth/me', { cookie });
  assert.equal(again.status, 401, 'the session row is gone — it stays dead');
  const relogin = await login(staff.email, staff.password);
  assert.equal(relogin.status, 403, 'after the grace, the consumed shift locks the member out until the next one');
  assert.equal(relogin.json.error, 'staff_outside_window');
  assert.ok(relogin.json.next_shift_start, 'the lockout names the next shift');
});

test('staffWindowState: a member of two staff businesses (active id NULL) is judged across both', async () => {
  const tz = pickTimezone();
  const a = await setup(tz, 'clk-merge-a');
  const b = await setup(tz, 'clk-merge-b');
  const inA = await addTeamMember(a.business, a.owner.id, 'clk-merge@example.com', { setActive: false });
  // Same account, staff row in business B too.
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, 'Sam Staff', $3, 'user', 'preset-sales', 'Sales clerk', '[]', 'active', $4)`,
    [crypto.randomUUID(), b.business.id, inA.email, b.owner.id],
  );
  const { weekday, minutes } = localNow(tz);
  await setShift(a.business.id, inA.staffId, weekday, minutes - 30, minutes + 180);
  const state = await staffWindowState(pool, inA.user);
  assert.equal(state.applies, true);
  assert.equal(state.allowed, true, 'admission in either business admits');
  assert.equal(state.hasOpenEntry, false);
});

test('bracket fallback: an invited member with NO schedule at all stands outside the bracket (the first-entry invariant)', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'clk-nosched-owner');
  // An invited row, never activated, no schedule posted — the
  // new hire accepting the invite. The bracket must not judge
  // them: their first sign-in flips the row Active and lands
  // them inside (welcome + training stay reachable).
  const staff = await addTeamMember(business, owner.id, 'clk-nosched@example.com', { setActive: false });
  const session = await login(staff.email, staff.password);
  assert.equal(session.status, 200, 'the schedule-less new hire signs in');
  const cookie = cookieFrom(session.setCookie);
  const list = await req('/api/businesses', { cookie });
  assert.equal(list.status, 200, 'and their session lives for the workspace doors');
  const state = await staffWindowState(pool, staff.user);
  assert.equal(state.applies, false, 'no schedule rows anywhere: the bracket does not bite');
});

// ---- (a) the gate, through the grace door -----------------------------------

test('clock-in gate: after clock-out, re-entry inside the grace is refused when no shift covers now and no window is open — next shift named', async () => {
  process.env.STAFF_AUTO_LOGOUT_MS = '60000';
  try {
    const tz = pickTimezone();
    const { business, owner } = await setup(tz, 'clk-gate-owner');
    const staff = await addTeamMember(business, owner.id, 'clk-gate@example.com');
    const { weekday, minutes } = localNow(tz);
    await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 180);
    const session = await login(staff.email, staff.password);
    const cookie = cookieFrom(session.setCookie);

    const inRes = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
    assert.equal(inRes.status, 201);
    assert.equal(inRes.json.entry.unscheduled, false, 'a scheduled clock-in is unchanged by the gate');
    assert.equal(inRes.json.entry.called_in, false);
    const outRes = await req(`${WF(business.id)}/clock/out`, { method: 'POST', body: { note: 'Done' }, cookie });
    assert.equal(outRes.status, 200);

    // The schedule changes: today's shift is gone, the next one
    // is tomorrow. Inside the grace the bracket still admits
    // the request — the clock gate is what refuses it.
    await clearShift(business.id, staff.staffId, weekday);
    await setShift(business.id, staff.staffId, (weekday + 1) % 7, 540, 1020);
    const refused = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
    assert.equal(refused.status, 403);
    assert.equal(refused.json.error, 'clock_in_not_scheduled');
    assert.equal(refused.json.message, 'You are not scheduled to work right now, and no call-in window is open for you.');
    assert.ok(refused.json.next_shift_start, 'the refusal names the next scheduled shift');
  } finally {
    delete process.env.STAFF_AUTO_LOGOUT_MS;
  }
});

// ---- (a) the call-in window ---------------------------------------------------

test('call-in window: opens, admits sign-in and clock-in, stays open, closes on clock-out; early close refuses again', async () => {
  const tz = pickTimezone();
  const { ownerCookie, business, owner } = await setup(tz, 'clk-window-owner');
  const staff = await addTeamMember(business, owner.id, 'clk-window@example.com');
  const { weekday } = localNow(tz);
  await setShift(business.id, staff.staffId, (weekday + 1) % 7, 540, 1020); // next shift tomorrow only

  const shut = await login(staff.email, staff.password);
  assert.equal(shut.status, 403, 'no shift today and no window: the door is shut');

  const open1 = await req(`${WF(business.id)}/call-in/${staff.staffId}`, { method: 'POST', body: {}, cookie: ownerCookie });
  assert.equal(open1.status, 201);
  assert.equal(open1.json.window.staff_member_id, staff.staffId);
  const open2 = await req(`${WF(business.id)}/call-in/${staff.staffId}`, { method: 'POST', body: {}, cookie: ownerCookie });
  assert.equal(open2.status, 201);
  assert.equal(open2.json.window.id, open1.json.window.id, 'opening twice is idempotent — one window');
  const { rows: winRows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM call_in_windows WHERE business_id = $1 AND closed_at IS NULL',
    [business.id],
  );
  assert.equal(winRows[0].n, 1);

  const session = await login(staff.email, staff.password);
  assert.equal(session.status, 200, 'the open window is also the sign-in path');
  const cookie = cookieFrom(session.setCookie);
  const status = await req(`${WF(business.id)}/clock/status`, { cookie });
  assert.equal(status.json.call_in_open, true);

  const inRes = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
  assert.equal(inRes.status, 201);
  assert.equal(inRes.json.entry.called_in, true);
  assert.equal(inRes.json.entry.unscheduled, true);

  const listed = await req(`${WF(business.id)}/call-in`, { cookie: ownerCookie });
  assert.equal(listed.json.windows.length, 1, 'the window stays open while the person works');

  const outRes = await req(`${WF(business.id)}/clock/out`, { method: 'POST', body: {}, cookie });
  assert.equal(outRes.status, 200);
  assert.ok(outRes.json.auto_logout_at, 'the usual grace follows the clock-out');
  const afterOut = await req(`${WF(business.id)}/call-in`, { cookie: ownerCookie });
  assert.equal(afterOut.json.windows.length, 0, 'clock-out closes the window');

  // Early close, on a second member who never clocked in (so
  // no grace is running): open the window, the door opens;
  // close it early, the door shuts again.
  const staff2 = await addTeamMember(business, owner.id, 'clk-window2@example.com', { name: 'Wanda Second' });
  // Wanda HAS a schedule (tomorrow only), so the bracket binds
  // her — unlike a member with no schedule at all, who stands
  // outside the bracket entirely (see the first-entry test).
  await setShift(business.id, staff2.staffId, (weekday + 1) % 7, 540, 1020);
  await req(`${WF(business.id)}/call-in/${staff2.staffId}`, { method: 'POST', body: {}, cookie: ownerCookie });
  const admitted2 = await login(staff2.email, staff2.password);
  assert.equal(admitted2.status, 200, 'the second member signs in on their open window');
  const closed = await req(`${WF(business.id)}/call-in/${staff2.staffId}`, { method: 'DELETE', cookie: ownerCookie });
  assert.equal(closed.status, 200);
  assert.ok(closed.json.window.closed_at, 'the early close stamps the window');
  const shutAgain = await login(staff2.email, staff2.password);
  assert.equal(shutAgain.status, 403, 'after the early close, sign-in is refused again');
});

// ---- (c) the tick + hierarchy --------------------------------------------------

test('the tick: unticked manager and staff are refused; ticked manager works staff but never managers; the owner works everyone', async () => {
  const tz = pickTimezone();
  const { ownerCookie, business, owner } = await setup(tz, 'clk-tick-owner');
  const staff = await addTeamMember(business, owner.id, 'clk-tick-staff@example.com');
  const plainMgr = await addTeamMember(business, owner.id, 'clk-tick-mgr@example.com', { manager: true });
  const tickedMgr = await addTeamMember(business, owner.id, 'clk-tick-mgr2@example.com', {
    manager: true, name: 'Tina Ticked', permissions: ['staff.clock'],
  });
  const otherMgr = await addTeamMember(business, owner.id, 'clk-tick-mgr3@example.com', { manager: true, name: 'Omar Other' });
  const { weekday, minutes } = localNow(tz);
  for (const m of [staff, plainMgr, tickedMgr, otherMgr]) {
    await setShift(business.id, m.staffId, weekday, minutes - 30, minutes + 180);
  }
  const loginCookie = async (m) => cookieFrom((await login(m.email, m.password)).setCookie);
  const plainCookie = await loginCookie(plainMgr);
  const tickedCookie = await loginCookie(tickedMgr);

  const staffTry = await req(`${WF(business.id)}/call-in/${staff.staffId}`, { method: 'POST', body: {}, cookie: staff.cookie });
  assert.equal(staffTry.status, 403);
  const listTry = await req(`${WF(business.id)}/call-in`, { cookie: plainCookie });
  assert.equal(listTry.status, 403);
  assert.equal(listTry.json.error, 'clock_admin_not_granted');
  assert.equal(listTry.json.message, 'Only the owner, or a manager the owner has trusted with call-ins and clock corrections, can do that.');
  const mgrTry = await req(`${WF(business.id)}/call-in/${staff.staffId}`, { method: 'POST', body: {}, cookie: plainCookie });
  assert.equal(mgrTry.status, 403);
  assert.equal(mgrTry.json.error, 'clock_admin_not_granted');

  const tickedOpen = await req(`${WF(business.id)}/call-in/${staff.staffId}`, { method: 'POST', body: {}, cookie: tickedCookie });
  assert.equal(tickedOpen.status, 201, 'the ticked manager opens a window for staff');
  const mgrTarget = await req(`${WF(business.id)}/call-in/${otherMgr.staffId}`, { method: 'POST', body: {}, cookie: tickedCookie });
  assert.equal(mgrTarget.status, 403);
  assert.equal(mgrTarget.json.message, 'Only the owner can manage a manager’s call-ins and time entries.');
  const ownerMgr = await req(`${WF(business.id)}/call-in/${otherMgr.staffId}`, { method: 'POST', body: {}, cookie: ownerCookie });
  assert.equal(ownerMgr.status, 201, 'the owner opens windows for managers too');
});

test('the tick brings its training: catalog, module map, and lesson requirements are wired', () => {
  const lesson = TRAINING_LESSONS.find((l) => l.id === 'mgr-clock-callin');
  assert.ok(lesson, 'the lesson ships in the server catalog');
  assert.equal(lesson.module, 'workforce');
  assert.equal(lesson.track, 'manager');
  assert.deepEqual(MODULE_BY_PERMISSION['staff.clock'], ['workforce']);
  assert.deepEqual(LESSON_REQUIREMENTS['mgr-clock-callin'], ['staff.clock']);
  assert.equal(TRAINING_LESSONS.length, 100, 'the catalog grew by exactly the one lesson');
});

// ---- (b) missed clock-out + corrections ---------------------------------------

async function missedFixture(prefix) {
  const tz = pickTimezone();
  const ctx = await setup(tz, `${prefix}-owner`);
  const staff = await addTeamMember(ctx.business, ctx.owner.id, `${prefix}-staff@example.com`);
  const { weekday, minutes } = localNow(tz);
  const startMins = minutes - 180;
  const endMins = minutes - 60;
  await setShift(ctx.business.id, staff.staffId, weekday, startMins, endMins);
  const dateStr = localDateStr(tz);
  const clockInAt = zonedTimeToUtc(dateStr, startMins, tz);
  const entryId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO time_entries (id, business_id, staff_member_id, clock_in_at, unscheduled)
     VALUES ($1, $2, $3, $4, false)`,
    [entryId, ctx.business.id, staff.staffId, clockInAt.toISOString()],
  );
  return { ...ctx, staff, tz, dateStr, startMins, endMins, entryId };
}

test('missed clock-out: flagged on entries and payroll with the scheduled times; owner and ticked manager belled exactly once', async () => {
  const f = await missedFixture('clk-missed');
  const tickedMgr = await addTeamMember(f.business, f.owner.id, 'clk-missed-mgr@example.com', {
    manager: true, name: 'Tina Ticked', permissions: ['staff.clock'],
  });
  void tickedMgr;

  const entries = await req(`${WF(f.business.id)}/entries`, { cookie: f.ownerCookie });
  assert.equal(entries.status, 200);
  const row = entries.json.entries.find((e) => e.id === f.entryId);
  assert.ok(row.missed_clock_out, 'the open entry past its shift end is flagged');
  assert.equal(row.missed_clock_out.shift_date, f.dateStr);

  const preview = await req(
    `${WF(f.business.id)}/payroll/preview?start=${f.dateStr}&end=${f.dateStr}`,
    { cookie: f.ownerCookie },
  );
  assert.equal(preview.status, 200);
  const person = preview.json.people.find((p) => p.person.id === f.staff.staffId);
  assert.equal(person.missed_clock_outs.length, 1, 'payroll carries the flag too');
  assert.equal(person.missed_clock_outs[0].entry_id, f.entryId);

  const bells = await pool.query(
    `SELECT recipient_user_id FROM workforce_notifications
      WHERE business_id = $1 AND event = 'missed_clock_out' AND entry_id = $2`,
    [f.business.id, f.entryId],
  );
  const recipients = new Set(bells.rows.map((r) => r.recipient_user_id));
  assert.ok(recipients.has(f.owner.id), 'the owner is belled');
  assert.ok(recipients.has(tickedMgr.user.id), 'the ticked manager is belled');

  await req(`${WF(f.business.id)}/entries`, { cookie: f.ownerCookie });
  const bellsAgain = await pool.query(
    `SELECT COUNT(*)::int AS n FROM workforce_notifications
      WHERE business_id = $1 AND event = 'missed_clock_out' AND entry_id = $2`,
    [f.business.id, f.entryId],
  );
  assert.equal(bellsAgain.rows[0].n, bells.rows.length, 'the bell rings once — the claim ledger holds');
});

test('corrections: owner fixes the missed entry and the flag clears; validations refuse bad times; the hierarchy holds', async () => {
  const f = await missedFixture('clk-fix');
  const plainMgr = await addTeamMember(f.business, f.owner.id, 'clk-fix-mgr@example.com', { manager: true });
  const tickedMgr = await addTeamMember(f.business, f.owner.id, 'clk-fix-mgr2@example.com', {
    manager: true, name: 'Tina Ticked', permissions: ['staff.clock'],
  });
  const { weekday, minutes } = localNow(f.tz);
  for (const m of [plainMgr, tickedMgr]) await setShift(f.business.id, m.staffId, weekday, minutes - 30, minutes + 180);
  const plainCookie = cookieFrom((await login(plainMgr.email, plainMgr.password)).setCookie);
  const tickedCookie = cookieFrom((await login(tickedMgr.email, tickedMgr.password)).setCookie);

  const wall = (mins) => `${f.dateStr}T${hhmm(mins)}`;
  const badOrder = await req(`${WF(f.business.id)}/entries/${f.entryId}`, {
    method: 'PATCH', cookie: f.ownerCookie,
    body: { clock_in_at: wall(f.startMins), clock_out_at: wall(f.startMins - 30) },
  });
  assert.equal(badOrder.status, 400);
  assert.equal(badOrder.json.message, 'The clock-out time must be after the clock-in time.');
  const garbage = await req(`${WF(f.business.id)}/entries/${f.entryId}`, {
    method: 'PATCH', cookie: f.ownerCookie, body: { clock_in_at: 'not-a-time' },
  });
  assert.equal(garbage.status, 400);
  assert.equal(garbage.json.message, 'Send each time as a valid date and time.');
  const missing = await req(`${WF(f.business.id)}/entries/${crypto.randomUUID()}`, {
    method: 'PATCH', cookie: f.ownerCookie, body: { clock_out_at: wall(f.endMins) },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.message, 'Time entry not found.');

  const staffTry = await req(`${WF(f.business.id)}/entries/${f.entryId}`, {
    method: 'PATCH', cookie: f.staff.cookie, body: { clock_out_at: wall(f.endMins) },
  });
  assert.equal(staffTry.status, 403);
  const plainTry = await req(`${WF(f.business.id)}/entries/${f.entryId}`, {
    method: 'PATCH', cookie: plainCookie, body: { clock_out_at: wall(f.endMins) },
  });
  assert.equal(plainTry.status, 403);
  assert.equal(plainTry.json.error, 'clock_admin_not_granted');

  const fixed = await req(`${WF(f.business.id)}/entries/${f.entryId}`, {
    method: 'PATCH', cookie: tickedCookie,
    body: { clock_in_at: wall(f.startMins), clock_out_at: wall(f.endMins) },
  });
  assert.equal(fixed.status, 200, 'the ticked manager corrects a staff entry');
  assert.ok(fixed.json.entry.clock_out_at, 'the entry is closed by the correction');

  const entries = await req(`${WF(f.business.id)}/entries`, { cookie: f.ownerCookie });
  const row = entries.json.entries.find((e) => e.id === f.entryId);
  assert.equal(row.missed_clock_out, null, 'once corrected, the flag clears');
});

test('corrections: a break outside the entry range is refused; a valid break saves', async () => {
  const f = await missedFixture('clk-break');
  const wall = (mins) => `${f.dateStr}T${hhmm(mins)}`;
  const closeFirst = await req(`${WF(f.business.id)}/entries/${f.entryId}`, {
    method: 'PATCH', cookie: f.ownerCookie,
    body: { clock_in_at: wall(f.startMins), clock_out_at: wall(f.endMins) },
  });
  assert.equal(closeFirst.status, 200);
  const breakId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO time_breaks (id, business_id, entry_id, break_type, out_at)
     VALUES ($1, $2, $3, 'break15', $4)`,
    [breakId, f.business.id, f.entryId, zonedTimeToUtc(f.dateStr, f.startMins + 60, f.tz).toISOString()],
  );
  const outside = await req(`${WF(f.business.id)}/entries/${f.entryId}`, {
    method: 'PATCH', cookie: f.ownerCookie,
    body: { breaks: [{ id: breakId, out_at: wall(f.startMins + 60), in_at: wall(f.endMins + 30) }] },
  });
  assert.equal(outside.status, 400);
  assert.equal(outside.json.message, 'Break times must fall between the clock-in and clock-out times.');
  const inside = await req(`${WF(f.business.id)}/entries/${f.entryId}`, {
    method: 'PATCH', cookie: f.ownerCookie,
    body: { breaks: [{ id: breakId, out_at: wall(f.startMins + 60), in_at: wall(f.startMins + 75) }] },
  });
  assert.equal(inside.status, 200);
  assert.equal(inside.json.entry.breaks.length, 1);
  assert.ok(inside.json.entry.breaks[0].in_at);
});

test('the Staff door hangs for a clock-tick holder (no dangling tick)', () => {
  const nav = fs.readFileSync(new URL('../../src/components/layout/navGroups.js', import.meta.url), 'utf8');
  assert.match(nav, /anyPerm: \['staff\.roster', 'staff\.clock'\]/, 'the Staff nav item carries the clock alternative');
});

test('clock status: a profile-less owner gets the readable shape, not a refusal', async () => {
  const { business, ownerCookie } = await setup('UTC', 'clk-status-owner');
  const status = await req(`${WF(business.id)}/clock/status`, { cookie: ownerCookie });
  assert.equal(status.status, 200, 'the owner can load the Time clock tab');
  assert.equal(status.json.self_clock_enabled, false, 'an owner has no clock of their own');
  assert.equal(status.json.open_entry, null);
  assert.equal(status.json.call_in_open, false);
});

test('bracket strictness: a switched-in member with NO schedule is refused (the 314 law stands)', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'clk-strict-owner');
  // Active business set (the switched-in shape the 314 harness
  // used), no schedule rows at all: the bracket binds anyway —
  // the fallback's first-entry shelter never applies here.
  const staff = await addTeamMember(business, owner.id, 'clk-strict@example.com', { setActive: true });
  const refused = await login(staff.email, staff.password);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, 'staff_outside_window');
  assert.equal(refused.json.next_shift_start, null);
});
