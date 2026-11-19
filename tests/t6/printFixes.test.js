/**
 * Print fixes (owner rulings, Nov 14, 2026): exact prices on every
 * printed document (cents, never whole-dollar rounding); the
 * price tag's final layout (price top, UPC barcode middle with
 * legible digits, name, SKU small at the bottom); the Print page
 * Select-all box over the currently listed products with a count;
 * the sales receipt as a narrow 80mm till slip while the invoice
 * keeps its full-page look; labels flowing on one sheet (print
 * CSS releases the viewport-height shell and takes the label flow
 * out of flex, which fragmented and repeated labels on paper).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('every print template formats money with cents (formatMoney digits = 2)', () => {
  for (const file of ['CustomerDoc.jsx', 'PurchaseOrderDoc.jsx', 'ReturnDoc.jsx']) {
    const src = read(`../../src/components/print/${file}`);
    assert.match(src, /business\?\.currency, 2\)/, `${file} passes explicit cents`);
    assert.ok(!src.includes('business?.currency)'), `${file} still has a rounding call`);
  }
  const card = read('../../src/components/print/LabelCard.jsx');
  assert.match(card, /formatMoney\(effective, business\.currency, 2\)/);
  assert.ok(!/formatMoney\(effective, business\.currency\)/.test(card), 'LabelCard still rounds');
});

test('price tag order: price, barcode + digits, name, SKU at the bottom', () => {
  const card = read('../../src/components/print/LabelCard.jsx');
  const priceBlock = card.slice(card.indexOf("template === 'price'"), card.indexOf("template === 'shelf'"));
  const iPrice = priceBlock.indexOf('{price}');
  const iBarcode = priceBlock.indexOf('BarcodeSvg');
  const iDigits = priceBlock.indexOf('{priceCode}</p>');
  const iName = priceBlock.indexOf('<Name');
  const iSku = priceBlock.indexOf('{product.sku}');
  assert.ok(iPrice >= 0 && iBarcode > iPrice && iDigits > iBarcode && iName > iDigits && iSku > iName,
    'price > barcode > digits > name > sku');
  assert.match(card, /priceCode = \(product\.upc \|\| product\.barcode \|\| product\.sku/);
  assert.match(priceBlock, /skuAtBottom/); // no duplicate SKU when the slot already shows it
  assert.match(card, /Large price with name, UPC barcode and SKU/);
});

test('Print picker: master Select-all over the listed products with a selected count', () => {
  const picker = read('../../src/components/print/ProductPicker.jsx');
  assert.match(picker, /indeterminate/);
  assert.match(picker, /products\.selectAllCount/);
  assert.match(picker, /products\.selectedCount/);
  assert.match(picker, /onToggleAll/);
  const center = read('../../src/pages/PrintCenter.jsx');
  assert.match(center, /toggleAllListed/);
  assert.match(center, /print-label-flow/);
});

test('the receipt is an 80mm slip; the invoice keeps the 180mm document', () => {
  const doc = read('../../src/components/print/CustomerDoc.jsx');
  const start = doc.indexOf('if (receipt)');
  const receiptBlock = doc.slice(start, start + 4200);
  assert.match(receiptBlock, /mx-auto w-\[80mm\]/);
  assert.match(receiptBlock, /print\.totalPaid/);
  assert.match(receiptBlock, /print\.footerReceipt/);
  assert.match(receiptBlock, /× \{money\(line\.unit_price\)\}/);
  assert.match(doc, /w-\[180mm\]/); // the shared invoice/packing document, unchanged
});

test('print CSS: shell height released and label flow taken out of flex on paper', () => {
  const css = read('../../src/index.css');
  const printBlock = css.slice(css.indexOf('@media print'));
  assert.match(printBlock, /\.min-h-screen \{\s*min-height: 0 !important;/);
  assert.match(printBlock, /\.print-label-flow \{\s*display: block !important;/);
  assert.match(printBlock, /\.print-label-flow > \.print-label \{\s*display: inline-block;/);
});

test('Products page: archived rows render no steppers, no Add stock, no Adjust door', () => {
  const page = read('../../src/pages/Products.jsx');
  assert.match(page, /const archived = product\.status === 'archived';/);
  // Since the Adjust-door fix (Nov 19, 2026), the same withholding
  // also covers members without products.edit — archived stays the
  // first condition, so an archived row never offers the door.
  assert.match(page, /onAddStock=\{archived \|\| !canEditProducts \? undefined :/);
  assert.match(page, /if \(product\.status === 'archived'\) return;/); // stepStock guard
  const funnel = read('../../src/lib/inventory.js');
  assert.match(funnel, /inventoryLib\.archivedFrozen/);
});

test('order lines cannot pick an archived product (existing lines keep theirs)', () => {
  const row = read('../../src/components/orders/OrderLineRow.jsx');
  assert.match(row, /\(p\.status \|\| 'active'\) !== 'archived' \|\| p\.id === line\.product_id/);
});
