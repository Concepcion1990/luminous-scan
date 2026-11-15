/**
 * T6 — Product form pins (Nov 14, 2026):
 *  - Preferred supplier gets the SAME plan treatment as sale
 *    pricing: off-Business the polite Business-plan note replaces
 *    the dropdown, and the save payload omits supplier_id /
 *    supplier_name entirely, so a downgraded business's stored
 *    supplier is held untouched — never cleared by an unrelated
 *    edit. On Business the dropdown renders exactly as before.
 *  - Only the name is required to save; the old combined
 *    name-and-SKU message (which claimed the name was missing when
 *    only the SKU was) is gone from the save gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dialog = readFileSync(
  new URL('../../src/components/products/ProductFormDialog.jsx', import.meta.url),
  'utf8',
);
const inventoryLib = readFileSync(
  new URL('../../src/lib/inventory.js', import.meta.url),
  'utf8',
);

test('supplier field: gated on the suppliers feature with the Business-plan note off-Business', () => {
  assert.ok(dialog.includes("const canSuppliers = can('suppliers');"), 'the form gates suppliers like pricing');
  assert.ok(dialog.includes("t('productForm.supplierBusinessOnly')"), 'the Business-plan note renders off-Business');
  assert.ok(dialog.includes('canSuppliers ? ('), 'the dropdown renders only when the plan allows suppliers');
});

test('supplier payload: omitted entirely off-Business so a held supplier_id is never altered', () => {
  assert.ok(
    dialog.includes('...(canSuppliers'),
    'supplier_id/supplier_name join the payload only on Business',
  );
  const occurrences = dialog.split('supplier_id: form.supplier_id').length - 1;
  assert.equal(occurrences, 1, 'supplier_id is sent from exactly one place: the Business-only spread');
  assert.ok(
    dialog.indexOf('supplier_id: form.supplier_id') > dialog.indexOf('...(canSuppliers'),
    'the single supplier_id send sits inside the canSuppliers spread',
  );
});

test('save gate: only the name is required, with its own accurate message', () => {
  assert.ok(dialog.includes("t('productForm.nameRequired')"), 'the name-only message is used');
  assert.ok(
    !dialog.includes("if (!form.name.trim() || !form.sku.trim())"),
    'the combined name+SKU refusal is gone',
  );
});

test('starting quantity: create-mode only, stocked as a receive movement at the chosen location', () => {
  assert.ok(dialog.includes('{!product && !createdProduct && ('), 'the quantity block renders only while creating');
  assert.ok(dialog.includes("t('productForm.quantityLabel')"), 'the quantity field is labeled');
  assert.ok(dialog.includes("t('productForm.quantityInvalid')"), 'invalid quantities get the plain refusal');
  assert.ok(dialog.includes('if (!/^\\d+$/.test(raw))'), 'only whole numbers of zero or more pass');
  assert.ok(dialog.includes("type: 'receive'"), 'the opening stock is a receive movement, never a bare write');
  assert.ok(dialog.includes('recordMovement({'), 'the movement goes through the shared funnel');
  assert.ok(dialog.includes('locations.length > 1'), 'a location choice appears only when there is a choice to make');
  assert.ok(dialog.includes("localStorage.getItem('stockroom.location')"), "the default location follows the scan flow's remembered location");
});

test('edit quantity: the Edit form shows the current count and saves a change as ONE movement', () => {
  assert.ok(
    dialog.includes('{product && locations.length > 0 && ('),
    'the quantity block renders in edit mode when there is somewhere to stock',
  );
  assert.ok(dialog.includes('id="edit_quantity"'), 'the edit quantity field exists');
  assert.ok(
    dialog.includes("t('productForm.quantityEditHint')"),
    'the edit hint says the difference is recorded as a movement',
  );
  assert.ok(
    dialog.includes('scoped({ product_id: product.id }, activeId)'),
    "the product's levels load on open so the box can prefill",
  );
  assert.ok(
    dialog.includes('setQuantity(String(current))'),
    'the box prefills with the current count at the chosen location',
  );
  assert.ok(
    dialog.includes('editQty !== currentAtLocation'),
    'an unchanged count writes no movement at all',
  );
  assert.ok(
    dialog.includes('quantity: editQty - currentAtLocation'),
    "an increase is a 'receive' of exactly the difference",
  );
  assert.ok(dialog.includes("type: 'correction'"), 'a decrease is a correction landing on the typed count');
  assert.ok(
    dialog.includes('quantity: editQty,'),
    'the correction carries the typed count itself (recordMovement sets the level to it)',
  );
});

test('photos: the add tile offers camera or gallery, both feeding the same upload pipeline', () => {
  assert.ok(
    dialog.includes('onClick={() => setPhotoChooserOpen(true)}'),
    'tapping the add tile opens the camera/gallery choice, not the gallery picker directly',
  );
  assert.ok(dialog.includes("t('productForm.takePhoto')"), 'the camera choice is labeled');
  assert.ok(dialog.includes("t('productForm.chooseFromGallery')"), 'the gallery choice is labeled');
  assert.ok(
    dialog.includes('capture="environment"'),
    'the camera input asks the device for the camera (capture=environment)',
  );
  assert.ok(dialog.includes('ref={cameraFileRef}'), 'the camera input has its own ref');
  // Both inputs run the identical addPhotos path (downscale + upload).
  const addPhotoCalls = dialog.match(/addPhotos\(Array\.from\(event\.target\.files \|\| \[\]\)\)/g) || [];
  assert.equal(addPhotoCalls.length, 2, 'camera and gallery files go through the same addPhotos pipeline');
  // The gallery input keeps its original shape: multi-select, no capture.
  const galleryInput = dialog.slice(dialog.indexOf('ref={fileRef}'), dialog.indexOf('ref={cameraFileRef}'));
  assert.ok(galleryInput.includes('accept="image/*"') && galleryInput.includes('multiple'), 'gallery input unchanged');
  assert.ok(!galleryInput.includes('capture'), 'the gallery input never forces the camera');
});

test('scan button: the UPC, Barcode and QR fields each open the in-form scanner', () => {
  assert.ok(dialog.includes("onClick={() => openCodeScanner('upc')}"), 'the UPC field has a scan button');
  assert.ok(dialog.includes("onClick={() => openCodeScanner('barcode')}"), 'the Barcode field has a scan button');
  // Owner ask (Nov 14, 2026): the QR field gets the same button — a
  // QR code can encode a whole URL, the one value nobody can type.
  assert.ok(dialog.includes("onClick={() => openCodeScanner('qr_code')}"), 'the QR field has a scan button');
  assert.ok(dialog.includes("t('productForm.scanCode')"), 'the scan buttons use the scan-code string');
  // The capture handler writes via set(field) and returns focus via
  // document.getElementById(field): the QR input's id must BE the
  // field name or the capture would land nowhere and focus nowhere.
  assert.ok(dialog.includes('id="qr_code"'), 'the QR input id matches its form field name');
  assert.ok(dialog.includes('htmlFor="qr_code"'), 'the QR label points at the same id');
  assert.ok(
    dialog.includes("import BarcodeScanner from '@/components/scan/BarcodeScanner';"),
    'the overlay reuses the app scanner component',
  );
});

test('scan overlay: lives inside the dialog so the half-filled form is never unmounted', () => {
  assert.ok(dialog.includes('{scanField && ('), 'the scanner renders only while a field is being scanned');
  assert.ok(
    dialog.includes('<BarcodeScanner onDetect={handleScanDetect} />'),
    'the scanner feeds the form capture handler',
  );
  // The overlay sits inside <DialogContent> (after the footer), not in
  // a route or a second dialog: form state lives in this component and
  // survives open/close untouched.
  assert.ok(
    dialog.indexOf('{scanField && (') > dialog.indexOf('<DialogFooter>'),
    'the overlay renders within the dialog content',
  );
  assert.ok(
    dialog.includes('onClick={() => setScanField(null)}'),
    'the overlay cancel just closes the scanner',
  );
});

test('scan capture: the code lands in the field it was invoked from, first capture latched', () => {
  assert.ok(dialog.includes('if (scanHandledRef.current || !scanField) return;'), 'repeat detects after a capture are ignored');
  assert.ok(dialog.includes('const field = scanField;'), 'the target field is latched before the overlay closes');
  assert.ok(dialog.includes('set(field)(value);'), 'the scanned value is written into that field');
  assert.ok(
    dialog.includes("requestAnimationFrame(() => document.getElementById(field)?.focus());"),
    'focus returns to the field after the overlay closes',
  );
});

test('scan capture: a code belonging to another product is named at the field', () => {
  assert.ok(
    dialog.includes('const other = matches.find((m) => m.id !== product?.id);'),
    'the product being edited never counts as "another product"',
  );
  assert.ok(dialog.includes("codeTaken?.field === 'upc'"), 'the notice renders at the UPC field');
  assert.ok(dialog.includes("codeTaken?.field === 'barcode'"), 'the notice renders at the Barcode field');
  assert.ok(dialog.includes("codeTaken?.field === 'qr_code'"), 'the notice renders at the QR field');
  assert.ok(
    dialog.includes("if (codeTaken?.field === 'qr_code') setCodeTaken(null);"),
    'editing the QR field by hand clears a stale notice',
  );
  assert.ok(
    dialog.includes("t('productForm.codeTakenNotice', { name: codeTaken.name })"),
    'the notice names the product that already holds the code',
  );
  assert.ok(
    dialog.includes("if (codeTaken?.field === 'upc') setCodeTaken(null);"),
    'editing the field by hand clears a stale notice',
  );
});

test('scan capture: the code-taken lookup covers the QR field too', () => {
  // handleScanDetect is field-generic, so a QR capture runs the same
  // findProductsByCode courtesy check as UPC/Barcode — which only
  // protects the QR field if the lookup itself matches qr_code.
  const lookup = inventoryLib.slice(
    inventoryLib.indexOf('export async function findProductsByCode'),
    inventoryLib.indexOf('export async function findProductByCode'),
  );
  assert.ok(lookup.includes('{ qr_code: { $in: variants } }'), 'the exact-pass lookup matches qr_code');
  assert.ok(lookup.includes("{ qr_code: { $regex: pattern, $options: 'i' } }"), 'the loose-pass lookup matches qr_code');
});

test('scan button: plan-independent — no plan or entitlement check touches the scanner', () => {
  const scanBlock = dialog.slice(dialog.indexOf('const openCodeScanner'), dialog.indexOf('const addPhotos'));
  assert.ok(!/can\(|entitlement|plan/i.test(scanBlock), 'the scan open/capture path never consults the plan');
  const overlayBlock = dialog.slice(dialog.indexOf('{scanField && ('));
  assert.ok(!/can\(|entitlement/i.test(overlayBlock), 'the overlay render never consults the plan');
});
