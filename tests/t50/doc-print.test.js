/**
 * T50 — Preview = print (release 353, Nov 23, 2026).
 *
 * The owner's hand-proof of release 350 found three gaps
 * between the Print Center preview and the printed page, and
 * her rulings close them:
 *
 *  (a) THE STRIPS DIDN'T EXTEND. She set both decorations to
 *      width 100% / length 10mm and got small centered SQUARES:
 *      350 rendered a sized banner with object-fit: contain, so
 *      a square picture letterboxed inside its band. Her
 *      ruling: a sized picture STRETCHES to fill the exact band
 *      — "it'll really be up to them how wide they want it."
 *      Unsized banners render exactly as they always have.
 *  (b) THE PRINT DROPPED THE HEADER. The document preview
 *      shows the globe logo, the business name and the title;
 *      the printed page started bare. Root cause: DocHeader is
 *      a semantic <header>, and the print stylesheet's blanket
 *      `header { display: none }` rule — written to hide the
 *      app shell's top bar — hid the document's own header with
 *      it. Her standing rule: preview = print. The stylesheet
 *      now restores headers inside the print area.
 *  (c) APP FURNITURE ON THE PAPER. The universal Sign out link
 *      printed inside the count sheet's frame: its wrapper in
 *      the shell Layout carried no no-print (the © footer below
 *      it already did). The wrapper now carries no-print, so
 *      every print flow from the shell prints its document
 *      alone.
 *
 * The rendered proof (logo + title + stretched strip measured
 * in a real print PDF) lives in the release harness; these
 * pins hold the mechanics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { decoImageStyle, DEFAULT_DOC_STYLE } from '../../src/lib/docStyle.js';
import { LOCALES } from '../../src/lib/i18n.js';

const PHOTO_URL = '/api/photos/123e4567-e89b-12d3-a456-426614174000';

test('stretch: her exact settings — width 100, length 10 — fill the band exactly', () => {
  const style = {
    ...DEFAULT_DOC_STYLE,
    headerImage: PHOTO_URL, footerImage: PHOTO_URL,
    headerWidth: 100, headerLength: 10, footerWidth: 100, footerLength: 10,
  };
  for (const slot of ['header', 'footer']) {
    const applied = decoImageStyle(style, slot);
    assert.equal(applied.width, '100%', `${slot} spans the full width she set`);
    assert.equal(applied.height, '10mm', `${slot} is exactly the length she set`);
    assert.equal(applied.maxHeight, undefined, `${slot} length is a band height, not a cap`);
    assert.equal(applied.objectFit, 'fill', `${slot} stretches to fill the band`);
    assert.equal(applied.marginInline, 'auto');
  }
});

test('stretch: width-only and length-only bands still fill', () => {
  const base = { ...DEFAULT_DOC_STYLE, headerImage: PHOTO_URL };
  // Width only: the band is that wide; the document's standing
  // cap bounds its height and the picture fills the box.
  const widthOnly = decoImageStyle({ ...base, headerWidth: 50 }, 'header');
  assert.equal(widthOnly.width, '50%');
  assert.equal(widthOnly.maxHeight, '24mm');
  assert.equal(widthOnly.height, undefined);
  assert.equal(widthOnly.objectFit, 'fill');
  // The receipt's own cap rules its width-only band.
  assert.equal(decoImageStyle({ ...base, headerWidth: 50 }, 'header', 18).maxHeight, '18mm');
  // Length only: full width, exactly that tall.
  const lengthOnly = decoImageStyle({ ...base, headerLength: 12 }, 'header');
  assert.equal(lengthOnly.width, '100%');
  assert.equal(lengthOnly.height, '12mm');
  assert.equal(lengthOnly.maxHeight, undefined);
  assert.equal(lengthOnly.objectFit, 'fill');
});

test('stretch: each slot reads its own sizes', () => {
  const style = {
    ...DEFAULT_DOC_STYLE,
    headerImage: PHOTO_URL, footerImage: PHOTO_URL,
    headerWidth: 25, headerLength: 8, footerWidth: 75, footerLength: 20,
  };
  assert.equal(decoImageStyle(style, 'header').width, '25%');
  assert.equal(decoImageStyle(style, 'header').height, '8mm');
  assert.equal(decoImageStyle(style, 'footer').width, '75%');
  assert.equal(decoImageStyle(style, 'footer').height, '20mm');
});

test('unsized: renders exactly as documents always have (contain, capped)', () => {
  const plain = { ...DEFAULT_DOC_STYLE, headerImage: PHOTO_URL, footerImage: PHOTO_URL };
  assert.deepEqual(decoImageStyle(plain, 'header'), {
    display: 'block', width: '100%', maxHeight: '24mm', objectFit: 'contain', marginInline: 'auto',
  });
  assert.deepEqual(decoImageStyle(plain, 'footer', 18), {
    display: 'block', width: '100%', maxHeight: '18mm', objectFit: 'contain', marginInline: 'auto',
  });
});

test('print stylesheet: document headers inside the print area print', () => {
  const css = readFileSync('src/index.css', 'utf8');
  // The blanket chrome rule stays — the app shell's top bar
  // and sidebar still never print.
  const blanket = css.indexOf('aside,\n  header,\n  .no-print');
  assert.ok(blanket >= 0, 'the blanket print-hide rule is still there');
  // The carve-out: a header inside the print area is a
  // document's own header (logo, name, title) and prints.
  const carve = css.search(/\.print-area header\s*\{\s*display: block !important;/);
  assert.ok(carve > blanket, 'the print-area header carve-out follows the blanket rule');
});

test('shell: the universal sign-out never reaches the paper', () => {
  const layout = readFileSync('src/components/Layout.jsx', 'utf8');
  const linkAt = layout.indexOf('layout.signOutLink');
  assert.ok(linkAt > 0, 'the sign-out link is in the shell');
  const before = layout.slice(0, linkAt);
  const divAt = before.lastIndexOf('<div className=');
  assert.ok(divAt > 0, 'the sign-out link has a wrapper div');
  const wrapper = before.slice(divAt, divAt + 90);
  assert.ok(wrapper.includes('no-print'), `the sign-out wrapper carries no-print: ${wrapper}`);
  // The © footer below it keeps its own no-print (non-regression).
  const footer = readFileSync('src/components/LegalFooter.jsx', 'utf8');
  assert.match(footer, /<footer\s+className=\{`no-print/);
});

test('wiring: DocHeader stays semantic and every family member uses it', () => {
  const header = readFileSync('src/components/print/DocHeader.jsx', 'utf8');
  assert.match(header, /<header/, 'DocHeader keeps its semantic element — the fix is in the stylesheet');
  for (const file of ['CustomerDoc', 'CountSheet', 'PickList', 'ReturnDoc', 'PurchaseOrderDoc']) {
    const src = readFileSync(`src/components/print/${file}.jsx`, 'utf8');
    assert.match(src, /<DocHeader/, `${file} renders the shared document header`);
  }
});

test('keyset: no new strings in 353 (5130 ×52)', () => {
  assert.equal(Object.keys(LOCALES.en).length, 6976);
  for (const [code, strings] of Object.entries(LOCALES)) {
    assert.equal(Object.keys(strings).length, 6976, code);
  }
});
