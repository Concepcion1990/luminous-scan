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