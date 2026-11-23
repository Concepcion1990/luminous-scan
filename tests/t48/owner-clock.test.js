/**
 * T48 — Release 351: the owner's Time clock card (Door 1).
 *
 * The owner's ruling (Nov 23, 2026): a caller with no staff
 * profile — the owner, most days — has no clock of their own,
 * so their Time clock view is the team's entries alone. The
 * worker furniture (the "ask the owner" notice, the shift line,
 * the clocked-in line, the clock/break buttons) must not render
 * for them.
 *
 * Her hard condition: what staff members see must not change.
 * These tests pin BOTH sides:
 *  - the no-staff-row status carries the EXPLICIT no_clock
 *    marker (the client keys on it alone, never on
 *    self_clock_enabled);
 *  - a staff row's status carries no_clock: false and the real
 *    self_clock_enabled in both of its states — off still
 *    refuses clock-in server-side, on still clocks in and out;
 *  - a manager (a staff row by construction) keeps the real
 *    card's status too.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
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

after(close);
beforeEach(() => resetRateLimits());

const WF = (bid) => `/api/businesses/${bid}/workforce`;

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
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [business.id, account.user.id]);
  return { staffId: id, email, cookie: account.cookie, user: account.user, password: account.password };
}

async function setShift(businessId, staffId, weekday, startMins, endMins) {
  await pool.query(
    `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (business_id, staff_member_id, weekday) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
    [crypto.randomUUID(), businessId, staffId, weekday, hhmm(startMins), hhmm(endMins)],
  );
}

test('owner status: the no-staff-row shape carries the explicit no_clock marker', async () => {
  const { cookie, business } = await ownerWithBusiness('t48-owner@example.com');
  const status = await req(`${WF(business.id)}/clock/status`, { cookie });
  assert.equal(status.status, 200, status.text);
  assert.equal(status.json.no_clock, true, 'the marker is explicit, not inferred');
  assert.equal(status.json.open_entry, null);
  assert.equal(status.json.open_break, null);
  assert.equal(status.json.today_shift, null);
  assert.equal(status.json.call_in_open, false);
  // The stand-in keeps its long-standing self-clock shape; the
  // client no longer reads it for this caller (pinned below).
  assert.equal(status.json.self_clock_enabled, false);
});

test('client wiring: the personal card keys on no_clock alone; the staff furniture stays whole', () => {
  const page = readFileSync(new URL('../../src/pages/Workforce.jsx', import.meta.url), 'utf8');
  assert.match(page, /const noClock = status\.no_clock === true;/, 'the client keys on the explicit marker');
  assert.doesNotMatch(page, /noClock\s*=\s*status\.self_clock_enabled/, 'owner-ness is never inferred from the self-clock setting');

  const personalAt = page.indexOf("{!noClock && (");
  const personalSectionAt = page.indexOf("<Section title={t('workforce.tab.clock')}>");
  const entriesSectionAt = page.indexOf("<Section title={t('workforce.entries.title')}>");
  assert.ok(personalAt > -1 && personalAt < personalSectionAt, 'the personal card is gated by the marker');
  assert.ok(entriesSectionAt > personalSectionAt, 'the entries list still follows the card');

  // The staff side of the card is untouched: the notice, the
  // disabled-when-off button, the call-in banner all still live
  // inside the personal card for callers with a staff row.
  const personal = page.slice(personalSectionAt, entriesSectionAt);
  assert.match(personal, /t\('workforce\.selfClockOff'\)/, 'the staff notice remains for staff');
  assert.match(personal, /disabled=\{busy \|\| selfOff\}/, 'the staff button still disables when self-clock is off');
  assert.match(personal, /status\.call_in_open/, 'the call-in banner remains for staff');
  assert.match(personal, /t\('workforce\.clockIn'\)/, 'the clock-in button remains for staff');
});

test('staff status: no_clock stays false in both self-clock states; off refuses, on clocks in and out', async () => {
  const tz = pickTimezone();
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('t48-staff-owner@example.com');
  await pool.query('UPDATE businesses SET timezone = $1 WHERE id = $2', [tz, business.id]);
  const staff = await addTeamMember(business, owner.id, 't48-staff@example.com');
  const manager = await addTeamMember(business, owner.id, 't48-manager@example.com', { manager: true });
  const { weekday, minutes } = localNow(tz);
  for (const member of [staff, manager]) {
    await setShift(business.id, member.staffId, weekday, Math.max(0, minutes - 30), Math.min(1439, minutes + 180));
  }
  const staffCookie = cookieFrom((await login(staff.email, staff.password)).setCookie);
  const managerCookie = cookieFrom((await login(manager.email, manager.password)).setCookie);

  // Self-clock ON (the default): the real card's status, and a
  // manager's row reads exactly the same way.
  const onStatus = await req(`${WF(business.id)}/clock/status`, { cookie: staffCookie });
  assert.equal(onStatus.status, 200, onStatus.text);
  assert.equal(onStatus.json.no_clock, false, 'a staff row is never marked no-clock');
  assert.equal(onStatus.json.self_clock_enabled, true);
  const mgrStatus = await req(`${WF(business.id)}/clock/status`, { cookie: managerCookie });
  assert.equal(mgrStatus.json.no_clock, false, 'a manager holds a staff row — the real card stays');
  assert.equal(mgrStatus.json.self_clock_enabled, true);

  // Self-clock OFF: the status still reports the real setting
  // (the staff notice + disabled button read it), the marker
  // stays false, and the server still refuses the clock-in.
  const offSave = await req(`${WF(business.id)}/settings`, {
    method: 'PATCH', body: { self_clock_enabled: false }, cookie: ownerCookie,
  });
  assert.equal(offSave.status, 200, offSave.text);
  const offStatus = await req(`${WF(business.id)}/clock/status`, { cookie: staffCookie });
  assert.equal(offStatus.json.no_clock, false);
  assert.equal(offStatus.json.self_clock_enabled, false, 'the staff side still sees the real off state');
  const refused = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie: staffCookie });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, 'self_clock_disabled');

  // Back ON: clock-in and clock-out work exactly as before.
  const onSave = await req(`${WF(business.id)}/settings`, {
    method: 'PATCH', body: { self_clock_enabled: true }, cookie: ownerCookie,
  });
  assert.equal(onSave.status, 200, onSave.text);
  const inRes = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie: staffCookie });
  assert.equal(inRes.status, 201, inRes.text);
  const liveStatus = await req(`${WF(business.id)}/clock/status`, { cookie: staffCookie });
  assert.equal(liveStatus.json.no_clock, false);
  assert.equal(liveStatus.json.open_entry?.id, inRes.json.entry.id, 'the open entry rides the staff status');
  const outRes = await req(`${WF(business.id)}/clock/out`, {
    method: 'POST', body: { note: 'Done for the day' }, cookie: staffCookie,
  });
  assert.equal(outRes.status, 200, outRes.text);
});
