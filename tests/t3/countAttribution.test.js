/**
 * T3 — Count attribution names, never emails (owner's rider,
 * Nov 21, 2026).
 *
 * The counts board is shared with every staff member (release
 * 333), and its "Started by" line rendered the starter's EMAIL
 * whenever the client had no name for them — the owner's own
 * email included, visible to all staff. Her ruling: attribution
 * renders the person's DISPLAY NAME, never their email. For the
 * owner that is the owner display name (fallback "Owner"); for
 * a member, their staff name.
 *
 * The fix is server-side: writes are stamped with the actor's
 * display name whatever the client sends, and a NON-OWNER's
 * read of a legacy row (one stamped with an email before this
 * build) resolves the email to the person's name — or drops it
 * when it matches nobody. The owner's own payload is unshaped.
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

const as = (who) => ({ cookie: who.cookie });

/** Invite a member, activate their account, full-week schedule. */
async function actor(owner, { email, roleId = 'preset-stock', roleName = 'Stock clerk' }) {
  const invite = await req('/api/entities/StaffMember', {
    method: 'POST',
    ...as(owner),
    body: {
      business_id: owner.business.id,
      full_name: roleName,
      email,
      role_id: roleId,
      role_name: roleName,
    },
  });
  assert.equal(invite.status, 201, invite.text);
  const account = await registerVerifiedUser(email);
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [
    owner.business.id,
    account.user.id,
  ]);
  const row = (
    await pool.query('SELECT id FROM staff_members WHERE business_id = $1 AND email = $2', [
      owner.business.id,
      email,
    ])
  ).rows[0];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, '00:00', '23:59')`,
      [crypto.randomUUID(), owner.business.id, row.id, weekday],
    );
  }
  return { ...account, memberId: row.id, email };
}

const createCount = (who, owner, body = {}) =>
  req('/api/entities/CountSession', {
    method: 'POST',
    ...as(who),
    body: { business_id: owner.business.id, number: 'CNT-ATTR-1', status: 'open', lines: [], ...body },
  });

const listCounts = (who, owner) =>
  req('/api/entities/CountSession/query', {
    method: 'POST',
    ...as(who),
    body: { filter: { business_id: owner.business.id } },
  });

async function setOwnerName(owner, name) {
  const res = await req(`/api/businesses/${owner.business.id}/profile-photos/owner-name`, {
    method: 'PUT',
    ...as(owner),
    body: { name },
  });
  assert.equal(res.status, 200, res.text);
}

test('a count the owner starts is stamped with her display name — never her email', async () => {
  const owner = await ownerWithBusiness('attr-owner@example.com');
  await setOwnerName(owner, 'Concepcion');

  // The old client sent the email; the server stamps the name.
  const created = await createCount(owner, owner, { started_by: 'attr-owner@example.com' });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.started_by, 'Concepcion');

  const stored = await pool.query('SELECT started_by FROM count_sessions WHERE id = $1', [created.json.id]);
  assert.equal(stored.rows[0].started_by, 'Concepcion');
});

test('before the owner sets a name, her counts are stamped "Owner"', async () => {
  const owner = await ownerWithBusiness('attr-fallback@example.com');
  const created = await createCount(owner, owner, { started_by: 'attr-fallback@example.com' });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.started_by, 'Owner');
});

test('a count a member starts is stamped with their staff name', async () => {
  const owner = await ownerWithBusiness('attr-member-owner@example.com');
  const runner = await actor(owner, { email: 'attr-runner@example.com' });
  const created = await createCount(runner, owner, { started_by: 'attr-runner@example.com' });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.started_by, 'Stock clerk');
});

test('applying a count stamps applied_by with the applier\'s name', async () => {
  const owner = await ownerWithBusiness('attr-apply-owner@example.com');
  await setOwnerName(owner, 'Concepcion');
  const created = await createCount(owner, owner, {});
  assert.equal(created.status, 201, created.text);
  const applied = await req(`/api/entities/CountSession/${created.json.id}`, {
    method: 'PATCH',
    ...as(owner),
    body: { status: 'applied', applied_by: 'attr-apply-owner@example.com' },
  });
  assert.equal(applied.status, 200, applied.text);
  assert.equal(applied.json.applied_by, 'Concepcion');
});

test('legacy email rows: a staff viewer sees names, never an email; the owner sees the row as stored', async () => {
  const owner = await ownerWithBusiness('attr-legacy-owner@example.com');
  const clerk = await actor(owner, {
    email: 'attr-legacy-clerk@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });
  await setOwnerName(owner, 'Concepcion');

  // A pre-rider row, stamped the old way (emails), written
  // straight to the table the way the old client left it.
  const legacyId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO count_sessions (id, business_id, number, status, lines, started_by, applied_by)
     VALUES ($1, $2, 'CNT-LEGACY', 'applied', '[]', $3, $4)`,
    [legacyId, owner.business.id, 'attr-legacy-owner@example.com', 'attr-legacy-clerk@example.com'],
  );
  // An email that belongs to nobody in this business.
  const strangerId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO count_sessions (id, business_id, number, status, lines, started_by)
     VALUES ($1, $2, 'CNT-STRANGER', 'open', '[]', 'someone-else@outside.example')`,
    [strangerId, owner.business.id],
  );

  const staffList = await listCounts(clerk, owner);
  assert.equal(staffList.status, 200, staffList.text);
  const legacy = staffList.json.items.find((row) => row.id === legacyId);
  assert.equal(legacy.started_by, 'Concepcion');
  assert.equal(legacy.applied_by, 'Sales clerk');
  const stranger = staffList.json.items.find((row) => row.id === strangerId);
  assert.equal(stranger.started_by, '');
  for (const row of staffList.json.items) {
    assert.ok(!String(row.started_by || '').includes('@'), 'no email in started_by for staff');
    assert.ok(!String(row.applied_by || '').includes('@'), 'no email in applied_by for staff');
  }

  // The single-row read shapes the same way.
  const staffGet = await req(`/api/entities/CountSession/${legacyId}`, { ...as(clerk) });
  assert.equal(staffGet.status, 200, staffGet.text);
  assert.equal(staffGet.json.started_by, 'Concepcion');

  // The owner's own payload is the row exactly as stored.
  const ownerList = await listCounts(owner, owner);
  const ownerLegacy = ownerList.json.items.find((row) => row.id === legacyId);
  assert.equal(ownerLegacy.started_by, 'attr-legacy-owner@example.com');
  assert.equal(ownerLegacy.applied_by, 'attr-legacy-clerk@example.com');
});
