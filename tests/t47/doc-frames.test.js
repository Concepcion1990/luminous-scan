/**
 * T47 — Document frames, banner sizes and the printed-at stamp
 * (release 350, Nov 23, 2026).
 *
 * The owner's rulings, pinned:
 *  - The Studio's border frame frames the FULL printed page (a
 *    print-fixed overlay at the page's edge), not just the
 *    document block; the root no longer carries the border.
 *  - Header/footer decorations render as full-width banners at
 *    their NATURAL proportions (contain, never stretched), sized
 *    by the owner's new Studio width/length controls; unset
 *    sizes render exactly as documents always have.
 *    (Superseded in part by release 353, Nov 23, 2026: a SIZED
 *    banner now stretches to fill the band — see t50. The
 *    unsized shape pinned here is unchanged.)
 *  - The bottom decoration anchors at the page bottom on paper
 *    (its wrapper is print-fixed to the sheet's bottom edge).
 *  - A printed-at stamp (date + time, the reader's locale) prints
 *    on EVERY Studio document — invoice, receipt, packing slip,
 *    purchase order + its packing slip, return document, count
 *    sheet, pick list, product sheet — and NEVER on the 4×6
 *    shipping label.
 *  - PurchaseOrderDoc wears the Studio (owner ruling, Nov 20,
 *    2026): PrintCenter hands it the style like every sibling.
 *  - The server sanitizer is the wall for the new sizes: whole
 *    numbers inside the sane ranges or the whole save is refused.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { close, req, ownerWithBusiness } from './helpers.js';
import { sanitizeDocStyle } from '../../server/authRoutes.js';
import {
  resolveDocStyle,
  docRootStyle,
  docFrameStyle,
  decoImageStyle,
  formatPrintedAt,
  DEFAULT_DOC_STYLE,
} from '../../src/lib/docStyle.js';
import { LOCALES } from '../../src/lib/i18n.js';

after(close);

const PHOTO_URL = '/api/photos/123e4567-e89b-12d3-a456-426614174000';

test('sanitizer: decoration sizes are kept in range and refused whole out of it', () => {
  const good = sanitizeDocStyle({
    headerImage: PHOTO_URL, footerImage: PHOTO_URL,
    headerWidth: 50, headerLength: 40, footerWidth: 100, footerLength: 4,
  });
  assert.equal(good.headerWidth, 50);
  assert.equal(good.headerLength, 40);
  assert.equal(good.footerWidth, 100);
  assert.equal(good.footerLength, 4);
  // The range edges are good values.
  assert.equal(sanitizeDocStyle({ headerWidth: 10 }).headerWidth, 10);
  assert.equal(sanitizeDocStyle({ headerWidth: 100 }).headerWidth, 100);
  assert.equal(sanitizeDocStyle({ footerLength: 100 }).footerLength, 100);
  // Absent and explicit null both mean unset.
  assert.equal(sanitizeDocStyle({}).headerWidth, null);
  assert.equal(sanitizeDocStyle({ headerWidth: null }).headerWidth, null);
  // A JSON string (the column's shape) carries sizes too.
  assert.equal(sanitizeDocStyle(JSON.stringify({ footerWidth: 75 })).footerWidth, 75);
  // Anything off the range — or not a whole number — refuses the
  // WHOLE style, exactly like an off-whitelist font.
  for (const bad of [
    { headerWidth: 9 }, { headerWidth: 101 }, { headerLength: 3 }, { headerLength: 101 },
    { footerWidth: 50.5 }, { footerLength: '40' }, { headerWidth: true }, { footerWidth: -50 },
  ]) {
    assert.equal(sanitizeDocStyle(bad), null, JSON.stringify(bad));
  }
});

test('doc style API: sizes save with the style and read back resolved', async () => {
  const owner = await ownerWithBusiness('t47-frames@example.com');
  const style = {
    color: true, font: 'serif', border: 'single',
    headerImage: PHOTO_URL, footerImage: PHOTO_URL,
    headerWidth: 60, headerLength: 30, footerWidth: 80, footerLength: 20,
  };
  const saved = await req(`/api/businesses/${owner.business.id}`, {
    method: 'PATCH', body: { doc_style: style }, cookie: owner.cookie,
  });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json.doc_style, style);

  // An out-of-range size in a later save is refused whole — the
  // previously saved style is still the one that reads back.
  const refused = await req(`/api/businesses/${owner.business.id}`, {
    method: 'PATCH', body: { doc_style: { ...style, headerWidth: 500 } }, cookie: owner.cookie,
  });
  assert.equal(refused.status, 400, refused.text);
  const list = await req('/api/businesses', { cookie: owner.cookie });
  const business = list.json.items.find((b) => b.id === owner.business.id);
  assert.deepEqual(business.doc_style, style);
});

test('resolve: stored sizes resolve, junk sizes fall back to unset', () => {
  assert.deepEqual(resolveDocStyle(null), DEFAULT_DOC_STYLE);
  assert.deepEqual(resolveDocStyle({ doc_style: 'junk' }), DEFAULT_DOC_STYLE);
  const resolved = resolveDocStyle({
    doc_style: { headerWidth: 33, headerLength: 12, footerWidth: 500, footerLength: 'x' },
  });
  assert.equal(resolved.headerWidth, 33);
  assert.equal(resolved.headerLength, 12);
  assert.equal(resolved.footerWidth, null, 'out-of-range reads back unset, never breaks');
  assert.equal(resolved.footerLength, null);
});

test('frame: the root no longer carries the border — the overlay spec does', () => {
  const style = { ...DEFAULT_DOC_STYLE, border: 'single' };
  const root = docRootStyle(style, '#123456');
  assert.equal(root.border, undefined, 'the frame left the document root');
  assert.equal(root.padding, '5mm', 'the root keeps the frame padding so words clear the line');
  assert.deepEqual(docFrameStyle(style, '#123456'), { border: '1pt solid #000' });
  // Color printing on + a brand color: the frame follows the brand.
  assert.deepEqual(
    docFrameStyle({ ...style, color: true }, '#123456'),
    { border: '1pt solid #123456' },
  );
  assert.deepEqual(
    docFrameStyle({ ...DEFAULT_DOC_STYLE, border: 'double' }),
    { border: '2.5pt double #000' },
  );
  assert.equal(docFrameStyle(DEFAULT_DOC_STYLE), null, 'no frame chosen, no overlay');
  assert.equal(docRootStyle(DEFAULT_DOC_STYLE).padding, undefined);
});

test('banners: unsized renders as always; owner sizes stretch to the band (353)', () => {
  const plain = { ...DEFAULT_DOC_STYLE, headerImage: PHOTO_URL };
  assert.deepEqual(decoImageStyle(plain, 'header'), {
    display: 'block', width: '100%', maxHeight: '24mm', objectFit: 'contain', marginInline: 'auto',
  });
  // The receipt's own long-standing cap is the default there.
  assert.equal(decoImageStyle(plain, 'header', 18).maxHeight, '18mm');
  // Release 353 (her ruling, Nov 23, 2026): a sized banner
  // STRETCHES to fill the exact band — width as set, length as
  // an exact height, object-fit fill. (350 pinned contain here;
  // her hand-proof — a square picture letterboxed to a small
  // centered square at width 100% / length 10mm — superseded
  // it. The full size matrix lives in t50.)
  const sized = { ...plain, headerWidth: 50, headerLength: 40 };
  const applied = decoImageStyle(sized, 'header');
  assert.equal(applied.width, '50%');
  assert.equal(applied.height, '40mm');
  assert.equal(applied.maxHeight, undefined, 'a set length is the exact band height, not a cap');
  assert.equal(applied.objectFit, 'fill', 'a sized banner stretches to fill its band');
});

test('stamp words: date + time in the reader’s own locale', () => {
  const when = new Date('2026-11-23T15:04:00');
  const en = formatPrintedAt(when, 'en');
  assert.match(en.date, /November 23, 2026/);
  assert.match(en.time, /3:04\s?PM/);
  const es = formatPrintedAt(when, 'es-MX');
  assert.match(es.date, /noviembre/);
  assert.notEqual(es.date, en.date);
  // A locale the runtime rejects falls back instead of throwing.
  const fallback = formatPrintedAt(when, 'not-a-locale!!');
  assert.ok(fallback.date && fallback.time);
});

test('wiring: the whole Studio family carries frame, banners and stamp', () => {
  for (const file of ['CustomerDoc', 'CountSheet', 'PickList', 'ReturnDoc', 'PurchaseOrderDoc']) {
    const src = readFileSync(`src/components/print/${file}.jsx`, 'utf8');
    assert.match(src, /from '\.\/DocChrome'/, `${file} imports the shared chrome`);
    assert.match(src, /<DocFrame/, `${file} renders the frame`);
    assert.match(src, /<DecoHeader/, `${file} renders the top banner`);
    assert.match(src, /<DecoFooter/, `${file} renders the bottom banner`);
    assert.match(src, /<PrintedAt/, `${file} prints the stamp`);
  }
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  assert.match(
    page,
    /<PurchaseOrderDoc[^>]*docStyle=\{docStyle\}/,
    'PrintCenter hands the purchase order the style, like every sibling',
  );
});

test('wiring: the shipping label never carries the stamp or the frame', () => {
  const label = readFileSync('src/components/print/ShippingLabelDoc.jsx', 'utf8');
  assert.doesNotMatch(label, /DocChrome|PrintedAt|printedAt|DocFrame/);
});

test('wiring: on the product sheet only — labels stay ruled', () => {
  const card = readFileSync('src/components/print/LabelCard.jsx', 'utf8');
  const sheetAt = card.indexOf('// Product sheet');
  assert.ok(sheetAt > 0);
  const stamps = [...card.matchAll(/<PrintedAt/g)].map((m) => m.index);
  assert.equal(stamps.length, 1, 'exactly one stamp, on the sheet');
  assert.ok(stamps[0] > sheetAt, 'the stamp lives in the sheet branch only');
});

test('print stylesheet: the frame fills the page and the bottom banner anchors', () => {
  const css = readFileSync('src/index.css', 'utf8');
  assert.match(css, /\.doc-frame-page\s*\{\s*position: fixed;\s*inset: 0;/);
  assert.match(css, /\.doc-deco-bottom\s*\{\s*position: fixed;\s*left: 0;\s*right: 0;\s*bottom: 0;/);
});

test('studio: the size controls are wired to the style fields', () => {
  const studio = readFileSync('src/components/print/DocStyleStudio.jsx', 'utf8');
  for (const key of ['print.style.imageWidth', 'print.style.imageLength', 'print.style.imageSizeHint']) {
    assert.ok(studio.includes(key), `the Studio speaks ${key}`);
  }
  assert.match(studio, /sizeField\(slot, 'Width'/);
  assert.match(studio, /sizeField\(slot, 'Length'/);
});

test('keyset: the four new keys exist in all 52 locales (5130)', () => {
  assert.equal(Object.keys(LOCALES.en).length, 5958);
  for (const [code, strings] of Object.entries(LOCALES)) {
    assert.equal(Object.keys(strings).length, 5958, code);
    for (const key of ['print.printedAt', 'print.style.imageWidth', 'print.style.imageLength', 'print.style.imageSizeHint']) {
      assert.equal(typeof strings[key], 'string', `${code} ${key}`);
      assert.ok(strings[key].length > 0, `${code} ${key}`);
    }
    assert.match(strings['print.printedAt'], /\{date\}/, `${code} stamp date placeholder`);
    assert.match(strings['print.printedAt'], /\{time\}/, `${code} stamp time placeholder`);
  }
});
