/**
 * T75 — the UPC-E repair (owner's ruling, Nov 25, 2026: "repaired
 * ourselves; go for it" — the build-it-ourselves doctrine). UPC-E
 * read on the native BarcodeDetector but @zxing/library 0.21.3
 * cannot decode it at all: its UPC-E path is broken at several
 * stacked points (decodeRow hunts the EAN end pattern inside
 * UPC-E's 010101 end guard and its quiet-zone check trips on the
 * guard's last bar; decodeMiddle returns a bare offset where an
 * object belongs and discards its own digits; the number-system
 * lookup corrupts its result with two-character inserts; the
 * UPC-A converter hangs in an infinite loop). The repair is the
 * app's own pass, src/lib/upceReader.js, built from the library's
 * sound primitives — guard search, digit decoder, parity table,
 * standard checksum — wired into the factory's ZXing fallback
 * ahead of the supplement pass, so a frame holding any other code
 * behaves exactly as before.
 *
 * The HEART RULE binds absolutely: a row that does not validate —
 * parity, end guard, fixed width, quiet zone, or the UPC-A
 * checksum over the expansion — is refused, never guessed. The
 * corrupted fixtures below each defeat exactly one gate while
 * passing the ones before it, and the pass is additionally run
 * over every fixture proven at t72/t73: it must manufacture
 * NOTHING there.
 *
 * Fixtures (fixtures.json) come from a from-spec constructor the
 * generator first proved byte-identical to BWIPP on the t72 symbol
 * (01234565) — the t73 precedent. Expected values are the UPC-A
 * expansions, computed by the generator's independent spec
 * implementation; the module's own expansion is cross-checked
 * against them below, so two implementations must agree.
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
import { createCodeReader, ZXING_FORMATS } from '../../src/lib/codeReader.js';
import { readUpceFromBitmap, readUpceFromCanvas, expandUpceToUpca } from '../../src/lib/upceReader.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const coverageFixtures = JSON.parse(readFileSync(new URL('../t72/fixtures.json', import.meta.url), 'utf8'));
const supplementFixtures = JSON.parse(readFileSync(new URL('../t73/fixtures.json', import.meta.url), 'utf8'));
const factorySource = readFileSync(new URL('../../src/lib/codeReader.js', import.meta.url), 'utf8');
const upceSource = readFileSync(new URL('../../src/lib/upceReader.js', import.meta.url), 'utf8');

function factoryHints() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

/** Render a 1D run-width fixture to a BinaryBitmap, as in t72/t73. */
function toBitmap1d(widths, scale = 3, height = 72, quiet = 30) {
  const QUIET = quiet;
  const total = widths.reduce((a, b) => a + b, 0);
  const w = QUIET * 2 + total * scale;
  const runs = [];
  let x = QUIET;
  let black = true;
  for (const run of widths) {
    runs.push([x, x + run * scale, black]);
    x += run * scale;
    black = !black;
  }
  const rgb = new Int32Array(w * height);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const isB = runs.some(([a, b, isBlack]) => isBlack && px >= a && px < b);
      const g = isB ? 0 : 255;
      rgb[py * w + px] = (g << 16) | (g << 8) | g;
    }
  }
  return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(rgb, w, height)));
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

// ---- the symbols themselves: exact expansions, from real samples ----
// Number systems 0 and 1, every expansion branch (last digit 0/1/2,
// 3, 4, and 5–9), and the check-digit edges 0 and 9 ride this loop.
for (const [id, fixture] of Object.entries(fixtures)) {
  if (fixture.expect === null) continue;
  test(`UPC-E decodes to its UPC-A expansion: ${id} (${fixture.genText})`, () => {
    assert.equal(readUpceFromBitmap(toBitmap1d(fixture.widths)), fixture.expect);
  });
}

// The module's expansion against the generator's independent one,
// value for value — two implementations of the spec must agree.
for (const [id, fixture] of Object.entries(fixtures)) {
  if (fixture.expect === null) continue;
  test(`expansion agreement (module vs generator): ${id}`, () => {
    assert.equal(expandUpceToUpca(fixture.genText), fixture.expect);
  });
}

// ---- traffic: a UPC-E beside a UPC-A / an EAN-13 on the same row ----
// The neighbour's start guard is tried first and refused (a UPC-A's
// all-L left half encodes no UPC-E parity; an EAN-13's left half
// dies at the end guard, width, or checksum) — the search resumes
// and the UPC-E reads. Named separately from the loop above
// because this refusal-and-resume is the repair's subtlest duty.
test('traffic: UPC-A beside UPC-E — the UPC-A candidate is refused, the UPC-E reads', () => {
  assert.equal(readUpceFromBitmap(toBitmap1d(fixtures.traffic_upca_upce.widths)), '012345000065');
});

test('traffic: EAN-13 beside UPC-E — the EAN-13 candidate is refused, the UPC-E reads', () => {
  assert.equal(readUpceFromBitmap(toBitmap1d(fixtures.traffic_ean13_upce.widths)), '155555000057');
});

// ---- the guards bite: decodable-but-invalid symbols are refused ----

test('corrupted digit (same parity, checksum broken) is refused', () => {
  assert.equal(readUpceFromBitmap(toBitmap1d(fixtures.upce_corrupt_digit.widths)), null);
});

test('wrong check-digit parity (derived check fails the checksum) is refused', () => {
  assert.equal(readUpceFromBitmap(toBitmap1d(fixtures.upce_corrupt_check.widths)), null);
});

test('truncated end guard is refused', () => {
  assert.equal(readUpceFromBitmap(toBitmap1d(fixtures.upce_corrupt_guard.widths)), null);
});

// ---- vertical confirmation: a one-slice strip cannot speak ----

test('a UPC-E pattern only a few pixel rows tall is refused (no vertical confirmation)', () => {
  // The symbol's bars occupy rows 34–36 of a 72-row image; rows a
  // few modules above and below are white, so no confirmation is
  // possible — the Aztec-slice discipline, applied to 1D.
  const fixture = fixtures.upce_01234565;
  const QUIET = 30;
  const total = fixture.widths.reduce((a, b) => a + b, 0);
  const w = QUIET * 2 + total * 3;
  const h = 72;
  const runs = [];
  let x = QUIET;
  let black = true;
  for (const run of fixture.widths) {
    runs.push([x, x + run * 3, black]);
    x += run * 3;
    black = !black;
  }
  const rgb = new Int32Array(w * h);
  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const inStrip = py >= 34 && py <= 36;
      const isB = inStrip && runs.some(([a, b, isBlack]) => isBlack && px >= a && px < b);
      const g = isB ? 0 : 255;
      rgb[py * w + px] = (g << 16) | (g << 8) | g;
    }
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(rgb, w, h)));
  assert.equal(readUpceFromBitmap(bitmap), null);
});

// ---- scale independence: the gates measure modules, not pixels ----

test('the same symbol reads at other scales', () => {
  // Quiet zones are given in modules (10 per side), as a real
  // symbol carries them — at a fixed pixel quiet zone the larger
  // scales would starve decodeRow's own quiet-zone rule, which the
  // pass mirrors faithfully.
  const fixture = fixtures.upce_01234565;
  assert.equal(readUpceFromBitmap(toBitmap1d(fixture.widths, 2, 72, 20)), '012345000065');
  assert.equal(readUpceFromBitmap(toBitmap1d(fixture.widths, 5, 72, 50)), '012345000065');
});

// ---- the heart rule: the pass manufactures nothing, anywhere else ----

for (const [id, fixture] of Object.entries(coverageFixtures)) {
  test(`no UPC-E manufactured from the t72 ${id} fixture`, () => {
    // The t72 upc_e fixture is the one honest exception: it IS a
    // UPC-E (the same symbol as t75's upce_01234565), and reading
    // it is the repair working, not a manufacture.
    const want = id === 'upc_e' ? '012345000065' : null;
    assert.equal(readUpceFromBitmap(toBitmap(fixture)), want);
  });
}

for (const [id, fixture] of Object.entries(supplementFixtures)) {
  test(`no UPC-E manufactured from the t73 ${id} fixture`, () => {
    assert.equal(readUpceFromBitmap(toBitmap(fixture)), null);
  });
}

test('no UPC-E in non-barcode images', () => {
  assert.equal(readUpceFromBitmap(solidBitmap(300, 100, 255)), null);
  assert.equal(readUpceFromBitmap(solidBitmap(300, 100, 0)), null);
  assert.equal(readUpceFromBitmap(noiseBitmap(400, 200)), null);
});

// ---- the library defect stands as history (the tripwire) ----

test('the library reader itself still throws on UPC-E — the repair is ours, not theirs', () => {
  // If a future library upgrade heals UPCEReader, this turns red:
  // that is the day the app-side pass can retire and this group is
  // revisited. Until then it documents why the pass exists.
  assert.throws(
    () => new MultiFormatReader().decode(toBitmap(coverageFixtures.upc_e), factoryHints()),
    NotFoundException,
  );
});

// ---- the wiring: fallback-only, UPC-E ahead of the supplement ----

test('factory wiring: the UPC-E pass runs only in the ZXing catch, ahead of the supplement pass', () => {
  assert.match(
    factorySource,
    /catch \{\s*\n\s*\/\/ The main decode found nothing: only now may our own UPC-E\s*\n\s*\/\/ pass and the standalone supplement speak, so combined\s*\n\s*\/\/ frames keep their main code\. UPC-E first — it is a whole\s*\n\s*\/\/ product code; a supplement only ever names a price\.\s*\n\s*return readUpceFromCanvas\(canvas\) \?\? readSupplementFromCanvas\(canvas\);/,
  );
  // The native branch is untouched: the platform decodes UPC-E
  // itself, so no pass is wired there.
  assert.match(
    factorySource,
    /if \(codes\.length\) return String\(codes\[0\]\.rawValue \|\| ''\);/,
  );
  assert.equal(factorySource.match(/readUpceFromCanvas\(canvas\)/g).length, 1);
});

test('UPC-E module wires the library\u2019s own internals (no re-implemented decoder tables)', () => {
  assert.match(upceSource, /core\/oned\/AbstractUPCEANReader\.js/);
  assert.match(upceSource, /core\/oned\/UPCEReader\.js/);
  assert.match(upceSource, /AbstractUPCEANReader\.findGuardPattern\(/);
  assert.match(upceSource, /AbstractUPCEANReader\.decodeDigit\(/);
  assert.match(upceSource, /UPCEReader\.NUMSYS_AND_CHECK_DIGIT_PATTERNS/);
  assert.match(upceSource, /UPCEReader\.MIDDLE_END_PATTERN/);
  assert.match(upceSource, /AbstractUPCEANReader\.checkStandardUPCEANChecksum\(upca\)/);
});

test('the canvas door refuses non-canvases quietly', () => {
  assert.equal(readUpceFromCanvas(null), null);
  assert.equal(readUpceFromCanvas({}), null);
  assert.equal(readUpceFromCanvas({ getContext: () => null, width: 100, height: 50 }), null);
});

// ---- equivalence: both doors yield the same value for one symbol ----

test('native door and fallback door agree on a UPC-E symbol (the UPC-A expansion)', async () => {
  // The platform's detector yields the expansion for a UPC-E; the
  // factory's native branch surfaces it untouched, and the
  // hand-built fallback pass returns the identical string for the
  // identical symbol — a product keyed by its UPC-A is found the
  // same way on either engine.
  const expansion = readUpceFromBitmap(toBitmap1d(fixtures.upce_01234565.widths));
  assert.equal(expansion, '012345000065');
  class UpceDetector {
    static async getSupportedFormats() {
      return ['qr_code', 'upc_e', 'ean_13'];
    }
    async detect() {
      return [{ rawValue: expansion, format: 'upc_e' }];
    }
  }
  globalThis.window = { BarcodeDetector: UpceDetector };
  try {
    const reader = await createCodeReader();
    assert.equal(reader.engine, 'native');
    assert.equal(await reader.read({}), expansion);
  } finally {
    delete globalThis.window;
  }
});

test('ZXing engine: a failed main decode falls through both passes and stays silent on a non-canvas', async () => {
  const reader = await createCodeReader();
  assert.equal(reader.engine, 'zxing');
  assert.equal(await reader.read({}), null);
});

test('combined EAN-13 + EAN-5 still returns the main code through the normal decode', () => {
  // The passes run only after the main decode fails; a frame whose
  // main code decodes never reaches them (the t73 guarantee,
  // re-proven here because the catch now chains two passes).
  const fixture = supplementFixtures.combined_ean13_ean5;
  const result = new MultiFormatReader().decode(toBitmap1d(fixture.widths), factoryHints());
  assert.equal(result.getText(), '9781974720149');
  assert.equal(BarcodeFormat[result.getBarcodeFormat()], 'EAN_13');
});
