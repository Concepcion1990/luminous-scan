/**
 * T13 — Owner-sent staff password reset (Nov 14, 2026): the owner can
 * email a team member the standard password reset (link + 6-digit
 * code, 10 minutes, single use) at the member's current account
 * email. Gating mirrors the staff-email fix: the owner of THIS
 * business only, on EVERY plan (Essentials has staff too — ownership
 * is the gate, never the plan). The owner never sees the code.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  login,
  ownerWithBusiness,
  resetCodeFromMail,
  latestMailTo,
  mailbox,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

async function invite(cookie, businessId, email) {
  const res = await req(`/api/businesses/${businessId}/staff`, {
    method: 'POST',
    body: {
      business_id: businessId,
      member: {
        full_name: 'Team Member',
        email,
        role_id: 'preset-sales',
        role_name: 'Sales clerk',
        permissions: ['products.view', 'scan.use'],
        status: 'invited',
      },
    },
    cookie,
  });
  assert.equal(res.status, 201, `invite ${email}: ${res.text}`);
  return res.json.member;
}

function sendReset(cookie, businessId, memberId) {
  return req(`/api/businesses/${businessId}/staff/${memberId}/send-password-reset`, {
    method: 'POST',
    body: {},
    cookie,
  });
}

async function memberRow(businessId, email) {
  const { rows } = await pool.query(
    'SELECT * FROM staff_members WHERE business_id = $1 AND LOWER(email) = $2',
    [businessId, email],
  );
  return rows[0];
}

test('owner send (Essentials): the reset email arrives and the code completes a real reset', async () => {
  const owner = await ownerWithBusiness('t13-sr-owner@example.com'); // essentials by default
  const invited = await invite(owner.cookie, owner.business.id, 't13-sr-member@example.com');
  const memberUser = await registerVerifiedUser('t13-sr-member@example.com', 'member-pass-123');
  assert.ok(memberUser.user.id);
  const member = await memberRow(owner.business.id, 't13-sr-member@example.com');
  assert.equal(member.id, invited.id);
  assert.equal(member.status, 'active');

  const mailBefore = mailbox.length;
  const res = await sendReset(owner.cookie, owner.business.id, member.id);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.sent_to, 't13-sr-member@example.com');
  // The owner is told only where it went — never the code or link.
  assert.ok(!/\d{6}/.test(JSON.stringify(res.json)), 'response carries no code');

  const mail = latestMailTo('t13-sr-member@example.com', 'Reset your');
  assert.ok(mail, 'reset email captured by the sink');
  assert.ok(mailbox.length > mailBefore);
  const code = resetCodeFromMail(mail);
  assert.match(code, /^\d{6}$/);

  const reset = await req('/api/auth/reset-password', {
    method: 'POST',
    body: { resetToken: code, newPassword: 'FreshStart789' },
  });
  assert.equal(reset.status, 200, reset.text);
  const oldLogin = await login('t13-sr-member@example.com', 'member-pass-123');
  assert.equal(oldLogin.status, 401);
  const newLogin = await login('t13-sr-member@example.com', 'FreshStart789');
  assert.equal(newLogin.status, 200);
});

test('owner send (Business): works the same on the Business plan', async () => {
  const owner = await ownerWithBusiness('t13-sr-bizowner@example.com', 'Biz Shop', { plan: 'business' });
  await invite(owner.cookie, owner.business.id, 't13-sr-bizmember@example.com');
  await registerVerifiedUser('t13-sr-bizmember@example.com', 'member-pass-123');
  const member = await memberRow(owner.business.id, 't13-sr-bizmember@example.com');
  const res = await sendReset(owner.cookie, owner.business.id, member.id);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.sent_to, 't13-sr-bizmember@example.com');
  assert.ok(latestMailTo('t13-sr-bizmember@example.com', 'Reset your'));
});

test('a staff member (not the owner) is refused', async () => {
  const owner = await ownerWithBusiness('t13-sr-gate@example.com');
  await invite(owner.cookie, owner.business.id, 't13-sr-gatemember@example.com');
  const memberUser = await registerVerifiedUser('t13-sr-gatemember@example.com', 'member-pass-123');
  const member = await memberRow(owner.business.id, 't13-sr-gatemember@example.com');
  const res = await sendReset(memberUser.cookie, owner.business.id, member.id);
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'owner_only');
});

test('a staff id from another business is refused as not found', async () => {
  const ownerA = await ownerWithBusiness('t13-sr-a@example.com');
  const ownerB = await ownerWithBusiness('t13-sr-b@example.com');
  await invite(ownerA.cookie, ownerA.business.id, 't13-sr-cross@example.com');
  await registerVerifiedUser('t13-sr-cross@example.com', 'member-pass-123');
  const member = await memberRow(ownerA.business.id, 't13-sr-cross@example.com');
  const res = await sendReset(ownerB.cookie, ownerB.business.id, member.id);
  assert.equal(res.status, 404);
  assert.equal(res.json.error, 'staff_not_found');
});

test('a pending invite (no account yet) is refused with the no-account message and sends nothing', async () => {
  const owner = await ownerWithBusiness('t13-sr-pending@example.com');
  const invited = await invite(owner.cookie, owner.business.id, 't13-sr-never@example.com');
  const mailBefore = mailbox.length;
  const res = await sendReset(owner.cookie, owner.business.id, invited.id);
  assert.equal(res.status, 409);
  assert.equal(res.json.error, 'staff_no_account');
  assert.equal(mailbox.length, mailBefore, 'no mail was sent');
});

test('the OTP resend cooldown refuses an immediate second send', async () => {
  const owner = await ownerWithBusiness('t13-sr-cool@example.com');
  await invite(owner.cookie, owner.business.id, 't13-sr-coolmember@example.com');
  await registerVerifiedUser('t13-sr-coolmember@example.com', 'member-pass-123');
  const member = await memberRow(owner.business.id, 't13-sr-coolmember@example.com');
  const first = await sendReset(owner.cookie, owner.business.id, member.id);
  assert.equal(first.status, 200, first.text);
  const second = await sendReset(owner.cookie, owner.business.id, member.id);
  assert.equal(second.status, 429);
  assert.equal(second.json.error, 'rate_limited');
});

test('the per-target send cap refuses a sixth send within the hour', async () => {
  const owner = await ownerWithBusiness('t13-sr-cap@example.com');
  await invite(owner.cookie, owner.business.id, 't13-sr-capmember@example.com');
  const memberUser = await registerVerifiedUser('t13-sr-capmember@example.com', 'member-pass-123');
  const member = await memberRow(owner.business.id, 't13-sr-capmember@example.com');
  for (let i = 0; i < 5; i += 1) {
    const res = await sendReset(owner.cookie, owner.business.id, member.id);
    assert.equal(res.status, 200, `send ${i + 1}: ${res.text}`);
    // Clear the live OTP so only the send cap (not the cooldown) is
    // what the next send meets.
    await pool.query('DELETE FROM otp_codes WHERE user_id = $1 AND purpose = $2', [memberUser.user.id, 'reset']);
  }
  const sixth = await sendReset(owner.cookie, owner.business.id, member.id);
  assert.equal(sixth.status, 429);
  assert.equal(sixth.json.error, 'rate_limited');
});

test('unauthenticated is refused', async () => {
  const owner = await ownerWithBusiness('t13-sr-anon@example.com');
  const invited = await invite(owner.cookie, owner.business.id, 't13-sr-anonmember@example.com');
  const res = await sendReset(null, owner.business.id, invited.id);
  assert.equal(res.status, 401);
});
