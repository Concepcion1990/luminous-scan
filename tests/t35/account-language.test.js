/**
 * The language carry fix (Nov 24, 2026) — server half.
 *
 * Language belongs to the PERSON (the owner's standing rule),
 * but its only server-side home was businesses.language, so an
 * owner with several businesses saw the app flip language on
 * every switch (her Nov 23 catch: Spanish in Business 3,
 * English in Businesses 1 and 2). Migration 052 gives the
 * account its own home (users.language); these tests pin the
 * server contract the shell now relies on:
 *
 *   - registration stamps the account with the request language
 *     (the account is born speaking it);
 *   - PATCH /auth/me { language } validates against the same
 *     allowlist as the business record, persists, and is served
 *     back by GET /auth/me — and a language write never moves
 *     the active business (nor a switch the language);
 *   - resolveAccountLanguage (the resolver behind every
 *     account-addressed email) reads the account first, then
 *     the business the person is standing in — never silently
 *     the oldest business while an active one disagrees.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pool,
  req,
  mailbox,
  cookieFrom,
  registerVerifiedUser,
  resetRateLimits,
  close,
} from '../t2/helpers.js';
import { ownerWithBusiness, createBusiness } from '../t3/helpers.js';
import { resolveAccountLanguage } from '../../server/email.js';

after(close);
beforeEach(() => resetRateLimits());

async function userRow(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0];
}

test('registration stamps the account language from the request language', async () => {
  const email = 'born-spanish@example.com';
  const res = await req('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'CorrectHorse123', language: 'es-MX' },
  });
  assert.equal(res.status, 201, res.text);
  const row = await userRow(email);
  assert.equal(row.language, 'es-MX', 'the account is born speaking the language it was created in');

  const plain = 'born-unstamped@example.com';
  const res2 = await req('/api/auth/register', {
    method: 'POST',
    body: { email: plain, password: 'CorrectHorse123' },
  });
  assert.equal(res2.status, 201, res2.text);
  assert.equal((await userRow(plain)).language, null, 'no request language, no stamp — seeding is a later, deliberate moment');
});

test('PATCH /auth/me { language }: a good code persists and is served back; a bad code is refused', async () => {
  const user = await registerVerifiedUser('patch-lang@example.com');

  const good = await req('/api/auth/me', {
    method: 'PATCH',
    body: { language: 'de' },
    cookie: user.cookie,
  });
  assert.equal(good.status, 200, good.text);
  assert.equal(good.json.language, 'de');

  const me = await req('/api/auth/me', { cookie: user.cookie });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.json.language, 'de', 'GET /auth/me serves the account language');
  assert.equal((await userRow(user.email)).language, 'de');

  const bad = await req('/api/auth/me', {
    method: 'PATCH',
    body: { language: 'xx-unknown' },
    cookie: user.cookie,
  });
  assert.equal(bad.status, 400, bad.text);
  assert.equal(bad.json.error, 'unsupported_language');
  assert.equal((await userRow(user.email)).language, 'de', 'a refused code never lands');
});

test('a language write never moves the active business; a switch never moves the language', async () => {
  const owner = await ownerWithBusiness('no-stomp@example.com', 'Primera', { plan: 'business' });
  const second = await createBusiness(owner.cookie, 'Segunda');

  const setActive = await req('/api/auth/me', {
    method: 'PATCH',
    body: { active_business_id: second.id },
    cookie: owner.cookie,
  });
  assert.equal(setActive.status, 200, setActive.text);
  assert.equal(setActive.json.active_business_id, second.id);

  const setLang = await req('/api/auth/me', {
    method: 'PATCH',
    body: { language: 'es-MX' },
    cookie: owner.cookie,
  });
  assert.equal(setLang.status, 200, setLang.text);
  assert.equal(setLang.json.language, 'es-MX');
  assert.equal(setLang.json.active_business_id, second.id, 'the language write left the active business where it was');

  const back = await req('/api/auth/me', {
    method: 'PATCH',
    body: { active_business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(back.status, 200, back.text);
  assert.equal(back.json.language, 'es-MX', 'switching businesses never touches the account language');

  const me = await req('/api/auth/me', { cookie: owner.cookie });
  assert.equal(me.json.language, 'es-MX');
  assert.equal(me.json.active_business_id, owner.business.id);
});

test('resolveAccountLanguage: the account wins; unseeded falls to the ACTIVE business, not the oldest', async () => {
  const owner = await ownerWithBusiness('resolver@example.com', 'Vieja', { plan: 'business' });
  const second = await createBusiness(owner.cookie, 'Nueva');

  // The second (newer) business speaks Spanish; the oldest is English.
  const langPatch = await req(`/api/businesses/${second.id}`, {
    method: 'PATCH',
    body: { language: 'es-MX' },
    cookie: owner.cookie,
  });
  assert.equal(langPatch.status, 200, langPatch.text);

  // Unseeded account standing in the OLD business: the oldest
  // owned business is the only signal left, and it answers.
  assert.equal(await resolveAccountLanguage(pool, owner.user.id), 'en');

  // Standing in the Spanish business, the resolver follows the
  // room the person is in — not the oldest business.
  await req('/api/auth/me', {
    method: 'PATCH',
    body: { active_business_id: second.id },
    cookie: owner.cookie,
  });
  assert.equal(await resolveAccountLanguage(pool, owner.user.id), 'es-MX');

  // Once the account itself is seeded, it outranks every room.
  await req('/api/auth/me', {
    method: 'PATCH',
    body: { language: 'de' },
    cookie: owner.cookie,
  });
  assert.equal(await resolveAccountLanguage(pool, owner.user.id), 'de');
});

test('a re-register never overwrites the stamp, and the verified user carries the account language', async () => {
  // Register (stamped es-MX), then register again before
  // verifying: the code is re-issued and the stamp survives.
  const email = 're-register@example.com';
  const first = await req('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'CorrectHorse123', language: 'es-MX' },
  });
  assert.equal(first.status, 201, first.text);
  const again = await req('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'CorrectHorse123', language: 'de' },
  });
  assert.equal(again.status, 201, again.text);
  assert.equal((await userRow(email)).language, 'es-MX', 'a re-register never overwrites the language already on the account');

  // The mails speak the request languages, so the code is read
  // language-independently: the only 6-digit run in the body.
  const mails = mailbox.filter((m) => m.to === email);
  assert.equal(mails.length, 2, 'both registrations mailed a code');
  const code = String(mails[mails.length - 1].text).match(/\b(\d{6})\b/)?.[1];
  assert.ok(code, 'a fresh code was mailed');
  const verify = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: code } });
  assert.equal(verify.status, 200, verify.text);
  assert.equal(verify.json.user.language, 'es-MX', 'the verified session user carries the account language');
  assert.ok(cookieFrom(verify.setCookie), 'a session was issued');
});
