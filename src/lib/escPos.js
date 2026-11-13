/**
 * ESC/POS label bytes — T5 printing (plan §2.12).
 *
 * Pure, no DOM, no network: the label bytes are generated
 * client-side from data the page already has, so a Bluetooth or USB
 * print job needs no live server round-trip and no internet.
 *
 * Generic, not product-only (owner design note Nov 9): the bytes
 * are built from a generic label payload — { title, lines, code,
 * codeType } (src/lib/labelPayload.js) — so a location / bin label
 * flows through exactly the same path as a product label. Product
 * objects are mapped to that payload by toLabel(); nothing here
 * reads product fields.
 *
 * Target: ESC/POS thermal label printers (the common dialect for
 * small receipt/label printers over Bluetooth LE and USB). The
 * barcode is a real Code 128 (GS k 73, code set B — the "{B"
 * prefix selects it). Zebra ZPL and Brother's own dialects are NOT
 * spoken here; a printer that only speaks ZPL will not understand
 * these bytes, and the UI says so — that needs real-hardware
 * testing with the owner (T6/T7), not a guess.
 */
import { toLabel, productCodeOf } from './labelPayload.js';

export { productCodeOf as labelCodeOf };

function pushText(bytes, value) {
  for (const ch of String(value ?? '')) {
    const code = ch.charCodeAt(0);
    bytes.push(code < 128 ? code : 63); // non-ASCII -> '?', never a broken byte
  }
}

/**
 * One label's ESC/POS bytes from a generic label payload:
 * title, each line, Code 128 barcode, code text.
 * A product object is accepted too and mapped via toLabel().
 */
export function escPosLabelBytes(item) {
  const label = toLabel(item);
  const bytes = [];
  const push = (...vals) => bytes.push(...vals);
  push(0x1b, 0x40); // ESC @ — initialise
  push(0x1b, 0x61, 0x01); // centre align
  push(0x1b, 0x45, 0x01); // bold on
  pushText(bytes, label.title || 'Untitled');
  push(0x0a);
  push(0x1b, 0x45, 0x00); // bold off
  for (const line of label.lines) {
    pushText(bytes, line);
    push(0x0a);
  }
  if (label.code) {
    // GS k 73 — Code 128, code set B ("{B" prefix), n = data length.
    const data = `{B${label.code}`;
    push(0x1d, 0x6b, 0x49, data.length);
    pushText(bytes, data);
    push(0x0a);
  }
  pushText(bytes, `Code: ${label.code || '—'}`);
  push(0x0a, 0x0a, 0x0a);
  push(0x1d, 0x56, 0x00); // GS V — cut
  return new Uint8Array(bytes);
}

/** Every label — product or location — `copies` times each, as one byte stream. */
export function escPosLabelsBytes(items, copies = 1) {
  const perCopy = Math.min(Math.max(Number(copies) || 1, 1), 20);
  const parts = (items || []).flatMap((item) =>
    Array.from({ length: perCopy }, () => escPosLabelBytes(item)),
  );
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}
