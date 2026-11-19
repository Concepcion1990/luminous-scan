/**
 * T28 — Document Style Studio (Scope B, Nov 14, 2026).
 *
 * The owner's design, pinned:
 *  - One per-business style (logo comes from Settings; color on/off;
 *    a font from the small set; a frame from the starter set; header
 *    and footer decoration images) saved through the owner-only
 *    business PATCH and handed back resolved on the business itself.
 *  - The server sanitizer is the wall: a style carrying an unknown
 *    font/border, a non-boolean color, or a decoration image that
 *    does not point at this app's own photo pipeline is refused
 *    whole (the save fails, the old style stays) — a style can
 *    never smuggle in an outside URL. Reads never break: a stored
 *    value that no longer parses reads back as the plain default.
 *  - The style dresses the letter-size family in the Print Center;
 *    tiny labels, the ruled price tag, the exempt storage-bin label
 *    and the 4×6 shipping label are untouched (source pins).
 *  - Plans parity: the style line renders on Plans AND Welcome for
 *    both plans, with a comparison row (both true).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { close, req, ownerWithBusiness } from './helpers.js';
import { PLANS, WELCOME_OPTIONS, COMPARISON_ROWS } from '../../src/lib/plans.js';
import { sanitizeDocStyle, DEFAULT_DOC_STYLE } from '../../server/authRoutes.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';

after(close);

const PHOTO_URL = '/api/photos/123e4567-e89b-12d3-a456-426614174000';

test('doc style: the sanitizer keeps good values and refuses the rest whole', () => {
  const good = sanitizeDocStyle({
    color: true, font: 'serif', border: 'double',
    headerImage: PHOTO_URL, footerImage: PHOTO_URL,
  });
  assert.deepEqual(good, {
    color: true, font: 'serif', border: 'double',
    headerImage: PHOTO_URL, footerImage: PHOTO_URL,
  });
  // Missing pieces fill from the defaults.
  assert.deepEqual(sanitizeDocStyle({}), DEFAULT_DOC_STYLE);
  assert.deepEqual(sanitizeDocStyle(''), DEFAULT_DOC_STYLE);
  // A JSON string is accepted (the column stores one).
  assert.equal(sanitizeDocStyle(JSON.stringify({ font: 'sans' })).font, 'sans');
  // Anything off-whitelist refuses the WHOLE style (null) — the
  // save fails and the previously saved style stays untouched.
  assert.equal(sanitizeDocStyle({ font: 'comic-sans' }), null);
  assert.equal(sanitizeDocStyle({ border: 'neon' }), null);
  assert.equal(sanitizeDocStyle({ color: 'yes' }), null);
  assert.equal(sanitizeDocStyle('not json at all'), null);
  assert.equal(sanitizeDocStyle(null), null);
  assert.equal(sanitizeDocStyle([1, 2]), null);
  // Outside URLs are NOT decoration images in this app.
  assert.equal(sanitizeDocStyle({ headerImage: 'https://evil.example/x.png' }), null);
  assert.equal(sanitizeDocStyle({ headerImage: '/api/photos/not-a-uuid' }), null);
});

test('doc style: a fresh business reads back the plain default style', async () => {
  const owner = await ownerWithBusiness('t28-style-fresh@example.com');
  const list = await req('/api/businesses', { cookie: owner.cookie });
  assert.equal(list.status, 200, list.text);
  const business = list.json.items.find((b) => b.id === owner.business.id);
  assert.ok(business, 'the business is listed for its owner');
  assert.deepEqual(business.doc_style, DEFAULT_DOC_STYLE);
});

test('doc style: the owner saves a style and it reads back resolved', async () => {
  const owner = await ownerWithBusiness('t28-style-save@example.com');
  const style = {
    color: true, font: 'typewriter', border: 'dashed',
    headerImage: PHOTO_URL, footerImage: '',
  };
  const saved = await req(`/api/businesses/${owner.business.id}`, {
    method: 'PATCH',
    body: { doc_style: style },
    cookie: owner.cookie,
  });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json.doc_style, style);

  // An invalid font in a later save is refused whole — and the
  // previously saved style is still the one that reads back.
  const refused = await req(`/api/businesses/${owner.business.id}`, {
    method: 'PATCH',
    body: { doc_style: { ...style, font: 'wingdings' } },
    cookie: owner.cookie,
  });
  assert.equal(refused.status, 400, refused.text);
  const list = await req('/api/businesses', { cookie: owner.cookie });
  const business = list.json.items.find((b) => b.id === owner.business.id);
  assert.deepEqual(business.doc_style, style);
});

test('plans parity: the document-style line shows on Plans and Welcome, both plans', () => {
  const LINE = 'Documents in your own style — logo, color, font, frame and pictures';
  assert.ok(PLANS.essentials.includes.includes(LINE), 'Essentials PLANS');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(welcomeEssentials.includes.includes(LINE), 'Welcome essentials');
  // Dedupe ruling (Nov 19, 2026): Business has the feature, but
  // its lists no longer repeat the Essentials line — the
  // "Everything in Essentials" opener carries it.
  assert.ok(!PLANS.business.includes.includes(LINE), 'Business PLANS does not repeat the line');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(!welcomeBusiness.includes.includes(LINE), 'Welcome business does not repeat the line');
  const row = COMPARISON_ROWS.find((r) => r.label === LINE);
  assert.ok(row, 'comparison row exists');
  assert.equal(row.essentials, true);
  assert.equal(row.business, true);
});

test('print center: the studio and the carrier panel are wired into the shipping + preview flow', () => {
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  assert.match(page, /import DocStyleStudio from '@\/components\/print\/DocStyleStudio';/);
  assert.match(page, /import CarrierLabelPanel, \{ useCarrierLabel \} from '@\/components\/print\/CarrierLabelPanel';/);
  assert.match(page, /<DocStyleStudio/);
  assert.match(page, /<CarrierLabelPanel/);
  // The style reaches the whole letter-size family.
  for (const marker of [
    /<CustomerDoc[\s\S]*?docStyle=\{docStyle\}/,
    /<ReturnDoc[\s\S]*?docStyle=\{docStyle\}/,
    /<Sheet[\s\S]*?docStyle=\{docStyle\}/,
    /<LabelCard[\s\S]*?docStyle=\{docStyle\}/,
  ]) assert.match(page, marker);
  // The uploaded label prints at true 4×6 through a named page.
  assert.match(page, /carrier-label-page/);
  const css = readFileSync('src/index.css', 'utf8');
  assert.match(css, /@page carrierLabel \{\s*size: 102mm 152mm;\s*margin: 0;?\s*\}/);
  assert.match(css, /print-color-adjust: exact/);
});

test('print center: the studio is boss-only (owner/admin), the carrier panel is for everyone', () => {
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  assert.match(page, /\{isBoss\(user, profile\) && \(\s*<DocStyleStudio/);
});

test('guard: ruled layouts stay ruled — bin label and price tag untouched by the style', () => {
  const card = readFileSync('src/components/print/LabelCard.jsx', 'utf8');
  // LabelCard branches on the template string: 'price' and 'bin'
  // return early; the fall-through return is the product sheet —
  // the only styled branch. Every USE of the style (docStyle?.)
  // lives in that final sheet return, after both early returns, so
  // the ruled price tag and the exempt storage-bin label print
  // exactly as they always have.
  const sheetAt = card.indexOf('// Product sheet');
  assert.ok(sheetAt > 0, 'the product-sheet branch is present');
  const uses = [...card.matchAll(/docStyle\?\./g)].map((m) => m.index);
  assert.ok(uses.length >= 2, 'the sheet branch does use the style');
  assert.ok(uses.every((i) => i > sheetAt), 'no style use outside the sheet branch');
});

test('training: the three extended lessons carry the new step 5 in BOTH catalogs', () => {
  for (const lessons of [CLIENT_LESSONS, SERVER_LESSONS]) {
    const byId = new Map(lessons.map((l) => [l.id, l]));
    assert.equal(byId.get('owner-shipping-labels').steps, 5);
    assert.equal(byId.get('print-shipping-label').steps, 5);
    assert.equal(byId.get('owner-printing').steps, 5);
  }
});
