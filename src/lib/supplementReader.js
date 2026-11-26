import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource } from '@zxing/library';
import AbstractUPCEANReaderModule from '@zxing/library/cjs/core/oned/AbstractUPCEANReader.js';
import UPCEANReaderModule from '@zxing/library/cjs/core/oned/UPCEANReader.js';
import EAN13ReaderModule from '@zxing/library/cjs/core/oned/EAN13Reader.js';
import UPCEANExtension5SupportModule from '@zxing/library/cjs/core/oned/UPCEANExtension5Support.js';

/**
 * Standalone EAN-5 / EAN-2 supplement reading — hand-built Nov 25, 2026
 * on the owner's ruling ("we want to build ourselves; no purchase").
 *
 * A supplement (the little 5-digit price add-on beside a book's main
 * barcode, or a 2-digit issue number) is not a standalone code in
 * either engine the scanner uses: the native BarcodeDetector has no
 * format for it, and @zxing/library only ever decodes one as a tail
 * on a main UPC/EAN it has just read. This module wires the library's
 * own row-level pieces — its guard-pattern search, its digit decoder,
 * its pattern tables, its check-digit encodings and checksum — to
 * find and decode a supplement standing ALONE in a frame. It runs
 * only after the main decode found nothing, so a frame containing a
 * main code behaves exactly as before: the main code wins.
 *
 * A supplement carries price or issue data, never a product identity,
 * so the digits flow into the ordinary scan-result path and honestly
 * match nothing, naming the number — the matcher never guesses.
 *
 * Two defects inside @zxing/library 0.21.3 had to be worked around,
 * both verified in its source and by execution:
 *  1. The L/G pattern table is built only on the UPCEANReader
 *     subclass (in its constructor), but the extension supports read
 *     it from the abstract base — a slot nothing ever assigns, so
 *     their digit decode throws on an undefined table. Nothing else
 *     reads the base slot (the concrete readers read their own), so
 *     seeding it with the library's own table cannot change any
 *     existing decode; it only makes the extension path runnable.
 *  2. The supports' decodeRow collects its digits into an immutable
 *     string, so the Result it returns always has empty text — the
 *     digits are computed and validated, then lost. The middle loop
 *     below therefore mirrors theirs line for line, calling their
 *     decodeDigit, their determineCheckDigit and their
 *     extensionChecksum; only the collection of the digits differs.
 *
 * The deep imports use the package's cjs files (its esm files import
 * each other without extensions, which the test runner cannot load),
 * unwrapped defensively: bundlers hand back the class, Node hands
 * back the module object that carries it as `.default`.
 */
const unwrap = (mod) => mod?.default ?? mod;
const AbstractUPCEANReader = unwrap(AbstractUPCEANReaderModule);
const UPCEANReader = unwrap(UPCEANReaderModule);
const EAN13Reader = unwrap(EAN13ReaderModule);
const UPCEANExtension5Support = unwrap(UPCEANExtension5SupportModule);

let patternTableReady = false;
function ensurePatternTable() {
  if (patternTableReady) return;
  patternTableReady = true;
  if (AbstractUPCEANReader.L_AND_G_PATTERNS === undefined) {
    // Constructing any concrete UPC/EAN reader runs the constructor
    // that builds the table on the subclass; copy that same table
    // into the base slot the extension path reads.
    new EAN13Reader();
    AbstractUPCEANReader.L_AND_G_PATTERNS = UPCEANReader.L_AND_G_PATTERNS;
  }
}

const EXTENSION_START_PATTERN = Int32Array.from([1, 1, 2]);
// A standalone supplement stands in real quiet zones. Inside another
// barcode no white run reaches five modules (every symbology the
// scanner reads caps its elements at four), so the left guard alone
// refuses almost every in-symbol candidate before any digit is read.
const LEFT_QUIET_MODULES = 5;
const RIGHT_QUIET_MODULES = 3;
const MAX_CANDIDATES_PER_ROW = 64;

const fiveSupport = new UPCEANExtension5Support();

/**
 * The extension supports' decodeMiddle, mirrored: same digit loop,
 * same separator walk, same validations — their decodeDigit, their
 * check-digit encodings (determineCheckDigit), their checksum
 * (extensionChecksum for five digits; the value % 4 parity identity
 * for two). Throws on any mismatch, exactly as theirs does.
 */
function decodeExtensionMiddle(row, startRange, digitCount) {
  const counters = new Int32Array(4);
  const end = row.getSize();
  let rowOffset = startRange[1];
  let parityBits = 0;
  let digits = '';
  for (let x = 0; x < digitCount && rowOffset < end; x += 1) {
    counters.fill(0);
    const bestMatch = AbstractUPCEANReader.decodeDigit(
      row,
      counters,
      rowOffset,
      AbstractUPCEANReader.L_AND_G_PATTERNS,
    );
    digits += String.fromCharCode('0'.charCodeAt(0) + (bestMatch % 10));
    for (const counter of counters) rowOffset += counter;
    if (bestMatch >= 10) {
      parityBits |= 1 << (digitCount - 1 - x);
    }
    if (x !== digitCount - 1) {
      // Walk off the separator between digits, as the library does.
      rowOffset = row.getNextSet(rowOffset);
      rowOffset = row.getNextUnset(rowOffset);
    }
  }
  if (digits.length !== digitCount) {
    throw new Error('supplement: incomplete');
  }
  if (digitCount === 5) {
    // determineCheckDigit throws when the L/G parity pattern encodes
    // no check digit at all; the checksum must then agree with it.
    const checkDigit = fiveSupport.determineCheckDigit(parityBits);
    if (UPCEANExtension5Support.extensionChecksum(digits) !== checkDigit) {
      throw new Error('supplement: checksum');
    }
  } else if (parseInt(digits, 10) % 4 !== parityBits) {
    throw new Error('supplement: parity');
  }
  return { digits, end: rowOffset };
}

/**
 * One binarized row: find each supplement-guard candidate in turn and
 * try to decode a supplement there, behind the quiet-zone guards.
 * Returns { digits, start, module } or null.
 */
export function findSupplementInRow(row) {
  ensurePatternTable();
  const size = row.getSize();
  const counters = new Int32Array(EXTENSION_START_PATTERN.length);
  let offset = 0;
  for (let attempt = 0; attempt < MAX_CANDIDATES_PER_ROW && offset < size; attempt += 1) {
    let range;
    try {
      counters.fill(0);
      range = AbstractUPCEANReader.findGuardPattern(
        row,
        offset,
        false,
        EXTENSION_START_PATTERN,
        counters,
      );
    } catch {
      return null;
    }
    const guardWidth = range[1] - range[0];
    let leftWhite = 0;
    for (let x = range[0] - 1; x >= 0 && !row.get(x); x -= 1) leftWhite += 1;
    if (leftWhite * 4 >= LEFT_QUIET_MODULES * guardWidth) {
      for (const digitCount of [5, 2]) {
        try {
          const { digits, end } = decodeExtensionMiddle(row, range, digitCount);
          const totalModules = digitCount === 5 ? 47 : 20;
          const module = (end - range[0]) / totalModules;
          let rightWhite = 0;
          for (let x = end; x < size && !row.get(x); x += 1) rightWhite += 1;
          if (rightWhite >= RIGHT_QUIET_MODULES * module) {
            return { digits, start: range[0], module };
          }
        } catch {
          // Not this length, or not a supplement at this candidate.
        }
      }
    }
    offset = range[0] + 1;
  }
  return null;
}

/**
 * Scan a binarized image for a standalone supplement. Rows are tried
 * middle-out, as the one-dimensional readers try them; a candidate is
 * accepted only when the SAME digits decode again a few modules
 * above or below it — a real supplement is a strip whose bars run its
 * full height, while a lucky slice through a two-dimensional symbol
 * (an Aztec row manufactured a plausible 2-digit read in rehearsal)
 * cannot repeat its pattern beyond one of its own modules.
 */
export function readSupplementFromBitmap(bitmap) {
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
    const hit = findSupplementInRow(row);
    if (!hit) continue;
    const delta = Math.max(2, Math.ceil(3 * hit.module));
    for (const confirmY of [y - delta, y + delta]) {
      if (confirmY < 0 || confirmY >= height) continue;
      const confirmRow = rowAt(confirmY);
      if (!confirmRow) continue;
      const confirmHit = findSupplementInRow(confirmRow);
      if (
        confirmHit &&
        confirmHit.digits === hit.digits &&
        Math.abs(confirmHit.start - hit.start) <= 2 * hit.module
      ) {
        return hit.digits;
      }
    }
  }
  return null;
}

/**
 * The canvas door the code-reader factory calls when its main decode
 * found nothing. Any failure at all returns null — a supplement miss
 * must never break the ordinary scan loop.
 */
export function readSupplementFromCanvas(canvas) {
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
    return readSupplementFromBitmap(bitmap);
  } catch {
    return null;
  }
}
