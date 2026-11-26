/**
 * T73 — the standalone supplement reader (owner's ruling, Nov 25,
 * 2026: "we want to build ourselves; no purchase") and her HEART
 * RULE, doubled for decoder surgery: every format proven at the
 * coverage build is re-proven after this change (the full t72 group
 * re-runs in the suite, and this group additionally runs the new
 * supplement pass itself over every one of those fixtures), the
 * supplements decode from real generated samples, and the
 * false-positive guards are proven to bite.
 *
 * Fixtures (fixtures.json) are BWIPP-generated run widths, the same
 * stock as t72. The two corrupted fixtures come from a from-spec
 * constructor the generator first proved byte-identical to BWIPP on
 * every valid value used: a digit swapped under the SAME parity
 * letter, so every digit still decodes cleanly and only the
 * checksum/parity validation can refuse the read.
 *
 * The combined fixture is the owner's own hand-test pair — her
 * manga's ISBN-13 with its 51199 price add-on beside it: the main
 * code must win through the normal decode path, unchanged.
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
} from '@zxing/library';
import AbstractUPCEANReader from '@zxing/library/cjs/core/oned/AbstractUPCEANReader.js';
import { createCodeReader, ZXING_FORMATS } from '../../src/lib/codeReader.js';
import { readSupplementFromBitmap, readSupplementFromCanvas } from '../../src/lib/supplementReader.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const coverageFixtures = JSON.parse(readFileSync(new URL('../t72/fixtures.json', import.meta.url), 'utf8'));
const factorySource = readFileSync(new URL('../../src/lib/codeReader.js', import.meta.url), 'utf8');
const supplementSource = readFileSync(new URL('../../src/lib/supplementReader.js', import.meta.url), 'utf8');

function factoryHints() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

/** Render a 1D run-width fixture to a BinaryBitmap, as in t72. */
function toBitmap1d(widths) {
  const SCALE = 3;
  const QUIET = 30;
  const total = widths.reduce((a, b) => a + b, 0);
  const w = QUIET * 2 + total * SCALE;
  const h = 72;
  const runs = [];
  let x = QUIET;
  let black = true;
  for (const run of widths) {
    runs.push([x, x + run * SCALE, black]);
    x += run * SCALE;
    black = !black;
  }
  const rgb = new Int32Array(w * h);
  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const isB = runs.some(([a, b, isBlack]) => isBlack && px >= a && px < b);
      const g = isB ? 0 : 255;
      rgb[py * w + px] = (g << 16) | (g << 8) | g;
    }
  }
  return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(rgb, w, h)));
}

/** Render a t72 fixture (1D widths or 2D module rows), as in t72. */
function toBitmap(fixture) {
  if (fixture.kind === '1d') return toBitmap1d(fixture.widths);
  const SCALE = 4;
  const QUIET = 16;
  const cols = fixture.rows[0].length;
  const rowsN = fixture.rows.length;
  const w = QUIET * 2 + cols * SCALE;
  const h = QUIET * 2 + rowsN * SCALE;
  const rgb = new Int32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const cx = Math.floor((x - QUIET) / SCALE);
      const cy = Math.floor((y - QUIET) / SCALE);
      const isB = cx >= 0 && cy >= 0 && cx < cols && cy < rowsN && fixture.rows[cy][cx] === '1';
      const g = isB ? 0 : 255;
      rgb[y * w + x] = (g << 16) | (g << 8) | g;
    }
  }
  return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(rgb, w, h)));
}

function solidBitmap(w, h, gray) {
  const rgb = new Int32Array(w * h);
  for (let i = 0; i < w * h; i += 1) rgb[i] = (gray << 16) | (gray << 8) | gray;
  return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(rgb, w, h)));
}

function noiseBitmap(w, h, seed = 42) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const rgb = new Int32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const g = Math.floor(rnd() * 256);
    rgb[i] = (g << 16) | (g << 8) | g;
  }
  return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(rgb, w, h)));
}

// ---- the supplements themselves: exact digits, from real samples ----

for (const id of ['ean5_51199', 'ean5_01234', 'ean2_53', 'ean2_07']) {
  test(`standalone supplement decodes exactly: ${id}`, () => {
    assert.equal(readSupplementFromBitmap(toBitmap1d(fixtures[id].widths)), fixtures[id].expect);
  });
}

// ---- the guards bite: a decodable-but-invalid supplement is refused ----

test('EAN-5 with a swapped digit is refused (parity-encoded check digit vs checksum)', () => {
  assert.equal(readSupplementFromBitmap(toBitmap1d(fixtures.ean5_corrupt.widths)), null);
});

test('EAN-2 with a swapped digit is refused (value % 4 parity identity)', () => {
  assert.equal(readSupplementFromBitmap(toBitmap1d(fixtures.ean2_corrupt.widths)), null);
});

// ---- the heart rule: the pass manufactures nothing, anywhere else ----

for (const [id, fixture] of Object.entries(coverageFixtures)) {
  test(`no supplement manufactured from the ${id} fixture`, () => {
    assert.equal(readSupplementFromBitmap(toBitmap(fixture)), null);
  });
}

test('no supplement in non-barcode images', () => {
  assert.equal(readSupplementFromBitmap(solidBitmap(300, 100, 255)), null);
  assert.equal(readSupplementFromBitmap(solidBitmap(300, 100, 0)), null);
  assert.equal(readSupplementFromBitmap(noiseBitmap(400, 200)), null);
});

// ---- combined frames: the main code wins, exactly as before ----

test('combined EAN-13 + EAN-5: the normal decode returns the main code', () => {
  const fixture = fixtures.combined_ean13_ean5;
  const result = new MultiFormatReader().decode(toBitmap1d(fixture.widths), factoryHints());
  assert.equal(result.getText(), '9781974720149');
  assert.equal(BarcodeFormat[result.getBarcodeFormat()], 'EAN_13');
});

// ---- the wiring: supplement only after the main decode found nothing ----

test('factory wiring: the supplement pass is a fallback in both engines, never a first resort', () => {
  // ZXing branch: inside the catch of the main decode.
  // AMENDED Nov 25, 2026 (UPC-E repair build, t75): the catch now
  // chains the app's own UPC-E pass ahead of the supplement pass —
  // the supplement remains a fallback inside the same catch, never
  // a first resort, and still speaks only when nothing before it
  // produced a value. The original pin's text is superseded by the
  // chained line below; the native-branch pin after it is unchanged.
  assert.match(
    factorySource,
    /catch \{\s*\n\s*\/\/ The main decode found nothing: only now may our own UPC-E\s*\n\s*\/\/ pass and the standalone supplement speak, so combined\s*\n\s*\/\/ frames keep their main code\. UPC-E first — it is a whole\s*\n\s*\/\/ product code; a supplement only ever names a price\.\s*\n\s*return readUpceFromCanvas\(canvas\) \?\? readSupplementFromCanvas\(canvas\);/,
  );
  // Native branch: only when the detector returned no codes.
  assert.match(
    factorySource,
    /if \(codes\.length\) return String\(codes\[0\]\.rawValue \|\| ''\);\s*\n\s*\/\/ The native API has no supplement format at all, so a\s*\n\s*\/\/ lone EAN-5\/EAN-2 strip falls through to the hand-built\s*\n\s*\/\/ pass rather than being stranded by the engine choice\.\s*\n\s*return readSupplementFromCanvas\(canvas\);/,
  );
});

test('supplement module wires the library\u2019s own internals (no re-implemented decoder tables)', () => {
  assert.match(supplementSource, /core\/oned\/AbstractUPCEANReader\.js/);
  assert.match(supplementSource, /core\/oned\/UPCEANExtension5Support\.js/);
  assert.match(supplementSource, /AbstractUPCEANReader\.findGuardPattern\(/);
  assert.match(supplementSource, /AbstractUPCEANReader\.decodeDigit\(/);
  assert.match(supplementSource, /determineCheckDigit\(parityBits\)/);
  assert.match(supplementSource, /UPCEANExtension5Support\.extensionChecksum\(digits\)/);
});

test('the pattern-table seed: the base slot the extension path reads is defined after a read', () => {
  readSupplementFromBitmap(toBitmap1d(fixtures.ean5_51199.widths));
  const base = AbstractUPCEANReader.default ?? AbstractUPCEANReader;
  assert.ok(Array.isArray(base.L_AND_G_PATTERNS));
  assert.equal(base.L_AND_G_PATTERNS.length, 20);
});

test('the canvas door refuses non-canvases quietly', () => {
  assert.equal(readSupplementFromCanvas(null), null);
  assert.equal(readSupplementFromCanvas({}), null);
  assert.equal(readSupplementFromCanvas({ getContext: () => null, width: 100, height: 50 }), null);
});

test('native engine with an empty frame reaches the supplement pass and stays silent on a non-canvas', async () => {
  class EmptyDetector {
    static async getSupportedFormats() {
      return ['qr_code', 'ean_13'];
    }
    async detect() {
      return [];
    }
  }
  globalThis.window = { BarcodeDetector: EmptyDetector };
  try {
    const reader = await createCodeReader();
    assert.equal(reader.engine, 'native');
    assert.equal(await reader.read({}), null);
  } finally {
    delete globalThis.window;
  }
});

test('ZXing engine: a failed main decode falls through to the supplement pass (null on a non-canvas)', async () => {
  const reader = await createCodeReader();
  assert.equal(reader.engine, 'zxing');
  assert.equal(await reader.read({}), null);
});
