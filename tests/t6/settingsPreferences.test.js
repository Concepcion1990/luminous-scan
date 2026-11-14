/**
 * T6 — Settings language + currency apply on selection (the
 * owner's ruling, Nov 14, 2026).
 *
 * Exactly two controls leave the form's Save flow: language and
 * currency persist the moment they are picked, through a
 * single-field PATCH that carries ONLY that field — so the
 * switch can neither save nor discard any other unsaved edit.
 * These tests pin the server half (a one-field PATCH changes
 * exactly one column and survives a fresh read) and the client
 * wiring (the two selects route through the immediate path;
 * everything else still goes through the form).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { close, req, ownerWithBusiness } from './helpers.js';

after(close);

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

async function getBusiness(cookie, businessId) {
  const res = await req('/api/businesses', { cookie });
  assert.equal(res.status, 200, res.text);
  return res.json.items.find((b) => b.id === businessId);
}

test('language persists from a single-field PATCH — nothing else moves', async () => {
  const owner = await ownerWithBusiness('pref-lang@example.com', 'Idioma Books');
  const bid = owner.business.id;

  const res = await req(`/api/businesses/${bid}`, {
    method: 'PATCH',
    body: { language: 'es-MX' },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.language, 'es-MX');

  // A fresh read (the reload path) shows the choice stuck, and
  // the fields the form might have held unsaved edits for are
  // exactly as they were — the one-field write touched nothing.
  const afterRead = await getBusiness(owner.cookie, bid);
  assert.equal(afterRead.language, 'es-MX');
  assert.equal(afterRead.name, 'Idioma Books');
  assert.equal(afterRead.currency, 'USD');
});

test('currency persists from a single-field PATCH — nothing else moves', async () => {
  const owner = await ownerWithBusiness('pref-curr@example.com', 'Moneda Books');
  const bid = owner.business.id;

  const res = await req(`/api/businesses/${bid}`, {
    method: 'PATCH',
    body: { currency: 'MXN' },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.currency, 'MXN');

  const afterRead = await getBusiness(owner.cookie, bid);
  assert.equal(afterRead.currency, 'MXN');
  assert.equal(afterRead.name, 'Moneda Books');
  assert.equal(afterRead.language, 'en');
});

test('client pins: only language and currency ride the immediate path', () => {
  const card = src('src/components/business/DetailsCard.jsx');
  assert.match(card, /onValueChange=\{pickPreference\('currency'\)\}/, 'currency applies on selection');
  assert.match(card, /onValueChange=\{pickPreference\('language'\)\}/, 'language applies on selection');
  assert.match(card, /pick\('timezone'\)/, 'timezone still uses the ordinary form flow');

  const page = src('src/pages/Settings.jsx');
  const apply = page.slice(page.indexOf('const applyPreference'), page.indexOf('const save ='));
  assert.match(apply, /body: \{ \[key\]: value \}/, 'the immediate path sends ONLY the one field');
  assert.match(apply, /setLocale\(value\)/, 'language re-renders the UI at selection time');
  assert.ok(!apply.includes('saveBusiness'), 'the immediate path never runs the full-form save');
  assert.match(page, /onPreferenceChange=\{applyPreference\}/, 'the card is wired to the immediate path');
});
