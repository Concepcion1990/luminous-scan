/**
 * Picker build — the registration language carry, server side.
 *
 * A business created with a `language` in the create body starts in
 * that language (the visitor's public-picker choice, sent by
 * createBusiness in src/lib/business.js). The code is validated
 * against the same allowlist the PATCH route enforces; unknown or
 * missing codes fail soft to English — creating a business is never
 * blocked by a bad language value. Runs against the real Express app
 * + pg-mem Postgres, like the rest of T2.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  req,
  registerVerifiedUser,
  resetRateLimits,
  close,
} from './helpers.js';

after(close);

beforeEach(() => resetRateLimits());

test('businesses: create with a language starts the business in it', async () => {
  const { cookie } = await registerVerifiedUser('lang-fr@example.com');
  const created = await req('/api/businesses', {
    method: 'POST',
    cookie,
    body: { name: 'Boutique', language: 'fr-FR' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.language, 'fr-FR');

  const list = await req('/api/businesses', { cookie });
  assert.equal(list.json.items[0].language, 'fr-FR');
});

test('businesses: create without a language, or with an unknown one, starts in English', async () => {
  const { cookie: noLangCookie } = await registerVerifiedUser('lang-none@example.com');
  const noLang = await req('/api/businesses', {
    method: 'POST',
    cookie: noLangCookie,
    body: { name: 'Plain Shop' },
  });
  assert.equal(noLang.status, 201);
  assert.equal(noLang.json.language, 'en');

  const { cookie: badLangCookie } = await registerVerifiedUser('lang-bad@example.com');
  const badLang = await req('/api/businesses', {
    method: 'POST',
    cookie: badLangCookie,
    body: { name: 'Odd Shop', language: 'klingon' },
  });
  assert.equal(badLang.status, 201);
  assert.equal(badLang.json.language, 'en');
});
