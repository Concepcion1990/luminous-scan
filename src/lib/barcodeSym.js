import { code128Rects } from './code128.js';

/**
 * Symbology by code type (owner ruling, Nov 14, 2026): a label
 * barcode is drawn in the code's NATIVE symbology, not always
 * Code 128 — a valid 12-digit numeric code is a true UPC-A, a
 * valid 13-digit numeric code is an EAN-13, and anything else
 * (alphanumeric SKUs like RB-1-COPY) stays Code 128. A numeric
 * code whose check digit does not verify falls back to Code 128
 * rather than drawing a barcode no scanner would accept.
 *
 * Encoders return the same shape as code128Rects — { width,
 * rects: [{x, w, tall?}] } in module units — so every renderer
 * (the SVG label templates today) draws any symbology the same
 * way. Guard bars carry tall: true (they run longer, as on real
 * packaging).
 */

// Left-hand odd-parity (L) digit patterns, 7 modules each.
const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
// Right-hand (R) patterns are the complements of L; G patterns
// (EAN-13 left, even parity) are the reversals of R.
const flip = (bits) => bits.split('').map((b) => (b === '1' ? '0' : '1')).join('');
const R = L.map(flip);
const G = R.map((bits) => bits.split('').reverse().join(''));
// EAN-13: the first digit picks the L/G pattern of the next six.
const EAN_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

function rectsFromBits(bits, tallSpans = []) {
  const rects = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      let j = i;
      while (j < bits.length && bits[j] === '1') j += 1;
      const tall = tallSpans.some(([a, b]) => i >= a && j <= b);
      rects.push({ x: i, w: j - i, ...(tall ? { tall: true } : {}) });
      i = j;
    } else i += 1;
  }
  return { width: bits.length, rects };
}

function upcCheckDigit(first11) {
  let sum = 0;
  for (let i = 0; i < 11; i += 1) sum += Number(first11[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

function eanCheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidUpcA(value) {
  return /^\d{12}$/.test(value) && upcCheckDigit(value.slice(0, 11)) === Number(value[11]);
}

export function isValidEan13(value) {
  return /^\d{13}$/.test(value) && eanCheckDigit(value.slice(0, 12)) === Number(value[12]);
}

/** 'UPC-A' | 'EAN-13' | 'CODE128' for any code value. */
export function symbologyFor(value) {
  const code = String(value || '').trim();
  if (isValidUpcA(code)) return 'UPC-A';
  if (isValidEan13(code)) return 'EAN-13';
  return 'CODE128';
}

export function upcARects(value) {
  const digits = String(value).split('').map(Number);
  const left = digits.slice(0, 6).map((d) => L[d]).join('');
  const right = digits.slice(6).map((d) => R[d]).join('');
  const bits = `101${left}01010${right}101`;
  // Guard spans: start (0-3), centre (45-50), end (92-95).
  return rectsFromBits(bits, [[0, 3], [45, 50], [92, 95]]);
}

export function ean13Rects(value) {
  const digits = String(value).split('').map(Number);
  const parity = EAN_PARITY[digits[0]];
  const left = digits.slice(1, 7).map((d, i) => (parity[i] === 'L' ? L[d] : G[d])).join('');
  const right = digits.slice(7).map((d) => R[d]).join('');
  const bits = `101${left}01010${right}101`;
  return rectsFromBits(bits, [[0, 3], [45, 50], [92, 95]]);
}

/** Rects in the code's native symbology; null when unencodable. */
export function barcodeRects(value) {
  const code = String(value || '').trim();
  if (!code) return null;
  const kind = symbologyFor(code);
  if (kind === 'UPC-A') return { kind, ...upcARects(code) };
  if (kind === 'EAN-13') return { kind, ...ean13Rects(code) };
  const rects = code128Rects(code);
  return rects ? { kind, ...rects } : null;
}
