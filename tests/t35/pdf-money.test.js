/**
 * Leftovers sweep, item 5 — money in server PDFs (Nov 15, 2026):
 * number grouping follows the business's locale; the amount stays
 * exact to the cent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPoPdf } from '../../server/printPdf.js';

test('item 5: money groups by the business locale, exact to the cent', () => {
  const order = {
    number: 'PO-9', supplier_name: 'S', order_date: '2026-11-15', status: 'ordered',
    lines: [{ product_name: 'X', qty_ordered: 1, unit_cost: 1234567.89 }],
    subtotal: 1234567.89, total: 1234567.89,
  };
  const de = buildPoPdf(order, { name: 'Laden', language: 'de', currency: 'EUR' });
  // The de-formatted total is drawn in the standard font (WinAnsi),
  // so it is extractable from the content stream as literal text.
  assert.ok(de.includes(Buffer.from('1.234.567,89')), 'de grouping 1.234.567,89 present');
  const en = buildPoPdf(order, { name: 'Shop', language: 'en', currency: 'USD' });
  assert.ok(en.includes(Buffer.from('1,234,567.89')), 'en grouping unchanged');
});
