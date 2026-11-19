/**
 * The Nov 19, 2026 staff batch — server proofs:
 *   - the shift window at sign-in (staff AND manager refused
 *     before their window, allowed inside it; no shift that day
 *     = refused; the owner is never refused);
 *   - per-request enforcement: a live session dies outside its
 *     window;
 *   - clock-out starts the 10-minute grace (shortened here via
 *     STAFF_AUTO_LOGOUT_MS), the session dies at the deadline,
 *     and clocking back in cancels it;
 *   - the welcome is pending for a new hire (any role) until
 *     marked seen, and never for the owner;
 *   - enrollment grants: a granted Settings section's endpoint
 *     authorizes by grant (tax rate saves), ungranted writes get
 *     the owner 403, a staff member's edit-name tick stays inert,
 *     a manager's works;
 *   - the neutral stop: billing-lock errors carry the neutral
 *     message to non-owners and the full reason to the owner.
 *
 * Real Express app over HTTP against pg-mem, same as every phase.
 * Shift scenarios use the same timezone trick as workforce.test.js:
 * pick a zone whose local time is mid-morning/mid-afternoon so
 * windows are expressible relative to the local clock.
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
  login,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

const WF = (bid) => `/api/businesses/${bid}/workforce`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function addTeamMember(business, ownerId, email, { manager = false, stock = false, name, permissions = [] } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, $7, 'active', $8)`,
    [
      id,
      business.id,
      name || (manager ? 'Manny Manager' : stock ? 'Stu Stock' : 'Sam Staff'),
      email,
      manager ? 'preset-manager' : stock ? 'preset-stock' : 'preset-sales',
      manager ? 'Manager' : stock ? 'Stock clerk' : 'Sales clerk',
      JSON.stringify(permissions),
      ownerId,
    ],
  );
  const account = await registerVerifiedUser(email);
  // A returning member's active business is the shop they work in.
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [business.id, account.user.id]);
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

// ---- The sign-in window -----------------------------------------------------

test('sign-in window: staff refused before the window with the next start named, allowed inside it', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'win-staff-owner');
  const staff = await addTeamMember(business, owner.id, 'win-staff@example.com');
  const { weekday, minutes } = localNow(tz);
  // Today's shift starts two hours from now: the door is shut.
  await setShift(business.id, staff.staffId, weekday, minutes + 120, minutes + 300);

  const refused = await login(staff.email, staff.password);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, 'staff_outside_window');
  assert.ok(refused.json.next_shift_start, 'the refusal names the next shift start');

  // Move the shift so it started 30 minutes ago: the door is open.
  await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 120);
  const allowed = await login(staff.email, staff.password);
  assert.equal(allowed.status, 200);
});

test('sign-in window: no shift today = refused; the owner is never refused', async () => {
  const tz = pickTimezone();
  const { business, owner, ownerCookie } = await setup(tz, 'win-noshift-owner');
  const staff = await addTeamMember(business, owner.id, 'win-noshift@example.com');
  // No schedule rows at all.
  const refused = await login(staff.email, staff.password);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, 'staff_outside_window');
  assert.equal(refused.json.next_shift_start, null);

  const ownerLogin = await login(owner.email, 'CorrectHorse123');
  assert.equal(ownerLogin.status, 200, 'the owner stands outside the bracket');
  assert.ok(ownerCookie);
});

test('sign-in window: a manager is bracketed by the owner-posted schedule the same way', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'win-mgr-owner');
  const manager = await addTeamMember(business, owner.id, 'win-mgr@example.com', { manager: true });
  const { weekday, minutes } = localNow(tz);
  await setShift(business.id, manager.staffId, weekday, minutes + 90, minutes + 240);
  const refused = await login(manager.email, manager.password);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, 'staff_outside_window');

  await setShift(business.id, manager.staffId, weekday, minutes - 15, minutes + 120);
  const allowed = await login(manager.email, manager.password);
  assert.equal(allowed.status, 200);
});

test('live session: a session used outside its window is refused and revoked', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'win-live-owner');
  const staff = await addTeamMember(business, owner.id, 'win-live@example.com');
  const { weekday, minutes } = localNow(tz);
  await setShift(business.id, staff.staffId, weekday, minutes + 120, minutes + 300);
  // The registration session predates the bracket (sessions minted
  // at registration are not window-checked); the first real request
  // outside the window must be refused and the session revoked.
  const me = await req('/api/auth/me', { cookie: staff.cookie });
  assert.equal(me.status, 401);
  assert.equal(me.json.error, 'staff_outside_window');
  const again = await req('/api/auth/me', { cookie: staff.cookie });
  assert.equal(again.status, 401, 'the session row is gone — it stays dead');
});

// ---- Clock-out grace + auto-logout ------------------------------------------

test('clock-out grace: session lives inside the grace, dies at the deadline; clocking back in cancels', async () => {
  process.env.STAFF_AUTO_LOGOUT_MS = '1500';
  try {
    const tz = pickTimezone();
    const { business, owner } = await setup(tz, 'win-clock-owner');
    const staff = await addTeamMember(business, owner.id, 'win-clock@example.com');
    const { weekday, minutes } = localNow(tz);
    await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 180);

    const session = await login(staff.email, staff.password);
    assert.equal(session.status, 200);
    const { cookieFrom } = await import('./helpers.js');
    const cookie = cookieFrom(session.setCookie);

    const inRes = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
    assert.equal(inRes.status, 201);
    assert.equal(inRes.json.auto_logout_at, null);

    const outRes = await req(`${WF(business.id)}/clock/out`, { method: 'POST', body: { note: 'Done for today' }, cookie });
    assert.equal(outRes.status, 200);
    assert.ok(outRes.json.auto_logout_at, 'clock-out starts the grace deadline');

    // Inside the grace: still signed in, and /auth/me carries the deadline.
    const meGrace = await req('/api/auth/me', { cookie });
    assert.equal(meGrace.status, 200);
    assert.ok(meGrace.json.auto_logout_at, 'me carries the pending deadline');

    await sleep(1900);
    const meDead = await req('/api/auth/me', { cookie });
    assert.equal(meDead.status, 401, 'the session is over once the grace ends');
  } finally {
    delete process.env.STAFF_AUTO_LOGOUT_MS;
  }
});

test('clock-back-in cancels the pending auto-logout', async () => {
  process.env.STAFF_AUTO_LOGOUT_MS = '60000';
  try {
    const tz = pickTimezone();
    const { business, owner } = await setup(tz, 'win-cancel-owner');
    const staff = await addTeamMember(business, owner.id, 'win-cancel@example.com');
    const { weekday, minutes } = localNow(tz);
    await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 180);

    const session = await login(staff.email, staff.password);
    const { cookieFrom } = await import('./helpers.js');
    const cookie = cookieFrom(session.setCookie);
    await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
    const outRes = await req(`${WF(business.id)}/clock/out`, { method: 'POST', body: { note: 'Done for today' }, cookie });
    assert.ok(outRes.json.auto_logout_at);
    const backIn = await req(`${WF(business.id)}/clock/in`, { method: 'POST', body: {}, cookie });
    assert.equal(backIn.status, 201);
    assert.equal(backIn.json.auto_logout_at, null, 'clocking back in cancels the deadline');
    const { rows } = await pool.query('SELECT auto_logout_at FROM staff_members WHERE id = $1', [staff.staffId]);
    assert.equal(rows[0].auto_logout_at, null);
  } finally {
    delete process.env.STAFF_AUTO_LOGOUT_MS;
  }
});

// ---- The welcome --------------------------------------------------------------

test('welcome: pending for a new hire of any role until seen; never for the owner', async () => {
  const tz = pickTimezone();
  const { business, owner, ownerCookie } = await setup(tz, 'win-welcome-owner');
  const manager = await addTeamMember(business, owner.id, 'win-welcome-mgr@example.com', { manager: true });
  const { weekday, minutes } = localNow(tz);
  await setShift(business.id, manager.staffId, weekday, minutes - 30, minutes + 120);

  const me = await req('/api/auth/me', { cookie: manager.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.staff_welcome_pending, true);

  const seen = await req('/api/auth/staff-welcome/seen', { method: 'POST', body: {}, cookie: manager.cookie });
  assert.equal(seen.status, 200);
  const meAfter = await req('/api/auth/me', { cookie: manager.cookie });
  assert.equal(meAfter.json.staff_welcome_pending, false);

  const ownerMe = await req('/api/auth/me', { cookie: ownerCookie });
  assert.equal(ownerMe.json.staff_welcome_pending, false, 'the owner was not hired — no welcome');
});

// ---- Enrollment grants ---------------------------------------------------------

test('grants: a granted tax-rate section saves; ungranted writes are refused; billing fields are never grantable', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'win-grant-owner');
  const manager = await addTeamMember(business, owner.id, 'win-grant-mgr@example.com', {
    manager: true,
    permissions: ['settings.taxRate'],
  });
  // The window: give the manager a live shift so requests pass.
  const { weekday, minutes } = localNow(tz);
  await setShift(business.id, manager.staffId, weekday, minutes - 30, minutes + 120);

  const saved = await req(`/api/businesses/${business.id}`, {
    method: 'PATCH', body: { tax_rate: '8.25' }, cookie: manager.cookie,
  });
  assert.equal(saved.status, 200);
  assert.equal(Number(saved.json.tax_rate), 8.25);

  const refused = await req(`/api/businesses/${business.id}`, {
    method: 'PATCH', body: { gs1_prefix: '1234567' }, cookie: manager.cookie,
  });
  assert.equal(refused.status, 403, 'an ungranted field is refused');
  assert.match(refused.json.message, /Only the business owner/);

  const mixed = await req(`/api/businesses/${business.id}`, {
    method: 'PATCH', body: { tax_rate: '9', name: 'New Name' }, cookie: manager.cookie,
  });
  assert.equal(mixed.status, 403, 'a patch mixing a granted and an ungranted field is refused whole');
});

test('grants: the edit-name tick is inert for staff and works for a manager', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'win-name-owner');
  const { weekday, minutes } = localNow(tz);
  const staff = await addTeamMember(business, owner.id, 'win-name-staff@example.com', {
    permissions: ['settings.editName'],
  });
  const manager = await addTeamMember(business, owner.id, 'win-name-mgr@example.com', {
    manager: true,
    permissions: ['settings.editName'],
  });
  for (const member of [staff, manager]) {
    await setShift(business.id, member.staffId, weekday, minutes - 30, minutes + 120);
  }
  const staffTry = await req(`/api/businesses/${business.id}`, {
    method: 'PATCH', body: { name: 'Staff Rename' }, cookie: staff.cookie,
  });
  assert.equal(staffTry.status, 403, 'staff never get the pencil — the tick is inert for them');

  const mgrTry = await req(`/api/businesses/${business.id}`, {
    method: 'PATCH', body: { name: 'Manager Renamed Shop' }, cookie: manager.cookie,
  });
  assert.equal(mgrTry.status, 200);
  assert.equal(mgrTry.json.name, 'Manager Renamed Shop');
});

test('plan-limit refusals: neutral for a non-owner, full wording for the owner', async () => {
  const tz = pickTimezone();
  const { business, owner, ownerCookie } = await setup(tz, 'win-limit-owner');
  const staff = await addTeamMember(business, owner.id, 'win-limit@example.com', { stock: true });
  const { weekday, minutes } = localNow(tz);
  await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 120);

  // Fill the Essentials catalog to its cap as the owner.
  const fifty = Array.from({ length: 50 }, (_, i) => ({
    name: `Widget ${i + 1}`,
    sku: `W-${i + 1}`,
    price: 1,
    status: 'active',
  }));
  const bulk = await req(`/api/businesses/${business.id}/products`, {
    method: 'POST', body: { business_id: business.id, products: fifty }, cookie: ownerCookie,
  });
  assert.equal(bulk.status, 201, bulk.text);

  const { NEUTRAL_LIMIT_MESSAGE } = await import('../../server/plans.js');
  const staffTry = await req('/api/entities/Product', {
    method: 'POST',
    body: { business_id: business.id, name: 'One Too Many', sku: 'W-51', price: 1, status: 'active' },
    cookie: staff.cookie,
  });
  assert.equal(staffTry.status, 403, staffTry.text);
  assert.equal(staffTry.json.error, 'product_limit');
  assert.equal(staffTry.json.message, NEUTRAL_LIMIT_MESSAGE);
  // Neutral means: no plan named, no numbers, no upsell — generic words
  // like "limit" and "the business" are fine and expected.
  assert.doesNotMatch(staffTry.json.message, /Essentials|This plan includes|\d+ products|move to|upgrade/i);

  const ownerTry = await req('/api/entities/Product', {
    method: 'POST',
    body: { business_id: business.id, name: 'One Too Many', sku: 'W-52', price: 1, status: 'active' },
    cookie: ownerCookie,
  });
  assert.equal(ownerTry.status, 403);
  assert.match(ownerTry.json.message, /This plan includes 50 products/);
});

test('contact details: the address & phone tick is manager-only; business details no longer covers them', async () => {
  const tz = pickTimezone();
  const { business, owner } = await setup(tz, 'win-contact-owner');
  const { weekday, minutes } = localNow(tz);

  // A manager WITH the contact-details tick edits address + phone.
  const mgr = await addTeamMember(business, owner.id, 'win-contact-mgr@example.com', {
    manager: true,
    permissions: ['settings.contactDetails'],
  });
  await setShift(business.id, mgr.staffId, weekday, minutes - 30, minutes + 120);
  const mgrPatch = await req(`/api/businesses/${business.id}`, {
    method: 'PATCH',
    body: { address: '1 Main St\nSanta Fe, NM 87501', contact_phone: '(505) 555-0100' },
    cookie: mgr.cookie,
  });
  assert.equal(mgrPatch.status, 200, mgrPatch.text);
  assert.equal(mgrPatch.json.address, '1 Main St\nSanta Fe, NM 87501');
  assert.equal(mgrPatch.json.contact_phone, '(505) 555-0100');

  // A manager with ONLY the business-details tick can edit the
  // email but NOT the address (the fields split on Nov 19, 2026).
  const mgr2 = await addTeamMember(business, owner.id, 'win-contact-mgr2@example.com', {
    manager: true,
    name: 'Mary Manager',
    permissions: ['settings.businessDetails'],
  });
  await setShift(business.id, mgr2.staffId, weekday, minutes - 30, minutes + 120);
  const emailPatch = await req(`/api/businesses/${business.id}`, {
    method: 'PATCH',
    body: { contact_email: 'shop@example.com' },
    cookie: mgr2.cookie,
  });
  assert.equal(emailPatch.status, 200, emailPatch.text);
  const addressPatch = await req(`/api/businesses/${business.id}`, {
    method: 'PATCH',
    body: { address: '2 Other St' },
    cookie: mgr2.cookie,
  });
  assert.equal(addressPatch.status, 403, addressPatch.text);

  // A STAFF member's stored contact tick stays inert (staff
  // never edit the address or phone — owner ruling, Nov 19, 2026).
  const staff = await addTeamMember(business, owner.id, 'win-contact-staff@example.com', {
    permissions: ['settings.contactDetails'],
  });
  await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 120);
  const staffPatch = await req(`/api/businesses/${business.id}`, {
    method: 'PATCH',
    body: { contact_phone: '(505) 555-9999' },
    cookie: staff.cookie,
  });
  assert.equal(staffPatch.status, 403, staffPatch.text);
});

test('pay rates: a hiring manager sets them, a plain manager cannot, staff see only their own', async () => {
  const tz = pickTimezone();
  const { business, owner, ownerCookie } = await setup(tz, 'win-pay-owner');
  const { weekday, minutes } = localNow(tz);

  const staff = await addTeamMember(business, owner.id, 'win-pay-staff@example.com');
  await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 120);
  const profilesUrl = `/api/businesses/${business.id}/workforce/payroll/profiles`;
  const staffProfileUrl = `${profilesUrl}/${staff.staffId}`;

  // The owner sets the staff member's hourly rate.
  const ownerSet = await req(staffProfileUrl, {
    method: 'PUT', body: { pay_type: 'hourly', hourly_rate: 18.5, annual_salary: 0 }, cookie: ownerCookie,
  });
  assert.equal(ownerSet.status, 200, ownerSet.text);
  assert.equal(Number(ownerSet.json.profile.hourly_rate), 18.5);

  // A manager WITH the hiring permission (staff.manage) sees the
  // whole team's rates and can change them.
  const hiringMgr = await addTeamMember(business, owner.id, 'win-pay-hiring@example.com', {
    manager: true,
    name: 'Hattie Hiring',
    permissions: ['staff.manage'],
  });
  await setShift(business.id, hiringMgr.staffId, weekday, minutes - 30, minutes + 120);
  const mgrList = await req(profilesUrl, { cookie: hiringMgr.cookie });
  assert.equal(mgrList.status, 200, mgrList.text);
  assert.ok(mgrList.json.profiles.length >= 2, 'the hiring manager sees the team rates');
  const mgrSet = await req(staffProfileUrl, {
    method: 'PUT', body: { pay_type: 'hourly', hourly_rate: 19.25, annual_salary: 0 }, cookie: hiringMgr.cookie,
  });
  assert.equal(mgrSet.status, 200, mgrSet.text);
  assert.equal(Number(mgrSet.json.profile.hourly_rate), 19.25);

  // A second member can hold a different rate at the same time.
  const mgrOwnSet = await req(`${profilesUrl}/${hiringMgr.staffId}`, {
    method: 'PUT', body: { pay_type: 'salary', hourly_rate: 0, annual_salary: 52000 }, cookie: ownerCookie,
  });
  assert.equal(mgrOwnSet.status, 200, mgrOwnSet.text);

  // A manager WITHOUT the hiring permission cannot set rates and
  // sees only their own row.
  const plainMgr = await addTeamMember(business, owner.id, 'win-pay-plain@example.com', {
    manager: true,
    name: 'Paul Plain',
    permissions: [],
  });
  await setShift(business.id, plainMgr.staffId, weekday, minutes - 30, minutes + 120);
  const plainSet = await req(staffProfileUrl, {
    method: 'PUT', body: { pay_type: 'hourly', hourly_rate: 99, annual_salary: 0 }, cookie: plainMgr.cookie,
  });
  assert.equal(plainSet.status, 403, plainSet.text);
  assert.match(plainSet.json.message, /hiring permission/);
  const plainList = await req(profilesUrl, { cookie: plainMgr.cookie });
  assert.equal(plainList.status, 200, plainList.text);
  assert.ok(plainList.json.profiles.every((entry) => entry.person.id === plainMgr.staffId));

  // The staff member sees only their own rate — the one set
  // through the dialog's door agrees with the Payroll record.
  const staffList = await req(profilesUrl, { cookie: staff.cookie });
  assert.equal(staffList.status, 200, staffList.text);
  assert.equal(staffList.json.profiles.length, 1);
  assert.equal(Number(staffList.json.profiles[0].profile.hourly_rate), 19.25);
});

test('personal contact fields: stored on the record, visible only behind the hiring gate', async () => {
  const tz = pickTimezone();
  const { business, owner, ownerCookie } = await setup(tz, 'win-contact2-owner');
  const { weekday, minutes } = localNow(tz);

  // The owner enrolls a member WITH a home address and phone.
  const created = await req('/api/entities/StaffMember', {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      business_id: business.id,
      full_name: 'Casey Contact',
      email: 'win-contact2-staff@example.com',
      role_id: 'preset-sales',
      role_name: 'Sales clerk',
      personal_address: '22 Canyon Rd\nSanta Fe, NM 87501',
      personal_phone: '(505) 555-0117',
    },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.personal_address, '22 Canyon Rd\nSanta Fe, NM 87501');
  assert.equal(created.json.personal_phone, '(505) 555-0117');

  // The member's own doors never receive the values: their own
  // staff-record read has the keys REMOVED (not blanked).
  const staff = await addTeamMember(business, owner.id, 'win-contact2-other@example.com');
  await setShift(business.id, staff.staffId, weekday, minutes - 30, minutes + 120);
  const memberAccount = await registerVerifiedUser('win-contact2-staff@example.com');
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [business.id, memberAccount.user.id]);
  await pool.query(
    `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (business_id, staff_member_id, weekday) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
    [crypto.randomUUID(), business.id, created.json.id, weekday, hhmm(minutes - 30), hhmm(minutes + 120)],
  );
  const ownList = await req('/api/entities/StaffMember/query', {
    method: 'POST', body: { filter: { business_id: business.id } }, cookie: memberAccount.cookie,
  });
  assert.equal(ownList.status, 200, ownList.text);
  const ownRow = ownList.json.items.find((row) => row.id === created.json.id);
  assert.ok(ownRow, 'the member sees their own row');
  assert.ok(!('personal_address' in ownRow) && !('personal_phone' in ownRow), 'contact keys are absent from the member’s own read');

  // A manager without the hiring permission is stripped too;
  // one with it keeps the values.
  const plainMgr = await addTeamMember(business, owner.id, 'win-contact2-plain@example.com', {
    manager: true, name: 'Paul Plain', permissions: [],
  });
  await setShift(business.id, plainMgr.staffId, weekday, minutes - 30, minutes + 120);
  const plainGet = await req(`/api/entities/StaffMember/${created.json.id}`, { cookie: plainMgr.cookie });
  assert.equal(plainGet.status, 403, plainGet.text); // non-owners may only read their own row at all

  const hiringMgr = await addTeamMember(business, owner.id, 'win-contact2-hiring@example.com', {
    manager: true, name: 'Hattie Hiring', permissions: ['staff.manage'],
  });
  await setShift(business.id, hiringMgr.staffId, weekday, minutes - 30, minutes + 120);
  const hiringList = await req('/api/entities/StaffMember/query', {
    method: 'POST', body: { filter: { business_id: business.id } }, cookie: hiringMgr.cookie,
  });
  assert.equal(hiringList.status, 200, hiringList.text);
  // (The roster list still scopes a non-owner to their own row —
  // pre-existing read rule — but their own row KEEPS the contact
  // keys because they hold the hiring gate.)
  const hiringRow = hiringList.json.items.find((row) => row.id === hiringMgr.staffId);
  assert.ok(hiringRow && 'personal_address' in hiringRow, 'the hiring gate keeps the contact keys');

  // The owner edits the phone through the plain entity update.
  const patched = await req(`/api/entities/StaffMember/${created.json.id}`, {
    method: 'PATCH', body: { personal_phone: '(505) 555-0118' }, cookie: ownerCookie,
  });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(patched.json.personal_phone, '(505) 555-0118');
});

// ---- The neutral stop -----------------------------------------------------------

test('neutral stop: billing-lock errors are neutral for non-owners, full reason for the owner', async () => {
  const { graceReadOnlyError, subscriptionDeniedError } = await import('../../server/subscriptionAccess.js');
  const { NEUTRAL_STOP_MESSAGE } = await import('../../server/billing.js');
  const gate = { state: 'grace', business: { owner_id: 'owner-1' } };
  const ownerUser = { id: 'owner-1' };
  const staffUser = { id: 'staff-9' };
  const ownerErr = graceReadOnlyError(gate, ownerUser);
  assert.match(ownerErr.message, /subscription ended/);
  const staffErr = graceReadOnlyError(gate, staffUser);
  assert.equal(staffErr.message, NEUTRAL_STOP_MESSAGE);
  assert.doesNotMatch(staffErr.message, /subscription|payment|billing|cancel/i);
  const denied = subscriptionDeniedError(gate, staffUser);
  assert.equal(denied.message, NEUTRAL_STOP_MESSAGE);
  const deniedOwner = subscriptionDeniedError(gate, ownerUser);
  assert.match(deniedOwner.message, /active subscription/);
});
