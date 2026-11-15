/**
 * T6 — Category combobox pins (Nov 14, 2026, owner catch + sharpened
 * ruling): the product form's Category control was a native
 * <input list> + <datalist> — the data arrived but the app rendered
 * no list (Chrome's native datalist popup never surfaces on her
 * Android Chrome inside the modal), so existing categories could not
 * be picked at all; and typed text was silently born as a category
 * on save via the Products filter facets. The rebuild:
 *  - VocabularyCombobox renders the list itself: opens on focus,
 *    typing filters, the "Add new" row is LAST and is the only birth
 *    door, picks fire on pointerdown (beats the field's blur);
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
const inline = readFileSync(
  new URL('../../src/components/products/AddVocabularyInline.jsx', import.meta.url),
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

test('combobox: the list is app-rendered and opens on focus', () => {
  assert.ok(combobox.includes('data-vocab-list'), 'the options list carries the app marker');
  assert.ok(combobox.includes('onFocus={() => setOpen(true)}'), 'focus opens the list');
  assert.ok(combobox.includes('setOpen(true)'), 'typing opens the list too');
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

test('add-new inline: creates through the managed Category machinery and selects the result', () => {
  assert.ok(inline.includes('base44.entities.Category.create'), 'creation goes through the Category entity');
  assert.ok(inline.includes('withBusiness('), 'the new row is business-scoped');
  assert.ok(inline.includes('onCreated?.('), 'the created name is handed back for selection');
  assert.ok(inline.includes('if (existing) {'), 'an existing name is selected without a second create');
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
