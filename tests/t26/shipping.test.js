/**
 * T26 — Shipping labels (BOTH plans, Nov 13, 2026).
 *
 * The owner's design, pinned:
 *  - A 4×6 shipping-label style lives in the Print Center alongside
 *    the other styles, on BOTH plans (it is a customer document,
 *    never a supplier one, so the Business-only supplier gate does
 *    not touch it).
 *  - It is built from a customer order (the shared customer-order
 *    picker loads it); the recipient name pre-fills from the order
 *    and the postal address is typed at print time — orders carry
 *    no address field and the address is never saved.
 *  - White-label: the label carries the business's own name only.
 *  - Plans parity: the includes line renders on Plans AND Welcome
 *    for both plans, with a comparison row (both true).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { close } from './helpers.js';
import { PLANS, WELCOME_OPTIONS, COMPARISON_ROWS, isSupplierPrintTemplate } from '../../src/lib/plans.js';

after(close);

const LINE = '4×6 shipping labels for customer orders';
const welcomeOf = (key) => WELCOME_OPTIONS.find((o) => o.key === key);

test('shipping: the style is registered as a customer document, 4x6, on both plans', () => {
  const cards = readFileSync('src/components/print/LabelCard.jsx', 'utf8');
  assert.match(cards, /key: 'shipping',\s*label: 'Shipping label',/);
  assert.match(cards, /key: 'shipping'[\s\S]*?kind: 'customer',\s*mode: 'shipping',/);
  // A customer document — NOT a supplier style — so it is never
  // Business-gated and shows on Essentials too.
  assert.equal(isSupplierPrintTemplate('shipping'), false);
});

test('shipping: Print Center loads customer orders for it and renders the label', () => {
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  assert.match(page, /\['invoice', 'receipt', 'custpacking', 'shipping'\]\.includes\(template\)/);
  assert.match(page, /import ShippingLabelDoc from '@\/components\/print\/ShippingLabelDoc';/);
  assert.match(page, /activeTemplate\.mode === 'shipping' \? \(\s*<ShippingLabelDoc/);
  // The recipient name pre-fills from the picked order.
  assert.match(page, /if \(template === 'shipping' && customerOrder\) \{\s*setShipName\(customerOrder\.customer_name \|\| ''\);/);
  // No server PDF masquerade: the label prints through the browser
  // like every other document, never as a packing-slip download.
  assert.match(page, /isCustomerDoc && customerOrder && activeTemplate\.mode !== 'shipping'/);
});

test('shipping: the label is white-label and takes the address at print time', () => {
  const doc = readFileSync('src/components/print/ShippingLabelDoc.jsx', 'utf8');
  assert.match(doc, /business\?\.name/);
  assert.match(doc, /recipientName \|\| order\?\.customer_name/);
  assert.match(doc, /w-\[102mm\]/);
  assert.match(doc, /h-\[152mm\]/);
  // The app's own name never appears on a customer's parcel.
  assert.ok(!doc.includes('Luminous StockHaven'), 'shipping label carries no app branding');
  assert.ok(!doc.includes('StockHaven'), 'shipping label carries no app branding');
});

test('shipping: plans parity — both plans, Plans page and Welcome, comparison row', () => {
  assert.ok(PLANS.essentials.includes.includes(LINE), 'Essentials PLANS includes names shipping labels');
  assert.ok(PLANS.business.includes.includes(LINE), 'Business PLANS includes names shipping labels');
  assert.ok(welcomeOf('essentials').includes.includes(LINE), 'Welcome Essentials includes names shipping labels');
  assert.ok(welcomeOf('business').includes.includes(LINE), 'Welcome Business includes names shipping labels');
  const row = COMPARISON_ROWS.find((r) => r.label === LINE);
  assert.ok(row, 'comparison row exists');
  assert.equal(row.essentials, true);
  assert.equal(row.business, true);
});
