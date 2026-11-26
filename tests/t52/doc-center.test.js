/**
 * T52 — Decorations center on the page (release 355,
 * Nov 23, 2026).
 *
 * The owner set both Studio decorations to width 50% /
 * length 10mm and the strips did not sit centered on the
 * page. Her ruling: a decoration is ALWAYS centered — it
 * starts at the center and, as the owner widens it, grows
 * outward equally on each side until it reaches the set
 * width.
 *
 * The mechanism, measured in a real print PDF before the
 * fix: the BOTTOM banner's print wrapper (.doc-deco-bottom)
 * is fixed across the printable width, so its picture took
 * 50% of the PAGE's width and centered on the page. The TOP
 * banner rendered only inside the 180mm document root, so
 * its picture took 50% of the DOCUMENT's content width and
 * centered on the document — the two banners printed at
 * different widths around different centers.
 *
 * The fix (shared layer only — DocChrome + the print
 * stylesheet): the top banner renders twice. The in-flow
 * copy is the preview and holds the banner's space in the
 * layout; on paper it does not paint. A print-only band
 * copy is fixed across the top of the printable area — the
 * same span the bottom banner gets at the bottom — so the
 * picture's width is the set share of the PAGE's width and
 * its auto margins center it on the page. Size behavior is
 * exactly as 353 shipped (decoImageStyle is untouched);
 * only placement moved. The 80mm receipt is a slip, not a
 * page: it opts out of the band (band={false}) and its
 * banner stays centered inside the slip.
 *
 * The rendered proof (margins measured in a real print
 * PDF at 50%, 30%, 100% and unsized) lives in the release
 * harness; these pins hold the mechanics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { decoImageStyle, DEFAULT_DOC_STYLE } from '../../src/lib/docStyle.js';
import { LOCALES } from '../../src/lib/i18n.js';

const PHOTO_URL = '/api/photos/123e4567-e89b-12d3-a456-426614174000';

test('size behavior is 353 verbatim: the bands inherit it unchanged', () => {
  const style = {
    ...DEFAULT_DOC_STYLE,
    headerImage: PHOTO_URL, footerImage: PHOTO_URL,
    headerWidth: 50, headerLength: 10, footerWidth: 50, footerLength: 10,
  };
  for (const slot of ['header', 'footer']) {
    const applied = decoImageStyle(style, slot);
    assert.equal(applied.width, '50%', `${slot} width is the set share`);
    assert.equal(applied.height, '10mm', `${slot} length is exact`);
    assert.equal(applied.objectFit, 'fill', `${slot} still stretches (353)`);
    // The auto inline margins are what center the picture
    // inside whichever band contains it — document on
    // screen, page on paper.
    assert.equal(applied.marginInline, 'auto', `${slot} carries its centering margins`);
  }
});

test('chrome: the top banner renders an in-flow copy and a print band copy', () => {
  const chrome = readFileSync('src/components/print/DocChrome.jsx', 'utf8');
  // The band is on by default; a caller must opt out.
  assert.match(chrome, /export function DecoHeader\(\{ style, capMm = 24, band = true, className = '' \}\)/);
  // The in-flow copy is the preview and holds the space.
  // It carries the print-hidden flow class ONLY when a
  // band copy exists to paint in its place — a band-less
  // banner (the receipt slip) must keep painting itself.
  assert.match(chrome, /className=\{`doc-deco \$\{band \? 'doc-deco-flow ' : ''\}\$\{className\}`\}/);
  // The band copy exists only when the band is on, is
  // hidden from assistive tech (it is a second painting of
  // the same decorative picture), and wears the band class.
  assert.match(chrome, /\{band && \(/);
  assert.match(chrome, /<div aria-hidden="true" className="doc-deco-top">/);
  // Both copies take the SAME computed style — one size
  // source, so the band can never drift from the preview's
  // size settings; only the containing band differs.
  const shared = chrome.match(/style=\{imgStyle\}/g) || [];
  assert.equal(shared.length, 2, 'flow copy and band copy share decoImageStyle output');
  assert.match(chrome, /const imgStyle = decoImageStyle\(style, 'header', capMm\);/);
});

test('chrome: the bottom banner keeps its 350 wrapper (the mechanism the top now mirrors)', () => {
  const chrome = readFileSync('src/components/print/DocChrome.jsx', 'utf8');
  assert.match(chrome, /export function DecoFooter\(\{ style, capMm = 24, anchor = true, className = '' \}\)/);
  assert.match(chrome, /anchor \? 'doc-deco-bottom' : ''/);
});

test('receipt fence: the slip opts out of the page band; the letter page does not', () => {
  const doc = readFileSync('src/components/print/CustomerDoc.jsx', 'utf8');
  const receipt = doc.match(/<DecoHeader style=\{docStyle\} capMm=\{18\}[^/]*\/>/);
  assert.ok(receipt, 'the receipt renders its header banner');
  assert.match(receipt[0], /band=\{false\}/, 'the receipt banner stays inside the slip');
  const letter = doc.match(/<DecoHeader style=\{docStyle\} className="mb-2" \/>/);
  assert.ok(letter, 'the letter branch renders its header banner with the band on');
});

test('stylesheet: the band is print-only, fixed across the printable top; the flow copy holds space without painting', () => {
  const css = readFileSync('src/index.css', 'utf8');
  // On screen the band copy never shows.
  const base = css.search(/\.doc-deco-top\s*\{\s*display: none;\s*\}/);
  assert.ok(base >= 0, 'the band is display:none outside print');
  // On paper it spans the printable width at the top —
  // the mirror of the bottom banner's span at the bottom.
  const bandPrint = css.search(/\.doc-deco-top\s*\{\s*display: block;\s*position: fixed;\s*top: 0;\s*left: 0;\s*right: 0;\s*\}/);
  assert.ok(bandPrint > base, 'the print band rule follows the screen rule');
  // The in-flow copy keeps its layout space (words never
  // move) but does not paint on paper.
  const flow = css.search(/\.doc-deco-flow\s*\{\s*visibility: hidden;\s*\}/);
  assert.ok(flow > base, 'the flow copy is visibility:hidden in print');
  // The bottom banner's 350 rule is untouched.
  assert.match(css, /\.doc-deco-bottom\s*\{\s*position: fixed;\s*left: 0;\s*right: 0;\s*bottom: 0;/);
});

test('keyset: no new strings in 355 (5130 ×52)', () => {
  assert.equal(Object.keys(LOCALES.en).length, 6006);
  for (const [code, strings] of Object.entries(LOCALES)) {
    assert.equal(Object.keys(strings).length, 6006, code);
  }
});
