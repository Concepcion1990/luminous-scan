import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Register OTP recovery — live failure 2026-11-06, Business retest:
 * the customer re-registered cperezcarrillo23@gmail.com, an email whose
 * account already existed and was verified in round 1 (its app data had
 * been deleted in cleanup, but the auth user was not). No code ever
 * arrived, because a new OTP is only sent for a brand-new account, and
 * the OTP screen had no way back to Login — only Resend.
 */
const page = readFileSync('src/pages/Register.jsx','utf8');

test('Register OTP screen offers a login escape hatch', () => {
  assert.match(page, /Log in instead/);
  assert.match(page, /to=\{loginPath\}/);
  assert.match(page, /A new code is only sent for a brand-new account/);
  assert.match(page, /sign in with the password you set/);
});

test('Register detects an already-registered email and points at login', () => {
  assert.match(page, /alreadyExists/);
  assert.match(page, /already\|exists\|registered/i);
  assert.match(page, /An account with this email already exists\. Sign in instead/);
  // The login link is shown with the already-exists error.
  assert.match(page, /alreadyExists && \(/);
  // The OTP screen is still shown for a genuinely new registration.
  assert.match(page, /setShowOtp\(true\)/);
});

// Finding 28 (audit P2): leaving the OTP screen no longer strands the
// customer — the pending email is persisted and both Register and Login
// offer the way back to the code.
const loginPage = readFileSync('src/pages/Login.jsx', 'utf8');

test('Register persists the pending-verification email and offers resume', () => {
  assert.match(page, /PENDING_VERIFICATION_KEY = "stockhaven\.pendingVerificationEmail"/);
  assert.match(page, /rememberPendingVerificationEmail\(email\)/);
  assert.match(page, /forgetPendingVerificationEmail\(\)/);
  assert.match(page, /Verify an emailed code/);
  assert.match(page, /A verification code was sent to/);
  assert.match(page, /Verify the code/);
});

test('Login offers the verification resume path for a pending email', () => {
  assert.match(loginPage, /readPendingVerificationEmail/);
  assert.match(loginPage, /Have a verification code for/);
  assert.match(loginPage, /Verify your email/);
});

test('Login shows the password-reset confirmation', () => {
  assert.match(loginPage, /Password changed — log in with your new password\./);
});
