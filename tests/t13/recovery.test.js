/**
 * T13 — Account recovery kit: spare keys (backup codes + verified
 * backup email), the restricted recovery session, the atomic
 * change-email carry (account + every staff row + trial history),
 * the signed-in change-email path, and the owner's staff-email fix.
 *
 * The owner's requirement, from her own experience of being locked
 * out of an email: losing your email must never cost you your shop —
 * and an email change must never mint a second free trial.
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
  login,
  ownerWithBusiness,
  cookieFrom,
  codeFromMail,
  latestMailTo,
} from './helpers.js';
import { checkTrialEligibility } from '../../server/trialEligibility.js';

after(close);
beforeEach(() => resetRateLimits());

const NO_STRIPE = { listCustomersByEmail: async () => [] };

async function invite(cookie, businessId, email, overrides = {}) {
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
        ...overrides,
      },
    },
    cookie,
  });
  assert.equal(res.status, 201, `invite ${email}: ${res.text}`);
  return res.json.member;
}

async function genCodes(cookie) {
  const res = await req('/api/account/backup-codes', { method: 'POST', body: {}, cookie });
  assert.equal(res.status, 200, res.text);
  return res.json.codes;
}

async function security(cookie) {
  const res = await req('/api/account/security', { cookie });
  assert.equal(res.status, 200, res.text);
  return res.json;
}

async function setVerifiedBackupEmail(cookie, backupEmail) {
  const start = await req('/api/account/backup-email', { method: 'POST', body: { email: backupEmail }, cookie });
  assert.equal(start.status, 200, start.text);
  const mail = latestMailTo(backupEmail, 'backup email code');
  assert.ok(mail, 'backup email code mail arrived');
  const verify = await req('/api/account/backup-email/verify', {
    method: 'POST',
    body: { code: codeFromMail(mail) },
    cookie,
  });
  assert.equal(verify.status, 200, verify.text);
}

async function seedConsumedTrial(email) {
  await pool.query(
    `INSERT INTO trial_history (id, email, plan, status, first_trial_at, consumed_at)
     VALUES ($1, $2, 'essentials', 'consumed', NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET status = 'consumed'`,
    [crypto.randomUUID(), email],
  );
}

async function changeEmail(cookie, newEmail, password) {
  const requestBody = { new_email: newEmail };
  if (password !== undefined) requestBody.password = password;
  const start = await req('/api/account/change-email/request', { method: 'POST', body: requestBody, cookie });
  assert.equal(start.status, 200, start.text);
  const mail = latestMailTo(newEmail, 'Confirm your new');
  assert.ok(mail, 'new-email code mail arrived');
  const confirm = await req('/api/account/change-email/confirm', {
    method: 'POST',
    body: { code: codeFromMail(mail) },
    cookie,
  });
  assert.equal(confirm.status, 200, confirm.text);
  return confirm.json;
}

// -------------------------------------------------------------------

test('backup codes: a set of 10 is shown once and the remaining count is tracked', async () => {
  const user = await registerVerifiedUser('t13-codes@example.com');
  const codes = await genCodes(user.cookie);
  assert.equal(codes.length, 10);
  assert.match(codes[0], /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const status = await security(user.cookie);
  assert.equal(status.backup_codes_remaining, 10);
  assert.equal(status.email, 't13-codes@example.com');
  assert.equal(status.backup_email_verified, false);
});

test('backup codes: regenerating kills the whole old set', async () => {
  const user = await registerVerifiedUser('t13-regen@example.com');
  const firstSet = await genCodes(user.cookie);
  const secondSet = await genCodes(user.cookie);
  assert.notDeepEqual(secondSet, firstSet);
  const status = await security(user.cookie);
  assert.equal(status.backup_codes_remaining, 10, 'still exactly one live set');

  const oldAttempt = await req('/api/auth/recover', {
    method: 'POST',
    body: { email: 't13-regen@example.com', backup_code: firstSet[0] },
    csrf: false,
  });
  assert.equal(oldAttempt.status, 400);
  assert.equal(oldAttempt.json.error, 'recovery_failed');

  const newAttempt = await req('/api/auth/recover', {
    method: 'POST',
    body: { email: 't13-regen@example.com', backup_code: secondSet[0] },
    csrf: false,
  });
  assert.equal(newAttempt.status, 200);
  assert.equal(newAttempt.json.recovery, true);
});

test('backup email: set + verify flow, masked once verified, cannot equal the account email', async () => {
  const user = await registerVerifiedUser('t13-backup@example.com');

  const same = await req('/api/account/backup-email', {
    method: 'POST',
    body: { email: 't13-backup@example.com' },
    cookie: user.cookie,
  });
  assert.equal(same.status, 400);
  assert.equal(same.json.error, 'backup_same_as_account');

  const start = await req('/api/account/backup-email', {
    method: 'POST',
    body: { email: 't13-backup-spare@example.com' },
    cookie: user.cookie,
  });
  assert.equal(start.status, 200, start.text);
  const mail = latestMailTo('t13-backup-spare@example.com', 'backup email code');
  assert.ok(mail, 'code mailed to the backup address');
  const code = codeFromMail(mail);
  assert.ok(code, 'mail carries a 6-digit code');

  const wrong = await req('/api/account/backup-email/verify', {
    method: 'POST',
    body: { code: code === '000000' ? '111111' : '000000' },
    cookie: user.cookie,
  });
  assert.equal(wrong.status, 400);

  const verify = await req('/api/account/backup-email/verify', {
    method: 'POST',
    body: { code },
    cookie: user.cookie,
  });
  assert.equal(verify.status, 200, verify.text);

  const status = await security(user.cookie);
  assert.equal(status.backup_email_verified, true);
  assert.ok(status.backup_email.includes('@example.com'));
  assert.ok(!status.backup_email.startsWith('t13-backup-spare'), 'backup email is masked, not raw');
});

test('full recovery: backup code -> restricted session -> change email -> shop, staff seat and trial all follow', async () => {
  const owner = await ownerWithBusiness('t13-owner@example.com');
  await invite(owner.cookie, owner.business.id, 't13-staff@example.com');
  const staff = await registerVerifiedUser('t13-staff@example.com', 'staff-pass-123');
  await seedConsumedTrial('t13-staff@example.com');
  const codes = await genCodes(staff.cookie);

  // The spare key opens a RESTRICTED session.
  const recovered = await req('/api/auth/recover', {
    method: 'POST',
    body: { email: 't13-staff@example.com', backup_code: codes[0] },
    csrf: false,
  });
  assert.equal(recovered.status, 200, recovered.text);
  const recoveryCookie = cookieFrom(recovered.setCookie);
  assert.ok(recoveryCookie);

  const me = await req('/api/auth/me', { cookie: recoveryCookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.session_scope, 'recovery');

  // The shop is closed to it — list and entity surfaces alike.
  const businesses = await req('/api/businesses', { cookie: recoveryCookie });
  assert.equal(businesses.status, 403);
  assert.equal(businesses.json.error, 'recovery_scope');
  const shop = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: owner.business.id } },
    cookie: recoveryCookie,
  });
  assert.equal(shop.status, 403);
  assert.equal(shop.json.error, 'recovery_scope');

  // A backup code works exactly once.
  const reuse = await req('/api/auth/recover', {
    method: 'POST',
    body: { email: 't13-staff@example.com', backup_code: codes[0] },
    csrf: false,
  });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.json.error, 'recovery_failed');

  // The one reachable job: change the email (no password — the spare
  // key was the proof).
  const changed = await changeEmail(recoveryCookie, 't13-staff-new@example.com');
  assert.equal(changed.user.email, 't13-staff-new@example.com');
  assert.equal(changed.user.session_scope, 'full');

  // The same session graduated: full access restored.
  const meAfter = await req('/api/auth/me', { cookie: recoveryCookie });
  assert.equal(meAfter.json.session_scope, 'full');
  const shopAfter = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: owner.business.id } },
    cookie: recoveryCookie,
  });
  assert.equal(shopAfter.status, 200, 'staff access at their business works under the new email');

  // Staff membership intact — keyed to the new email, gone from the old.
  const newRows = await pool.query(
    "SELECT * FROM staff_members WHERE business_id = $1 AND LOWER(email) = 't13-staff-new@example.com'",
    [owner.business.id],
  );
  assert.equal(newRows.rows.length, 1);
  assert.equal(newRows.rows[0].status, 'active');
  const oldRows = await pool.query(
    "SELECT * FROM staff_members WHERE LOWER(email) = 't13-staff@example.com'",
    [],
  );
  assert.equal(oldRows.rows.length, 0);

  // Trial history carried, never duplicated: no second trial, ever.
  const history = await pool.query("SELECT * FROM trial_history WHERE email = 't13-staff-new@example.com'");
  assert.equal(history.rows.length, 1);
  assert.equal(history.rows[0].status, 'consumed');
  const oldHistory = await pool.query("SELECT * FROM trial_history WHERE email = 't13-staff@example.com'");
  assert.equal(oldHistory.rows.length, 0);
  const eligibility = await checkTrialEligibility(pool, 't13-staff-new@example.com', NO_STRIPE);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'trial_history');

  // The old address got the "your email was changed" notice.
  const notice = latestMailTo('t13-staff@example.com', 'email was changed');
  assert.ok(notice, 'notice attempted to the old address');

  // Every OTHER session was revoked; the graduated one lives.
  const oldSession = await req('/api/auth/me', { cookie: staff.cookie });
  assert.equal(oldSession.status, 401);

  // And the person signs in at the new email with the same password.
  const relogin = await login('t13-staff-new@example.com', 'staff-pass-123');
  assert.equal(relogin.status, 200, relogin.text);
  assert.ok(cookieFrom(relogin.setCookie));
  const oldLogin = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 't13-staff@example.com', password: 'staff-pass-123' },
    csrf: false,
  });
  assert.equal(oldLogin.status, 401);
});

test('recovery by backup-email code: works, locks after repeated bad codes, never enumerates', async () => {
  const user = await registerVerifiedUser('t13-lockout@example.com');
  await setVerifiedBackupEmail(user.cookie, 't13-lockout-spare@example.com');

  const ask = await req('/api/auth/recover', {
    method: 'POST',
    body: { email: 't13-lockout@example.com' },
    csrf: false,
  });
  assert.equal(ask.status, 200);
  assert.deepEqual(ask.json, { ok: true });
  const mail = latestMailTo('t13-lockout-spare@example.com', 'account recovery code');
  assert.ok(mail, 'recovery code mailed to the backup address');
  const code = codeFromMail(mail);
  const wrongCode = code === '000000' ? '111111' : '000000';

  for (let i = 0; i < 4; i += 1) {
    const bad = await req('/api/auth/recover/verify', {
      method: 'POST',
      body: { email: 't13-lockout@example.com', code: wrongCode },
      csrf: false,
    });
    assert.equal(bad.status, 400, `bad attempt ${i + 1}`);
  }
  const fifth = await req('/api/auth/recover/verify', {
    method: 'POST',
    body: { email: 't13-lockout@example.com', code: wrongCode },
    csrf: false,
  });
  assert.equal(fifth.status, 423, 'the fifth wrong code locks the recovery');
  const correctButLocked = await req('/api/auth/recover/verify', {
    method: 'POST',
    body: { email: 't13-lockout@example.com', code },
    csrf: false,
  });
  assert.equal(correctButLocked.status, 423, 'even the right code is refused once locked');

  // No enumeration: unknown accounts get the same shapes.
  const ghostAsk = await req('/api/auth/recover', {
    method: 'POST',
    body: { email: 't13-nobody@example.com' },
    csrf: false,
  });
  assert.equal(ghostAsk.status, 200);
  assert.deepEqual(ghostAsk.json, { ok: true });
  const ghostCode = await req('/api/auth/recover', {
    method: 'POST',
    body: { email: 't13-nobody@example.com', backup_code: 'ABCD-2345' },
    csrf: false,
  });
  assert.equal(ghostCode.status, 400);
  assert.equal(ghostCode.json.error, 'recovery_failed');
});

test('recovery by backup-email code: happy path reaches the change-email step', async () => {
  const user = await registerVerifiedUser('t13-emailpath@example.com');
  await setVerifiedBackupEmail(user.cookie, 't13-emailpath-spare@example.com');
  await req('/api/auth/recover', {
    method: 'POST',
    body: { email: 't13-emailpath@example.com' },
    csrf: false,
  });
  const mail = latestMailTo('t13-emailpath-spare@example.com', 'account recovery code');
  const verify = await req('/api/auth/recover/verify', {
    method: 'POST',
    body: { email: 't13-emailpath@example.com', code: codeFromMail(mail) },
    csrf: false,
  });
  assert.equal(verify.status, 200, verify.text);
  const recoveryCookie = cookieFrom(verify.setCookie);
  const me = await req('/api/auth/me', { cookie: recoveryCookie });
  assert.equal(me.json.session_scope, 'recovery');
  const changed = await changeEmail(recoveryCookie, 't13-emailpath-new@example.com');
  assert.equal(changed.user.email, 't13-emailpath-new@example.com');
});

test('signed-in change email: password required, then everything follows the new email', async () => {
  const user = await registerVerifiedUser('t13-inside@example.com', 'inside-pass-123');

  const noPassword = await req('/api/account/change-email/request', {
    method: 'POST',
    body: { new_email: 't13-inside-new@example.com' },
    cookie: user.cookie,
  });
  assert.equal(noPassword.status, 401);
  const wrongPassword = await req('/api/account/change-email/request', {
    method: 'POST',
    body: { new_email: 't13-inside-new@example.com', password: 'not-the-password' },
    cookie: user.cookie,
  });
  assert.equal(wrongPassword.status, 401);

  const changed = await changeEmail(user.cookie, 't13-inside-new@example.com', 'inside-pass-123');
  assert.equal(changed.user.email, 't13-inside-new@example.com');

  const status = await security(user.cookie);
  assert.equal(status.email, 't13-inside-new@example.com');
  const relogin = await login('t13-inside-new@example.com', 'inside-pass-123');
  assert.equal(relogin.status, 200, relogin.text);
  assert.ok(cookieFrom(relogin.setCookie));
});

test('owner staff-email fix: an invited member (no account yet) — only this row moves', async () => {
  const owner = await ownerWithBusiness('t13-fixowner@example.com');
  const member = await invite(owner.cookie, owner.business.id, 't13-invited-old@example.com');

  const fixed = await req(`/api/businesses/${owner.business.id}/staff/${member.id}/email`, {
    method: 'POST',
    body: { email: 't13-invited-new@example.com' },
    cookie: owner.cookie,
  });
  assert.equal(fixed.status, 200, fixed.text);
  assert.equal(fixed.json.member.email, 't13-invited-new@example.com');

  // The generic entity update refuses email changes outright.
  const sneaky = await req(`/api/entities/StaffMember/${member.id}`, {
    method: 'PATCH',
    body: { email: 't13-sneaky@example.com' },
    cookie: owner.cookie,
  });
  assert.equal(sneaky.status, 400);
  assert.equal(sneaky.json.error, 'staff_email_change');

  // The member joins under the NEW email and the seat activates.
  await registerVerifiedUser('t13-invited-new@example.com');
  const rows = await pool.query('SELECT * FROM staff_members WHERE id = $1', [member.id]);
  assert.equal(rows.rows[0].email, 't13-invited-new@example.com');
  assert.equal(rows.rows[0].status, 'active');
});

test('owner staff-email fix: an active member with an account — account, all rows and trial follow', async () => {
  const ownerA = await ownerWithBusiness('t13-fix-a@example.com');
  const ownerB = await ownerWithBusiness('t13-fix-b@example.com');
  await invite(ownerA.cookie, ownerA.business.id, 't13-member-old@example.com');
  await invite(ownerB.cookie, ownerB.business.id, 't13-member-old@example.com');
  const memberUser = await registerVerifiedUser('t13-member-old@example.com', 'member-pass-123');
  await seedConsumedTrial('t13-member-old@example.com');

  // A staff member (not the owner) may not use the fix.
  const memberRow = await pool.query(
    "SELECT id FROM staff_members WHERE business_id = $1 AND LOWER(email) = 't13-member-old@example.com'",
    [ownerA.business.id],
  );
  const asStaffReal = await req(`/api/businesses/${ownerA.business.id}/staff/${memberRow.rows[0].id}/email`, {
    method: 'POST',
    body: { email: 't13-nope@example.com' },
    cookie: memberUser.cookie,
  });
  assert.equal(asStaffReal.status, 403);
  assert.equal(asStaffReal.json.error, 'owner_only');

  const fixed = await req(`/api/businesses/${ownerA.business.id}/staff/${memberRow.rows[0].id}/email`, {
    method: 'POST',
    body: { email: 't13-member-new@example.com' },
    cookie: ownerA.cookie,
  });
  assert.equal(fixed.status, 200, fixed.text);
  assert.equal(fixed.json.member.email, 't13-member-new@example.com');

  // The account itself moved.
  const account = await pool.query("SELECT email FROM users WHERE id = $1", [memberUser.user.id]);
  assert.equal(account.rows[0].email, 't13-member-new@example.com');

  // EVERY staff row followed — both businesses — none left behind.
  const rowsNew = await pool.query("SELECT business_id FROM staff_members WHERE LOWER(email) = 't13-member-new@example.com'");
  assert.equal(rowsNew.rows.length, 2);
  const rowsOld = await pool.query("SELECT id FROM staff_members WHERE LOWER(email) = 't13-member-old@example.com'");
  assert.equal(rowsOld.rows.length, 0);

  // Trial history followed; no second trial under the new email.
  const eligibility = await checkTrialEligibility(pool, 't13-member-new@example.com', NO_STRIPE);
  assert.equal(eligibility.eligible, false);

  // Access follows the new email at the OTHER business too.
  const relogin = await login('t13-member-new@example.com', 'member-pass-123');
  assert.equal(relogin.status, 200, relogin.text);
  const atB = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: ownerB.business.id } },
    cookie: cookieFrom(relogin.setCookie),
  });
  assert.equal(atB.status, 200, 'member still works at business B under the new email');
  const oldLogin = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 't13-member-old@example.com', password: 'member-pass-123' },
    csrf: false,
  });
  assert.equal(oldLogin.status, 401);

  // The notice went to the old address.
  assert.ok(latestMailTo('t13-member-old@example.com', 'email was changed'));

  // Fixing onto an email already seated on this business is refused
  // (the same-business seat check fires before the account check —
  // both are 409 refusals, nothing changes either way).
  const other = await invite(ownerA.cookie, ownerA.business.id, 't13-other@example.com');
  const clash = await req(`/api/businesses/${ownerA.business.id}/staff/${other.id}/email`, {
    method: 'POST',
    body: { email: 't13-member-new@example.com' },
    cookie: ownerA.cookie,
  });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.error, 'staff_exists');
});
