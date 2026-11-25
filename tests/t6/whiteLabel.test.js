/**
 * T6 — white-label / customization.
 *
 * Two owed fixes in one file:
 *   (a) Settings could never save ANYTHING: entities.Business.update
 *       rejected as not-implemented and the businesses table had no
 *       identity columns. PATCH /api/businesses/:id + migration 006
 *       fix that — the save is proven here end to end.
 *   (b) The color picker saved a value nothing ever read. The
 *       picker is proven to APPLY here: brandTheme turns the hex into
 *       theme variables and the style tag carries them.
 *
 * The app name stays Luminous StockHaven throughout — no endpoint
 * accepts a new app name, and the test proves an `app_name` field in
 * the patch is ignored, not stored.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  close,
  req,
  ownerWithBusiness,
  registerVerifiedUser,
} from './helpers.js';

after(close);

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('Settings save lands: name, brand color, language, contact details', async () => {
  const owner = await ownerWithBusiness('whitelabel-save@example.com');
  const res = await req(`/api/businesses/${owner.business.id}`, {
    method: 'PATCH',
    body: {
      name: 'The Cozy Corner',
      tagline: 'Books and quiet',
      brand_color: '#7D4B34',
      contact_email: 'hello@cozy.example',
      contact_phone: '505-555-0100',
      website: 'https://cozy.example',
      address: '1 Main St, Santa Fe, NM',
      currency: 'USD',
      date_format: 'd MMM yyyy',
      unit_system: 'metric',
      language: 'en',
    },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.name, 'The Cozy Corner');
  assert.equal(res.json.brand_color, '#7d4b34');
  assert.equal(res.json.language, 'en');
  assert.equal(res.json.contact_email, 'hello@cozy.example');
  assert.equal(res.json.unit_system, 'metric');

  // It persists: a fresh list read shows the saved values.
  const list = await req('/api/businesses', { cookie: owner.cookie });
  const saved = list.json.items.find((b) => b.id === owner.business.id);
  assert.equal(saved.name, 'The Cozy Corner');
  assert.equal(saved.brand_color, '#7d4b34');
  assert.equal(saved.tagline, 'Books and quiet');
});

test('a row holding a retired silent default heals to the cream-tan on read', async () => {
  const owner = await ownerWithBusiness('whitelabel-heal@example.com');
  const patch = (body) =>
    req(`/api/businesses/${owner.business.id}`, { method: 'PATCH', body, cookie: owner.cookie });

  // The bronze #6d4c26 was the shipped default for a few hours on
  // Nov 14, 2026 and silently stamped rows saved in that window (the
  // owner's live workspace among them). The stamp still lands in the
  // row on save, but the serializer resolves it — and the retired
  // teal — to the cream-tan default on every read: the heal is a
  // read-time resolution, no production data write.
  const bronze = await patch({ brand_color: '#6D4C26' });
  assert.equal(bronze.status, 200);
  assert.equal(bronze.json.brand_color, '#e3d5bf');
  const teal = await patch({ brand_color: '#145042' });
  assert.equal(teal.status, 200);
  assert.equal(teal.json.brand_color, '#e3d5bf');
  const list = await req('/api/businesses', { cookie: owner.cookie });
  const saved = list.json.items.find((b) => b.id === owner.business.id);
  assert.equal(saved.brand_color, '#e3d5bf');

  // A genuinely chosen color — even a bronze one step off the old
  // stamp — still wins, untouched.
  const custom = await patch({ brand_color: '#6d4c27' });
  assert.equal(custom.status, 200);
  assert.equal(custom.json.brand_color, '#6d4c27');
});

test('Settings save refuses bad values and strangers — and ignores app_name', async () => {
  const owner = await ownerWithBusiness('whitelabel-guards@example.com');
  const patch = (body, cookie = owner.cookie) =>
    req(`/api/businesses/${owner.business.id}`, { method: 'PATCH', body, cookie });

  const badColor = await patch({ brand_color: 'not-a-color' });
  assert.equal(badColor.status, 400);
  const badLanguage = await patch({ language: 'es' });
  assert.equal(badLanguage.status, 400);
  const badName = await patch({ name: '' });
  assert.equal(badName.status, 400);
  const badEmail = await patch({ contact_email: 'not-an-email' });
  assert.equal(badEmail.status, 400);

  // The app name is not changeable: the field is dropped, the saved
  // name is untouched, and no app_name comes back.
  const renamed = await patch({ name: 'Still My Store', app_name: 'Some Other App' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.name, 'Still My Store');
  assert.equal(renamed.json.app_name, undefined);

  // A stranger (not even a member) cannot save on this business.
  const stranger = await registerVerifiedUser('whitelabel-stranger@example.com');
  const forbidden = await patch({ name: 'Hijacked' }, stranger.cookie);
  assert.equal(forbidden.status, 403);
  const list = await req('/api/businesses', { cookie: owner.cookie });
  assert.equal(list.json.items[0].name, 'Still My Store');

  const signedOut = await req(`/api/businesses/${owner.business.id}`, {
    method: 'PATCH',
    body: { name: 'Nope' },
  });
  assert.equal(signedOut.status, 401);
});

test('store-logo upload stores the image on the business record', async () => {
  const owner = await ownerWithBusiness('whitelabel-logo@example.com');
  const upload = (dataUrl, cookie = owner.cookie) =>
    req(`/api/businesses/${owner.business.id}/logo`, {
      method: 'POST',
      body: { dataUrl },
      cookie,
    });

  const ok = await upload(TINY_PNG);
  assert.equal(ok.status, 200);
  assert.ok(ok.json.logo_url.startsWith('data:image/png;base64,'));

  const list = await req('/api/businesses', { cookie: owner.cookie });
  assert.equal(list.json.items[0].logo_url, TINY_PNG);

  // Wrong type, oversize, and strangers are all refused.
  const wrongType = await upload('data:text/plain;base64,aGVsbG8=');
  assert.equal(wrongType.status, 400);
  // Over the universal 25 MB ceiling (owner ruling, Nov 23, 2026):
  // the logo path's widened parser lets the body through, so the
  // route's own clear 400 answers (not the parser's 413).
  const huge = await upload(`data:image/png;base64,${Buffer.alloc(25 * 1024 * 1024 + 1, 0x41).toString('base64')}`);
  assert.equal(huge.status, 400);
  const stranger = await registerVerifiedUser('whitelabel-logo-stranger@example.com');
  const forbidden = await upload(TINY_PNG, stranger.cookie);
  assert.equal(forbidden.status, 403);
});

test('the bronze heal holds on a Business-plan workspace too', async () => {
  // The heal lives in the serializer every plan reads through —
  // pinned here under Business as well as Essentials (owner
  // requirement, Nov 14, 2026: fixes land on both plans).
  const owner = await ownerWithBusiness('whitelabel-heal-biz@example.com', 'Biz Heal Shop', { plan: 'business' });
  const patch = (body) =>
    req(`/api/businesses/${owner.business.id}`, { method: 'PATCH', body, cookie: owner.cookie });
  const bronze = await patch({ brand_color: '#6D4C26' });
  assert.equal(bronze.status, 200);
  assert.equal(bronze.json.brand_color, '#e3d5bf');
  const custom = await patch({ brand_color: '#6d4c27' });
  assert.equal(custom.status, 200);
  assert.equal(custom.json.brand_color, '#6d4c27');
});
