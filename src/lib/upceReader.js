import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource } from '@zxing/library';
import AbstractUPCEANReaderModule from '@zxing/library/cjs/core/oned/AbstractUPCEANReader.js';
import UPCEANReaderModule from '@zxing/library/cjs/core/oned/UPCEANReader.js';
import UPCEReaderModule from '@zxing/library/cjs/core/oned/UPCEReader.js';

/**
 * UPC-E reading on the ZXing fallback path — hand-built Nov 25, 2026
 * on the owner's ruling ("repaired ourselves; go for it"), the
 * build-it-ourselves doctrine applied to the scanner's last blind
 * spot. UPC-E (the short 8-digit UPC found on small items) reads on
 * the native BarcodeDetector, but @zxing/library 0.21.3 cannot decode
 * it at all — a pre-existing defect, proven byte-identical under the
 * pre-change format list at the coverage build and pinned there
 * (t72) until this repair. This module wires the library's own
 * row-level pieces — its guard-pattern search, its digit decoder,
 * its pattern tables, its parity table, its checksum — into the
 * decode the library's UPCEReader was supposed to perform, and runs
 * only after the main decode found nothing, so a frame holding any
 * other code behaves exactly as before.
 *
 * The value returned is the UPC-A expansion of the symbol — the
 * 12-digit form the native path yields for the same symbol and the
 * form product records carry — computed from the spec and validated
 * by the library's own standard checksum before it may speak.
 *
 * The library's UPC-E path is broken at several stacked points, each
 * verified in its source and (where callable) by execution:
 *  1. UPCEANReader.decodeRow locates the end guard by calling the
 *     STATIC base decodeEnd, which searches for the EAN START_END
 *     pattern [1,1,1] — it locks onto the middle of UPC-E's 010101
 *     end guard, and decodeRow's quiet-zone check then trips on the
 *     guard's own final bar. UPCEReader's own decodeEnd, which knows
 *     the 010101 pattern, is never called.
 *  2. UPCEReader.decodeMiddle returns a bare row offset where
 *     decodeRow expects { rowOffset, resultString }, and builds its
 *     digits into a throwaway StringBuilder — the decoded digits
 *     never reach decodeRow at all.
 *  3. UPCEReader.determineNumSysAndCheckDigit performs Java char
 *     arithmetic as JavaScript string concatenation ('0' + n), so it
 *     inserts and appends TWO characters per digit: executed on the
 *     fixture symbol it produces "0012345605" where "01234565"
 *     belongs. The parity TABLE it reads is intact, so the lookup is
 *     mirrored below against the library's own table.
 *  4. UPCEReader.convertUPCEtoUPCA switches char codes against digit
 *     literals (its default branch would always win) and, worse,
 *     StringBuilder.appendChars loops on a condition that can never
 *     become false (`offset < offset + len`) — any call hangs until
 *     the process dies (execution-proven). The expansion is therefore
 *     implemented from the spec, and the checksum that validates it
 *     is the library's own checkStandardUPCEANChecksum — the exact
 *     gate every working UPC/EAN reader in the library passes
 *     through, executed and proven sound on these values.
 * The decode below mirrors UPCEANReader.decodeRow + UPCEReader's
 * decodeMiddle/decodeEnd line for line, calling the library's
 * primitives for every match and every validation; only the broken
 * vessels (collection, lookup, expansion) differ.
 *
 * The deep imports use the package's cjs files (its esm files import
 * each other without extensions, which the test runner cannot load),
 * unwrapped defensively: bundlers hand back the class, Node hands
 * back the module object that carries it as `.default`.
 */
const unwrap = (mod) => mod?.default ?? mod;
const AbstractUPCEANReader = unwrap(AbstractUPCEANReaderModule);
const UPCEANReader = unwrap(UPCEANReaderModule);
const UPCEReader = unwrap(UPCEReaderModule);

let patternTableReady = false;
function ensurePatternTable() {
  if (patternTableReady) return;
  patternTableReady = true;
  if (UPCEANReader.L_AND_G_PATTERNS === undefined) {
    // Constructing the reader runs the constructor that builds the
    // L/G table on UPCEANReader, the slot UPC-E's decode reads.
    new UPCEReader();
  }
}

// A UPC-E symbol is fixed-width: 3 (start guard) + 6 × 7 (digits)
// + 6 (end guard) = 51 modules, always. A candidate whose measured
// span is not 51 of its own modules is some other symbol's slice.
const TOTAL_MODULES = 51;
const DIGIT_MODULES = 42;
const MAX_CANDIDATES_PER_ROW = 64;

/**
 * AbstractUPCEANReader.findStartGuardPattern, mirrored with a start
 * offset so the candidate search can resume past a refused guard:
 * same guard match, same left quiet-zone rule (a guard's width of
 * white before it). Throws when the row holds no further guard.
 */
function findStartGuard(row, fromOffset) {
  const counters = new Int32Array(AbstractUPCEANReader.START_END_PATTERN.length);
  let nextStart = fromOffset;
  for (;;) {
    counters.fill(0);
    const startRange = AbstractUPCEANReader.findGuardPattern(
      row,
      nextStart,
      false,
      AbstractUPCEANReader.START_END_PATTERN,
      counters,
    );
    const start = startRange[0];
    nextStart = startRange[1];
    const quietStart = start - (nextStart - start);
    if (quietStart >= 0 && row.isRange(quietStart, start, false)) {
      return startRange;
    }
  }
}

/**
 * UPCEReader.decodeMiddle, mirrored: the same six-digit loop over
 * the library's decodeDigit and its L/G table, the same parity-bit
 * collection — only the collection of the digits differs (theirs is
 * built into a throwaway StringBuilder and discarded). Throws on
 * any undecodable digit, exactly as theirs does.
 */
function decodeUpceMiddle(row, startRange) {
  const counters = new Int32Array(4);
  const end = row.getSize();
  let rowOffset = startRange[1];
  let lgPatternFound = 0;
  let digits = '';
  for (let x = 0; x < 6 && rowOffset < end; x += 1) {
    counters.fill(0);
    const bestMatch = AbstractUPCEANReader.decodeDigit(
      row,
      counters,
      rowOffset,
      UPCEReader.L_AND_G_PATTERNS,
    );
    digits += String.fromCharCode('0'.charCodeAt(0) + (bestMatch % 10));
    for (const counter of counters) rowOffset += counter;
    if (bestMatch >= 10) {
      lgPatternFound |= 1 << (5 - x);
    }
  }
  if (digits.length !== 6) {
    throw new Error('upce: incomplete');
  }
  return { digits, lgPatternFound, rowOffset };
}

/**
 * UPCEReader.determineNumSysAndCheckDigit, mirrored as a pure lookup
 * against the library's own NUMSYS_AND_CHECK_DIGIT_PATTERNS table
 * (theirs corrupts its result with two-character inserts/appends —
 * defect 3 above). The parity pattern of the six digits encodes
 * exactly one (number system, check digit) pair, or none: no match
 * is a refusal, never a guess.
 */
function determineNumSysAndCheckDigit(lgPatternFound) {
  const table = UPCEReader.NUMSYS_AND_CHECK_DIGIT_PATTERNS;
  for (let numSys = 0; numSys <= 1; numSys += 1) {
    for (let d = 0; d < 10; d += 1) {
      if (lgPatternFound === table[numSys][d]) {
        return { numSys, checkDigit: d };
      }
    }
  }
  throw new Error('upce: parity');
}

/**
 * The UPC-E → UPC-A expansion, from the spec (the library's
 * convertUPCEtoUPCA is unusable — defect 4 above). The six digits'
 * last digit selects where the zeros sit; the number system leads
 * and the check digit closes, so the standard UPC checksum over
 * this expansion is the symbol's own check-digit validation.
 */
export function expandUpceToUpca(upce) {
  const six = upce.slice(1, 7);
  const last = six[5];
  let mid;
  if (last === '0' || last === '1' || last === '2') {
    mid = six.slice(0, 2) + last + '0000' + six.slice(2, 5);
  } else if (last === '3') {
    mid = six.slice(0, 3) + '00000' + six.slice(3, 5);
  } else if (last === '4') {
    mid = six.slice(0, 4) + '00000' + six[4];
  } else {
    mid = six.slice(0, 5) + '0000' + last;
  }
  return upce[0] + mid + upce[7];
}

/**
 * One candidate, validated end to end in decodeRow's own order:
 * digits → parity-derived number system and check digit → the
 * reader's own 010101 end guard → the fixed-width gate → the
 * quiet zone decodeRow demands → the standard checksum over the
 * expansion. Any failure throws; the caller moves to the next
 * candidate. Returns { upca, start, module }.
 */
function decodeUpceAt(row, startRange) {
  const { digits, lgPatternFound, rowOffset } = decodeUpceMiddle(row, startRange);
  const { numSys, checkDigit } = determineNumSysAndCheckDigit(lgPatternFound);
  const upce = `${numSys}${digits}${checkDigit}`;
  // UPCEReader's own decodeEnd, mirrored: the 010101 end pattern,
  // white-first — the call decodeRow never makes (defect 1 above).
  const endRange = AbstractUPCEANReader.findGuardPatternWithoutCounters(
    row,
    rowOffset,
    true,
    UPCEReader.MIDDLE_END_PATTERN,
  );
  const module = (rowOffset - startRange[1]) / DIGIT_MODULES;
  const span = endRange[1] - startRange[0];
  if (Math.abs(span - TOTAL_MODULES * module) > 2 * module) {
    throw new Error('upce: width');
  }
  // decodeRow's quiet-zone rule: at least an end-pattern width of
  // white must follow the end guard.
  const end = endRange[1];
  const quietEnd = end + (end - endRange[0]);
  if (quietEnd >= row.getSize() || !row.isRange(end, quietEnd, false)) {
    throw new Error('upce: quiet zone');
  }
  const upca = expandUpceToUpca(upce);
  if (!AbstractUPCEANReader.checkStandardUPCEANChecksum(upca)) {
    throw new Error('upce: checksum');
  }
  return { upca, start: startRange[0], module };
}

/**
 * One binarized row: try each start-guard candidate in turn until
 * one validates as a whole UPC-E. A refused candidate (a UPC-A or
 * EAN-13 standing on the same row refuses at the parity table —
 * their left halves encode no UPC-E number system) resumes the
 * search just past its guard. Returns { upca, start, module } or
 * null.
 */
export function findUpceInRow(row) {
  ensurePatternTable();
  const size = row.getSize();
  let offset = 0;
  for (let attempt = 0; attempt < MAX_CANDIDATES_PER_ROW && offset < size; attempt += 1) {
    let range;
    try {
      range = findStartGuard(row, offset);
    } catch {
      return null;
    }
    try {
      return decodeUpceAt(row, range);
    } catch {
      offset = range[0] + 1;
    }
  }
  return null;
}

/**
 * Scan a binarized image for a UPC-E. Rows are tried middle-out, as
 * the one-dimensional readers try them; a candidate is accepted
 * only when the SAME expansion decodes again a few modules above
 * or below it — a real UPC-E is a strip whose bars run its full
 * height, while a lucky slice through another symbol cannot repeat
 * its pattern beyond one of its own modules (the supplement pass's
 * discipline, kept). Returns the 12-digit UPC-A expansion or null.
 */
export function readUpceFromBitmap(bitmap) {
  const height = bitmap.getHeight();
  if (!height || height < 8) return null;
  const step = Math.max(1, Math.floor(height / 40));
  const mid = Math.floor(height / 2);
  const order = [mid];
  for (let d = step; d < height; d += step) {
    if (mid - d >= 0) order.push(mid - d);
    if (mid + d < height) order.push(mid + d);
  }
  const rowAt = (y) => {
    try {
      return bitmap.getBlackRow(y, null);
    } catch {
      return null;
    }
  };
  for (const y of order) {
    const row = rowAt(y);
    if (!row) continue;
    const hit = findUpceInRow(row);
    if (!hit) continue;
    const delta = Math.max(2, Math.ceil(3 * hit.module));
    for (const confirmY of [y - delta, y + delta]) {
      if (confirmY < 0 || confirmY >= height) continue;
      const confirmRow = rowAt(confirmY);
      if (!confirmRow) continue;
      const confirmHit = findUpceInRow(confirmRow);
      if (
        confirmHit &&
        confirmHit.upca === hit.upca &&
        Math.abs(confirmHit.start - hit.start) <= 2 * hit.module
      ) {
        return hit.upca;
      }
    }
  }
  return null;
}

/**
 * The canvas door the code-reader factory calls when its main
 * decode found nothing. Any failure at all returns null — a UPC-E
 * miss must never break the ordinary scan loop.
 */
export function readUpceFromCanvas(canvas) {
  try {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const { width, height } = canvas;
    if (!width || !height || width < 40 || height < 8) return null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    const { data } = context.getImageData(0, 0, width, height);
    const rgb = new Int32Array(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
      rgb[j] = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    }
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(rgb, width, height)));
    return readUpceFromBitmap(bitmap);
  } catch {
    return null;
  }
}
