/**
 * T6 — Category combobox pins (Nov 14, 2026, owner catch + sharpened
 * ruling): the product form's Category control was a native
 * <input list> + <datalist> — the data arrived but the app rendered
 * no list (Chrome's native datalist popup never surfaces on her
 * Android Chrome inside the modal), so existing categories could not
 * be picked at all; and typed text was silently born as a category
 * on save via the Products filter facets. The rebuild:
 *  - VocabularyCombobox renders the list itself: opens on intent
 *    (a pointer tap into the field, the chevron, typing — since
 *    Nov 20, 2026, never on focus alone: inside Radix dialogs the
 *    focus machinery lands focus in the field on open and hands it
 *    back after outside taps, which sprang the list on arrival and
 *    undid every dismissal), typing filters, the "Add new" row is
 *    LAST and is the only birth door, picks fire on pointerdown
 *    (beats the field's blur), while the "Add new" row itself
 *    fires on click (Nov 20, 2026: a pointerdown opening mounted
 *    its window under the still-pressed tap, and the tap's own
 *    click cancelled that window inside the Categories edit
 *    window — the A3 tap collision);
 *  - judgeVocabularyValue guards the save: typed-but-unmatched text
 *    is refused with a plain message, a matched value saves under
 *    the list's exact spelling, the value the form opened with is
 *    grandfathered, and a name created via Add new this session is
 *    sanctioned.
 * The same treatment covers Subcategory (same control family).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { judgeVocabularyValue } from '../../src/lib/vocabulary.js';

const combobox = readFileSync(
  new URL('../../src/components/products/VocabularyCombobox.jsx', import.meta.url),
  'utf8',
);
const addWindow = readFileSync(
  new URL('../../src/components/products/AddVocabularyDialog.jsx', import.meta.url),
  'utf8',
);
const dialog = readFileSync(
  new URL('../../src/components/products/ProductFormDialog.jsx', import.meta.url),
  'utf8',
);
const details = readFileSync(
  new URL('../../src/components/products/ProductDetailsFields.jsx', import.meta.url),
  'utf8',
);
const bulkDialog = readFileSync(
  new URL('../../src/components/products/BulkEditDialog.jsx', import.meta.url),
  'utf8',
);

test('combobox: the list is app-rendered and opens on intent, never on focus alone', () => {
  assert.ok(combobox.includes('data-vocab-list'), 'the options list carries the app marker');
  assert.ok(combobox.includes('onPointerDown={() => setOpen(true)}'), 'a tap into the field opens the list');
  assert.ok(combobox.includes('setOpen(true)'), 'typing opens the list too');
  // Nov 20, 2026 (owner catch): focus alone must NEVER open the
  // list — the host dialog's focus machinery lands focus in the
  // field when the dialog opens and hands it back after an
  // outside tap, which sprang the list on arrival and resurrected
  // it after every dismissal, freezing Bulk edit on her phone.
  assert.ok(!combobox.includes('onFocus'), 'no focus handler can spring the list');
  assert.ok(combobox.includes("e.key === 'Escape'"), 'Escape still closes the list');
});

test('combobox: the Add new row releases the field before the window opens', () => {
  const blurAt = combobox.indexOf('inputRef.current?.blur()');
  const requestAt = combobox.indexOf('onAddNewRequest();');
  assert.ok(blurAt !== -1 && requestAt !== -1 && blurAt < requestAt, 'focus is released before the Add window is asked for');
});

test('combobox: the Add new row opens its window on click, never on pointerdown (A3 tap collision)', () => {
  // Nov 20, 2026 (owner ruling): opening the Add window on
  // pointerdown mounted it under the still-pressed tap, and
  // inside the short, centered Categories edit window the same
  // tap's click landed on the window's own Cancel — the window
  // cancelled itself (harness-instrumented: pointerdown t=7639,
  // mount t=7647, click on Cancel t=7738, gone t=7741). The row
  // now requests the window from its click handler, when the
  // summoning gesture is finished; its pointerdown only guards
  // the tap (preventDefault — no focus move, no blur race).
  const rowAt = combobox.indexOf('onAddNewRequest && (');
  assert.ok(rowAt !== -1, 'the Add new row block exists');
  const row = combobox.slice(rowAt, combobox.indexOf('</li>', rowAt));
  assert.ok(row.includes('onPointerDown={(e) => e.preventDefault()}'), 'the row’s pointerdown only guards the tap');
  const clickAt = row.indexOf('onClick');
  const requestAt = row.indexOf('onAddNewRequest();');
  assert.ok(clickAt !== -1 && requestAt > clickAt, 'the Add window is requested from the click handler, not pointerdown');
});

test('combobox: typing filters the existing options, case-insensitively', () => {
  assert.ok(
    combobox.includes('options.filter((name) => !typed || name.toLowerCase().includes(typed))'),
    'options filter by the typed text',
  );
});

test('combobox: the Add new row renders LAST and is the only birth door', () => {
  const optionsAt = combobox.indexOf('filtered.map((name)');
  const addNewAt = combobox.indexOf('onAddNewRequest();');
  assert.ok(optionsAt !== -1 && addNewAt > optionsAt, 'the Add new row comes after every option');
  assert.ok(combobox.includes('onPointerDown'), 'rows pick on pointerdown, before blur can close the list');
});

test('no native datalist remains in the product form', () => {
  assert.ok(!dialog.includes('<datalist'), 'the dialog renders no datalist');
  assert.ok(!dialog.includes('list='), 'the dialog binds no native list');
  assert.ok(!details.includes('<datalist'), 'the details fields render no datalist');
  assert.ok(details.includes('VocabularyCombobox'), 'subcategory uses the same combobox');
  assert.ok(dialog.includes('VocabularyCombobox'), 'category uses the combobox');
});

test('add-new window: creates through the managed Category machinery and selects the result', () => {
  assert.ok(addWindow.includes('base44.entities.Category.create'), 'creation goes through the Category entity');
  assert.ok(addWindow.includes('withBusiness('), 'the new row is business-scoped');
  assert.ok(addWindow.includes('onCreated?.('), 'the created name is handed back for selection');
  assert.ok(addWindow.includes('if (existing) {'), 'an existing name is selected without a second create');
});

test('add-new window: a real overlay window, not an inline panel (owner ruling, Nov 14, 2026)', () => {
  // The inline panel squeezed into the form's right-hand column as a
  // narrow sliver and reflowed the grid — her "it freaks out on me".
  // The replacement is a modal overlay window: the form behind it
  // cannot move, and the one name field is full-width and
  // autofocused. Since Nov 20, 2026 it is a real Radix Dialog
  // nested over the host: the hand-rolled overlay it replaced
  // rendered outside the host dialog's layer, so the host killed
  // its pointer events and fought its focus — on the owner's
  // phone its Cancel/Add took no taps at all (the freeze).
  assert.ok(addWindow.includes('@radix-ui/react-dialog'), 'the window is built on the app dialog machinery');
  assert.ok(addWindow.includes('DialogPrimitive.Root'), 'the window is its own dialog root');
  assert.ok(addWindow.includes('DialogPrimitive.Portal'), 'the window portals onto the layer stack');
  assert.ok(addWindow.includes('fixed inset-0 z-[80]'), 'the window overlays above the host dialog and the hand-rolled overlays');
  assert.ok(addWindow.includes('DialogPrimitive.Title'), 'the window carries its title as the dialog title');
  assert.ok(addWindow.includes('autoFocus'), 'the name field is focused on open');
  assert.ok(addWindow.includes('useState(initialName)'), 'the field is prefilled with the typed text');
  assert.ok(addWindow.includes("t('productForm.cancel')"), 'Cancel uses the shared cancel string');
  assert.ok(addWindow.includes("t('categories.addButton')"), 'Save uses the shared add string');
  assert.ok(!addWindow.includes('border-dashed'), 'no trace of the old inline panel styling');
});

test('add-new window: both form doors open it; the inline panel is gone', () => {
  assert.ok(dialog.includes('<AddVocabularyDialog'), 'the product form renders the window');
  assert.ok(dialog.includes("addNewField === 'category' ? form.category : form.subcategory"), 'the window prefills from the field being edited');
  assert.ok(
    dialog.includes("addNewField === 'category' ? 'productForm.addNewCategory' : 'productForm.addNewSubcategory'"),
    'the window title switches between the add-category and add-subcategory strings by field',
  );
  assert.ok(!dialog.includes('AddVocabularyInline'), 'the form no longer renders the inline panel');
  assert.ok(!details.includes('AddVocabularyInline'), 'the details fields no longer render the inline panel');
});

test('bulk-delete confirmation: a real nested Radix dialog, not a hand-rolled overlay (Nov 20, 2026)', () => {
  // The confirmation used to be a hand-rolled fixed overlay
  // mounted as a sibling of the bulk dialog's content — outside
  // the host's layer, where the host's modal machinery killed its
  // pointer events and kept its focus, so its Cancel/Yes took no
  // taps on the owner's phone: the Add window's freeze, second
  // door. The owner's ruling folded it into the freeze fix; it is
  // now a nested Radix dialog on the Add window's construction.
  assert.ok(bulkDialog.includes('@radix-ui/react-dialog'), 'the bulk dialog builds on the app dialog machinery');
  assert.ok(bulkDialog.includes('DialogPrimitive.Root'), 'the confirmation is its own dialog root');
  assert.ok(bulkDialog.includes('DialogPrimitive.Portal'), 'the confirmation portals onto the layer stack');
  assert.ok(bulkDialog.includes('fixed inset-0 z-[80]'), 'the confirmation overlays above its host dialog');
  assert.ok(!bulkDialog.includes('z-[70]'), 'no hand-rolled overlay remains in the bulk dialog');
  assert.ok(bulkDialog.includes('DialogPrimitive.Title'), 'the confirm title is the dialog title');
  assert.ok(bulkDialog.includes('DialogPrimitive.Description'), 'the confirm body is the dialog description');
  assert.ok(bulkDialog.includes("t('products.bulkDeleteConfirmButton'"), 'the red Yes button keeps its words');
  assert.ok(bulkDialog.includes('if (!next && !deleting) setConfirmDelete(false)'), 'dismissal is Cancel — and never mid-delete');
});

test('judge: typed-but-unmatched text is refused — no silent birth', () => {
  const verdict = judgeVocabularyValue({
    typedRaw: 'chips',
    initial: '',
    options: ['Drinks'],
    sanctioned: [],
    loaded: true,
  });
  assert.equal(verdict.ok, false);
});

test('judge: a matched value saves under the list spelling', () => {
  const verdict = judgeVocabularyValue({
    typedRaw: 'drinks',
    initial: '',
    options: ['Drinks'],
    sanctioned: [],
    loaded: true,
  });
  assert.deepEqual(verdict, { ok: true, value: 'Drinks' });
});

test('judge: the value the form opened with is grandfathered', () => {
  const verdict = judgeVocabularyValue({
    typedRaw: 'Old Facet',
    initial: 'Old Facet',
    options: ['Drinks'],
    sanctioned: [],
    loaded: true,
  });
  assert.deepEqual(verdict, { ok: true, value: 'Old Facet' });
});

test('judge: an Add-new name from this session is sanctioned before any refetch', () => {
  const verdict = judgeVocabularyValue({
    typedRaw: 'Snacks',
    initial: '',
    options: ['Drinks'],
    sanctioned: ['Snacks'],
    loaded: true,
  });
  assert.deepEqual(verdict, { ok: true, value: 'Snacks' });
});

test('judge: empty and not-yet-loaded values pass untouched', () => {
  assert.deepEqual(
    judgeVocabularyValue({ typedRaw: '  ', initial: '', options: [], sanctioned: [], loaded: true }),
    { ok: true, value: '' },
  );
  assert.deepEqual(
    judgeVocabularyValue({ typedRaw: 'anything', initial: '', options: [], sanctioned: [], loaded: false }),
    { ok: true, value: 'anything' },
  );
});

test('dialog: the save gate runs the judge for category and subcategory before the payload', () => {
  assert.ok(dialog.includes("setError(t('productForm.categoryNotFound'))"), 'category refusal shows the plain message');
  assert.ok(dialog.includes("setError(t('productForm.subcategoryNotFound'))"), 'subcategory refusal shows the plain message');
  assert.ok(dialog.includes('category: categoryVerdict.value'), 'the payload uses the judged category');
  assert.ok(dialog.includes('subcategory: subcategoryVerdict.value'), 'the payload uses the judged subcategory');
});
