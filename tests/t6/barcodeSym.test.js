/**
 * Symbology by code type (owner ruling, Nov 14, 2026): a valid
 * 12-digit numeric code renders as a true UPC-A, a valid 13-digit
 * as EAN-13, anything else as Code 128 — all at natural
 * proportions. The owner's own shelf codes are the fixtures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  symbologyFor,
  isValidUpcA,
  isValidEan13,
  barcodeRects,
  upcARects,
  ean13Rects,
} from '../../src/lib/barcodeSym.js';
import { productToLabel } from '../../src/lib/labelPayload.js';
import { escPosLabelBytes } from '../../src/lib/escPos.js';

test('her shelf: both UPCs are valid UPC-A; the SKU copy stays Code 128', () => {
  assert.equal(symbologyFor('611269546019'), 'UPC-A'); // Red Bull
  assert.equal(symbologyFor('028400091510'), 'UPC-A'); // Doritos
  assert.equal(symbologyFor('RB-1-COPY'), 'CODE128');
  assert.equal(symbologyFor('RB-1'), 'CODE128');
  assert.equal(isValidUpcA('611269546019'), true);
  assert.equal(isValidUpcA('611269546018'), false); // bad check digit
});

test('a 13-digit code with a bad check digit falls back to Code 128, never a fake EAN', () => {
  assert.equal(isValidEan13('3111957486343'), false);
  assert.equal(symbologyFor('3111957486343'), 'CODE128');
  // A genuinely valid EAN-13 (check digit computed for 590123412345).
  assert.equal(isValidEan13('5901234123457'), true);
  assert.equal(symbologyFor('5901234123457'), 'EAN-13');
});

test('UPC-A and EAN-13 encode to the standard 95 modules with tall guard bars', () => {
  const upc = upcARects('611269546019');
  assert.equal(upc.width, 95);
  assert.ok(upc.rects.some((r) => r.tall));
  const ean = ean13Rects('5901234123457');
  assert.equal(ean.width, 95);
  const via = barcodeRects('028400091510');
  assert.equal(via.kind, 'UPC-A');
  assert.equal(via.width, 95);
});

test('the thermal payload carries the native symbology and ESC/POS speaks it', () => {
  const label = productToLabel({ name: '16oz Redbull', sku: 'RB-1', upc: '611269546019', price: 4.99 });
  assert.equal(label.codeType, 'UPC-A');
  const bytes = escPosLabelBytes(label);
  // GS k 0x41 (UPC-A, function B) with a 12-byte payload follows.
  const at = bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x6b && bytes[i + 2] === 0x41);
  assert.ok(at >= 0, 'ESC/POS emits the UPC-A command');
  assert.equal(bytes[at + 3], 12);

  const skuLabel = productToLabel({ name: 'Copy', sku: 'RB-1-COPY', price: 4.99 });
  assert.equal(skuLabel.codeType, 'CODE128');
  const skuBytes = escPosLabelBytes(skuLabel);
  const at128 = skuBytes.findIndex((b, i) => b === 0x1d && skuBytes[i + 1] === 0x6b && skuBytes[i + 2] === 0x49);
  assert.ok(at128 >= 0, 'ESC/POS keeps Code 128 for SKUs');
});

test('BarcodeSvg renders natural width in mm and the bin keeps the legacy stretch', () => {
  const svg = readFileSync(new URL('../../src/components/print/BarcodeSvg.jsx', import.meta.url), 'utf8');
  assert.match(svg, /MODULE_MM = 0\.25/);
  assert.match(svg, /width: `\$\{widthMm\}mm`/);
  assert.match(svg, /variant === 'legacy'/);
  const card = readFileSync(new URL('../../src/components/print/LabelCard.jsx', import.meta.url), 'utf8');
  assert.match(card, /variant="legacy"/); // the storage bin, exempt by her word
});
