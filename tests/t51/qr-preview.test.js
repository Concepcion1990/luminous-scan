/**
 * T51 — QR code preview in the product form (release 354,
 * Nov 23, 2026).
 *
 * Her ask, made while hand-testing the code generator on the
 * product form (Nov 23, ~2:53 AM): in the QR code value row,
 * between the value box and the little scanner button, show
 * the actual QR code picture itself — drawn live from whatever
 * value is in the box (typed, scanned, or generated; her test
 * flow that night minted SH-QC6ACQBQXV and the picture should
 * have appeared the moment the value landed).
 *
 * The pins:
 *  - the preview is drawn by the SAME renderer the printed
 *    labels use (QrSvg over lib/qr's qrMatrix), so the picture
 *    in the form is the code that prints;
 *  - it sits in the QR row only, between the input and the
 *    scanner button — no previews on the barcode/UPC/EAN rows;
 *  - it follows the trimmed value (the value that saves), and
 *    an empty box or a value the encoder cannot hold shows no
 *    picture at all — never a QR of the wrong value, never a
 *    broken image;
 *  - zero new strings: the picture needs no label, and QrSvg's
 *    aria-label reuses the standing print.qrLabel.
 *
 * The rendered proof (live redraw, pixel diff, real decode,
 * phone-width layout) lives in the release harness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { qrMatrix } from '../../src/lib/qr.js';
import { LOCALES } from '../../src/lib/i18n.js';

const form = readFileSync('src/components/products/ProductFormDialog.jsx', 'utf8');

test('encoder: her generated value encodes, and the picture follows the value', () => {
  const a = qrMatrix('SH-QC6ACQBQXV');
  assert.ok(a, 'the value she minted the night she asked encodes');
  assert.equal(a.modules.length, a.size);
  const b = qrMatrix('SH-DIFFERENT1');
  assert.ok(b, 'a second value encodes');
  assert.notDeepEqual(b.modules, a.modules, 'a different value draws a different code');
  const again = qrMatrix('SH-QC6ACQBQXV');
  assert.deepEqual(again.modules, a.modules, 'the same value always draws the same code');
});

test('encoder: a value too long for the code comes back null, so the form can stay silent', () => {
  assert.equal(qrMatrix('X'.repeat(63)), null, '63 characters exceed the encoder (versions 1-4, 62 max)');
  assert.ok(qrMatrix('X'.repeat(62)), '62 characters still encode');
});

test('wiring: the form draws the preview with the labels\u2019 own renderer', () => {
  assert.match(form, /import \{ qrMatrix \} from '@\/lib\/qr';/, 'the form imports the shared QR encoder');
  assert.match(form, /import QrSvg from '@\/components\/print\/QrSvg';/, 'the form imports the print renderer');
  const label = readFileSync('src/components/print/LabelCard.jsx', 'utf8');
  assert.match(label, /import QrSvg from '.\/QrSvg';/, 'the labels render with QrSvg');
  const svg = readFileSync('src/components/print/QrSvg.jsx', 'utf8');
  assert.match(svg, /import \{ qrMatrix \} from '@\/lib\/qr';/, 'QrSvg draws from qrMatrix — one hand for form and print');
});

test('wiring: the preview follows the trimmed value and stays silent when there is nothing true to show', () => {
  assert.match(
    form,
    /const qrPreviewValue = \(form\.qr_code \|\| ''\)\.trim\(\);/,
    'the preview value is the trimmed field value — the one that saves and prints',
  );
  assert.match(
    form,
    /const qrPreviewMatrix = qrPreviewValue \? qrMatrix\(qrPreviewValue\) : null;/,
    'an empty box never reaches the encoder, and an unencodable value yields no matrix',
  );
  assert.match(
    form,
    /\{qrPreviewMatrix && \(/,
    'the picture renders only when a true matrix exists',
  );
});

test('wiring: the picture sits in the QR row, between the box and the scanner button — QR row only', () => {
  const inputAt = form.indexOf('id="qr_code"');
  const previewAt = form.indexOf('data-tour="product-qr-preview"');
  const buttonAt = form.indexOf("openCodeScanner('qr_code')");
  assert.ok(inputAt > 0 && previewAt > inputAt, 'the preview follows the QR input');
  assert.ok(buttonAt > previewAt, 'the scanner button follows the preview');
  const uses = form.match(/<QrSvg/g) || [];
  assert.equal(uses.length, 1, 'exactly one QrSvg in the form — no previews on the barcode/UPC/EAN rows');
  assert.match(
    form,
    /<QrSvg value=\{qrPreviewValue\} className="block h-full w-full" \/>/,
    'the preview draws the live value',
  );
});

test('keyset: no new strings in 354 (5130 ×52)', () => {
  assert.equal(Object.keys(LOCALES.en).length, 7012);
  for (const [code, strings] of Object.entries(LOCALES)) {
    assert.equal(Object.keys(strings).length, 7012, code);
  }
});
