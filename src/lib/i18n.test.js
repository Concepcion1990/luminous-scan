/**
 * T6 — i18n framework (src/lib/i18n.js + src/lib/locales/en.js).
 *
 * T6.3 added the first translation language (Arabic, ar) on top of the
 * machinery: these tests prove the machinery AND the Arabic locale —
 * English strings resolve for the converted surfaces (nav + scan),
 * interpolation works, unknown locales fall back to English, a missing
 * key degrades to the key itself instead of crashing, and every English
 * key exists in Arabic with matching value placeholders.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, setLocale, getLocale, getStrings, SUPPORTED_LOCALES, DEFAULT_LOCALE, isRTL } from './i18n.js';
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

test('RTL locales are detected (document direction flips in a real browser)', () => {
  // The node test env has no document — isRTL is the unit under test
  // here; the live dir flip is verified at T7 in a real browser.
  assert.equal(isRTL('ar'), true);
  assert.equal(isRTL('fa'), true);
  assert.equal(isRTL('prs'), true);
  assert.equal(isRTL('tg'), true);
  assert.equal(isRTL('ur'), true);
  assert.equal(isRTL('pa-Arab'), true);
  assert.equal(isRTL('en'), false);
  assert.equal(isRTL('es-MX'), false);
  assert.equal(isRTL('zh-Hans'), false);
});

test('the registry holds English and Arabic, ABC order', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['ar', 'en']);
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

/**
 * T6.3 — Arabic (ar), the first translated locale. A language is only
 * "done" when the whole app flows in it: every English key exists in
 * Arabic, every value is a non-empty string, and the value placeholders
 * ({count}, {name}, {price}…) match — except the English plural-agreement
 * markers ({s}, {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Arabic omits by design: Arabic plural lives in the word form, and
 * keeping one would render a stray Latin letter (e.g. منتجs).
 */
test('Arabic has every English key, with matching value placeholders', async () => {
  const { ar } = await import('./locales/ar.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(ar).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const arabic = ar[key];
    assert.equal(typeof arabic, 'string', `ar missing key: ${key}`);
    assert.ok(arabic.length > 0, `ar empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(arabic);
    for (const p of want) assert.ok(got.has(p), `ar ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `ar ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `ar ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Arabic renders the app in Arabic, RTL included', () => {
  assert.equal(setLocale('ar'), 'ar');
  assert.equal(getLocale(), 'ar');
  assert.equal(t('nav.scan'), 'مسح');
  assert.equal(t('nav.overview'), 'نظرة عامة');
  assert.equal(t('scan.printShelfTag'), 'طباعة بطاقة الرف');
  assert.equal(t('sync.sent'), 'تم إرسال جميع التغييرات');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'الممر 1' }), 'يوجد فقط 3 متوفر في الممر 1.');
  assert.equal(isRTL(), true);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});
