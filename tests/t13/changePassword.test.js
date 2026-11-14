/**
 * T13 — Change password (Nov 14, 2026): the signed-in password change
 * the owner found missing in Settings → Security. Account-level, all
 * plans, all roles: verify the current password, apply the standard
 * password rule, revoke every OTHER session, keep the acting one.
 * Restricted recovery sessions are refused by the app-level scope
 * guard, like every other non-allowlisted route.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  login,
  cookieFrom,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

const CHANGE = '/api/auth/change-password';

test('change password: unauthenticated is refused', async () => {
  const res = await req(CHANGE, {
    method: 'POST',
    body: { currentPassword: 'CorrectHorse123', newPassword: 'BrandNewPass456' },
  });
  assert.equal(res.status, 401);
});

test('change password: wrong current password is refused and nothing changes', async () => {
  const user = await registerVerifiedUser('t13-cp-wrong@example.com', 'CorrectHorse123');
  const res = await req(CHANGE, {
    method: 'POST',
    body: { currentPassword: 'NotThePassword1', newPassword: 'BrandNewPass456' },
    cookie: user.cookie,
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'current_password_incorrect');
  const stillWorks = await login('t13-cp-wrong@example.com', 'CorrectHorse123');
  assert.equal(stillWorks.status, 200);
});

test('change password: a weak new password is refused by the standard rule', async () => {
  const user = await registerVerifiedUser('t13-cp-weak@example.com', 'CorrectHorse123');
  const res = await req(CHANGE, {
    method: 'POST',
    body: { currentPassword: 'CorrectHorse123', newPassword: 'short' },
    cookie: user.cookie,
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'invalid_password');
});

test('change password: the new password must differ from the current one', async () => {
  const user = await registerVerifiedUser('t13-cp-same@example.com', 'CorrectHorse123');
  const res = await req(CHANGE, {
    method: 'POST',
    body: { currentPassword: 'CorrectHorse123', newPassword: 'CorrectHorse123' },
    cookie: user.cookie,
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'password_unchanged');
});

test('change password: success swaps the password, revokes other sessions, keeps the acting one', async () => {
  const user = await registerVerifiedUser('t13-cp-ok@example.com', 'CorrectHorse123');
  // A second, independent session for the same account ("other device").
  const second = await login('t13-cp-ok@example.com', 'CorrectHorse123');
  assert.equal(second.status, 200);
  const secondCookie = cookieFrom(second.setCookie);
  assert.ok(secondCookie);

  const res = await req(CHANGE, {
    method: 'POST',
    body: { currentPassword: 'CorrectHorse123', newPassword: 'BrandNewPass456' },
    cookie: user.cookie,
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.ok, true);

  // The acting session survives.
  const meAfter = await req('/api/auth/me', { cookie: user.cookie });
  assert.equal(meAfter.status, 200, meAfter.text);
  // The other session is revoked.
  const otherAfter = await req('/api/auth/me', { cookie: secondCookie });
  assert.equal(otherAfter.status, 401);
  // Old password can no longer sign in; the new one can.
  const oldLogin = await login('t13-cp-ok@example.com', 'CorrectHorse123');
  assert.equal(oldLogin.status, 401);
  const newLogin = await login('t13-cp-ok@example.com', 'BrandNewPass456');
  assert.equal(newLogin.status, 200);
});

test('change password: a restricted recovery session is refused', async () => {
  const user = await registerVerifiedUser('t13-cp-recovery@example.com', 'CorrectHorse123');
  const codes = await req('/api/account/backup-codes', { method: 'POST', body: {}, cookie: user.cookie });
  assert.equal(codes.status, 200, codes.text);
  const recovered = await req('/api/auth/recover', {
    method: 'POST',
    body: { email: 't13-cp-recovery@example.com', backup_code: codes.json.codes[0] },
    csrf: false,
  });
  assert.equal(recovered.status, 200, recovered.text);
  const recoveryCookie = cookieFrom(recovered.setCookie);
  assert.ok(recoveryCookie);
  const res = await req(CHANGE, {
    method: 'POST',
    body: { currentPassword: 'CorrectHorse123', newPassword: 'BrandNewPass456' },
    cookie: recoveryCookie,
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'recovery_scope');
});

test('change password: attempts are rate limited', async () => {
  const user = await registerVerifiedUser('t13-cp-limit@example.com', 'CorrectHorse123');
  let last;
  for (let i = 0; i < 11; i += 1) {
    last = await req(CHANGE, {
      method: 'POST',
      body: { currentPassword: 'CorrectHorse123', newPassword: 'short' },
      cookie: user.cookie,
    });
  }
  assert.equal(last.status, 429);
  assert.equal(last.json.error, 'rate_limited');
});
