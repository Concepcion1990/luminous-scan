/**
 * T72 — scanner coverage completion (owner's ruling, Nov 25, 2026:
 * "it should scan any number, any barcode, any code, anything") and her
 * HEART RULE: the scanner is the heart of the app, so every format that
 * read before the change is re-proven by execution after it, one by one,
 * and the three newly enabled formats (PDF417, Code 93, GS1 DataBar /
 * RSS-14) are proven the same way. A regression means the build does
 * not park.
 *
 * The proofs drive the real decoder stack (@zxing/library's
 * MultiFormatReader) with the factory's own shipped lists, imported
 * from src/lib/codeReader.js — not a copy — and a source pin keeps the
 * factory wired to those lists. Samples are known-good symbols
 * generated once with BWIPP (bwip-js) and committed as fixtures
 * (fixtures.json): 1D symbols as bar/space run widths, 2D symbols as
 * module rows. Two generation notes:
 *  - BWIPP's Code 93 encoder emits NO check characters; the Code 93
 *    spec mandates two (C and K, mod-47). The fixture's symbol carries
 *    them (computed per the spec), and the reader returns the payload
 *    with the checks stripped, as it should.
 *  - BWIPP's GS1 DataBar takes the AI syntax '(01)…' at generation;
 *    the reader returns the bare GTIN-14.
 *
 * UPC-E carries a pinned KNOWN DEFECT instead of a decode proof — see
 * the dedicated test below. The short version: @zxing/library 0.21.3's
 * UPCEANReader.decodeRow looks for the wrong end pattern on a UPC-E
 * symbol and then fails its own quiet-zone check on the end guard's
 * last bar, so a spec-correct UPC-E cannot decode through the ZXing
 * fallback in this library version. It fails identically with the
 * pre-change format list (proven at build time): this build did not
 * cause it and a config change cannot fix it. UPC-E stays enabled —
 * the native BarcodeDetector path reads it where the platform offers
 * it, and the pin turns red the day a library upgrade repairs the
 * reader, which is the day this note must be revisited.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
  NotFoundException,
} from '@zxing/library';
import { createCodeReader, ZXING_FORMATS, NATIVE_FORMATS } from '../../src/lib/codeReader.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const factorySource = readFileSync(new URL('../../src/lib/codeReader.js', import.meta.url), 'utf8');

const ORIGINAL_ELEVEN = [
  'QR_CODE', 'DATA_MATRIX', 'AZTEC', 'UPC_A', 'UPC_E', 'EAN_13', 'EAN_8',
  'CODE_128', 'CODE_39', 'ITF', 'CODABAR',
];

function factoryHints() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

/** Render a fixture to a BinaryBitmap exactly as proven at build time. */
function toBitmap(fixture) {
  const SCALE = fixture.kind === '1d' ? 3 : 4;
  const QUIET = fixture.kind === '1d' ? 30 : 16;
  let w;
  let h;
  let isBlack;
  if (fixture.kind === '1d') {
    const total = fixture.widths.reduce((a, b) => a + b, 0);
    w = QUIET * 2 + total * SCALE;
    h = 72;
    const runs = [];
    let x = QUIET;
    let black = true;
    for (const run of fixture.widths) {
      runs.push([x, x + run * SCALE, black]);
      x += run * SCALE;
      black = !black;
    }
    isBlack = (px) => runs.some(([a, b, isB]) => isB && px >= a && px < b);
  } else {
    const cols = fixture.rows[0].length;
    const rowsN = fixture.rows.length;
    w = QUIET * 2 + cols * SCALE;
    h = QUIET * 2 + rowsN * SCALE;
    isBlack = (px, py) => {
      const cx = Math.floor((px - QUIET) / SCALE);
      const cy = Math.floor((py - QUIET) / SCALE);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rowsN) return false;
      return fixture.rows[cy][cx] === '1';
    };
  }
  const rgb = new Int32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const g = isBlack(x, y) ? 0 : 255;
      rgb[y * w + x] = (g << 16) | (g << 8) | g;
    }
  }
  return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(rgb, w, h)));
}

test('the factory builds its ZXing hints from the shipped list (no drift)', () => {
  assert.match(factorySource, /hints\.set\(DecodeHintType\.POSSIBLE_FORMATS, ZXING_FORMATS\)/);
  assert.match(factorySource, /hints\.set\(DecodeHintType\.TRY_HARDER, true\)/);
  assert.match(factorySource, /NATIVE_FORMATS\.filter\(\(format\) => supported\.includes\(format\)\)/);
});

test('ZXing list: the original eleven plus PDF417, Code 93 and GS1 DataBar — nothing else', () => {
  const names = ZXING_FORMATS.map((f) => BarcodeFormat[f]).sort();
  assert.deepEqual(names, [...ORIGINAL_ELEVEN, 'PDF_417', 'CODE_93', 'RSS_14'].sort());
  // Held OFF on evidence (owner's ruling + the audit): RSS_EXPANDED's
  // reader carries the library's own "not ready for production"
  // warning; MAXICODE has no reader in the package at all.
  assert.ok(!ZXING_FORMATS.includes(BarcodeFormat.RSS_EXPANDED));
  assert.ok(!ZXING_FORMATS.includes(BarcodeFormat.MAXICODE));
});

test('native list: thirteen — the eleven plus code_93 and pdf417 (the API has no DataBar value)', () => {
  assert.deepEqual(NATIVE_FORMATS, [
    'qr_code', 'data_matrix', 'aztec', 'pdf417', 'upc_a', 'upc_e', 'ean_13',
    'ean_8', 'code_128', 'code_39', 'code_93', 'itf', 'codabar',
  ]);
});

// The heart rule, executed: every decodable format, one by one, with
// the shipped configuration. UPC-E is the single pinned exception
// below; the other ten originals and the three additions all prove here.
for (const [id, fixture] of Object.entries(fixtures)) {
  if (fixture.expect === null) continue;
  test(`decodes: ${fixture.format} (${id})`, () => {
    const result = new MultiFormatReader().decode(toBitmap(fixture), factoryHints());
    assert.equal(result.getText(), fixture.expect);
    assert.equal(BarcodeFormat[result.getBarcodeFormat()], fixture.format);
  });
}

test('UPC-E: pinned known defect in @zxing/library 0.21.3 (ZXing path only)', () => {
  // The fixture is a spec-correct UPC-E (digits, L/G parity and the
  // UPC-A checksum all verify against the reader's own tables). The
  // library's decodeRow nevertheless throws NotFound: it searches for
  // the EAN end pattern inside UPC-E's 010101 end guard and its
  // quiet-zone check then trips on the guard's own last bar. Proven
  // identical under the pre-change list — pre-existing, not a
  // regression. UPC-E stays in the list: the native path reads it, and
  // this pin is the tripwire for a future library fix.
  const fixture = fixtures.upc_e;
  assert.ok(ZXING_FORMATS.includes(BarcodeFormat.UPC_E));
  assert.throws(
    () => new MultiFormatReader().decode(toBitmap(fixture), factoryHints()),
    NotFoundException,
  );
});

test('native path: the factory hands the detector the new formats, filtered by the platform', async () => {
  const ALL_NATIVE = [
    'aztec', 'code_128', 'code_39', 'code_93', 'codabar', 'data_matrix',
    'ean_13', 'ean_8', 'itf', 'pdf417', 'qr_code', 'upc_a', 'upc_e',
  ];
  let constructedWith = null;
  class FakeBarcodeDetector {
    static async getSupportedFormats() {
      return ALL_NATIVE;
    }
    constructor({ formats }) {
      constructedWith = formats;
    }
    async detect() {
      return [{ rawValue: '9781974720149' }];
    }
  }
  globalThis.window = { BarcodeDetector: FakeBarcodeDetector };
  try {
    const reader = await createCodeReader();
    assert.equal(reader.engine, 'native');
    assert.deepEqual(constructedWith, NATIVE_FORMATS);
    assert.ok(constructedWith.includes('code_93'));
    assert.ok(constructedWith.includes('pdf417'));
    assert.equal(await reader.read({}), '9781974720149');
  } finally {
    delete globalThis.window;
  }
});

test('native path: a platform without PDF417 simply never offers it', async () => {
  let constructedWith = null;
  class PartialBarcodeDetector {
    static async getSupportedFormats() {
      return ['qr_code', 'code_93', 'ean_13'];
    }
    constructor({ formats }) {
      constructedWith = formats;
    }
    async detect() {
      return [];
    }
  }
  globalThis.window = { BarcodeDetector: PartialBarcodeDetector };
  try {
    const reader = await createCodeReader();
    assert.equal(reader.engine, 'native');
    assert.deepEqual(constructedWith, ['qr_code', 'ean_13', 'code_93']);
    assert.equal(await reader.read({}), null);
  } finally {
    delete globalThis.window;
  }
});

test('ZXing path: without a native detector the factory builds the JavaScript reader', async () => {
  const reader = await createCodeReader();
  assert.equal(reader.engine, 'zxing');
  assert.equal(typeof reader.read, 'function');
});
