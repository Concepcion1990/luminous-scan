import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SUPPLIER_PRINT_TEMPLATES, isSupplierPrintTemplate } from './plans.js';

/**
 * Supplier print styles: Business-only, on the Labels & sheets page.
 *
 * LIVE FINDING (2026-11-07, on the fresh Essentials account): the Print
 * Center offered "Purchase order" (costed order to send the supplier) and
 * "Supplier packing slip" (quantities only, no prices). Both relate to
 * suppliers/buying and belong to Business only.
 *
 * The other styles stay on both plans — including the customer packing slip
 * and the return document, which are customer documents, not supplier ones.
 * Printing is client-side (window.print of this preview) and no backend
 * function generates these documents, so the style list and the render
 * guard are the enforcement.
 */

const KEPT_STYLES = [
  'price',
  'shelf',
  'barcode',
  'qr',
  'bin',
  'sheet',
  'count',
  'pick',
  'invoice',
  'receipt',
  'custpacking',
  'returndoc',
];

test('the supplier print styles are exactly Purchase order and Supplier packing slip', () => {
  assert.deepEqual(SUPPLIER_PRINT_TEMPLATES, ['po', 'packing']);
  assert.equal(isSupplierPrintTemplate('po'), true);
  assert.equal(isSupplierPrintTemplate('packing'), true);
  for (const key of KEPT_STYLES) assert.equal(isSupplierPrintTemplate(key), false);
});

test('the Print Center offers supplier styles on Business only', () => {
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  assert.match(page, /import \{ isSupplierPrintTemplate \} from '@\/lib\/plans';/);
  assert.match(page, /const \{ isEssentials, isLoading: entitlementLoading \} = useEntitlements\(\);/);
  assert.match(page, /const showSupplierDocs = !isEssentials && !entitlementLoading;/);
  assert.match(
    page,
    /const visibleTemplates = TEMPLATES\.filter\(\s*\(entry\) => showSupplierDocs \|\| !isSupplierPrintTemplate\(entry\.key\)\s*\);/
  );
  assert.match(page, /\{visibleTemplates\.map\(\(entry\) => \(/);
  // A supplier style picked on Business must not linger on Essentials.
  assert.match(
    page,
    /if \(isEssentials && isSupplierPrintTemplate\(template\)\) setTemplate\('price'\);/
  );
  // The purchase-order rows are not even loaded on Essentials.
  assert.match(page, /if \(!needsOrder \|\| !activeId \|\| !showSupplierDocs\) return;/);
});

test('a supplier document cannot preview or print on Essentials', () => {
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  assert.match(
    page,
    /const supplierBlocked = isSupplierPrintTemplate\(template\) && !showSupplierDocs;/
  );
  assert.match(page, /const blank = supplierBlocked \|\| nothingPicked;/);
  assert.match(page, /\{supplierBlocked \? \(/);
  assert.match(page, /\{activeTemplate\?\.label\} is a Business feature/);
});

test('Business keeps both supplier styles', () => {
  const cards = readFileSync('src/components/print/LabelCard.jsx', 'utf8');
  assert.match(cards, /key: 'po',\s*label: 'Purchase order',/);
  assert.match(cards, /key: 'packing',\s*label: 'Supplier packing slip',/);
});

test('the Print Center subtitle does not advertise purchase orders to Essentials', () => {
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  // One subtitle per plan: the purchase-orders mention only rides along
  // when supplier documents are actually available.
  assert.match(page, /\{showSupplierDocs\s*\n\s*\? 'Scannable labels, stock sheets, pick lists, purchase orders, customer invoices, receipts and return documents\.'\s*\n\s*: 'Scannable labels, stock sheets, pick lists, customer invoices, receipts and return documents\.'\}/);
});

test('supplier styles show as locked entries linking to /upgrade on Essentials', () => {
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  // Only once Essentials is confirmed — while the plan is still loading
  // the styles stay hidden, so a Business account never briefly sees them
  // locked the way the limits flashed.
  assert.match(page, /const lockedSupplierTemplates =\s*\n\s*isEssentials && !entitlementLoading/);
  assert.match(page, /TEMPLATES\.filter\(\(entry\) => isSupplierPrintTemplate\(entry\.key\)\)/);
  assert.match(page, /\{lockedSupplierTemplates\.map\(\(entry\) => \(/);
  assert.match(page, /<Lock className="h-3\.5 w-3\.5 shrink-0 text-muted-foreground" \/>/);
  // Locked entries link out to /upgrade — they never select the style, so
  // the supplierBlocked preview guard underneath stays as defence in depth.
  assert.match(page, /<Link\s*\n\s*key=\{entry\.key\}\s*\n\s*to="\/upgrade"/);
  assert.match(page, /Business\s*\n\s*<\/span>/);
});
