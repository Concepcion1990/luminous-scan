/**
 * T3 — Profile photos + the owner's display name (owner rulings,
 * Nov 19, 2026, refined Nov 21).
 *
 * A photo shows beside each person's name in the header. A team
 * member's photo goes to the OWNER for approval and shows
 * NOWHERE until approved — not the header, not the Staff list,
 * not Messages. Approval is the owner's alone (no manager tick,
 * nobody approves their own). A declined CHANGE keeps the
 * original approved photo. The owner's own photo needs no
 * approval, and the owner's display name replaces the word
 * "Owner" everywhere, on both ends; "Owner" is the fallback
 * until a name is set.
 *
 * These tests pin the API contract: the approval gate at the
 * byte level (a pending photo is never served), the owner-only
 * decision routes, the decline-keeps-original rule, the live
 * owner name in Messages and context, and the purges.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  pool,
  req,
  reqRaw,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

const as = (who) => ({ cookie: who.cookie });

const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Invite a member, activate their account, full-week schedule. */
async function actor(owner, { email, roleId = 'preset-sales', roleName = 'Sales clerk' }) {
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
  return { ...account, memberId: row.id };
}

const base = (owner) => `/api/businesses/${owner.business.id}/profile-photos`;

async function submit(who, owner, dataUrl = PNG_A) {
  return req(`${base(owner)}/me`, { method: 'POST', ...as(who), body: { dataUrl } });
}

test('owner name: unset is null everywhere; set replaces "Owner"; member cannot set it', async () => {
  const owner = await ownerWithBusiness('pp-name-owner@example.com');
  const member = await actor(owner, { email: 'pp-name-member@example.com' });

  const fresh = await req(`${base(owner)}/summary`, { ...as(owner) });
  assert.equal(fresh.status, 200, fresh.text);
  assert.equal(fresh.json.owner_name, null);
  assert.equal(fresh.json.me_key, 'owner');
  assert.deepEqual(fresh.json.approved_keys, []);

  const memberTry = await req(`${base(owner)}/owner-name`, {
    method: 'PUT',
    ...as(member),
    body: { name: 'Sneaky' },
  });
  assert.equal(memberTry.status, 403, memberTry.text);
  assert.equal(memberTry.json.message, 'Only the business owner can set the owner name.');

  const tooLong = await req(`${base(owner)}/owner-name`, {
    method: 'PUT',
    ...as(owner),
    body: { name: 'x'.repeat(81) },
  });
  assert.equal(tooLong.status, 400, tooLong.text);
  assert.equal(tooLong.json.message, 'Keep your name to 80 characters or fewer.');

  const set = await req(`${base(owner)}/owner-name`, {
    method: 'PUT',
    ...as(owner),
    body: { name: '  Concepcion  ' },
  });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.json.owner_name, 'Concepcion');

  // The member's summary and the workforce context carry it too.
  const memberSummary = await req(`${base(owner)}/summary`, { ...as(member) });
  assert.equal(memberSummary.json.owner_name, 'Concepcion');
  assert.equal(memberSummary.json.me_key, member.memberId);
  const ctx = await req(`/api/businesses/${owner.business.id}/workforce/context`, { ...as(member) });
  assert.equal(ctx.json.owner_name, 'Concepcion');

  // Clearing returns the fallback.
  const cleared = await req(`${base(owner)}/owner-name`, {
    method: 'PUT',
    ...as(owner),
    body: { name: '   ' },
  });
  assert.equal(cleared.json.owner_name, null);
});

test('owner photo: approved the moment it is set, served to the whole business', async () => {
  const owner = await ownerWithBusiness('pp-owner-owner@example.com');
  const member = await actor(owner, { email: 'pp-owner-member@example.com' });

  const posted = await submit(owner, owner);
  assert.equal(posted.status, 200, posted.text);
  assert.equal(posted.json.has_approved, true);
  assert.equal(posted.json.has_pending, false);

  const summary = await req(`${base(owner)}/summary`, { ...as(member) });
  assert.deepEqual(summary.json.approved_keys, ['owner']);

  const file = await reqRaw(`${base(owner)}/owner/file`, { ...as(member) });
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /image\/png/);
  assert.ok(file.buffer.length > 0);

  // Nothing is ever waiting on the owner's own photo.
  const pending = await req(`${base(owner)}/pending`, { ...as(owner) });
  assert.deepEqual(pending.json.pending, []);
});

test('member photo: pending shows NOWHERE until the owner approves; then it serves', async () => {
  const owner = await ownerWithBusiness('pp-flow-owner@example.com');
  const member = await actor(owner, { email: 'pp-flow-member@example.com' });

  const posted = await submit(member, owner);
  assert.equal(posted.status, 200, posted.text);
  assert.equal(posted.json.has_pending, true);
  assert.equal(posted.json.has_approved, false);

  // Invisible: not in the approved set, and the bytes refuse.
  const summary = await req(`${base(owner)}/summary`, { ...as(owner) });
  assert.deepEqual(summary.json.approved_keys, []);
  const earlyFile = await reqRaw(`${base(owner)}/${member.memberId}/file`, { ...as(owner) });
  assert.equal(earlyFile.status, 404);
  const memberEarlyFile = await reqRaw(`${base(owner)}/${member.memberId}/file`, { ...as(member) });
  assert.equal(memberEarlyFile.status, 404);

  // The owner sees the waiting photo; the member can preview
  // their own submission but nobody else's waiting bytes.
  const queue = await req(`${base(owner)}/pending`, { ...as(owner) });
  assert.equal(queue.json.pending.length, 1);
  assert.equal(queue.json.pending[0].staff_id, member.memberId);
  const ownerPeek = await reqRaw(`${base(owner)}/${member.memberId}/pending-file`, { ...as(owner) });
  assert.equal(ownerPeek.status, 200);
  const memberPeek = await reqRaw(`${base(owner)}/${member.memberId}/pending-file`, { ...as(member) });
  assert.equal(memberPeek.status, 403);
  const ownPreview = await reqRaw(`${base(owner)}/me/pending-file`, { ...as(member) });
  assert.equal(ownPreview.status, 200);

  // The owner's bell rang.
  const bells = await pool.query(
    "SELECT COUNT(*)::int AS n FROM workforce_notifications WHERE business_id = $1 AND event = 'photo_submitted'",
    [owner.business.id],
  );
  assert.equal(bells.rows[0].n, 1);

  const approved = await req(`${base(owner)}/${member.memberId}/approve`, {
    method: 'POST',
    ...as(owner),
    body: {},
  });
  assert.equal(approved.status, 200, approved.text);

  const meAfter = await req(`${base(owner)}/me`, { ...as(member) });
  assert.equal(meAfter.json.has_approved, true);
  assert.equal(meAfter.json.decision, 'approved');
  const file = await reqRaw(`${base(owner)}/${member.memberId}/file`, { ...as(owner) });
  assert.equal(file.status, 200);
});

test('approval is owner-only: a manager cannot approve, and nobody approves their own', async () => {
  const owner = await ownerWithBusiness('pp-gate-owner@example.com');
  const manager = await actor(owner, {
    email: 'pp-gate-manager@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  const member = await actor(owner, { email: 'pp-gate-member@example.com' });
  await submit(member, owner);

  const managerTry = await req(`${base(owner)}/${member.memberId}/approve`, {
    method: 'POST',
    ...as(manager),
    body: {},
  });
  assert.equal(managerTry.status, 403, managerTry.text);
  assert.equal(managerTry.json.message, 'Only the business owner can approve team photos.');

  const selfTry = await req(`${base(owner)}/${member.memberId}/approve`, {
    method: 'POST',
    ...as(member),
    body: {},
  });
  assert.equal(selfTry.status, 403, selfTry.text);

  const managerQueue = await req(`${base(owner)}/pending`, { ...as(manager) });
  assert.equal(managerQueue.status, 403, managerQueue.text);

  // Still pending, still invisible.
  const me = await req(`${base(owner)}/me`, { ...as(member) });
  assert.equal(me.json.has_pending, true);
  assert.equal(me.json.has_approved, false);
});

test('declined first photo: nothing shows, and the person is told to choose another', async () => {
  const owner = await ownerWithBusiness('pp-dec1-owner@example.com');
  const member = await actor(owner, { email: 'pp-dec1-member@example.com' });
  await submit(member, owner);

  const declined = await req(`${base(owner)}/${member.memberId}/decline`, {
    method: 'POST',
    ...as(owner),
    body: {},
  });
  assert.equal(declined.status, 200, declined.text);

  const me = await req(`${base(owner)}/me`, { ...as(member) });
  assert.equal(me.json.has_approved, false);
  assert.equal(me.json.has_pending, false);
  assert.equal(me.json.decision, 'declined');
  assert.equal(me.json.decision_had_approved, false);

  const file = await reqRaw(`${base(owner)}/${member.memberId}/file`, { ...as(owner) });
  assert.equal(file.status, 404);
});

test('a declined CHANGE keeps the original approved photo in place', async () => {
  const owner = await ownerWithBusiness('pp-dec2-owner@example.com');
  const member = await actor(owner, { email: 'pp-dec2-member@example.com' });

  await submit(member, owner, PNG_A);
  await req(`${base(owner)}/${member.memberId}/approve`, { method: 'POST', ...as(owner), body: {} });
  const first = await reqRaw(`${base(owner)}/${member.memberId}/file`, { ...as(owner) });
  assert.equal(first.status, 200);
  const firstBytes = Buffer.from(first.buffer);

  await submit(member, owner, PNG_B);
  const midMe = await req(`${base(owner)}/me`, { ...as(member) });
  assert.equal(midMe.json.has_approved, true);
  assert.equal(midMe.json.has_pending, true);
  // While the change waits, the ORIGINAL still serves.
  const mid = await reqRaw(`${base(owner)}/${member.memberId}/file`, { ...as(owner) });
  assert.ok(Buffer.from(mid.buffer).equals(firstBytes));

  await req(`${base(owner)}/${member.memberId}/decline`, { method: 'POST', ...as(owner), body: {} });
  const me = await req(`${base(owner)}/me`, { ...as(member) });
  assert.equal(me.json.decision, 'declined');
  assert.equal(me.json.decision_had_approved, true);
  assert.equal(me.json.has_approved, true);
  const after = await reqRaw(`${base(owner)}/${member.memberId}/file`, { ...as(owner) });
  assert.ok(Buffer.from(after.buffer).equals(firstBytes));
});

test('messages: the owner participant carries the live name and the approved-photo flag', async () => {
  const owner = await ownerWithBusiness('pp-msg-owner@example.com');
  const member = await actor(owner, { email: 'pp-msg-member@example.com' });

  await req(`${base(owner)}/owner-name`, { method: 'PUT', ...as(owner), body: { name: 'Concepcion' } });

  const created = await req(`/api/businesses/${owner.business.id}/workforce/messages/threads`, {
    method: 'POST',
    ...as(member),
    body: { with_owner: true },
  });
  assert.equal(created.status, 201, created.text);
  const ownerPart = created.json.thread.participants.find((p) => p.key === 'owner');
  assert.equal(ownerPart.name, 'Concepcion');
  assert.equal(ownerPart.photo, false);

  // Owner photo approved → the flag turns on for the member too.
  await submit(owner, owner);
  const listed = await req(`/api/businesses/${owner.business.id}/workforce/messages/threads`, { ...as(member) });
  const ownerPart2 = listed.json.threads[0].participants.find((p) => p.key === 'owner');
  assert.equal(ownerPart2.photo, true);

  // The member's PENDING photo does not flag their participant.
  await submit(member, owner);
  const ownerView = await req(`/api/businesses/${owner.business.id}/workforce/messages/threads`, { ...as(owner) });
  const memberPart = ownerView.json.threads[0].participants.find((p) => p.key === member.memberId);
  assert.equal(memberPart.photo, false);
  await req(`${base(owner)}/${member.memberId}/approve`, { method: 'POST', ...as(owner), body: {} });
  const ownerView2 = await req(`/api/businesses/${owner.business.id}/workforce/messages/threads`, { ...as(owner) });
  const memberPart2 = ownerView2.json.threads[0].participants.find((p) => p.key === member.memberId);
  assert.equal(memberPart2.photo, true);
});

test('another business cannot read this business\'s photos or name', async () => {
  const ownerA = await ownerWithBusiness('pp-iso-a@example.com');
  const ownerB = await ownerWithBusiness('pp-iso-b@example.com');
  await submit(ownerA, ownerA);

  const file = await reqRaw(`${base(ownerA)}/owner/file`, { ...as(ownerB) });
  assert.equal(file.status, 403);
  const summary = await req(`${base(ownerA)}/summary`, { ...as(ownerB) });
  assert.equal(summary.status, 403);
});

test('removing a staff member purges their photo rows', async () => {
  const owner = await ownerWithBusiness('pp-purge-owner@example.com');
  const member = await actor(owner, { email: 'pp-purge-member@example.com' });
  await submit(member, owner);
  await req(`${base(owner)}/${member.memberId}/approve`, { method: 'POST', ...as(owner), body: {} });

  const before = await pool.query('SELECT COUNT(*)::int AS n FROM profile_photos WHERE business_id = $1', [
    owner.business.id,
  ]);
  assert.equal(before.rows[0].n, 1);

  const removed = await req(`/api/entities/StaffMember/${member.memberId}`, {
    method: 'DELETE',
    ...as(owner),
  });
  assert.equal(removed.status, 200, removed.text);
  const afterRows = await pool.query('SELECT COUNT(*)::int AS n FROM profile_photos WHERE business_id = $1', [
    owner.business.id,
  ]);
  assert.equal(afterRows.rows[0].n, 0);
});

test('a photo that is not an image is refused; a decision with nothing waiting is refused', async () => {
  const owner = await ownerWithBusiness('pp-bad-owner@example.com');
  const member = await actor(owner, { email: 'pp-bad-member@example.com' });

  const bad = await req(`${base(owner)}/me`, {
    method: 'POST',
    ...as(member),
    body: { dataUrl: 'data:text/plain;base64,aGVsbG8=' },
  });
  assert.equal(bad.status, 400, bad.text);
  assert.equal(bad.json.message, 'Send a PNG, JPG or WebP image under 25 MB.');

  const nothing = await req(`${base(owner)}/${member.memberId}/approve`, {
    method: 'POST',
    ...as(owner),
    body: {},
  });
  assert.equal(nothing.status, 404, nothing.text);
  assert.equal(nothing.json.message, 'That team member has no photo waiting for approval.');
});
