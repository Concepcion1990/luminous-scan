/**
 * T6 — i18n framework (src/lib/i18n.js + src/lib/locales/en.js).
 *
 * The UI stays English until the owner picks the first translation
 * language. These tests prove the machinery, not a translation:
 * English strings resolve for the converted surfaces (nav + scan),
 * interpolation works, unknown locales fall back to English, and a
 * missing key degrades to the key itself instead of crashing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, setLocale, getLocale, getStrings, SUPPORTED_LOCALES, DEFAULT_LOCALE } from './i18n.js';
import { en } from './locales/en.js';

test('English strings resolve for the converted surfaces', () => {
  setLocale('en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(t('nav.overview'), 'Overview');
  assert.equal(t('nav.group.inventory'), 'Inventory');
  assert.equal(t('scan.title'), 'Scan an item');
  assert.equal(t('scan.printShelfTag'), 'Print shelf tag');
  assert.equal(t('sync.sent'), 'All changes sent');
});

test('interpolation fills placeholders and leaves gaps visible', () => {
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Aisle 1' }), 'Only 3 on hand at Aisle 1.');
  assert.equal(t('scan.availableAt', { store: 'Second Store', count: 7 }), 'Available at Second Store — 7 on hand.');
  // A missing variable leaves the placeholder in place — visible, not silent.
  assert.match(t('scan.onlyOnHand', { count: 3 }), /\{location\}/);
});

test('unknown locales fall back to English, never to a blank screen', () => {
  assert.equal(setLocale('es'), 'en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(setLocale(''), 'en');
  assert.deepEqual(getStrings('xx'), en);
});

test('a missing key returns the key itself', () => {
  assert.equal(t('nav.noSuchScreen'), 'nav.noSuchScreen');
  assert.equal(t(''), '');
});

test('every nav labelKey has an English string', async () => {
  const { NAV_GROUPS } = await import('../components/layout/navGroups.js');
  for (const group of NAV_GROUPS) {
    assert.equal(typeof en[group.labelKey], 'string', group.labelKey);
    for (const item of group.items) {
      assert.equal(typeof en[item.labelKey], 'string', item.labelKey);
    }
  }
});

test('the registry is English-only until the owner picks the first language', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['en']);
  assert.equal(DEFAULT_LOCALE, 'en');
});

test('every English string is a non-empty string', () => {
  for (const [key, value] of Object.entries(en)) {
    assert.equal(typeof value, 'string', key);
    assert.ok(value.length > 0, key);
  }
  // The converted surfaces are fully keyed: nav + scan + sync.
  const keys = Object.keys(en);
  assert.ok(keys.filter((k) => k.startsWith('nav.')).length >= 25);
  assert.ok(keys.filter((k) => k.startsWith('scan.')).length >= 20);
  assert.ok(keys.filter((k) => k.startsWith('sync.')).length >= 4);
});
