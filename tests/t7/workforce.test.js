/**
 * Workforce phase — schedules + hierarchy, the time clock (windows,
 * breaks, emergency early departure), notifications, time-off
 * hierarchy, tasks, payroll math (overtime, tax config, salary),
 * stub push hierarchy, cash-up, and direct-deposit visibility.
 * Real Express app over HTTP against pg-mem, same as every phase.
 *
 * Clock scenarios run in a business timezone picked so its local
 * time is mid-morning/mid-afternoon right now — shift windows are
 * then expressible relative to the local clock without ever
 * crossing midnight.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

const WF = (bid) => `/api/businesses/${bid}/workforce`;

// ---- Fixtures -------------------------------------------------------------

/** Insert a trusted active staff row (created by the owner), then register its user. */
async function addTeamMember(business, ownerId, email, { manager = false, name } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, '[]', 'active', $7)`,
    [
      id,
      business.id,
      name || (manager ? 'Manny Manager' : 'Sam Staff'),
      email,
      manager ? 'preset-manager' : 'preset-sales',
      manager ? 'Manager' : 'Sales clerk',
      ownerId,
    ],
  );
  const account = await registerVerifiedUser(email);
  return { staffId: id, email, cookie: account.cookie, user: account.user };
}

async function setTimezone(businessId, tz) {
  await pool.query('UPDATE businesses SET timezone = $1 WHERE id = $2', [tz, businessId]);
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

async function setSchedule(cookie, bid, staffId, shifts) {
  return req(`${WF(bid)}/schedules/${staffId}`, { method: 'PUT', body: { shifts }, cookie });
}
async function clock(cookie, bid, action, body = {}) {
  return req(`${WF(bid)}/clock/${action}`, { method: 'POST', body, cookie });
}

// ---- Schedules + hierarchy --------------------------------------------------

test('schedule permissions: owner sets the manager\u2019s, manager sets staff\u2019s, staff set none', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('wf-sched@example.com');
  const manager = await addTeamMember(business, owner.id, 'wf-sched-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'wf-sched-staff@example.com');
  const shift = [{ weekday: 1, start_time: '09:00', end_time: '17:00' }];

  const byOwner = await setSchedule(ownerCookie, business.id, manager.staffId, shift);
  assert.equal(byOwner.status, 200);
  assert.equal(byOwner.json.schedules.length, 1);

  const managerOwn = await setSchedule(manager.cookie, business.id, manager.staffId, shift);
  assert.equal(managerOwn.status, 403, 'a manager cannot set their own schedule');

  const managerStaff = await setSchedule(manager.cookie, business.id, staff.staffId, shift);
  assert.equal(managerStaff.status, 200);

  const staffAttempt = await setSchedule(staff.cookie, business.id, staff.staffId, shift);
  assert.equal(staffAttempt.status, 403);

  // Staff read only their own schedule rows.
  const staffView = await req(`${WF(business.id)}/schedules`, { cookie: staff.cookie });
  assert.equal(staffView.status, 200);
  assert.ok(staffView.json.schedules.every((s) => s.staff_member_id === staff.staffId));
  assert.equal(staffView.json.schedules.length, 1);
});

// ---- Time clock ---------------------------------------------------------------

test('clock windows: too-early in refused, early out needs a note, too-late out refused', async () => {
  const tz = pickTimezone();
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('wf-clock@example.com');
  await setTimezone(business.id, tz);
  const { weekday, minutes } = localNow(tz);

  // Too-early: the shift starts an hour from now.
  const early = await addTeamMember(business, owner.id, 'wf-clock-early@example.com');
  await setSchedule(ownerCookie, business.id, early.staffId, [
    { weekday, start_time: hhmm(minutes + 60), end_time: hhmm(minutes + 240) },
  ]);
  const tooEarly = await clock(early.cookie, business.id, 'in');
  assert.equal(tooEarly.status, 400);
  assert.equal(tooEarly.json.error, 'clock_too_early');

  // In-progress shift: clock in, break out/in, then an early clock-out.
  const worker = await addTeamMember(business, owner.id, 'wf-clock-worker@example.com');
  await setSchedule(ownerCookie, business.id, worker.staffId, [
    { weekday, start_time: hhmm(minutes - 30), end_time: hhmm(minutes + 120) },
  ]);
  const inRes = await clock(worker.cookie, business.id, 'in');
  assert.equal(inRes.status, 201);
  assert.equal(inRes.json.entry.unscheduled, false);
  const again = await clock(worker.cookie, business.id, 'in');
  assert.equal(again.status, 400);
  assert.equal(again.json.error, 'already_clocked_in');

  const breakOutRes = await clock(worker.cookie, business.id, 'break-out', { break_type: 'lunch30' });
  assert.equal(breakOutRes.status, 201);
  const breakInRes = await clock(worker.cookie, business.id, 'break-in');
  assert.equal(breakInRes.status, 200);

  const noNote = await clock(worker.cookie, business.id, 'out');
  assert.equal(noNote.status, 400);
  assert.equal(noNote.json.error, 'note_required');
  const withNote = await clock(worker.cookie, business.id, 'out', { note: 'Family emergency - had to leave.' });
  assert.equal(withNote.status, 200);
  assert.equal(withNote.json.entry.early_departure, true);
  assert.match(withNote.json.entry.early_note, /Family emergency/);

  // Too-late: the shift ended an hour ago; clocking in is allowed,
  // clocking out is past the 10-minute window.
  const late = await addTeamMember(business, owner.id, 'wf-clock-late@example.com');
  await setSchedule(ownerCookie, business.id, late.staffId, [
    { weekday, start_time: hhmm(minutes - 180), end_time: hhmm(minutes - 60) },
  ]);
  const lateIn = await clock(late.cookie, business.id, 'in');
  assert.equal(lateIn.status, 201);
  const lateOut = await clock(late.cookie, business.id, 'out', { note: 'stayed late' });
  assert.equal(lateOut.status, 400);
  assert.equal(lateOut.json.error, 'clock_too_late');
});

test('unscheduled day: clocking works and is flagged; notifications reach owner + manager', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('wf-notify@example.com');
  const manager = await addTeamMember(business, owner.id, 'wf-notify-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'wf-notify-staff@example.com');

  const inRes = await clock(staff.cookie, business.id, 'in');
  assert.equal(inRes.status, 201);
  assert.equal(inRes.json.entry.unscheduled, true);
  const outRes = await clock(staff.cookie, business.id, 'out');
  assert.equal(outRes.status, 200);
  assert.equal(outRes.json.entry.early_departure, false);

  const ownerInbox = await req(`${WF(business.id)}/notifications`, { cookie: ownerCookie });
  assert.ok(ownerInbox.json.notifications.some((n) => n.event === 'clock_in' && /Sam Staff/.test(n.detail)));
  assert.ok(ownerInbox.json.notifications.some((n) => n.event === 'clock_out'));

  const managerInbox = await req(`${WF(business.id)}/notifications`, { cookie: manager.cookie });
  assert.ok(managerInbox.json.notifications.some((n) => n.event === 'clock_in'));

  // A manager's own clock event notifies the owner only — not the manager.
  const before = managerInbox.json.notifications.length;
  await clock(manager.cookie, business.id, 'in');
  await clock(manager.cookie, business.id, 'out');
  const managerInboxAfter = await req(`${WF(business.id)}/notifications`, { cookie: manager.cookie });
  assert.equal(managerInboxAfter.json.notifications.length, before);
  const ownerInboxAfter = await req(`${WF(business.id)}/notifications`, { cookie: ownerCookie });
  assert.ok(
    ownerInboxAfter.json.notifications.some((n) => n.event === 'clock_in' && /Manny Manager/.test(n.detail)),
  );
});

test('self-clock toggle off blocks clocking (owner setting)', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('wf-toggle@example.com');
  const staff = await addTeamMember(business, owner.id, 'wf-toggle-staff@example.com');
  const on = await clock(staff.cookie, business.id, 'in');
  assert.equal(on.status, 201);
  await clock(staff.cookie, business.id, 'out');

  const asStaff = await req(`${WF(business.id)}/settings`, {
    method: 'PATCH',
    body: { self_clock_enabled: false },
    cookie: staff.cookie,
  });
  assert.equal(asStaff.status, 403, 'staff cannot flip the switch');

  const off = await req(`${WF(business.id)}/settings`, {
    method: 'PATCH',
    body: { self_clock_enabled: false },
    cookie: ownerCookie,
  });
  assert.equal(off.status, 200);
  const blocked = await clock(staff.cookie, business.id, 'in');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error, 'self_clock_disabled');
});

// ---- Time off -------------------------------------------------------------------

test('time-off hierarchy: manager decides staff, only the owner decides the manager\u2019s', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('wf-off@example.com');
  const manager = await addTeamMember(business, owner.id, 'wf-off-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'wf-off-staff@example.com');

  const staffReq = await req(`${WF(business.id)}/time-off`, {
    method: 'POST',
    body: { start_date: '2026-12-24', end_date: '2026-12-26', reason: 'Family' },
    cookie: staff.cookie,
  });
  assert.equal(staffReq.status, 201);
  const decided = await req(`${WF(business.id)}/time-off/${staffReq.json.request.id}`, {
    method: 'PATCH',
    body: { status: 'approved', decision_reason: 'Enjoy!' },
    cookie: manager.cookie,
  });
  assert.equal(decided.status, 200);
  assert.equal(decided.json.request.status, 'approved');

  // Declining without a reason is refused.
  const staffReq2 = await req(`${WF(business.id)}/time-off`, {
    method: 'POST',
    body: { start_date: '2026-12-01', end_date: '2026-12-01', reason: '' },
    cookie: staff.cookie,
  });
  const noReason = await req(`${WF(business.id)}/time-off/${staffReq2.json.request.id}`, {
    method: 'PATCH',
    body: { status: 'declined', decision_reason: '' },
    cookie: manager.cookie,
  });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.error, 'reason_required');

  // The manager's own request: neither they nor staff can decide it.
  const mgrReq = await req(`${WF(business.id)}/time-off`, {
    method: 'POST',
    body: { start_date: '2027-01-05', end_date: '2027-01-06', reason: 'Rest' },
    cookie: manager.cookie,
  });
  assert.equal(mgrReq.status, 201);
  const selfDecide = await req(`${WF(business.id)}/time-off/${mgrReq.json.request.id}`, {
    method: 'PATCH',
    body: { status: 'approved', decision_reason: 'ok' },
    cookie: manager.cookie,
  });
  assert.equal(selfDecide.status, 403);
  const staffDecide = await req(`${WF(business.id)}/time-off/${mgrReq.json.request.id}`, {
    method: 'PATCH',
    body: { status: 'approved', decision_reason: 'ok' },
    cookie: staff.cookie,
  });
  assert.equal(staffDecide.status, 403);
  const ownerDecide = await req(`${WF(business.id)}/time-off/${mgrReq.json.request.id}`, {
    method: 'PATCH',
    body: { status: 'declined', decision_reason: 'We are short that week.' },
    cookie: ownerCookie,
  });
  assert.equal(ownerDecide.status, 200);
  assert.equal(ownerDecide.json.request.decision_reason, 'We are short that week.');

  // The staff member sees the outcome and the reason on their own list.
  const staffList = await req(`${WF(business.id)}/time-off`, { cookie: staff.cookie });
  assert.ok(staffList.json.requests.every((r) => r.staff_member_id === staff.staffId));
});

// ---- Tasks -------------------------------------------------------------------------

test('tasks: manager assigns, staff completes, staff cannot assign', async () => {
  const { business, user: owner } = await ownerWithBusiness('wf-tasks@example.com');
  const manager = await addTeamMember(business, owner.id, 'wf-tasks-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'wf-tasks-staff@example.com');

  const created = await req(`${WF(business.id)}/tasks`, {
    method: 'POST',
    body: { staff_member_id: staff.staffId, title: 'Face the book wall', due_date: '2026-11-20' },
    cookie: manager.cookie,
  });
  assert.equal(created.status, 201);
  const byStaff = await req(`${WF(business.id)}/tasks`, {
    method: 'POST',
    body: { staff_member_id: staff.staffId, title: 'Nope' },
    cookie: staff.cookie,
  });
  assert.equal(byStaff.status, 403);

  const mine = await req(`${WF(business.id)}/tasks`, { cookie: staff.cookie });
  assert.equal(mine.json.tasks.length, 1);
  const done = await req(`${WF(business.id)}/tasks/${created.json.task.id}`, {
    method: 'PATCH',
    body: { status: 'done' },
    cookie: staff.cookie,
  });
  assert.equal(done.status, 200);
  assert.equal(done.json.task.status, 'done');
});

// ---- Payroll -------------------------------------------------------------------------

async function insertEntry(bid, staffId, inIso, outIso, breaks = []) {
  const entryId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO time_entries (id, business_id, staff_member_id, clock_in_at, clock_out_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [entryId, bid, staffId, inIso, outIso],
  );
  for (const brk of breaks) {
    await pool.query(
      `INSERT INTO time_breaks (id, entry_id, business_id, break_type, planned_minutes, out_at, in_at)
       VALUES ($1, $2, $3, 'lunch60', 60, $4, $5)`,
      [crypto.randomUUID(), entryId, bid, brk[0], brk[1]],
    );
  }
  return entryId;
}

test('payroll math: breaks unpaid, overtime over 40/week, tax config applied once', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('wf-pay@example.com');
  await setTimezone(business.id, 'UTC');
  const staff = await addTeamMember(business, owner.id, 'wf-pay-staff@example.com');

  // Mon Jan 5 – Fri Jan 9 2026, 09:00-18:00 with a 1h break = 8 paid h/day;
  // Sat Jan 10, 09:00-14:00, no break = 5 h. Week total 45 -> 40 regular + 5 OT.
  for (const day of ['05', '06', '07', '08', '09']) {
    await insertEntry(business.id, staff.staffId, `2026-01-${day}T09:00:00Z`, `2026-01-${day}T18:00:00Z`, [
      [`2026-01-${day}T12:00:00Z`, `2026-01-${day}T13:00:00Z`],
    ]);
  }
  await insertEntry(business.id, staff.staffId, '2026-01-10T09:00:00Z', '2026-01-10T14:00:00Z');

  const config = await req(`${WF(business.id)}/payroll/config`, {
    method: 'PUT',
    body: { federal_pct: 10, state_pct: 0, social_security_pct: 6.2, medicare_pct: 1.45, custom_deductions: [] },
    cookie: ownerCookie,
  });
  assert.equal(config.status, 200);

  const profile = await req(`${WF(business.id)}/payroll/profiles/${staff.staffId}`, {
    method: 'PUT',
    body: { pay_type: 'hourly', hourly_rate: 22 },
    cookie: ownerCookie,
  });
  assert.equal(profile.status, 200);

  const run = await req(`${WF(business.id)}/payroll/runs`, {
    method: 'POST',
    body: { period_start: '2026-01-04', period_end: '2026-01-10', adjustments: {} },
    cookie: ownerCookie,
  });
  assert.equal(run.status, 201);
  assert.equal(run.json.stubs.length, 1);
  const stub = run.json.stubs[0];
  assert.equal(stub.regular_hours, 40);
  assert.equal(stub.overtime_hours, 5);
  assert.equal(stub.gross, 1045); // 40*22 + 5*22*1.5
  // Deductions on 1045: federal 104.50, SS 64.79, Medicare 15.15, state 0.
  assert.equal(stub.total_deductions, 184.44);
  assert.equal(stub.net, 860.56);
  assert.equal(stub.pushed, false);
});

test('salary manager: period share of annual salary; stub push hierarchy', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('wf-salary@example.com');
  const manager = await addTeamMember(business, owner.id, 'wf-salary-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'wf-salary-staff@example.com');

  await req(`${WF(business.id)}/payroll/config`, {
    method: 'PUT',
    body: { federal_pct: 0, state_pct: 0, social_security_pct: 0, medicare_pct: 0, custom_deductions: [] },
    cookie: ownerCookie,
  });
  await req(`${WF(business.id)}/payroll/profiles/${manager.staffId}`, {
    method: 'PUT',
    body: { pay_type: 'salary', annual_salary: 52000 },
    cookie: ownerCookie,
  });
  await req(`${WF(business.id)}/payroll/profiles/${staff.staffId}`, {
    method: 'PUT',
    body: { pay_type: 'hourly', hourly_rate: 15 },
    cookie: ownerCookie,
  });

  // 14-day period: 52000 * 14 / 365 = 1994.52.
  const run = await req(`${WF(business.id)}/payroll/runs`, {
    method: 'POST',
    body: { period_start: '2026-01-04', period_end: '2026-01-17', adjustments: {} },
    cookie: ownerCookie,
  });
  assert.equal(run.status, 201);
  const mgrStub = run.json.stubs.find((s) => s.staff_member_id === manager.staffId);
  const staffStub = run.json.stubs.find((s) => s.staff_member_id === staff.staffId);
  assert.equal(mgrStub.pay_type, 'salary');
  assert.equal(mgrStub.gross, 1994.52);
  assert.equal(mgrStub.net, 1994.52);

  // Nothing is visible to staff until a stub is pushed.
  const before = await req(`${WF(business.id)}/payroll/my-stubs`, { cookie: staff.cookie });
  assert.equal(before.json.stubs.length, 0);

  // A manager can push a staff stub but never a manager's stub.
  const mgrPushOwn = await req(`${WF(business.id)}/payroll/stubs/${mgrStub.id}/push`, {
    method: 'POST',
    body: {},
    cookie: manager.cookie,
  });
  assert.equal(mgrPushOwn.status, 403);
  const mgrPushStaff = await req(`${WF(business.id)}/payroll/stubs/${staffStub.id}/push`, {
    method: 'POST',
    body: {},
    cookie: manager.cookie,
  });
  assert.equal(mgrPushStaff.status, 200);
  const ownerPushMgr = await req(`${WF(business.id)}/payroll/stubs/${mgrStub.id}/push`, {
    method: 'POST',
    body: {},
    cookie: ownerCookie,
  });
  assert.equal(ownerPushMgr.status, 200);

  const after = await req(`${WF(business.id)}/payroll/my-stubs`, { cookie: staff.cookie });
  assert.equal(after.json.stubs.length, 1);
  assert.equal(after.json.stubs[0].id, staffStub.id);
});

test('payroll context: the IRS box flag is owner-only; staff cannot read config', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('wf-irs@example.com');
  const manager = await addTeamMember(business, owner.id, 'wf-irs-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'wf-irs-staff@example.com');

  const ownerCtx = await req(`${WF(business.id)}/payroll/context`, { cookie: ownerCookie });
  assert.equal(ownerCtx.json.show_irs_box, true);
  const mgrCtx = await req(`${WF(business.id)}/payroll/context`, { cookie: manager.cookie });
  assert.equal(mgrCtx.json.show_irs_box, false);
  const staffCtx = await req(`${WF(business.id)}/payroll/context`, { cookie: staff.cookie });
  assert.equal(staffCtx.json.show_irs_box, false);

  const staffConfig = await req(`${WF(business.id)}/payroll/config`, { cookie: staff.cookie });
  assert.equal(staffConfig.status, 403);
  const staffRun = await req(`${WF(business.id)}/payroll/runs`, {
    method: 'POST',
    body: { period_start: '2026-01-04', period_end: '2026-01-10' },
    cookie: manager.cookie,
  });
  assert.equal(staffRun.status, 403, 'only the owner runs payroll');
});

// ---- Cash-up ---------------------------------------------------------------------------

test('cash-up: counted vs expected with denominations; staff locked out', async () => {
  const { business, user: owner } = await ownerWithBusiness('wf-cash@example.com');
  const manager = await addTeamMember(business, owner.id, 'wf-cash-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'wf-cash-staff@example.com');

  const saved = await req(`${WF(business.id)}/cash-ups`, {
    method: 'POST',
    body: {
      date: '2026-01-10',
      float_amount: 100,
      cash_sales: 250,
      cash_refunds: 10,
      payouts: 5,
      card_payments: 300,
      denominations: { 100: 2, 50: 1, 20: 4, 1: 5 },
    },
    cookie: manager.cookie,
  });
  assert.equal(saved.status, 201);
  // Counted 200+50+80+5 = 335; expected 100+250-10-5 = 335.
  assert.equal(saved.json.cash_up.counted_total, 335);
  assert.equal(saved.json.cash_up.expected_total, 335);
  assert.equal(saved.json.cash_up.over_short, 0);

  const short = await req(`${WF(business.id)}/cash-ups`, {
    method: 'POST',
    body: {
      date: '2026-01-11',
      float_amount: 100,
      cash_sales: 0,
      cash_refunds: 0,
      payouts: 0,
      card_payments: 0,
      denominations: { 50: 1, 20: 2, 1: 5 },
    },
    cookie: manager.cookie,
  });
  assert.equal(short.json.cash_up.over_short, -5);

  const staffAttempt = await req(`${WF(business.id)}/cash-ups`, {
    method: 'POST',
    body: { date: '2026-01-11', denominations: {} },
    cookie: staff.cookie,
  });
  assert.equal(staffAttempt.status, 403);
});

// ---- Direct deposit -----------------------------------------------------------------------

test('direct deposit: details submit to the owner only, masked everywhere else', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('wf-dd@example.com');
  const manager = await addTeamMember(business, owner.id, 'wf-dd-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'wf-dd-staff@example.com');

  await req(`${WF(business.id)}/settings`, {
    method: 'PATCH',
    body: { dd_enabled: true },
    cookie: ownerCookie,
  });
  const invite = await req(`${WF(business.id)}/dd/invite`, {
    method: 'POST',
    body: { staff_member_id: staff.staffId },
    cookie: ownerCookie,
  });
  assert.equal(invite.status, 201);

  const submit = await req(`${WF(business.id)}/dd/submit`, {
    method: 'POST',
    body: {
      bank_name: 'First Test Bank',
      account_type: 'checking',
      routing_number: '123456789',
      account_number: '987654321',
    },
    cookie: staff.cookie,
  });
  assert.equal(submit.status, 200);
  assert.equal(submit.json.account_masked, '****4321');
  assert.ok(!JSON.stringify(submit.json).includes('987654321'), 'submit response must not echo the full account number');

  // The staff member's own view is masked too.
  const mine = await req(`${WF(business.id)}/dd`, { cookie: staff.cookie });
  assert.equal(mine.json.mine.status, 'submitted');
  assert.ok(!JSON.stringify(mine.json).includes('987654321'));

  // The owner's team list is masked; only the single-row owner read is full.
  const ownerView = await req(`${WF(business.id)}/dd`, { cookie: ownerCookie });
  assert.ok(!JSON.stringify(ownerView.json).includes('987654321'));
  const full = await req(`${WF(business.id)}/dd/details/${staff.staffId}`, { cookie: ownerCookie });
  assert.equal(full.status, 200);
  assert.equal(full.json.details.account_number, '987654321');
  assert.equal(full.json.details.routing_number, '123456789');

  const mgrFull = await req(`${WF(business.id)}/dd/details/${staff.staffId}`, { cookie: manager.cookie });
  assert.equal(mgrFull.status, 403);
  const staffFull = await req(`${WF(business.id)}/dd/details/${staff.staffId}`, { cookie: staff.cookie });
  assert.equal(staffFull.status, 403);
});
