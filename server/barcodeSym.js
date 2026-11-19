/**
 * Server mirror of src/lib/code128.js + src/lib/barcodeSym.js —
 * the server imports nothing from src/, so the label barcode
 * encoders are kept here in miniature, exactly as server/
 * codeGenerator.js mirrors the check digits. The parity test
 * (tests/t35/label-barcode-pdf.test.js) pins the two copies
 * rect-for-rect across a battery of codes, so they cannot drift.
 *
 * Why the server needs real bars at all (owner catch, Nov 18,
 * 2026): the labels PDFs rendered the code as honest text only —
 * 'the server has no barcode font' — but jsPDF can draw the bars
 * as plain rectangles from these encoders, no font required. A
 * shelf label a scanner cannot scan is useless; the PDF paths
 * now draw the same native-symbology bars the browser-print
 * templates draw in SVG.
 */

/**
 * Code 128 (subset B) encoder for printed labels. The width table is the exact
 * pattern table the scanner library decodes, so a printed label round-trips.
 */

const PATTERNS = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 ' +
  '112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 ' +
  '311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 ' +
  '112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
  '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 ' +
  '122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 ' +
  '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
  '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'
).split(' ');

const START_B = 104;
const STOP = 106;

/**
 * Bars for a Code 128 B symbol: widths that alternate bar, space, bar…
 * Returns null when the value cannot be encoded (digits, letters and common
 * punctuation are fine).
 */
export function code128Bars(value) {
  const text = String(value || '');
  if (!text) return null;

  const values = [];
  let checksum = START_B;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) return null;
    const symbol = code - 32;
    values.push(symbol);
    checksum += symbol * (i + 1);
  }

  const sequence = [START_B, ...values, checksum % 103, STOP];
  const bars = [];
  sequence.forEach((symbol) => {
    const pattern = PATTERNS[symbol];
    for (let i = 0; i < pattern.length; i += 1) bars.push(Number(pattern[i]));
  });
  return bars;
}

/** Dark rectangles (in modules) for an SVG barcode, or null. */
export function code128Rects(value) {
  const bars = code128Bars(value);
  if (!bars) return null;

  const rects = [];
  let x = 0;
  bars.forEach((width, index) => {
    if (index % 2 === 0) rects.push({ x, w: width });
    x += width;
  });
  return { width: x, rects };
}

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
