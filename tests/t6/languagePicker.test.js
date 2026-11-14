/**
 * Picker build tests — the public language picker, its localStorage
 * persistence, the registration language carry, and the policy
 * translation registry (English fallback + the protective line).
 *
 * Lib-level behaviour runs against the real modules; page wiring is
 * asserted on source (the codebase's established page-test pattern —
 * there is no DOM renderer in the suite). The "translated body" path
 * is proven with a small fixture body registered in-test — NOT a fake
 * full translation; the registry ships empty, exactly as production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOCALE_LABEL_KEYS,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  getLocale,
  getStrings,
  initLocale,
  isRTL,
  localeLabel,
  setLocale,
  t,
} from '../../src/lib/i18n.js';
import {
  POLICY_KINDS,
  getPolicyDocument,
  hasPolicyTranslation,
  registerPolicyTranslation,
} from '../../src/lib/policyTranslations.js';
import { STOCKHAVEN_TERMS_OF_SERVICE } from '../../src/lib/stockhavenTermsOfService.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY } from '../../src/lib/stockhavenSubscriptionPolicy.js';
import { STOCKHAVEN_PRIVACY_POLICY } from '../../src/lib/stockhavenPrivacyPolicy.js';

const ENGLISH_DOCUMENTS = {
  terms: STOCKHAVEN_TERMS_OF_SERVICE,
  subscription: STOCKHAVEN_SUBSCRIPTION_POLICY,
  privacy: STOCKHAVEN_PRIVACY_POLICY,
};

const NOTICE_ENGLISH =
  'This translation is provided so you can read it in your language. If there is ever a disagreement between this translation and the English version, the English version is the official one.';

function read(path) {
  return readFileSync(path, 'utf8');
}

test('picker: the protective line exists in every locale, English verbatim', () => {
  assert.equal(getStrings('en')['policies.translationNotice'], NOTICE_ENGLISH);
  // The English variants (batch 7) read the official English text itself,
  // so their notice keeps the standard English wording too; every
  // translated locale carries the notice in its own language.
  const ENGLISH_LOCALES = new Set(['en', 'en-GB', 'en-CA', 'en-AU', 'en-IN']);
  for (const code of SUPPORTED_LOCALES) {
    const value = getStrings(code)['policies.translationNotice'];
    assert.equal(typeof value, 'string', `${code} is missing policies.translationNotice`);
    assert.ok(value.length > 20, `${code} translation notice looks empty`);
    if (ENGLISH_LOCALES.has(code)) {
      assert.equal(value, NOTICE_ENGLISH, `${code} notice should stay the English wording`);
    } else {
      assert.notEqual(value, NOTICE_ENGLISH, `${code} notice is still the English text`);
    }
  }
});

test('picker: every registry locale has a native label key', () => {
  for (const code of SUPPORTED_LOCALES) {
    const key = LOCALE_LABEL_KEYS[code];
    assert.ok(key, `${code} has no label key in LOCALE_LABEL_KEYS`);
    const label = getStrings('en')[key];
    assert.equal(typeof label, 'string', `${key} missing from en.js`);
    assert.ok(label.length > 0);
  }
  // The label a visitor sees for a language is that language's own
  // name — identical values in every locale file by design.
  assert.equal(localeLabel('ar'), getStrings('de')['settings.details.arabic']);
  assert.equal(localeLabel('fr-FR'), getStrings('en')['settings.details.french']);
});

test('picker: switching renders the new language immediately, RTL included', () => {
  setLocale('de');
  assert.equal(getLocale(), 'de');
  assert.equal(t('nav.scan'), getStrings('de')['nav.scan']);
  assert.notEqual(t('nav.scan'), getStrings('en')['nav.scan']);
  setLocale('ar');
  assert.equal(isRTL(), true);
  assert.equal(t('nav.scan'), getStrings('ar')['nav.scan']);
  setLocale('en');
  assert.equal(isRTL(), false);
});

test('picker: the choice persists in localStorage and is restored at startup', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    // Choosing writes the key the picker reads back after a reload.
    setLocale('ar');
    assert.equal(store.get(LOCALE_STORAGE_KEY), 'ar');
    // A code stored by a previous session is applied by initLocale.
    store.set(LOCALE_STORAGE_KEY, 'fr-FR');
    initLocale();
    assert.equal(getLocale(), 'fr-FR');
    assert.equal(t('nav.scan'), getStrings('fr-FR')['nav.scan']);
    // A stored code the registry no longer holds is ignored, not fatal.
    store.set(LOCALE_STORAGE_KEY, 'klingon');
    initLocale();
    assert.equal(getLocale(), 'fr-FR');
  } finally {
    delete globalThis.localStorage;
    setLocale('en');
  }
});

test('picker: present on every public page (and the auth layout)', () => {
  for (const page of ['Welcome', 'Plans', 'Subscribe', 'TermsOfService', 'SubscriptionPolicy', 'PrivacyPolicy']) {
    const src = read(`src/pages/${page}.jsx`);
    assert.ok(src.includes('LanguagePicker'), `${page} does not render the LanguagePicker`);
    assert.ok(src.includes('useLocale'), `${page} does not subscribe to locale changes`);
  }
  // Login + Register reach the picker through AuthLayout, and each
  // page subscribes itself so its form strings re-render on switch.
  const layout = read('src/components/AuthLayout.jsx');
  assert.ok(layout.includes('LanguagePicker'), 'AuthLayout does not render the LanguagePicker');
  for (const page of ['Login', 'Register']) {
    assert.ok(read(`src/pages/${page}.jsx`).includes('useLocale()'), `${page} does not subscribe to locale changes`);
  }
  // Startup restores the stored choice before first render.
  assert.ok(read('src/main.jsx').includes('initLocale()'), 'main.jsx does not call initLocale()');
});

test('picker: the component offers every locale by its label key', () => {
  const src = read('src/components/LanguagePicker.jsx');
  assert.ok(src.includes('SUPPORTED_LOCALES'), 'picker does not list the registry locales');
  assert.ok(src.includes('LOCALE_LABEL_KEYS'), 'picker does not use the native label keys');
  assert.ok(src.includes('setLocale'), 'picker does not apply the choice through setLocale');
});

test('registration: the create call carries the chosen locale', () => {
  const business = read('src/lib/business.js');
  assert.ok(
    business.includes('language: values.language || getLocale()'),
    'createBusiness does not send the active locale',
  );
});

test('policies: no translation registered -> the English body, cleanly', () => {
  // For locales without a registered translation, every kind falls
  // back to the English document itself. (Tranche 1 registered am,
  // ar, bn and bho; tranche 2 registered the six Spanish variants —
  // sampled here are locales still unregistered.)
  for (const kind of POLICY_KINDS) {
    for (const locale of ['pa-Arab', 'id', 'ms']) {
      assert.equal(hasPolicyTranslation(kind, locale), false);
      const { document, translated } = getPolicyDocument(kind, locale);
      assert.equal(translated, false, `${kind}/${locale} should not claim a translation`);
      assert.equal(document, ENGLISH_DOCUMENTS[kind], `${kind}/${locale} should be the English document`);
    }
    const english = getPolicyDocument(kind, 'en');
    assert.equal(english.translated, false);
    assert.equal(english.document, ENGLISH_DOCUMENTS[kind]);
  }
  assert.deepEqual([...POLICY_KINDS], ['terms', 'subscription', 'privacy']);
});

test('policies: a registered translation is served, merged over English, with the line', () => {
  // Malformed registrations are refused and never poison the slot.
  // (Fixture registrations use the placeholder code 'xx', which no
  // real translation pass will ever register, so this test survives
  // every tranche.)
  assert.equal(registerPolicyTranslation('terms', 'xx', null), false);
  assert.equal(registerPolicyTranslation('terms', 'xx', { title: 42, sections: [] }), false);
  assert.equal(registerPolicyTranslation('terms', 'en', { title: 'X', sections: [] }), false);
  assert.equal(registerPolicyTranslation('unknown', 'xx', { title: 'X', sections: [] }), false);
  assert.equal(hasPolicyTranslation('terms', 'xx'), false);

  // A minimal fixture body — a title and one section, deliberately NOT
  // a full translation — proves the translated path end to end.
  const fixture = {
    title: 'Conditions du service (fixture)',
    sections: [
      { id: 'acceptance', title: '1. Acceptation (fixture)', paragraphs: ['Paragraphe fixture.'] },
    ],
  };
  assert.equal(registerPolicyTranslation('terms', 'xx', fixture), true);
  assert.equal(hasPolicyTranslation('terms', 'xx'), true);

  const { document, translated } = getPolicyDocument('terms', 'xx');
  assert.equal(translated, true);
  assert.equal(document.title, fixture.title);
  assert.deepEqual(document.sections, fixture.sections);
  // Fields the translation omits come from the official English text.
  assert.equal(document.owner, STOCKHAVEN_TERMS_OF_SERVICE.owner);
  assert.equal(document.effectiveDate, STOCKHAVEN_TERMS_OF_SERVICE.effectiveDate);

  // The protective line the page prints above a translated body is
  // itself in the visitor's language.
  setLocale('fr-FR');
  try {
    assert.equal(t('policies.translationNotice'), getStrings('fr-FR')['policies.translationNotice']);
    assert.notEqual(t('policies.translationNotice'), NOTICE_ENGLISH);
  } finally {
    setLocale('en');
  }
});

test('policies: each page wires the registry and gates the line on a translation', () => {
  const pages = {
    TermsOfService: 'terms',
    SubscriptionPolicy: 'subscription',
    PrivacyPolicy: 'privacy',
  };
  for (const [page, kind] of Object.entries(pages)) {
    const src = read(`src/pages/${page}.jsx`);
    assert.ok(src.includes(`getPolicyDocument('${kind}'`), `${page} does not read the ${kind} document from the registry`);
    assert.ok(src.includes('translated &&'), `${page} does not gate the protective line on a translation`);
    assert.ok(src.includes("t('policies.translationNotice')"), `${page} does not render the protective line`);
  }
});
