/**
 * Generic label payload — T5 printing (plan §2.12 + owner design
 * note Nov 9 ~8:11 PM).
 *
 * Labels are NOT product-only. Besides product labels the app will
 * later print LOCATION labels — aisle tags and stock-room bin labels
 * (e.g. a bin holding overstock Harry Potter books that do not fit
 * on the aisle). So every label path speaks ONE payload:
 *
 *   { title, lines: [String], code, codeType }
 *
 *   title    — the big line: a product name, an aisle name, a bin name.
 *   lines    — the smaller lines under it, in order: price and SKU for
 *              a product; aisle / room / contents for a location.
 *   code     — the scannable code: UPC / SKU for a product, the aisle
 *              or bin code for a location.
 *   codeType — 'CODE128' today (what the ESC/POS path draws and the
 *              browser-print templates draw in SVG). A future code
 *              type (QR) is a value here, not a new code path.
 *
 * A product label and a location label flow through the SAME
 * machinery — ESC/POS bytes, Bluetooth / USB sends, client-side PDF,
 * server PDF, browser-print layout — because each generator takes
 * this payload, never a product object. The mappers below are the
 * only place product or location fields are read.
 *
 * The fuller features behind this — overstock location tracking
 * (bin / top-of-shelf / stock room, counts per location) and
 * price-drop reasons shown to the manager — are POST-TWIN, not T5.
 * This module only makes sure nothing in T5's label design blocks
 * them later.
 */

export function labelMoney(value, currency = 'USD') {
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

/** The scannable code for a product: barcode, then UPC, then SKU. */
export function productCodeOf(product) {
  return String(product.barcode || product.upc || product.sku || product.qr_code || '').trim();
}

/** A product as a generic label: name, price + SKU lines, UPC/SKU code. */
export function productToLabel(product) {
  const lines = [];
  if (product.price !== null && product.price !== undefined && product.price !== '') {
    lines.push(labelMoney(product.price));
  }
  if (product.sku) lines.push(`SKU ${product.sku}`);
  return {
    title: String(product.name || 'Untitled').slice(0, 42),
    lines,
    code: productCodeOf(product),
    codeType: 'CODE128',
  };
}

/**
 * A location as a generic label: aisle or bin name, detail lines,
 * aisle/bin code. Accepts the shape the future aisle feature will
 * carry — { name, code, aisle, bin, room, detail, contents } — and
 * tolerates plain { title, lines, code } payloads passed straight
 * through by toLabel.
 */
export function locationToLabel(location) {
  const lines = [];
  for (const value of [location.detail, location.aisle, location.bin, location.room, location.contents]) {
    if (value) lines.push(String(value));
  }
  if (Array.isArray(location.lines)) lines.push(...location.lines.map(String));
  return {
    title: String(location.name || location.title || 'Location').slice(0, 42),
    lines,
    code: String(location.code || location.barcode || location.sku || location.id || '').trim(),
    codeType: 'CODE128',
  };
}

/**
 * Normalise anything a label path is handed into a generic label.
 * A payload that already has a title IS a label (pass-through, with
 * defaults). A product maps through productToLabel. Anything with a
 * name and no title is treated as a location.
 */
export function toLabel(item) {
  if (!item) return { title: 'Untitled', lines: [], code: '', codeType: 'CODE128' };
  if (typeof item.title === 'string') {
    return {
      title: item.title.slice(0, 42),
      lines: Array.isArray(item.lines) ? item.lines.map(String) : [],
      code: String(item.code || '').trim(),
      codeType: item.codeType || 'CODE128',
    };
  }
  if (item.name && (item.aisle !== undefined || item.bin !== undefined || item.room !== undefined || item.code)) {
    return locationToLabel(item);
  }
  return productToLabel(item);
}
