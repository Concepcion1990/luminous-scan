/**
 * T6 — Window conversion pins (Nov 20, 2026, release 328, owner
 * ruling: "Convert those three windows too, after the sweep").
 *
 * Release 326 converted the two windows that FROZE on the owner's
 * phone (the picker's Add window and Bulk edit's delete
 * confirmation) from hand-rolled fixed overlays into real nested
 * Radix Dialogs, and flagged three more windows from the same
 * hand-rolled family. None of the three sat as a sibling of a
 * Radix DialogContent the way the frozen two did, and the harness
 * documented their actual behavior before conversion: buttons
 * answered, but there was no focus trap and no scroll lock —
 * focus stayed on whatever opened them and the page/form behind
 * still scrolled — and the Categories edit window's Add-new door
 * did not open its window at all under a real touch tap. The
 * owner ordered the conversion anyway. These pins hold the three
 * windows to the 326 construction:
 *
 *  - CategoryEditDialog (Inventory by category): a real Radix
 *    Dialog (own Root + Portal, Title) at its original z-[70]
 *    layer, so the Add window (z-[80]) still nests above it; no
 *    hand-rolled role="dialog" card remains; the save judge and
 *    the entity update path are untouched.
 *  - OrderFormDialog's tracking scanner: a nested Radix Dialog
 *    (own Root + Portal, z-[80]) inside the order dialog, with a
 *    screen-reader Title from the existing scanTracking key; the
 *    capture handler and Cancel are untouched.
 *  - CountSheet's tally scanner: a real Radix Dialog (own Root +
 *    Portal, z-[80]) whose Title is the existing scanTally.title
 *    line; the tally handler and Done are untouched.
 *
 * Behavior is proven live by
 * ~/workspace/hotfix-harness/probe-windowconv.mjs (real touch
 * taps with elementFromPoint hit-verification).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const categoryEdit = readFileSync(
  new URL('../../src/components/inventory/CategoryEditDialog.jsx', import.meta.url),
  'utf8',
);
const orderForm = readFileSync(
  new URL('../../src/components/orders/OrderFormDialog.jsx', import.meta.url),
  'utf8',
);
const countSheet = readFileSync(
  new URL('../../src/components/counts/CountSheet.jsx', import.meta.url),
  'utf8',
);

const HAND_ROLLED_CARD = 'fixed inset-0 z-[70] flex items-center justify-center bg-black/60';

test('category edit window: a real Radix dialog at its original layer', () => {
  assert.ok(
    categoryEdit.includes("import * as DialogPrimitive from '@radix-ui/react-dialog';"),
    'built on the Radix primitives, like the Add window',
  );
  assert.ok(categoryEdit.includes('<DialogPrimitive.Root'), 'own Root');
  assert.ok(categoryEdit.includes('<DialogPrimitive.Portal>'), 'own Portal');
  assert.ok(categoryEdit.includes('<DialogPrimitive.Title'), 'the heading is the dialog Title');
  assert.ok(
    categoryEdit.includes('z-[70]'),
    'keeps its z-[70] layer so the Add window (z-[80]) still nests above it',
  );
  assert.ok(!categoryEdit.includes('role="dialog"'), 'no hand-rolled dialog card remains');
  assert.ok(!categoryEdit.includes(HAND_ROLLED_CARD), 'no hand-rolled overlay remains');
});

test('category edit window: dismissal is Cancel, blocked while saving', () => {
  assert.ok(
    categoryEdit.includes('if (!next && !busy) onCancel?.()'),
    'Escape/backdrop cancel through onCancel, never mid-save',
  );
  // The save path is untouched by the conversion.
  assert.ok(categoryEdit.includes('judgeVocabularyValue({'), 'the save judge still guards');
  assert.ok(
    categoryEdit.includes('base44.entities.Product.update(product.id, { category: verdict.value })'),
    'the entity write is unchanged',
  );
  assert.ok(categoryEdit.includes('<AddVocabularyDialog'), 'the Add window still rides along');
});

test('tracking scanner: a nested Radix dialog inside the order dialog', () => {
  assert.ok(
    orderForm.includes("import * as DialogPrimitive from '@radix-ui/react-dialog';"),
    'built on the Radix primitives, like the Add window',
  );
  const overlay = orderForm.slice(orderForm.indexOf('{trackingScanOpen && ('));
  assert.ok(overlay.includes('<DialogPrimitive.Root'), 'own Root');
  assert.ok(overlay.includes('<DialogPrimitive.Portal>'), 'own Portal');
  assert.ok(overlay.includes('z-[80]'), 'the nested layer above the host dialog');
  assert.ok(
    overlay.includes('<DialogPrimitive.Title className="sr-only">{t(\'orders.scanTracking\')}</DialogPrimitive.Title>'),
    'a screen-reader Title from the existing key — no new string, no visible change',
  );
  assert.ok(!overlay.includes(HAND_ROLLED_CARD), 'no hand-rolled overlay remains');
  assert.ok(
    overlay.includes("if (!next) setTrackingScanOpen(false)"),
    'dismissal closes the scanner through its own state',
  );
  // The capture path is untouched by the conversion.
  assert.ok(overlay.includes('<BarcodeScanner onDetect={handleTrackingScan} />'), 'the scanner is unchanged');
  assert.ok(overlay.includes('onClick={() => setTrackingScanOpen(false)}'), 'Cancel still closes it directly');
});

test('tally scanner: a real Radix dialog with the tally title as its Title', () => {
  assert.ok(
    countSheet.includes("import * as DialogPrimitive from '@radix-ui/react-dialog';"),
    'built on the Radix primitives, like the Add window',
  );
  const overlay = countSheet.slice(countSheet.indexOf('{scannerOpen && ('));
  assert.ok(overlay.includes('<DialogPrimitive.Root'), 'own Root');
  assert.ok(overlay.includes('<DialogPrimitive.Portal>'), 'own Portal');
  assert.ok(overlay.includes('z-[80]'), 'the converted layer');
  assert.ok(overlay.includes('<DialogPrimitive.Title'), 'the visible title line is the dialog Title');
  assert.ok(overlay.includes("t('scanTally.title')"), 'the title is the existing tally string');
  assert.ok(!overlay.includes(HAND_ROLLED_CARD), 'no hand-rolled overlay remains');
  assert.ok(
    overlay.includes("if (!next) setScannerOpen(false)"),
    'dismissal closes the scanner through its own state',
  );
  // The tally path is untouched by the conversion.
  assert.ok(overlay.includes('<BarcodeScanner onDetect={handleTallyDetect} />'), 'the scanner is unchanged');
  assert.ok(overlay.includes("t('scanTally.done')"), 'Done still closes it');
});
