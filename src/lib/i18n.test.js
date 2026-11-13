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

test('the registry holds English, Arabic, Amharic, Bengali, Bhojpuri, Canadian French, Cantonese, Dari, French, German, Gujarati, Hausa, Hindi, Indonesian, Italian, Japanese, Javanese, Kannada, Korean, Malay, Mandarin Simplified, Mandarin Traditional, Marathi, Nigerian Pidgin, Persian, Shanghainese and Tajik, ABC order', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['am', 'ar', 'bho', 'bn', 'de', 'en', 'fa', 'fr-CA', 'fr-FR', 'gu', 'ha', 'hi', 'id', 'it', 'ja', 'jv', 'kn', 'ko', 'mr', 'ms', 'pcm', 'prs', 'tg', 'wuu', 'yue', 'zh-Hans', 'zh-Hant']);
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

/**
 * T6.3 continuation — Bengali (bn), the third translated locale.
 * Same proof as Arabic and Amharic: every English key exists in Bengali,
 * every value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural}, {suffix},
 * {us}, {cs}, {ps}, {fs}, {rs}), which Bengali omits by design.
 */
test('Bengali has every English key, with matching value placeholders', async () => {
  const { bn } = await import('./locales/bn.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(bn).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = bn[key];
    assert.equal(typeof value, 'string', `bn missing key: ${key}`);
    assert.ok(value.length > 0, `bn empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `bn ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `bn ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `bn ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Bengali renders the app in Bengali', () => {
  assert.equal(setLocale('bn'), 'bn');
  assert.equal(getLocale(), 'bn');
  assert.equal(t('nav.scan'), 'স্ক্যান');
  assert.equal(t('nav.overview'), 'ওভারভিউ');
  assert.equal(t('scan.printShelfTag'), 'শেলফ ট্যাগ মুদ্রণ করুন');
  assert.equal(t('sync.sent'), 'সব পরিবর্তন পাঠানো হয়েছে');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'আইল ১' }), 'আইল ১-এ হাতে আছে শুধু 3টি।');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});
/**
 * T6.3 continuation — Amharic (am), the second translated locale.
 * Same proof as Arabic: every English key exists in Amharic, every value
 * is a non-empty string, and the value placeholders match — except the
 * English plural-agreement markers ({s}, {plural}, {suffix}, {us}, {cs},
 * {ps}, {fs}, {rs}), which Amharic omits by design.
 */
test('Amharic has every English key, with matching value placeholders', async () => {
  const { am } = await import('./locales/am.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(am).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = am[key];
    assert.equal(typeof value, 'string', `am missing key: ${key}`);
    assert.ok(value.length > 0, `am empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `am ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `am ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `am ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Amharic renders the app in Amharic', () => {
  assert.equal(setLocale('am'), 'am');
  assert.equal(getLocale(), 'am');
  assert.equal(t('nav.scan'), 'ስካን');
  assert.equal(t('nav.overview'), 'አጠቃላይ እይታ');
  assert.equal(t('scan.printShelfTag'), 'የመደርደሪያ መለያ አትም');
  assert.equal(t('sync.sent'), 'ሁሉም ለውጦች ተልከዋል');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'መተላለፊያ 1' }), '3 ብቻ በእጅ ያለ በመተላለፊያ 1።');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Bhojpuri (bho), the fourth translated locale.
 * Same proof as the others: every English key exists in Bhojpuri, every
 * value is a non-empty string, and the value placeholders match — except
 * the English plural-agreement markers ({s}, {plural}, {suffix}, {us},
 * {cs}, {ps}, {fs}, {rs}), which Bhojpuri omits by design.
 */
test('Bhojpuri has every English key, with matching value placeholders', async () => {
  const { bho } = await import('./locales/bho.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(bho).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = bho[key];
    assert.equal(typeof value, 'string', `bho missing key: ${key}`);
    assert.ok(value.length > 0, `bho empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `bho ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `bho ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `bho ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Bhojpuri renders the app in Bhojpuri', () => {
  assert.equal(setLocale('bho'), 'bho');
  assert.equal(getLocale(), 'bho');
  assert.equal(t('nav.scan'), 'स्कैन');
  assert.equal(t('nav.overview'), 'अवलोकन');
  assert.equal(t('scan.printShelfTag'), 'शेल्फ टैग छापीं');
  assert.equal(t('sync.sent'), 'सभ बदलाव भेजल गइल');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'आइल १' }), 'आइल १ पर सिर्फ 3 हाथ में बा।');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Mandarin Chinese, Simplified (zh-Hans), the fifth
 * translated locale. Same proof as the others: every English key exists,
 * every value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural}, {suffix},
 * {us}, {cs}, {ps}, {fs}, {rs}), which Chinese omits by design.
 */
test('Mandarin Simplified has every English key, with matching value placeholders', async () => {
  const { zhHans } = await import('./locales/zh-Hans.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(zhHans).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = zhHans[key];
    assert.equal(typeof value, 'string', `zh-Hans missing key: ${key}`);
    assert.ok(value.length > 0, `zh-Hans empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `zh-Hans ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `zh-Hans ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `zh-Hans ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Mandarin Simplified renders the app in Simplified Chinese', () => {
  assert.equal(setLocale('zh-Hans'), 'zh-Hans');
  assert.equal(getLocale(), 'zh-Hans');
  assert.equal(t('nav.scan'), '扫描');
  assert.equal(t('nav.overview'), '概览');
  assert.equal(t('scan.printShelfTag'), '打印货架标签');
  assert.equal(t('sync.sent'), '所有更改已发送');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: '过道 1' }), '过道 1仅剩 3 件在库。');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Mandarin Chinese, Traditional (zh-Hant), the sixth
 * translated locale. Same proof as the others: every English key exists,
 * every value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural}, {suffix},
 * {us}, {cs}, {ps}, {fs}, {rs}), which Chinese omits by design.
 */
test('Mandarin Traditional has every English key, with matching value placeholders', async () => {
  const { zhHant } = await import('./locales/zh-Hant.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(zhHant).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = zhHant[key];
    assert.equal(typeof value, 'string', `zh-Hant missing key: ${key}`);
    assert.ok(value.length > 0, `zh-Hant empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `zh-Hant ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `zh-Hant ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `zh-Hant ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Mandarin Traditional renders the app in Traditional Chinese', () => {
  assert.equal(setLocale('zh-Hant'), 'zh-Hant');
  assert.equal(getLocale(), 'zh-Hant');
  assert.equal(t('nav.scan'), '掃描');
  assert.equal(t('nav.overview'), '總覽');
  assert.equal(t('scan.printShelfTag'), '列印貨架標籤');
  assert.equal(t('sync.sent'), '所有變更已傳送');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: '走道 1' }), '走道 1 僅剩 3 件庫存。');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Cantonese (yue), the seventh translated locale.
 * Same proof as the others: every English key exists in Cantonese, every
 * value is a non-empty string, and the value placeholders match — except
 * the English plural-agreement markers ({s}, {plural}, {suffix}, {us},
 * {cs}, {ps}, {fs}, {rs}), which Cantonese omits by design.
 */
test('Cantonese has every English key, with matching value placeholders', async () => {
  const { yue } = await import('./locales/yue.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(yue).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = yue[key];
    assert.equal(typeof value, 'string', `yue missing key: ${key}`);
    assert.ok(value.length > 0, `yue empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `yue ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `yue ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `yue ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Cantonese renders the app in Cantonese', () => {
  assert.equal(setLocale('yue'), 'yue');
  assert.equal(getLocale(), 'yue');
  assert.equal(t('nav.scan'), '掃描');
  assert.equal(t('nav.overview'), '總覽');
  assert.equal(t('scan.printShelfTag'), '列印貨架標籤');
  assert.equal(t('sync.sent'), '所有更改已傳送');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: '走廊 1' }), '走廊 1 只係得 3 件現貨。');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Shanghainese / Wu (wuu), the eighth translated
 * locale. Same proof as the others: every English key exists, every value
 * is a non-empty string, and the value placeholders match — except the
 * English plural-agreement markers ({s}, {plural}, {suffix}, {us}, {cs},
 * {ps}, {fs}, {rs}), which Wu omits by design.
 */
test('Shanghainese has every English key, with matching value placeholders', async () => {
  const { wuu } = await import('./locales/wuu.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(wuu).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = wuu[key];
    assert.equal(typeof value, 'string', `wuu missing key: ${key}`);
    assert.ok(value.length > 0, `wuu empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `wuu ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `wuu ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `wuu ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Shanghainese renders the app in Shanghainese', () => {
  assert.equal(setLocale('wuu'), 'wuu');
  assert.equal(getLocale(), 'wuu');
  assert.equal(t('nav.scan'), '扫码');
  assert.equal(t('nav.overview'), '总览');
  assert.equal(t('scan.printShelfTag'), '打印货架标签');
  assert.equal(t('sync.sent'), '改动全部发出去哉');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: '走道 1' }), '勒 走道 1 只有 3 件有货。');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Canadian French (fr-CA), the ninth translated
 * locale. Same proof as the others: every English key exists, every value
 * is a non-empty string, and the value placeholders match — except the
 * English plural-agreement markers ({s}, {plural}, {suffix}, {us}, {cs},
 * {ps}, {fs}, {rs}), which French omits by design.
 */
test('Canadian French has every English key, with matching value placeholders', async () => {
  const { frCA } = await import('./locales/fr-CA.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(frCA).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = frCA[key];
    assert.equal(typeof value, 'string', `fr-CA missing key: ${key}`);
    assert.ok(value.length > 0, `fr-CA empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `fr-CA ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `fr-CA ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `fr-CA ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Canadian French renders the app in Canadian French', () => {
  assert.equal(setLocale('fr-CA'), 'fr-CA');
  assert.equal(getLocale(), 'fr-CA');
  assert.equal(t('nav.scan'), 'Numériser');
  assert.equal(t('nav.overview'), 'Aperçu');
  assert.equal(t('scan.printShelfTag'), 'Imprimer l’étiquette de tablette');
  assert.equal(t('sync.sent'), 'Tous les changements envoyés');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Allée 1' }), 'Seulement 3 en main à Allée 1.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Malay (ms), the tenth translated locale. Same proof
 * as the others: every English key exists, every value is a non-empty
 * string, and the value placeholders match — except the English
 * plural-agreement markers ({s}, {plural}, {suffix}, {us}, {cs}, {ps},
 * {fs}, {rs}), which Malay omits by design.
 */
test('Malay has every English key, with matching value placeholders', async () => {
  const { ms } = await import('./locales/ms.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(ms).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = ms[key];
    assert.equal(typeof value, 'string', `ms missing key: ${key}`);
    assert.ok(value.length > 0, `ms empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `ms ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `ms ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `ms ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Malay renders the app in Malay', () => {
  assert.equal(setLocale('ms'), 'ms');
  assert.equal(getLocale(), 'ms');
  assert.equal(t('nav.scan'), 'Imbas');
  assert.equal(t('nav.overview'), 'Gambaran keseluruhan');
  assert.equal(t('scan.printShelfTag'), 'Cetak tag rak');
  assert.equal(t('sync.sent'), 'Semua perubahan dihantar');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Lorong 1' }), 'Hanya 3 di tangan di Lorong 1.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Gujarati (gu), the eleventh translated locale. Same
 * proof as the others: every English key exists, every value is a non-empty
 * string, and the value placeholders match — except the English
 * plural-agreement markers ({s}, {plural}, {suffix}, {us}, {cs}, {ps},
 * {fs}, {rs}), which Gujarati omits by design.
 */
test('Gujarati has every English key, with matching value placeholders', async () => {
  const { gu } = await import('./locales/gu.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(gu).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = gu[key];
    assert.equal(typeof value, 'string', `gu missing key: ${key}`);
    assert.ok(value.length > 0, `gu empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `gu ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `gu ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `gu ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Gujarati renders the app in Gujarati', () => {
  assert.equal(setLocale('gu'), 'gu');
  assert.equal(getLocale(), 'gu');
  assert.equal(t('nav.scan'), 'સ્કેન');
  assert.equal(t('nav.overview'), 'ઝાંખી');
  assert.equal(t('scan.printShelfTag'), 'શેલ્ફ ટેગ છાપો');
  assert.equal(t('sync.sent'), 'બધા ફેરફાર મોકલાયા');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'પાંખ 1' }), 'પાંખ 1 પર ફક્ત 3 હાથ પર છે.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — German (de), the twelfth translated locale. Same
 * proof as the others: every English key exists, every value is a non-empty
 * string, and the value placeholders match — except the English
 * plural-agreement markers ({s}, {plural}, {suffix}, {us}, {cs}, {ps},
 * {fs}, {rs}), which German omits by design.
 */
test('German has every English key, with matching value placeholders', async () => {
  const { de } = await import('./locales/de.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(de).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = de[key];
    assert.equal(typeof value, 'string', `de missing key: ${key}`);
    assert.ok(value.length > 0, `de empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `de ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `de ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `de ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to German renders the app in German', () => {
  assert.equal(setLocale('de'), 'de');
  assert.equal(getLocale(), 'de');
  assert.equal(t('nav.scan'), 'Scannen');
  assert.equal(t('nav.overview'), 'Übersicht');
  assert.equal(t('scan.printShelfTag'), 'Regaletikett drucken');
  assert.equal(t('sync.sent'), 'Alle Änderungen gesendet');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Gang 1' }), 'Nur 3 vorrätig bei Gang 1.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — French (France) (fr-FR), the thirteenth translated
 * locale. Same proof as the others: every English key exists, every value
 * is a non-empty string, and the value placeholders match — except the
 * English plural-agreement markers ({s}, {plural}, {suffix}, {us}, {cs},
 * {ps}, {fs}, {rs}), which French omits by design.
 */
test('French (France) has every English key, with matching value placeholders', async () => {
  const { frFR } = await import('./locales/fr-FR.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(frFR).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = frFR[key];
    assert.equal(typeof value, 'string', `fr-FR missing key: ${key}`);
    assert.ok(value.length > 0, `fr-FR empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `fr-FR ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `fr-FR ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `fr-FR ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to French (France) renders the app in French', () => {
  assert.equal(setLocale('fr-FR'), 'fr-FR');
  assert.equal(getLocale(), 'fr-FR');
  assert.equal(t('nav.scan'), 'Scanner');
  assert.equal(t('nav.overview'), 'Aperçu');
  assert.equal(t('scan.printShelfTag'), "Imprimer l'étiquette de rayon");
  assert.equal(t('sync.sent'), 'Toutes les modifications envoyées');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Allée 1' }), 'Seulement 3 en stock à Allée 1.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Hausa (ha), the fourteenth translated locale. Same
 * proof as the others: every English key exists, every value is a non-empty
 * string, and the value placeholders match — except the English
 * plural-agreement markers ({s}, {plural}, {suffix}, {us}, {cs}, {ps},
 * {fs}, {rs}), which Hausa omits by design.
 */
test('Hausa has every English key, with matching value placeholders', async () => {
  const { ha } = await import('./locales/ha.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(ha).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = ha[key];
    assert.equal(typeof value, 'string', `ha missing key: ${key}`);
    assert.ok(value.length > 0, `ha empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `ha ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `ha ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `ha ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Hausa renders the app in Hausa', () => {
  assert.equal(setLocale('ha'), 'ha');
  assert.equal(getLocale(), 'ha');
  assert.equal(t('nav.scan'), 'Duba');
  assert.equal(t('nav.overview'), 'Bayyani');
  assert.equal(t('scan.printShelfTag'), 'Buga alamar shago');
  assert.equal(t('sync.sent'), 'An aika duk canje-canje');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Hanya 1' }), '3 kaɗai a hannu a Hanya 1.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Italian (it), the fifteenth translated locale. Same
 * proof as the others: every English key exists, every value is a non-empty
 * string, and the value placeholders match — except the English
 * plural-agreement markers ({s}, {plural}, {suffix}, {us}, {cs}, {ps},
 * {fs}, {rs}), which Italian omits by design.
 */
test('Italian has every English key, with matching value placeholders', async () => {
  const { it } = await import('./locales/it.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(it).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = it[key];
    assert.equal(typeof value, 'string', `it missing key: ${key}`);
    assert.ok(value.length > 0, `it empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `it ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `it ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `it ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Italian renders the app in Italian', () => {
  assert.equal(setLocale('it'), 'it');
  assert.equal(getLocale(), 'it');
  assert.equal(t('nav.scan'), 'Scansiona');
  assert.equal(t('nav.overview'), 'Panoramica');
  assert.equal(t('scan.printShelfTag'), 'Stampa cartellino da scaffale');
  assert.equal(t('sync.sent'), 'Tutte le modifiche inviate');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Corsia 1' }), 'Solo 3 disponibili presso Corsia 1.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Hindi (hi), the sixteenth translated locale. Same
 * proof as the others: every English key exists, every value is a non-empty
 * string, and the value placeholders match — except the English
 * plural-agreement markers ({s}, {plural}, {suffix}, {us}, {cs}, {ps},
 * {fs}, {rs}), which Hindi omits by design.
 */
test('Hindi has every English key, with matching value placeholders', async () => {
  const { hi } = await import('./locales/hi.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(hi).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = hi[key];
    assert.equal(typeof value, 'string', `hi missing key: ${key}`);
    assert.ok(value.length > 0, `hi empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `hi ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `hi ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `hi ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Hindi renders the app in Hindi', () => {
  assert.equal(setLocale('hi'), 'hi');
  assert.equal(getLocale(), 'hi');
  assert.equal(t('nav.scan'), 'स्कैन');
  assert.equal(t('nav.overview'), 'सिंहावलोकन');
  assert.equal(t('scan.printShelfTag'), 'शेल्फ टैग प्रिंट करें');
  assert.equal(t('sync.sent'), 'सभी परिवर्तन भेज दिए गए');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'गलियारा 1' }), 'गलियारा 1 पर केवल 3 ही उपलब्ध है।');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 continuation — Indonesian (id), the seventeenth translated locale.
 * Same proof as the others: every English key exists, every value is a
 * non-empty string, and the value placeholders match — except the English
 * plural-agreement markers ({s}, {plural}, {suffix}, {us}, {cs}, {ps},
 * {fs}, {rs}), which Indonesian omits by design.
 */
test('Indonesian has every English key, with matching value placeholders', async () => {
  const { id } = await import('./locales/id.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(id).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = id[key];
    assert.equal(typeof value, 'string', `id missing key: ${key}`);
    assert.ok(value.length > 0, `id empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `id ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `id ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `id ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Indonesian renders the app in Indonesian', () => {
  assert.equal(setLocale('id'), 'id');
  assert.equal(getLocale(), 'id');
  assert.equal(t('nav.scan'), 'Pindai');
  assert.equal(t('nav.overview'), 'Ikhtisar');
  assert.equal(t('scan.printShelfTag'), 'Cetak label rak');
  assert.equal(t('sync.sent'), 'Semua perubahan terkirim');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Lorong 1' }), 'Hanya 3 yang tersedia di Lorong 1.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 4 — Japanese (ja), the eighteenth translated locale.
 * Same proof as Arabic: every English key exists in Japanese, every
 * value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural},
 * {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which Japanese omits by
 * design.
 */
test('Japanese has every English key, with matching value placeholders', async () => {
  const { ja } = await import('./locales/ja.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(ja).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = ja[key];
    assert.equal(typeof value, 'string', `ja missing key: ${key}`);
    assert.ok(value.length > 0, `ja empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `ja ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `ja ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `ja ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Japanese renders the app in Japanese', () => {
  assert.equal(setLocale('ja'), 'ja');
  assert.equal(getLocale(), 'ja');
  assert.equal(t('nav.scan'), 'スキャン');
  assert.equal(t('nav.overview'), '概要');
  assert.equal(t('scan.printShelfTag'), '棚タグを印刷する');
  assert.equal(t('sync.sent'), 'すべての変更が送信されました');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: '通路 1' }), '通路 1 での手持ちは 3 のみです。');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 4 — Javanese (jv), the nineteenth translated locale.
 * Same proof as Arabic: every English key exists in Javanese, every
 * value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural},
 * {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which Javanese omits by
 * design.
 */
test('Javanese has every English key, with matching value placeholders', async () => {
  const { jv } = await import('./locales/jv.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(jv).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = jv[key];
    assert.equal(typeof value, 'string', `jv missing key: ${key}`);
    assert.ok(value.length > 0, `jv empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `jv ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `jv ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `jv ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Javanese renders the app in Javanese', () => {
  assert.equal(setLocale('jv'), 'jv');
  assert.equal(getLocale(), 'jv');
  assert.equal(t('nav.scan'), 'Mindai');
  assert.equal(t('nav.overview'), 'Ringkesan');
  assert.equal(t('scan.printShelfTag'), 'Cithak tandha rak');
  assert.equal(t('sync.sent'), 'Sedaya pangowahan dipunkintun');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Lorong 1' }), 'Namung 3 ing tangan ing Lorong 1.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 4 — Kannada (kn), the twentieth translated locale.
 * Same proof as Arabic: every English key exists in Kannada, every
 * value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural},
 * {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which Kannada omits by
 * design.
 */
test('Kannada has every English key, with matching value placeholders', async () => {
  const { kn } = await import('./locales/kn.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(kn).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = kn[key];
    assert.equal(typeof value, 'string', `kn missing key: ${key}`);
    assert.ok(value.length > 0, `kn empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `kn ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `kn ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `kn ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Kannada renders the app in Kannada', () => {
  assert.equal(setLocale('kn'), 'kn');
  assert.equal(getLocale(), 'kn');
  assert.equal(t('nav.scan'), 'ಸ್ಕ್ಯಾನ್');
  assert.equal(t('nav.overview'), 'ಅವಲೋಕನ');
  assert.equal(t('scan.printShelfTag'), 'ಶೆಲ್ಫ್ ಟ್ಯಾಗ್ ಅನ್ನು ಮುದ್ರಿಸಿ');
  assert.equal(t('sync.sent'), 'ಎಲ್ಲಾ ಬದಲಾವಣೆಗಳನ್ನು ಕಳುಹಿಸಲಾಗಿದೆ');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'ಐಲ್ 1' }), 'ಐಲ್ 1 ನಲ್ಲಿ ಕೇವಲ 3 ಕೈಯಲ್ಲಿದೆ.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 4 — Korean (ko), the twenty-first translated locale.
 * Same proof as Arabic: every English key exists in Korean, every
 * value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural},
 * {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which Korean omits by
 * design.
 */
test('Korean has every English key, with matching value placeholders', async () => {
  const { ko } = await import('./locales/ko.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(ko).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = ko[key];
    assert.equal(typeof value, 'string', `ko missing key: ${key}`);
    assert.ok(value.length > 0, `ko empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `ko ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `ko ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `ko ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Korean renders the app in Korean', () => {
  assert.equal(setLocale('ko'), 'ko');
  assert.equal(getLocale(), 'ko');
  assert.equal(t('nav.scan'), '스캔');
  assert.equal(t('nav.overview'), '개요');
  assert.equal(t('scan.printShelfTag'), '선반 태그 인쇄');
  assert.equal(t('sync.sent'), '모든 변경 사항이 전송되었습니다');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: '통로 1' }), '통로 1에 3개만 보유 중입니다.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 4 — Marathi (mr), the twenty-second translated locale.
 * Same proof as Arabic: every English key exists in Marathi, every
 * value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural},
 * {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which Marathi omits by
 * design.
 */
test('Marathi has every English key, with matching value placeholders', async () => {
  const { mr } = await import('./locales/mr.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(mr).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = mr[key];
    assert.equal(typeof value, 'string', `mr missing key: ${key}`);
    assert.ok(value.length > 0, `mr empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `mr ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `mr ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `mr ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Marathi renders the app in Marathi', () => {
  assert.equal(setLocale('mr'), 'mr');
  assert.equal(getLocale(), 'mr');
  assert.equal(t('nav.scan'), 'स्कॅन करा');
  assert.equal(t('nav.overview'), 'आढावा');
  assert.equal(t('scan.printShelfTag'), 'कपाट टॅग छापा');
  assert.equal(t('sync.sent'), 'सर्व बदल पाठवले');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'ठिकाण 1' }), 'ठिकाण 1 येथे फक्त 3 हातात.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 4 — Nigerian Pidgin (pcm), the twenty-third translated locale.
 * Same proof as Arabic: every English key exists in Nigerian Pidgin, every
 * value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural},
 * {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which Nigerian Pidgin omits by
 * design.
 */
test('Nigerian Pidgin has every English key, with matching value placeholders', async () => {
  const { pcm } = await import('./locales/pcm.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(pcm).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = pcm[key];
    assert.equal(typeof value, 'string', `pcm missing key: ${key}`);
    assert.ok(value.length > 0, `pcm empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `pcm ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `pcm ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `pcm ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Nigerian Pidgin renders the app in Nigerian Pidgin', () => {
  assert.equal(setLocale('pcm'), 'pcm');
  assert.equal(getLocale(), 'pcm');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(t('nav.overview'), 'Overview');
  assert.equal(t('scan.printShelfTag'), 'Print shelf tag');
  assert.equal(t('sync.sent'), 'All changes don send');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Aisle 1' }), 'Na only 3 dey hand at Aisle 1.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 4 — Persian (fa), the twenty-fourth translated locale.
 * Same proof as Arabic: every English key exists in Persian, every
 * value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural},
 * {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which Persian omits by
 * design.
 * Persian is in RTL_LOCALES, so the switch test also proves the
 * right-to-left direction engages (isRTL() true while it is active).
 */
test('Persian has every English key, with matching value placeholders', async () => {
  const { fa } = await import('./locales/fa.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(fa).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = fa[key];
    assert.equal(typeof value, 'string', `fa missing key: ${key}`);
    assert.ok(value.length > 0, `fa empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `fa ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `fa ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `fa ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Persian renders the app in Persian, RTL included', () => {
  assert.equal(setLocale('fa'), 'fa');
  assert.equal(getLocale(), 'fa');
  assert.equal(t('nav.scan'), 'اسکن');
  assert.equal(t('nav.overview'), 'نمای کلی');
  assert.equal(t('scan.printShelfTag'), 'چاپ برچسب قفسه');
  assert.equal(t('sync.sent'), 'همه تغییرات ارسال شدند');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'راهرو 1' }), 'فقط 3 در راهرو 1 موجود است.');
  assert.equal(isRTL(), true);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 4 — Dari (prs), the twenty-fifth translated locale.
 * Same proof as Arabic: every English key exists in Dari, every
 * value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural},
 * {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which Dari omits by
 * design.
 * Dari is in RTL_LOCALES, so the switch test also proves the
 * right-to-left direction engages (isRTL() true while it is active).
 */
test('Dari has every English key, with matching value placeholders', async () => {
  const { prs } = await import('./locales/prs.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(prs).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = prs[key];
    assert.equal(typeof value, 'string', `prs missing key: ${key}`);
    assert.ok(value.length > 0, `prs empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `prs ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `prs ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `prs ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Dari renders the app in Dari, RTL included', () => {
  assert.equal(setLocale('prs'), 'prs');
  assert.equal(getLocale(), 'prs');
  assert.equal(t('nav.scan'), 'اسکن');
  assert.equal(t('nav.overview'), 'نمای کلی');
  assert.equal(t('scan.printShelfTag'), 'چاپ برچسب قفسه');
  assert.equal(t('sync.sent'), 'همه تغییرات فرستاده شدند');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'راهرو 1' }), 'فقط 3 در راهرو 1 موجود است.');
  assert.equal(isRTL(), true);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 4 — Tajik (tg), the twenty-sixth translated locale.
 * Same proof as Arabic: every English key exists in Tajik, every
 * value is a non-empty string, and the value placeholders match —
 * except the English plural-agreement markers ({s}, {plural},
 * {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which Tajik omits by
 * design.
 * Tajik is in RTL_LOCALES, so the switch test also proves the
 * right-to-left direction engages (isRTL() true while it is active).
 */
test('Tajik has every English key, with matching value placeholders', async () => {
  const { tg } = await import('./locales/tg.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(tg).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = tg[key];
    assert.equal(typeof value, 'string', `tg missing key: ${key}`);
    assert.ok(value.length > 0, `tg empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `tg ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `tg ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `tg ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Tajik renders the app in Tajik, RTL included', () => {
  assert.equal(setLocale('tg'), 'tg');
  assert.equal(getLocale(), 'tg');
  assert.equal(t('nav.scan'), 'Скан');
  assert.equal(t('nav.overview'), 'Шарҳ');
  assert.equal(t('scan.printShelfTag'), 'Чоп кардани барчаспи раф');
  assert.equal(t('sync.sent'), 'Ҳамаи тағйирот фиристода шуданд');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'гузаргоҳ 1' }), 'Танҳо 3 дар даст дар гузаргоҳ 1.');
  assert.equal(isRTL(), true);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});
