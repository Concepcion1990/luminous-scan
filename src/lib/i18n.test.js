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
  assert.equal(isRTL('ur'), true);
  assert.equal(isRTL('pa-Arab'), true);
  assert.equal(isRTL('en'), false);
  // Tajik is Cyrillic — left-to-right, NOT RTL (fixed Nov 12, 2026).
  assert.equal(isRTL('tg'), false);
  assert.equal(isRTL('es-MX'), false);
  assert.equal(isRTL('zh-Hans'), false);
});

test('the registry holds English, English (Australia), English (Canada), English (India), English (United Kingdom), Arabic, Amharic, Bengali, Bhojpuri, Brazilian Portuguese, Canadian French, Cantonese, Dari, European Portuguese, French, German, Gujarati, Hausa, Hindi, Indonesian, Italian, Japanese, Javanese, Kannada, Korean, Malay, Mandarin Simplified, Mandarin Traditional, Marathi, Nigerian Pidgin, Persian, Punjabi (Gurmukhi), Punjabi (Shahmukhi), Russian, Shanghainese, Spanish (Cuba), Spanish (Mexico), Spanish (Puerto Rico), Spanish (Spain), Spanish (United States), Spanish (Venezuela), Swahili, Tagalog, Tajik, Tamil, Telugu, Thai, Turkish, Ukrainian, Urdu, Vietnamese and Yoruba, ABC order', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['am', 'ar', 'bho', 'bn', 'de', 'en', 'en-AU', 'en-CA', 'en-GB', 'en-IN', 'es-CU', 'es-ES', 'es-MX', 'es-PR', 'es-US', 'es-VE', 'fa', 'fr-CA', 'fr-FR', 'gu', 'ha', 'hi', 'id', 'it', 'ja', 'jv', 'kn', 'ko', 'mr', 'ms', 'pa-Arab', 'pa-Guru', 'pcm', 'prs', 'pt-BR', 'pt-PT', 'ru', 'sw', 'ta', 'te', 'tg', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'wuu', 'yo', 'yue', 'zh-Hans', 'zh-Hant']);
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
 * Tajik reads left-to-right (Cyrillic), so it is NOT in RTL_LOCALES
 * (removed Nov 12, 2026); the switch test asserts isRTL() stays false
 * while Tajik is active.
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

test('switching to Tajik renders the app in Tajik, left-to-right', () => {
  assert.equal(setLocale('tg'), 'tg');
  assert.equal(getLocale(), 'tg');
  assert.equal(t('nav.scan'), 'Скан');
  assert.equal(t('nav.overview'), 'Шарҳ');
  assert.equal(t('scan.printShelfTag'), 'Чоп кардани барчаспи раф');
  assert.equal(t('sync.sent'), 'Ҳамаи тағйирот фиристода шуданд');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'гузаргоҳ 1' }), 'Танҳо 3 дар даст дар гузаргоҳ 1.');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 5 — Brazilian Portuguese (pt-BR), the twenty-seventh
 * translated locale.
 * Same proof as Arabic: every English key exists in Brazilian Portuguese,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Brazilian Portuguese omits by design.
 * Brazilian vocabulary throughout (estoque, prateleira, tela,
 * arquivo, planilha); the plural lives in the word form.
 */
test('Brazilian Portuguese has every English key, with matching value placeholders', async () => {
  const { ptBR } = await import('./locales/pt-BR.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(ptBR).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = ptBR[key];
    assert.equal(typeof value, 'string', `pt-BR missing key: ${key}`);
    assert.ok(value.length > 0, `pt-BR empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `pt-BR ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `pt-BR ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `pt-BR ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Brazilian Portuguese renders the app in Brazilian Portuguese', () => {
  assert.equal(setLocale("pt-BR"), "pt-BR");
  assert.equal(getLocale(), "pt-BR");
  assert.equal(t('nav.scan'), "Escanear");
  assert.equal(t('nav.overview'), "Visão geral");
  assert.equal(t('scan.printShelfTag'), "Imprimir etiqueta de prateleira");
  assert.equal(t('sync.sent'), "Todas as alterações enviadas");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "corredor 1" }), "Apenas 3 em estoque em corredor 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 5 — European Portuguese (pt-PT), the twenty-eighth
 * translated locale.
 * Same proof as Arabic: every English key exists in European Portuguese,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * European Portuguese omits by design.
 * Genuinely European, distinct from Brazilian Portuguese: ecrã,
 * ficheiro, folha de cálculo, gestão (never gerenciamento), and
 * a + infinitive progressives.
 */
test('European Portuguese has every English key, with matching value placeholders', async () => {
  const { ptPT } = await import('./locales/pt-PT.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(ptPT).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = ptPT[key];
    assert.equal(typeof value, 'string', `pt-PT missing key: ${key}`);
    assert.ok(value.length > 0, `pt-PT empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `pt-PT ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `pt-PT ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `pt-PT ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to European Portuguese renders the app in European Portuguese', () => {
  assert.equal(setLocale("pt-PT"), "pt-PT");
  assert.equal(getLocale(), "pt-PT");
  assert.equal(t('nav.scan'), "Digitalizar");
  assert.equal(t('nav.overview'), "Vista geral");
  assert.equal(t('scan.printShelfTag'), "Imprimir etiqueta de prateleira");
  assert.equal(t('sync.sent'), "Todas as alterações enviadas");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "corredor 1" }), "Apenas 3 em stock em corredor 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 5 — Punjabi (Gurmukhi) (pa-Guru), the twenty-ninth
 * translated locale.
 * Same proof as Arabic: every English key exists in Punjabi (Gurmukhi),
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Punjabi (Gurmukhi) omits by design.
 * Standard Majhi-based written Punjabi in Gurmukhi script,
 * respectful ਤੁਸੀਂ forms, Western digits (no Gurmukhi digits).
 */
test('Punjabi (Gurmukhi) has every English key, with matching value placeholders', async () => {
  const { paGuru } = await import('./locales/pa-Guru.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(paGuru).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = paGuru[key];
    assert.equal(typeof value, 'string', `pa-Guru missing key: ${key}`);
    assert.ok(value.length > 0, `pa-Guru empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `pa-Guru ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `pa-Guru ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `pa-Guru ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Punjabi (Gurmukhi) renders the app in Punjabi (Gurmukhi)', () => {
  assert.equal(setLocale("pa-Guru"), "pa-Guru");
  assert.equal(getLocale(), "pa-Guru");
  assert.equal(t('nav.scan'), "ਸਕੈਨ");
  assert.equal(t('nav.overview'), "ਸੰਖੇਪ ਜਾਣਕਾਰੀ");
  assert.equal(t('scan.printShelfTag'), "ਸ਼ੈਲਫ ਟੈਗ ਛਾਪੋ");
  assert.equal(t('sync.sent'), "ਸਾਰੇ ਬਦਲਾਅ ਭੇਜੇ ਗਏ");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "ਸ਼ੈਲਫ 1" }), "ਸ਼ੈਲਫ 1 'ਤੇ ਸਿਰਫ਼ 3 ਹੱਥ ਵਿੱਚ ਹੈ।");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 5 — Punjabi (Shahmukhi) (pa-Arab), the thirtieth
 * translated locale.
 * Same proof as Arabic: every English key exists in Punjabi (Shahmukhi),
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Punjabi (Shahmukhi) omits by design.
 * Punjabi in Shahmukhi script — Punjabi vocabulary and grammar
 * (ਦਾ/دی/دے genitives), NOT Urdu substitution.
 * Punjabi (Shahmukhi) is in RTL_LOCALES, so the switch test also
 * proves the right-to-left direction engages (isRTL() true while
 * it is active).
 */
test('Punjabi (Shahmukhi) has every English key, with matching value placeholders', async () => {
  const { paArab } = await import('./locales/pa-Arab.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(paArab).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = paArab[key];
    assert.equal(typeof value, 'string', `pa-Arab missing key: ${key}`);
    assert.ok(value.length > 0, `pa-Arab empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `pa-Arab ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `pa-Arab ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `pa-Arab ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Punjabi (Shahmukhi) renders the app in Punjabi (Shahmukhi), RTL included', () => {
  assert.equal(setLocale("pa-Arab"), "pa-Arab");
  assert.equal(getLocale(), "pa-Arab");
  assert.equal(t('nav.scan'), "سکین کرو");
  assert.equal(t('nav.overview'), "جائزہ");
  assert.equal(t('scan.printShelfTag'), "شیلف ٹیگ چھاپو");
  assert.equal(t('sync.sent'), "ساریاں تبدیلیاں بھیجیاں گئیاں");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "شیلف 1" }), "شیلف 1 اُتے صرف 3 موجود اے۔");
  assert.equal(isRTL(), true);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 5 — Russian (ru), the thirty-first
 * translated locale.
 * Same proof as Arabic: every English key exists in Russian,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Russian omits by design.
 * Polite lowercase вы; count phrases are restructured to
 * number-independent forms, because Russian has three plural
 * forms and no single marker could agree with every number.
 */
test('Russian has every English key, with matching value placeholders', async () => {
  const { ru } = await import('./locales/ru.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(ru).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = ru[key];
    assert.equal(typeof value, 'string', `ru missing key: ${key}`);
    assert.ok(value.length > 0, `ru empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `ru ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `ru ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `ru ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Russian renders the app in Russian', () => {
  assert.equal(setLocale("ru"), "ru");
  assert.equal(getLocale(), "ru");
  assert.equal(t('nav.scan'), "Сканировать");
  assert.equal(t('nav.overview'), "Обзор");
  assert.equal(t('scan.printShelfTag'), "Напечатать ценник для полки");
  assert.equal(t('sync.sent'), "Все изменения отправлены");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "ряд 1" }), "В наличии в ряд 1: только 3.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 5 — Spanish (United States) (es-US), the thirty-second
 * translated locale.
 * Same proof as Arabic: every English key exists in Spanish (United States),
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Spanish (United States) omits by design.
 * The neutral-US reference Spanish: computadora, almacén, no
 * vosotros, no Peninsular vocabulary, no regional slang.
 */
test('Spanish (United States) has every English key, with matching value placeholders', async () => {
  const { esUS } = await import('./locales/es-US.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(esUS).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = esUS[key];
    assert.equal(typeof value, 'string', `es-US missing key: ${key}`);
    assert.ok(value.length > 0, `es-US empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `es-US ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `es-US ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `es-US ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Spanish (United States) renders the app in Spanish (United States)', () => {
  assert.equal(setLocale("es-US"), "es-US");
  assert.equal(getLocale(), "es-US");
  assert.equal(t('nav.scan'), "Escanear");
  assert.equal(t('nav.overview'), "Resumen");
  assert.equal(t('scan.printShelfTag'), "Imprimir etiqueta de estante");
  assert.equal(t('sync.sent'), "Todos los cambios enviados");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "pasillo 1" }), "Solo hay 3 en existencia en pasillo 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 5 — Spanish (Spain) (es-ES), the thirty-third
 * translated locale.
 * Same proof as Arabic: every English key exists in Spanish (Spain),
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Spanish (Spain) omits by design.
 * Peninsular vocabulary (ordenador, estantería, albarán) and
 * vosotros forms where the English addresses a group.
 */
test('Spanish (Spain) has every English key, with matching value placeholders', async () => {
  const { esES } = await import('./locales/es-ES.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(esES).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = esES[key];
    assert.equal(typeof value, 'string', `es-ES missing key: ${key}`);
    assert.ok(value.length > 0, `es-ES empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `es-ES ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `es-ES ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `es-ES ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Spanish (Spain) renders the app in Spanish (Spain)', () => {
  assert.equal(setLocale("es-ES"), "es-ES");
  assert.equal(getLocale(), "es-ES");
  assert.equal(t('nav.scan'), "Escanear");
  assert.equal(t('nav.overview'), "Resumen");
  assert.equal(t('scan.printShelfTag'), "Imprimir etiqueta de estantería");
  assert.equal(t('sync.sent'), "Todos los cambios enviados");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "pasillo 1" }), "Solo hay 3 disponibles en pasillo 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 5 — Spanish (Mexico) (es-MX), the thirty-fourth
 * translated locale.
 * Same proof as Arabic: every English key exists in Spanish (Mexico),
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Spanish (Mexico) omits by design.
 * Mexican business vocabulary carried naturally (anaquel,
 * apartado, paquetería) — professional register, no caricature.
 */
test('Spanish (Mexico) has every English key, with matching value placeholders', async () => {
  const { esMX } = await import('./locales/es-MX.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(esMX).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = esMX[key];
    assert.equal(typeof value, 'string', `es-MX missing key: ${key}`);
    assert.ok(value.length > 0, `es-MX empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `es-MX ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `es-MX ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `es-MX ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Spanish (Mexico) renders the app in Spanish (Mexico)', () => {
  assert.equal(setLocale("es-MX"), "es-MX");
  assert.equal(getLocale(), "es-MX");
  assert.equal(t('nav.scan'), "Escanear");
  assert.equal(t('nav.overview'), "Resumen");
  assert.equal(t('scan.printShelfTag'), "Imprimir etiqueta de anaquel");
  assert.equal(t('sync.sent'), "Todos los cambios enviados");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "pasillo 1" }), "Solo hay 3 en existencia en pasillo 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 5 — Spanish (Cuba) (es-CU), the thirty-fifth
 * translated locale.
 * Same proof as Arabic: every English key exists in Spanish (Cuba),
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Spanish (Cuba) omits by design.
 * Cuban/Caribbean business vocabulary carried naturally
 * (estante, existencias, computadora) — professional register,
 * no caricature.
 */
test('Spanish (Cuba) has every English key, with matching value placeholders', async () => {
  const { esCU } = await import('./locales/es-CU.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(esCU).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = esCU[key];
    assert.equal(typeof value, 'string', `es-CU missing key: ${key}`);
    assert.ok(value.length > 0, `es-CU empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `es-CU ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `es-CU ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `es-CU ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Spanish (Cuba) renders the app in Spanish (Cuba)', () => {
  assert.equal(setLocale("es-CU"), "es-CU");
  assert.equal(getLocale(), "es-CU");
  assert.equal(t('nav.scan'), "Escanear");
  assert.equal(t('nav.overview'), "Resumen");
  assert.equal(t('scan.printShelfTag'), "Imprimir etiqueta de estante");
  assert.equal(t('sync.sent'), "Todos los cambios enviados");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "pasillo 1" }), "Solo hay 3 en existencia en pasillo 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 5 — Spanish (Puerto Rico) (es-PR), the thirty-sixth
 * translated locale.
 * Same proof as Arabic: every English key exists in Spanish (Puerto Rico),
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Spanish (Puerto Rico) omits by design.
 * Puerto Rican business vocabulary carried naturally (góndola,
 * suplidor, escanear where genuinely standard) — professional
 * register, no caricature.
 */
test('Spanish (Puerto Rico) has every English key, with matching value placeholders', async () => {
  const { esPR } = await import('./locales/es-PR.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(esPR).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = esPR[key];
    assert.equal(typeof value, 'string', `es-PR missing key: ${key}`);
    assert.ok(value.length > 0, `es-PR empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `es-PR ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `es-PR ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `es-PR ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Spanish (Puerto Rico) renders the app in Spanish (Puerto Rico)', () => {
  assert.equal(setLocale("es-PR"), "es-PR");
  assert.equal(getLocale(), "es-PR");
  assert.equal(t('nav.scan'), "Escanear");
  assert.equal(t('nav.overview'), "Resumen");
  assert.equal(t('scan.printShelfTag'), "Imprimir etiqueta de estante");
  assert.equal(t('sync.sent'), "Todos los cambios enviados");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "pasillo 1" }), "Solo hay 3 disponibles en pasillo 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 5 — Spanish (Venezuela) (es-VE), the thirty-seventh
 * translated locale.
 * Same proof as Arabic: every English key exists in Spanish (Venezuela),
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Spanish (Venezuela) omits by design.
 * Venezuelan business vocabulary carried naturally (anaquel,
 * depósito, apartado) — professional register, no caricature.
 */
test('Spanish (Venezuela) has every English key, with matching value placeholders', async () => {
  const { esVE } = await import('./locales/es-VE.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(esVE).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = esVE[key];
    assert.equal(typeof value, 'string', `es-VE missing key: ${key}`);
    assert.ok(value.length > 0, `es-VE empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `es-VE ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `es-VE ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `es-VE ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Spanish (Venezuela) renders the app in Spanish (Venezuela)', () => {
  assert.equal(setLocale("es-VE"), "es-VE");
  assert.equal(getLocale(), "es-VE");
  assert.equal(t('nav.scan'), "Escanear");
  assert.equal(t('nav.overview'), "Resumen");
  assert.equal(t('scan.printShelfTag'), "Imprimir etiqueta de anaquel");
  assert.equal(t('sync.sent'), "Todos los cambios enviados");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "pasillo 1" }), "Solo hay 3 en existencia en pasillo 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 6 — Swahili (sw), the thirty-eighth
 * translated locale.
 * Same proof as Arabic: every English key exists in Swahili,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Swahili omits by design.
 * Standard (Kenya/Tanzania) business register
 * (lebo ya rafu, mabadiliko).
 */
test('Swahili has every English key, with matching value placeholders', async () => {
  const { sw } = await import('./locales/sw.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(sw).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = sw[key];
    assert.equal(typeof value, 'string', `sw missing key: ${key}`);
    assert.ok(value.length > 0, `sw empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `sw ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `sw ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `sw ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Swahili renders the app in Swahili', () => {
  assert.equal(setLocale("sw"), "sw");
  assert.equal(getLocale(), "sw");
  assert.equal(t('nav.scan'), "Changanua");
  assert.equal(t('nav.overview'), "Muhtasari");
  assert.equal(t('scan.printShelfTag'), "Chapisha lebo ya rafu");
  assert.equal(t('sync.sent'), "Mabadiliko yote yametumwa");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "njia 1" }), "3 pekee zilizopo katika njia 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 6 — Tagalog (tl), the thirty-ninth
 * translated locale.
 * Same proof as Arabic: every English key exists in Tagalog,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Tagalog omits by design.
 * Standard Filipino register
 * (tag sa istante, pagbabago).
 */
test('Tagalog has every English key, with matching value placeholders', async () => {
  const { tl } = await import('./locales/tl.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(tl).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = tl[key];
    assert.equal(typeof value, 'string', `tl missing key: ${key}`);
    assert.ok(value.length > 0, `tl empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `tl ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `tl ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `tl ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Tagalog renders the app in Tagalog', () => {
  assert.equal(setLocale("tl"), "tl");
  assert.equal(getLocale(), "tl");
  assert.equal(t('nav.scan'), "I-scan");
  assert.equal(t('nav.overview'), "Pangkalahatang-ideya");
  assert.equal(t('scan.printShelfTag'), "I-print ang tag sa istante");
  assert.equal(t('sync.sent'), "Naipadala na ang lahat ng pagbabago");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "pasilyo 1" }), "3 lamang ang nasa kamay sa pasilyo 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 6 — Tamil (ta), the fortieth
 * translated locale.
 * Same proof as Arabic: every English key exists in Tamil,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Tamil omits by design.
 * Formal-neutral Tamil register.
 */
test('Tamil has every English key, with matching value placeholders', async () => {
  const { ta } = await import('./locales/ta.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(ta).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = ta[key];
    assert.equal(typeof value, 'string', `ta missing key: ${key}`);
    assert.ok(value.length > 0, `ta empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `ta ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `ta ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `ta ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Tamil renders the app in Tamil', () => {
  assert.equal(setLocale("ta"), "ta");
  assert.equal(getLocale(), "ta");
  assert.equal(t('nav.scan'), "ஸ்கேன்");
  assert.equal(t('nav.overview'), "கண்ணோட்டம்");
  assert.equal(t('scan.printShelfTag'), "அலமாரி குறிச்சொல்லை அச்சிடவும்");
  assert.equal(t('sync.sent'), "அனைத்து மாற்றங்களும் அனுப்பப்பட்டன");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "நடைபாதை 1" }), "நடைபாதை 1 இல் 3 மட்டுமே கையில் உள்ளது.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 6 — Telugu (te), the forty-first
 * translated locale.
 * Same proof as Arabic: every English key exists in Telugu,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Telugu omits by design.
 * Formal-neutral Telugu register.
 */
test('Telugu has every English key, with matching value placeholders', async () => {
  const { te } = await import('./locales/te.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(te).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = te[key];
    assert.equal(typeof value, 'string', `te missing key: ${key}`);
    assert.ok(value.length > 0, `te empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `te ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `te ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `te ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Telugu renders the app in Telugu', () => {
  assert.equal(setLocale("te"), "te");
  assert.equal(getLocale(), "te");
  assert.equal(t('nav.scan'), "స్కాన్");
  assert.equal(t('nav.overview'), "అవలోకనం");
  assert.equal(t('scan.printShelfTag'), "షెల్ఫ్ ట్యాగ్‌ను ముద్రించండి");
  assert.equal(t('sync.sent'), "అన్ని మార్పులు పంపబడ్డాయి");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "మార్గం 1" }), "మార్గం 1 వద్ద చేతిలో 3 మాత్రమే ఉన్నాయి.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 6 — Thai (th), the forty-second
 * translated locale.
 * Same proof as Arabic: every English key exists in Thai,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Thai omits by design.
 * Polite Thai register; by Thai UI convention
 * scan.onlyOnHand carries no trailing full stop.
 */
test('Thai has every English key, with matching value placeholders', async () => {
  const { th } = await import('./locales/th.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(th).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = th[key];
    assert.equal(typeof value, 'string', `th missing key: ${key}`);
    assert.ok(value.length > 0, `th empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `th ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `th ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `th ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Thai renders the app in Thai', () => {
  assert.equal(setLocale("th"), "th");
  assert.equal(getLocale(), "th");
  assert.equal(t('nav.scan'), "สแกน");
  assert.equal(t('nav.overview'), "ภาพรวม");
  assert.equal(t('scan.printShelfTag'), "พิมพ์ป้ายชั้นวาง");
  assert.equal(t('sync.sent'), "ส่งการเปลี่ยนแปลงทั้งหมดแล้ว");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "ทางเดิน 1" }), "มีเพียง 3 ชิ้นคงเหลือที่ ทางเดิน 1");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 6 — Turkish (tr), the forty-third
 * translated locale.
 * Same proof as Arabic: every English key exists in Turkish,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Turkish omits by design.
 * Formal siz register for account-holder strings.
 */
test('Turkish has every English key, with matching value placeholders', async () => {
  const { tr } = await import('./locales/tr.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(tr).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = tr[key];
    assert.equal(typeof value, 'string', `tr missing key: ${key}`);
    assert.ok(value.length > 0, `tr empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `tr ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `tr ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `tr ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Turkish renders the app in Turkish', () => {
  assert.equal(setLocale("tr"), "tr");
  assert.equal(getLocale(), "tr");
  assert.equal(t('nav.scan'), "Tara");
  assert.equal(t('nav.overview'), "Genel bakış");
  assert.equal(t('scan.printShelfTag'), "Raf etiketi yazdır");
  assert.equal(t('sync.sent'), "Tüm değişiklikler gönderildi");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "koridor 1" }), "koridor 1 konumunda yalnızca 3 adet elde var.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 6 — Ukrainian (uk), the forty-fourth
 * translated locale.
 * Same proof as Arabic: every English key exists in Ukrainian,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Ukrainian omits by design.
 * Proper Ukrainian (товар, склад, цінник на
 * полицю) — no Russian calques.
 */
test('Ukrainian has every English key, with matching value placeholders', async () => {
  const { uk } = await import('./locales/uk.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(uk).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = uk[key];
    assert.equal(typeof value, 'string', `uk missing key: ${key}`);
    assert.ok(value.length > 0, `uk empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `uk ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `uk ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `uk ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Ukrainian renders the app in Ukrainian', () => {
  assert.equal(setLocale("uk"), "uk");
  assert.equal(getLocale(), "uk");
  assert.equal(t('nav.scan'), "Сканування");
  assert.equal(t('nav.overview'), "Огляд");
  assert.equal(t('scan.printShelfTag'), "Надрукувати цінник на полицю");
  assert.equal(t('sync.sent'), "Усі зміни надіслано");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "прохід 1" }), "У наявності лише 3 у локації прохід 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 6 — Urdu (ur), the forty-fifth
 * translated locale.
 * Same proof as Arabic: every English key exists in Urdu,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Urdu omits by design.
 * Proper Urdu in Nastaliq script, formal آپ
 * register. Urdu is an RTL locale — the switch test asserts
 * isRTL() engages while Urdu is active.
 */
test('Urdu has every English key, with matching value placeholders', async () => {
  const { ur } = await import('./locales/ur.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(ur).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = ur[key];
    assert.equal(typeof value, 'string', `ur missing key: ${key}`);
    assert.ok(value.length > 0, `ur empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `ur ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `ur ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `ur ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Urdu renders the app in Urdu', () => {
  assert.equal(setLocale("ur"), "ur");
  assert.equal(getLocale(), "ur");
  assert.equal(t('nav.scan'), "اسکین");
  assert.equal(t('nav.overview'), "جائزہ");
  assert.equal(t('scan.printShelfTag'), "شیلف ٹیگ پرنٹ کریں");
  assert.equal(t('sync.sent'), "تمام تبدیلیاں بھیج دی گئیں");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "گلیارہ 1" }), "گلیارہ 1 پر صرف 3 موجود ہیں۔");
  assert.equal(isRTL(), true);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 6 — Vietnamese (vi), the forty-sixth
 * translated locale.
 * Same proof as Arabic: every English key exists in Vietnamese,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Vietnamese omits by design.
 * Neutral-polite register (bạn), full diacritics
 * (tồn kho, sản phẩm).
 */
test('Vietnamese has every English key, with matching value placeholders', async () => {
  const { vi } = await import('./locales/vi.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(vi).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = vi[key];
    assert.equal(typeof value, 'string', `vi missing key: ${key}`);
    assert.ok(value.length > 0, `vi empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `vi ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `vi ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `vi ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Vietnamese renders the app in Vietnamese', () => {
  assert.equal(setLocale("vi"), "vi");
  assert.equal(getLocale(), "vi");
  assert.equal(t('nav.scan'), "Quét");
  assert.equal(t('nav.overview'), "Tổng quan");
  assert.equal(t('scan.printShelfTag'), "In thẻ kệ");
  assert.equal(t('sync.sent'), "Đã gửi tất cả thay đổi");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "lối đi 1" }), "Chỉ có 3 đang có tại lối đi 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

/**
 * T6.3 batch 6 — Yoruba (yo), the forty-seventh
 * translated locale.
 * Same proof as Arabic: every English key exists in Yoruba,
 * every value is a non-empty string, and the value placeholders
 * match — except the English plural-agreement markers ({s},
 * {plural}, {suffix}, {us}, {cs}, {ps}, {fs}, {rs}), which
 * Yoruba omits by design.
 * Full Yoruba diacritics (ẹ, ọ, ṣ + tone marks);
 * established loanwords where no common native term exists.
 */
test('Yoruba has every English key, with matching value placeholders', async () => {
  const { yo } = await import('./locales/yo.js');
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(yo).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = yo[key];
    assert.equal(typeof value, 'string', `yo missing key: ${key}`);
    assert.ok(value.length > 0, `yo empty value: ${key}`);
    const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `yo ${key} missing {${p}}`);
    for (const p of got) assert.ok(placeholders(english).has(p), `yo ${key} extra {${p}}`);
    for (const p of agreement) assert.ok(!got.has(p), `yo ${key} keeps agreement marker {${p}}`);
  }
});

test('switching to Yoruba renders the app in Yoruba', () => {
  assert.equal(setLocale("yo"), "yo");
  assert.equal(getLocale(), "yo");
  assert.equal(t('nav.scan'), "Ṣàyẹ̀wò");
  assert.equal(t('nav.overview'), "Àkópọ̀");
  assert.equal(t('scan.printShelfTag'), "Tẹ̀ àmì ṣẹ́ẹ̀fù jáde");
  assert.equal(t('sync.sent'), "A ti fi gbogbo àyípadà ránṣẹ́");
  assert.equal(t('scan.onlyOnHand', { count: 3, location: "ọ̀nà 1" }), "3 nìkan ni ó wà ní ọwọ́ ní ọ̀nà 1.");
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

test('English (United Kingdom) has every English key, with matching value placeholders', async () => {
  const { enGB } = await import('./locales/en-GB.js');
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(enGB).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = enGB[key];
    assert.equal(typeof value, 'string', `en-GB missing key: ${key}`);
    assert.ok(value.length > 0, `en-GB empty value: ${key}`);
    // English variants KEEP the plural-agreement markers — placeholders
    // must match the English set exactly (unlike the translated locales).
    const want = placeholders(english);
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `en-GB ${key} missing {${p}}`);
    for (const p of got) assert.ok(want.has(p), `en-GB ${key} extra {${p}}`);
  }
});

test('switching to English (United Kingdom) renders the app in English (United Kingdom)', () => {
  assert.equal(setLocale('en-GB'), 'en-GB');
  assert.equal(getLocale(), 'en-GB');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(t('nav.overview'), 'Overview');
  assert.equal(t('scan.printShelfTag'), 'Print shelf tag');
  assert.equal(t('sync.sent'), 'All changes sent');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Aisle 1' }), 'Only 3 on hand at Aisle 1.');
  // The strings that genuinely differ in this region:
  assert.equal(t('settings.identity.brandColor'), 'Brand colour');
  assert.equal(t('import.title'), 'Import centre');
  assert.equal(t('products.eyebrow'), 'Catalogue');
  assert.equal(t('settings.billingStatus.canceled'), 'Cancelled');
  assert.equal(t('settings.details.addressPlaceholder'), 'Street, city, postcode');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

test('English (Canada) has every English key, with matching value placeholders', async () => {
  const { enCA } = await import('./locales/en-CA.js');
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(enCA).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = enCA[key];
    assert.equal(typeof value, 'string', `en-CA missing key: ${key}`);
    assert.ok(value.length > 0, `en-CA empty value: ${key}`);
    const want = placeholders(english);
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `en-CA ${key} missing {${p}}`);
    for (const p of got) assert.ok(want.has(p), `en-CA ${key} extra {${p}}`);
  }
});

test('switching to English (Canada) renders the app in English (Canada)', () => {
  assert.equal(setLocale('en-CA'), 'en-CA');
  assert.equal(getLocale(), 'en-CA');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(t('nav.overview'), 'Overview');
  assert.equal(t('scan.printShelfTag'), 'Print shelf tag');
  assert.equal(t('sync.sent'), 'All changes sent');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Aisle 1' }), 'Only 3 on hand at Aisle 1.');
  // The strings that genuinely differ in this region (Canada keeps the
  // US forms for catalog, fulfillment and the -ize words):
  assert.equal(t('settings.identity.brandColor'), 'Brand colour');
  assert.equal(t('import.title'), 'Import centre');
  assert.equal(t('products.eyebrow'), 'Catalog');
  assert.equal(t('settings.billingStatus.canceled'), 'Cancelled');
  assert.equal(t('settings.details.addressPlaceholder'), 'Street, city, province, postal code');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

test('English (Australia) has every English key, with matching value placeholders', async () => {
  const { enAU } = await import('./locales/en-AU.js');
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(enAU).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = enAU[key];
    assert.equal(typeof value, 'string', `en-AU missing key: ${key}`);
    assert.ok(value.length > 0, `en-AU empty value: ${key}`);
    const want = placeholders(english);
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `en-AU ${key} missing {${p}}`);
    for (const p of got) assert.ok(want.has(p), `en-AU ${key} extra {${p}}`);
  }
});

test('switching to English (Australia) renders the app in English (Australia)', () => {
  assert.equal(setLocale('en-AU'), 'en-AU');
  assert.equal(getLocale(), 'en-AU');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(t('nav.overview'), 'Overview');
  assert.equal(t('scan.printShelfTag'), 'Print shelf tag');
  assert.equal(t('sync.sent'), 'All changes sent');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Aisle 1' }), 'Only 3 on hand at Aisle 1.');
  // The strings that genuinely differ in this region:
  assert.equal(t('settings.identity.brandColor'), 'Brand colour');
  assert.equal(t('import.title'), 'Import centre');
  assert.equal(t('products.eyebrow'), 'Catalogue');
  assert.equal(t('settings.billingStatus.canceled'), 'Cancelled');
  assert.equal(t('settings.details.addressPlaceholder'), 'Street, city, state, postcode');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});

test('English (India) has every English key, with matching value placeholders', async () => {
  const { enIN } = await import('./locales/en-IN.js');
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  assert.equal(Object.keys(enIN).length, Object.keys(en).length);
  for (const [key, english] of Object.entries(en)) {
    const value = enIN[key];
    assert.equal(typeof value, 'string', `en-IN missing key: ${key}`);
    assert.ok(value.length > 0, `en-IN empty value: ${key}`);
    const want = placeholders(english);
    const got = placeholders(value);
    for (const p of want) assert.ok(got.has(p), `en-IN ${key} missing {${p}}`);
    for (const p of got) assert.ok(want.has(p), `en-IN ${key} extra {${p}}`);
  }
});

test('switching to English (India) renders the app in English (India)', () => {
  assert.equal(setLocale('en-IN'), 'en-IN');
  assert.equal(getLocale(), 'en-IN');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(t('nav.overview'), 'Overview');
  assert.equal(t('scan.printShelfTag'), 'Print shelf tag');
  assert.equal(t('sync.sent'), 'All changes sent');
  assert.equal(t('scan.onlyOnHand', { count: 3, location: 'Aisle 1' }), 'Only 3 on hand at Aisle 1.');
  // The strings that genuinely differ in this region:
  assert.equal(t('settings.identity.brandColor'), 'Brand colour');
  assert.equal(t('import.title'), 'Import centre');
  assert.equal(t('products.eyebrow'), 'Catalogue');
  assert.equal(t('settings.billingStatus.canceled'), 'Cancelled');
  assert.equal(t('settings.details.addressPlaceholder'), 'Street, city, state, PIN code');
  assert.equal(isRTL(), false);
  // And back to English — the switch is live, not frozen at import.
  assert.equal(setLocale('en'), 'en');
  assert.equal(t('nav.scan'), 'Scan');
  assert.equal(isRTL(), false);
});
