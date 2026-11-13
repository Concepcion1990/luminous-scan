/**
 * T2 Google-removal tests — owner's decision, Nov 9: email + password
 * ONLY. No Google OAuth code, client id/secret, or 'Sign in with
 * Google' button/UI anywhere on the twin. Her reasoning (on the
 * record for any future proposal): she thinks it is more secure —
 * fewer doors into the app, no third party in the middle of her
 * customers' logins.
 *
 * Static checks over the ported source, plus the authMfa helper
 * itself (its Google functions must reject, never redirect).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

function readSrc(relative) {
  return readFileSync(`src/${relative}`, 'utf8');
}

function allSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      allSourceFiles(path, out);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

test('Login and Register have no Google sign-in button or handler', () => {
  for (const page of ['pages/Login.jsx', 'pages/Register.jsx']) {
    const src = readSrc(page);
    assert.doesNotMatch(src, /Continue with Google/);
    assert.doesNotMatch(src, /loginWithGoogle/);
    assert.doesNotMatch(src, /GoogleIcon/);
    assert.doesNotMatch(src, /handleGoogle/);
  }
});

test('GoogleIcon component is deleted and unreferenced', () => {
  assert.equal(existsSync('src/components/GoogleIcon.jsx'), false);
  for (const file of allSourceFiles('src')) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /GoogleIcon/);
  }
});

test('Subscribe no longer offers Google as a way to create an account', () => {
  assert.doesNotMatch(readSrc('pages/Subscribe.jsx'), /Continue with Google/);
});

test('no Google OAuth identifiers anywhere in src', () => {
  for (const file of allSourceFiles('src')) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /GOOGLE_CLIENT_ID/);
    assert.doesNotMatch(src, /GOOGLE_CLIENT_SECRET/);
    assert.doesNotMatch(src, /accounts\.google\.com/);
  }
});

test('loginWithGoogle / loginWithSocial reject with an email-and-password message', async () => {
  const { loginWithGoogle, loginWithSocial } = await import('../../src/lib/authMfa.js');
  await assert.rejects(loginWithGoogle(), /email and password/);
  await assert.rejects(loginWithSocial(), /email and password/);
});

test('authMfa records the owner decision (fewer doors, no third party)', () => {
  const src = readSrc('lib/authMfa.js');
  assert.match(src, /fewer doors/);
  assert.match(src, /no third party in the middle/);
});
