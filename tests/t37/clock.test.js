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
 *   (e) release 363 (the owner's ruling, Nov 23, 2026, proven
 *       by her hand the same night): a called-in entry carries
 *       NO clock-out fence — she clocked in through a window at
 *       20:56 against a shift that ended at 18:00 and the out
 *       door refused her ("up to 10 minutes after your shift
 *       ends"), stranding the entry AND the window it was
 *       meant to close, under an instant Missed clock-out flag.
 *       Now: the called-in clock out at any time, that
 *       clock-out closes the window, a live called-in entry
 *       wears no missed flag, and a scheduled entry's fence is
 *       byte-identical.
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
    manager: true, name: 'Tina Ticked', permissions: ['staff.clockBoard', 'staff.callins'],
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
  assert.equal(listTry.json.message, 'Only the owner, or a manager the owner has trusted with call-ins, can do that.');
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
  assert.deepEqual(MODULE_BY_PERMISSION['staff.clockBoard'], ['workforce']);
  assert.deepEqual(MODULE_BY_PERMISSION['staff.callins'], ['workforce']);
  assert.deepEqual(LESSON_REQUIREMENTS['mgr-clock-callin'], ['staff.clockBoard', 'staff.callins']);
  assert.equal(TRAINING_LESSONS.length, 121, '120 since the barcode-pool build (Nov 25, 2026) added 1 (owner-barcode-pool, both plans, general heading); 119 since the training build (Nov 25, 2026) added 1 (owner-own-training, both plans, general heading); 118 since the age check build (Nov 25, 2026) added 1 (scanner-age-check, both plans); 117 since the prints build (Nov 25, 2026) added 1 (staff-record-prints, both plans); 116 since the paper-trail batch (release 378, Nov 25, 2026) added 1 (staff-log-book); 115 since the eBay storefront batch (release 362, Nov 23, 2026) added 1 (owner-ebay-connect); 114 since the restaurant operations batch (Nov 23, 2026) added 4 (owner-restaurant-ops, staff-restaurant-daily, mgr-restaurant-invoices, mgr-restaurant-reports); the catalog grew by exactly the one lesson in the clock build (100); the staff documents build (Nov 21, 2026) added two more (owner-staff-documents, mgr-staff-documents), for 102; the restaurant corner build (Nov 23, 2026) added five more, for 107; the cross-store messages build (Nov 23, 2026) added three more (one per track), for 110');
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
    manager: true, name: 'Tina Ticked', permissions: ['staff.clockBoard', 'staff.callins'],
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
    manager: true, name: 'Tina Ticked', permissions: ['staff.clockBoard', 'staff.callins'],
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
  assert.match(nav, /anyPerm: \['staff\.roster', 'staff\.clockBoard', 'staff\.callins', 'staff\.documents'\]/, 'the Staff nav item carries the clock alternative (and, since the staff documents build, the documents tick — the documents area lives on this page)');
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

// ---- (e) release 363: the called-in clock-out carries no fence ----------------

test('release 363: a called-in entry clocks out hours after the shift ended, wears no missed flag while open, and its clock-out closes the window', async () => {
  const tz = pickTimezone();
  const { ownerCookie, business, owner } = await setup(tz, 'clk-363-owner');
  const staff = await addTeamMember(business, owner.id, 'clk-363@example.com');
  const { weekday, minutes } = localNow(tz);
  // The owner's live shape (Nov 23, 2026): a shift exists on
  // paper for today and ended HOURS ago (hers: 10:00–18:00,
  // called in at 20:56). start stays a valid HH:MM because the
  // picked zone is at 08:00 at the earliest.
  await setShift(business.id, staff.staffId, weekday, minutes - 300, minutes - 180);

  const open = await req(`${WF(business.id)}/call-in/${staff.staffId}`, { method: 'POST', body: {}, cookie: ownerCookie });
  assert.equal(open.status, 201);

  const session = await login(staff.email, staff.password);
  assert.equal(session.status, 200, 'the open window admits sign-in after hours');
  const cookie = cookieFrom(session.setCookie);

  const inRes = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
  assert.equal(inRes.status, 201);
  assert.equal(inRes.json.entry.called_in, true, 'the entry began through the window');
  assert.equal(inRes.json.entry.unscheduled, false, 'a shift exists on paper today — the owner\u2019s exact shape');
  const entryId = inRes.json.entry.id;

  // While the called-in entry is still open it is NOT a missed
  // clock-out: no flag on the entries read (the owner's read
  // also runs the claim pass), no claim stamp, no bell.
  const entries = await req(`${WF(business.id)}/entries`, { cookie: ownerCookie });
  assert.equal(entries.status, 200);
  const row = entries.json.entries.find((e) => e.id === entryId);
  assert.equal(row.missed_clock_out, null, 'a live called-in entry wears no missed flag');
  const { rows: claimRows } = await pool.query('SELECT missed_flagged_at FROM time_entries WHERE id = $1', [entryId]);
  assert.equal(claimRows[0].missed_flagged_at, null, 'the claim ledger never stamps a called-in entry');
  const bells = await pool.query(
    `SELECT COUNT(*)::int AS n FROM workforce_notifications
      WHERE business_id = $1 AND event = 'missed_clock_out' AND entry_id = $2`,
    [business.id, entryId],
  );
  assert.equal(bells.rows[0].n, 0, 'no missed bell rings for a called-in entry');

  // The clock-out itself: three hours past the shift's end,
  // far beyond the scheduled fence's end + 10 — before this
  // release it was refused with clock_too_late, every time.
  const outRes = await req(`${WF(business.id)}/clock/out`, { method: 'POST', body: {}, cookie });
  assert.equal(outRes.status, 200, 'the called-in clock-out lands at any time');
  assert.ok(outRes.json.entry.clock_out_at, 'the entry is closed');
  assert.equal(outRes.json.entry.early_departure, false, 'a called-in entry is not measured against the shift at all');
  assert.ok(outRes.json.auto_logout_at, 'the usual grace follows');

  // And the clock-out closed the window, by the designed path.
  const listed = await req(`${WF(business.id)}/call-in`, { cookie: ownerCookie });
  assert.equal(listed.json.windows.length, 0, 'the window is closed on the owner\u2019s side');
  const { rows: winRows } = await pool.query(
    'SELECT closed_at, close_reason FROM call_in_windows WHERE business_id = $1 AND staff_member_id = $2',
    [business.id, staff.staffId],
  );
  assert.equal(winRows.length, 1);
  assert.ok(winRows[0].closed_at, 'the window row is stamped closed');
  assert.equal(winRows[0].close_reason, 'clock_out', 'closed by the clock-out, not by hand');
});

test('release 363: a called-in entry also clocks out BEFORE the scheduled shift, with no note demanded', async () => {
  const tz = pickTimezone();
  const { ownerCookie, business, owner } = await setup(tz, 'clk-363early-owner');
  const staff = await addTeamMember(business, owner.id, 'clk-363early@example.com');
  const { weekday, minutes } = localNow(tz);
  // Today's shift starts two hours from now; the window lets
  // the member in ahead of it, and "any time" runs both ways:
  // leaving again before the shift even begins is theirs to
  // do, without the early-departure note a scheduled entry
  // would owe (the note measures against the shift too).
  await setShift(business.id, staff.staffId, weekday, minutes + 120, minutes + 300);
  await req(`${WF(business.id)}/call-in/${staff.staffId}`, { method: 'POST', body: {}, cookie: ownerCookie });
  const session = await login(staff.email, staff.password);
  assert.equal(session.status, 200);
  const cookie = cookieFrom(session.setCookie);
  const inRes = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
  assert.equal(inRes.status, 201);
  assert.equal(inRes.json.entry.called_in, true);
  const outRes = await req(`${WF(business.id)}/clock/out`, { method: 'POST', body: {}, cookie });
  assert.equal(outRes.status, 200, 'no note is demanded of a called-in entry');
  assert.equal(outRes.json.entry.early_departure, false);
  const listed = await req(`${WF(business.id)}/call-in`, { cookie: ownerCookie });
  assert.equal(listed.json.windows.length, 0, 'the early clock-out closes the window too');
});

test('release 363: a scheduled (not called-in) entry is still refused after its fence — the fence is byte-identical', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'clk-363fence-owner');
  const staff = await addTeamMember(business, owner.id, 'clk-363fence@example.com');
  const { weekday, minutes } = localNow(tz);
  await setShift(business.id, staff.staffId, weekday, minutes - 180, minutes - 60);
  // An entry opened during the shift, planted directly (the
  // t7 shape): called_in is false, so nothing about its road
  // changes in this release.
  const entryId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO time_entries (id, business_id, staff_member_id, clock_in_at, unscheduled, called_in)
     VALUES ($1, $2, $3, $4, false, false)`,
    [entryId, business.id, staff.staffId, zonedTimeToUtc(localDateStr(tz), minutes - 180, tz).toISOString()],
  );
  const session = await login(staff.email, staff.password);
  assert.equal(session.status, 200, 'the open entry admits its owner');
  const cookie = cookieFrom(session.setCookie);
  const outRes = await req(`${WF(business.id)}/clock/out`, { method: 'POST', body: { note: 'stayed late' }, cookie });
  assert.equal(outRes.status, 400);
  assert.equal(outRes.json.error, 'clock_too_late');
  assert.equal(
    outRes.json.message,
    'You can clock out up to 10 minutes after your shift ends. Ask your manager or the owner for help with this entry.',
  );
  const { rows } = await pool.query('SELECT clock_out_at FROM time_entries WHERE id = $1', [entryId]);
  assert.equal(rows[0].clock_out_at, null, 'the refused entry stays open for the owner to correct');
});

test('release 363: the owner\u2019s manual Close window still works exactly as before', async () => {
  const tz = pickTimezone();
  const { ownerCookie, business, owner } = await setup(tz, 'clk-363close-owner');
  const staff = await addTeamMember(business, owner.id, 'clk-363close@example.com');
  const { weekday } = localNow(tz);
  await setShift(business.id, staff.staffId, (weekday + 1) % 7, 540, 1020); // tomorrow only — the bracket binds
  const open = await req(`${WF(business.id)}/call-in/${staff.staffId}`, { method: 'POST', body: {}, cookie: ownerCookie });
  assert.equal(open.status, 201);
  const admitted = await login(staff.email, staff.password);
  assert.equal(admitted.status, 200, 'the window admits while open');
  const closed = await req(`${WF(business.id)}/call-in/${staff.staffId}`, { method: 'DELETE', cookie: ownerCookie });
  assert.equal(closed.status, 200);
  assert.ok(closed.json.window.closed_at, 'the manual close stamps the window');
  assert.equal(closed.json.window.close_reason, 'closed_early', 'a hand close keeps its own reason');
  const shut = await login(staff.email, staff.password);
  assert.equal(shut.status, 403, 'after the manual close the door is shut again');
});
