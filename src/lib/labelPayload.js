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
 *   codeType — the code's native symbology: 'UPC-A' or 'EAN-13'
 *              for valid numeric codes of those lengths, 'CODE128'
 *              for everything else (what the ESC/POS path draws
 *              and the browser-print templates draw in SVG).
 *
 * A product label and a location label flow through the SAME
 * machinery — ESC/POS bytes, Bluetooth / USB sends, client-side PDF,
 * server PDF, browser-print layout — because each generator takes
 * this payload, never a product object. The mappers below are the
 * only place product or location fields are read.
 *
 * The payload also carries the product's PHOTO (print family,
 * Nov 24, 2026 — the owner's ruling: the barcode and QR labels
 * print the product's picture beside the item, in every path):
 *   photo     — the stored photo's URL (photo_urls[0]); the
 *               browser-print templates read it directly.
 *   photoData — the same photo as a data URL, attached by the
 *               labels-PDF caller (client or server) so the PDF
 *               builders can embed it without fetching.
 *   photoRaster — the same photo as ESC/POS raster bytes,
 *               attached by the Bluetooth / USB callers.
 * A location label carries none of these — a sign for a place
 * stays exactly as it was (the owner's exception list).
 *
 * The fuller features behind this — overstock location tracking
 * (bin / top-of-shelf / stock room, counts per location) and
 * price-drop reasons shown to the manager — are POST-TWIN, not T5.
 * This module only makes sure nothing in T5's label design blocks
 * them later.
 */
import { symbologyFor } from './barcodeSym.js';

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
  const code = productCodeOf(product);
  const label = {
    title: String(product.name || 'Untitled').slice(0, 42),
    lines,
    code,
    // Native symbology (Nov 14, 2026): a valid UPC/EAN code prints
    // as itself on every path; everything else stays Code 128.
    codeType: symbologyFor(code),
  };
  // Photo fields join the payload ONLY when there is a photo to
  // carry (print family, Nov 24, 2026) — a photo-less product's
  // payload keeps exactly the shape it has always had.
  const photo = Array.isArray(product.photo_urls) ? product.photo_urls[0] : '';
  if (photo) label.photo = photo;
  // A photo a caller already fetched for this product (as a
  // data URL or ESC/POS raster) rides through the mapping —
  // the PDF and thermal builders read it from the payload.
  if (product.photoData) label.photoData = product.photoData;
  if (product.photoRaster) label.photoRaster = product.photoRaster;
  return label;
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
    const label = {
      title: item.title.slice(0, 42),
      lines: Array.isArray(item.lines) ? item.lines.map(String) : [],
      code: String(item.code || '').trim(),
      codeType: item.codeType || 'CODE128',
    };
    // Photo fields ride the pass-through untouched (print
    // family, Nov 24, 2026) so a caller-attached photo survives
    // normalisation on its way to the PDF and ESC/POS builders —
    // present only when the payload actually carries one.
    if (item.photo) label.photo = item.photo;
    if (item.photoData) label.photoData = item.photoData;
    if (item.photoRaster) label.photoRaster = item.photoRaster;
    return label;
  }
  if (item.name && (item.aisle !== undefined || item.bin !== undefined || item.room !== undefined || item.code)) {
    return locationToLabel(item);
  }
  return productToLabel(item);
}
