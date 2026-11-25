/**
 * T67 — the clock tick split + the staff-documents self-door
 * (the owner's rulings, Nov 23, 2026; built Nov 24, 2026):
 *   (a) the ONE tick staff.clock (release 339) is TWO ticks now:
 *       staff.clockBoard (the team clock board + missed
 *       clock-outs + time fixes) and staff.callins (the call-in
 *       windows). Each works alone: a board-only manager is
 *       refused at the call-in doors with the call-ins wording,
 *       a call-ins-only manager is refused at the time-fix door
 *       with the board wording, and the workforce context
 *       carries the two booleans separately;
 *   (b) the missed-clock-out bell rings for board holders, not
 *       for call-ins-only managers;
 *   (c) the conversion: a stored staff.clock grant becomes
 *       BOTH new ticks (member rows and role presets alike),
 *       by execution of the boot sweep, and the sweep is
 *       idempotent;
 *   (d) the self-door: the person a staff document is ABOUT
 *       opens their OWN file read-only (list + bytes) with no
 *       tick at all; a colleague's document under their own
 *       stem is a plain 404; every write road stays shut (the
 *       admin stem still 403s the subject, and no /mine write
 *       route exists); a person with no staff row gets the 404;
 *       the ticked manager's admin road is unchanged.
 *
 * Real Express app over HTTP against pg-mem, same as every
 * phase; fixtures follow the t37/t38 harness patterns.
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
  setEntitlement,
} from './helpers.js';
import { convertLegacyClockTicks } from '../../server/clockAdmin.js';
import { zonedTimeToUtc } from '../../server/staffWindow.js';

after(close);
beforeEach(() => resetRateLimits());

const WF = (bid) => `/api/businesses/${bid}/workforce`;
const DOCS = (bid) => `/api/businesses/${bid}/staff-documents`;
const txt = (text) => `data:text/plain;base64,${Buffer.from(text).toString('base64')}`;

const BOARD_MSG = 'Only the owner, or a manager the owner has trusted with the clock board and missed clock-outs, can do that.';
const CALLIN_MSG = 'Only the owner, or a manager the owner has trusted with call-ins, can do that.';

async function addTeamMember(business, ownerId, email, { manager = false, name, permissions = [] } = {}) {
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
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [business.id, account.user.id]);
  // An all-week shift so the member's own sessions pass the
  // sign-in bracket — the doors are what these tests judge.
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, '00:00', '23:59')
       ON CONFLICT (business_id, staff_member_id, weekday) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
      [crypto.randomUUID(), business.id, id, weekday],
    );
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
function localDateStr(tz) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

async function setup(tz, emailPrefix) {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness(`${emailPrefix}@example.com`);
  if (tz) await pool.query('UPDATE businesses SET timezone = $1 WHERE id = $2', [tz, business.id]);
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

/** A staff member whose shift ended an hour ago, still clocked in. */
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

const freshCookie = async (m) => cookieFrom((await login(m.email, m.password)).setCookie);

// ---- (a) the split gates ------------------------------------------------------

test('board-only manager: call-in doors refuse with the call-ins wording; the board doors open; context splits', async () => {
  const f = await missedFixture('split-board');
  const boardMgr = await addTeamMember(f.business, f.owner.id, 'split-board-mgr@example.com', {
    manager: true, name: 'Bea Board', permissions: ['staff.clockBoard'],
  });
  const cookie = await freshCookie(boardMgr);

  const listTry = await req(`${WF(f.business.id)}/call-in`, { cookie });
  assert.equal(listTry.status, 403);
  assert.equal(listTry.json.error, 'clock_admin_not_granted');
  assert.equal(listTry.json.message, CALLIN_MSG);
  const openTry = await req(`${WF(f.business.id)}/call-in/${f.staff.staffId}`, { method: 'POST', body: {}, cookie });
  assert.equal(openTry.status, 403);
  assert.equal(openTry.json.error, 'clock_admin_not_granted');
  assert.equal(openTry.json.message, CALLIN_MSG);

  const ctx = await req(`${WF(f.business.id)}/context`, { cookie });
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.clock_board_admin, true);
  assert.equal(ctx.json.call_in_admin, false);
  assert.ok(!('clock_admin' in ctx.json), 'the old combined boolean is gone');

  const wall = (mins) => `${f.dateStr}T${hhmm(mins)}`;
  const fix = await req(`${WF(f.business.id)}/entries/${f.entryId}`, {
    method: 'PATCH', cookie, body: { clock_out_at: wall(f.endMins) },
  });
  assert.equal(fix.status, 200, 'the board tick alone carries the time-fix door');
});

test('call-ins-only manager: call-in doors open; the time-fix door refuses with the board wording; context splits', async () => {
  const f = await missedFixture('split-callin');
  const callMgr = await addTeamMember(f.business, f.owner.id, 'split-callin-mgr@example.com', {
    manager: true, name: 'Cal Callins', permissions: ['staff.callins'],
  });
  const cookie = await freshCookie(callMgr);

  const opened = await req(`${WF(f.business.id)}/call-in/${f.staff.staffId}`, { method: 'POST', body: {}, cookie });
  assert.equal(opened.status, 201, 'the call-ins tick alone opens a window');
  const list = await req(`${WF(f.business.id)}/call-in`, { cookie });
  assert.equal(list.status, 200);
  assert.equal(list.json.windows.length, 1);

  const wall = (mins) => `${f.dateStr}T${hhmm(mins)}`;
  const fixTry = await req(`${WF(f.business.id)}/entries/${f.entryId}`, {
    method: 'PATCH', cookie, body: { clock_out_at: wall(f.endMins) },
  });
  assert.equal(fixTry.status, 403);
  assert.equal(fixTry.json.error, 'clock_admin_not_granted');
  assert.equal(fixTry.json.message, BOARD_MSG);

  const ctx = await req(`${WF(f.business.id)}/context`, { cookie });
  assert.equal(ctx.json.clock_board_admin, false);
  assert.equal(ctx.json.call_in_admin, true);
});

test('neither-tick manager: both doors refuse; plain staff too', async () => {
  const f = await missedFixture('split-none');
  const plainMgr = await addTeamMember(f.business, f.owner.id, 'split-none-mgr@example.com', { manager: true });
  const cookie = await freshCookie(plainMgr);
  const listTry = await req(`${WF(f.business.id)}/call-in`, { cookie });
  assert.equal(listTry.status, 403);
  assert.equal(listTry.json.message, CALLIN_MSG);
  const wall = (mins) => `${f.dateStr}T${hhmm(mins)}`;
  const fixTry = await req(`${WF(f.business.id)}/entries/${f.entryId}`, {
    method: 'PATCH', cookie, body: { clock_out_at: wall(f.endMins) },
  });
  assert.equal(fixTry.status, 403);
  assert.equal(fixTry.json.message, BOARD_MSG);
  const ctx = await req(`${WF(f.business.id)}/context`, { cookie });
  assert.equal(ctx.json.clock_board_admin, false);
  assert.equal(ctx.json.call_in_admin, false);
});

// ---- (b) the bell follows the board tick --------------------------------------

test('the missed clock-out bell rings for the owner and board holders — never for call-ins-only managers', async () => {
  const f = await missedFixture('split-bell');
  const boardMgr = await addTeamMember(f.business, f.owner.id, 'split-bell-board@example.com', {
    manager: true, name: 'Bea Board', permissions: ['staff.clockBoard'],
  });
  const callMgr = await addTeamMember(f.business, f.owner.id, 'split-bell-call@example.com', {
    manager: true, name: 'Cal Callins', permissions: ['staff.callins'],
  });
  const boardCookie = await freshCookie(boardMgr);

  const entries = await req(`${WF(f.business.id)}/entries`, { cookie: boardCookie });
  assert.equal(entries.status, 200);
  const row = entries.json.entries.find((e) => e.id === f.entryId);
  assert.ok(row?.missed_clock_out, 'the board holder sees the flag on their own read');

  const bells = await pool.query(
    `SELECT recipient_user_id FROM workforce_notifications
      WHERE business_id = $1 AND event = 'missed_clock_out' AND entry_id = $2`,
    [f.business.id, f.entryId],
  );
  const recipients = new Set(bells.rows.map((r) => r.recipient_user_id));
  assert.ok(recipients.has(f.owner.id), 'the owner is belled');
  assert.ok(recipients.has(boardMgr.user.id), 'the board holder is belled');
  assert.ok(!recipients.has(callMgr.user.id), 'the call-ins-only manager is NOT belled');
});

// ---- (c) the conversion --------------------------------------------------------

test('the conversion: a stored staff.clock grant becomes BOTH ticks, on members and role presets; idempotent', async () => {
  const { business, owner } = await setup(null, 'split-convert');
  const memberId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, 'Legacy Larry', 'split-convert-larry@example.com', 'user', 'preset-manager', 'Manager', $3, 'active', $4)`,
    [memberId, business.id, JSON.stringify(['staff.roster', 'staff.clock']), owner.id],
  );
  const roleId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_roles (id, business_id, name, permissions, created_by_id)
     VALUES ($1, $2, 'Legacy role', $3, $4)`,
    [roleId, business.id, JSON.stringify(['staff.clock']), owner.id],
  );
  const cleanId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, 'Clean Clara', 'split-convert-clara@example.com', 'user', 'preset-sales', 'Sales clerk', $3, 'active', $4)`,
    [cleanId, business.id, JSON.stringify(['staff.roster']), owner.id],
  );

  const converted = await convertLegacyClockTicks(pool);
  assert.equal(converted, 2, 'exactly the two legacy rows convert');

  const member = await pool.query('SELECT permissions FROM staff_members WHERE id = $1', [memberId]);
  assert.deepEqual(JSON.parse(member.rows[0].permissions), ['staff.roster', 'staff.clockBoard', 'staff.callins']);
  const role = await pool.query('SELECT permissions FROM staff_roles WHERE id = $1', [roleId]);
  assert.deepEqual(JSON.parse(role.rows[0].permissions), ['staff.clockBoard', 'staff.callins']);
  const clean = await pool.query('SELECT permissions FROM staff_members WHERE id = $1', [cleanId]);
  assert.deepEqual(JSON.parse(clean.rows[0].permissions), ['staff.roster'], 'rows without the old tick are untouched');

  const again = await convertLegacyClockTicks(pool);
  assert.equal(again, 0, 'the sweep is idempotent');
});

// ---- (d) the self-door ----------------------------------------------------------

test('the self-door: own file opens read-only, a colleague’s file is a 404, every write road stays shut', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('selfdoor-owner@example.com');
  await setEntitlement(business.id, { plan: 'essentials', status: 'active' });
  const bid = business.id;
  const sam = await addTeamMember(business, owner.id, 'selfdoor-sam@example.com', { name: 'Sam Subject' });
  const pat = await addTeamMember(business, owner.id, 'selfdoor-pat@example.com', { name: 'Pat Peer' });
  const tina = await addTeamMember(business, owner.id, 'selfdoor-tina@example.com', {
    manager: true, name: 'Tina Ticked', permissions: ['staff.documents'],
  });

  const upSam = await req(`${DOCS(bid)}/${sam.staffId}`, {
    method: 'POST', cookie: ownerCookie,
    body: { title: 'W-4', filename: 'w4.txt', dataUrl: txt('SAM-W4-BYTES') },
  });
  assert.equal(upSam.status, 201, upSam.text);
  const samDocId = upSam.json.documents[0].id;
  const upPat = await req(`${DOCS(bid)}/${pat.staffId}`, {
    method: 'POST', cookie: ownerCookie,
    body: { title: 'ID copy', filename: 'id.txt', dataUrl: txt('PAT-ID-BYTES') },
  });
  assert.equal(upPat.status, 201, upPat.text);
  const patDocId = upPat.json.documents[0].id;

  // Sam holds NO tick at all — the self-door is not the tick.
  const mine = await req(`${DOCS(bid)}/mine`, { cookie: sam.cookie });
  assert.equal(mine.status, 200, mine.text);
  assert.equal(mine.json.documents.length, 1, 'only Sam’s own documents are listed');
  assert.equal(mine.json.documents[0].id, samDocId);
  assert.ok(!('email' in mine.json.documents[0]), 'names, never emails');

  const own = await req(`${DOCS(bid)}/mine/${samDocId}/file`, { cookie: sam.cookie });
  assert.equal(own.status, 200);
  assert.equal(own.text, 'SAM-W4-BYTES', 'the own file opens with its bytes (view / download / print ride this door)');

  const peers = await req(`${DOCS(bid)}/mine/${patDocId}/file`, { cookie: sam.cookie });
  assert.equal(peers.status, 404, 'a colleague’s document under the self stem is a plain 404 — it does not exist for Sam');

  // No write road: the admin stem still refuses the subject,
  // and the self stem has no write routes at all.
  const postOwn = await req(`${DOCS(bid)}/${sam.staffId}`, {
    method: 'POST', cookie: sam.cookie,
    body: { title: 'Forged', filename: 'forged.txt', dataUrl: txt('FORGED') },
  });
  assert.equal(postOwn.status, 403, 'the subject cannot upload into their own file');
  const delOwn = await req(`${DOCS(bid)}/${sam.staffId}/${samDocId}`, { method: 'DELETE', cookie: sam.cookie });
  assert.equal(delOwn.status, 403, 'the subject cannot delete from their own file');
  const readAdmin = await req(`${DOCS(bid)}/${sam.staffId}`, { cookie: sam.cookie });
  assert.equal(readAdmin.status, 403, 'the admin stem still refuses the subject — the self-door is the only road');
  const postMine = await req(`${DOCS(bid)}/mine`, {
    method: 'POST', cookie: sam.cookie,
    body: { title: 'Forged', filename: 'forged.txt', dataUrl: txt('FORGED') },
  });
  assert.ok([403, 404, 405].includes(postMine.status), 'no write route exists under /mine — the stem refuses (it lands on the admin door as an unknown member and 403s, or 404s); the count below is the proof nothing was written');
  const after = await req(`${DOCS(bid)}/mine`, { cookie: sam.cookie });
  assert.equal(after.json.documents.length, 1, 'nothing was written by any refused road');

  // A person with no staff row in the business gets the 404.
  const ownerMine = await req(`${DOCS(bid)}/mine`, { cookie: ownerCookie });
  assert.equal(ownerMine.status, 404, 'the owner has no staff row — no self file');

  // The ticked manager's admin road is unchanged by the self-door.
  const tinaList = await req(`${DOCS(bid)}/${sam.staffId}`, { cookie: tina.cookie });
  assert.equal(tinaList.status, 200);
  assert.equal(tinaList.json.documents.length, 1);
});
