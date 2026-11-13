/**
 * T20 — Translation tranche 1 (Nov 13, 2026).
 *
 * The first four locales in ABC order — Amharic (am), Arabic (ar),
 * Bengali (bn), Bhojpuri (bho) — had their translation debt retired:
 * every UI string that had been propagated as verbatim-English
 * interim (workforce, inbox/messaging, training, recovery kit,
 * Send-PO, trial reminders, delete warning, Rewards, POS, and the
 * POS plan-gate strings) is now translated, and all three policy
 * bodies (Terms, Subscription Policy, Privacy Policy) are registered
 * for these locales in src/lib/policyTranslations.js.
 *
 * DEBT DEFINITION (the census this pass ran on): a key is debt when
 * the locale value is byte-identical to the English value AND the
 * English value carries translatable natural language — i.e. it is
 * NOT any of the legitimately-identical categories:
 *   - empty, placeholder-only, letter-free after stripping
 *     placeholders, or a bare URL;
 *   - settings.deleteConfirmWord (each locale's own word by design;
 *     English variants keep DELETE);
 *   - settings.details.* language labels (identical in every file
 *     by the standing rule in src/lib/locales/README.md);
 *   - composed solely of proper/technical tokens (brand and channel
 *     names, plan names, US program names, technical abbreviations
 *     such as SKU/UPC/ISBN) plus separators — these stay in Latin
 *     script in every locale file, per each file's own header;
 *   - an example-data placeholder (a *Placeholder key whose value is
 *     sample data: an email address, a bare domain a user must type
 *     literally, or one of the fictional example names).
 * English regional variants (en-GB/CA/AU/IN) are adaptations, not
 * translations — most values are identical by design and they are
 * out of scope for the debt census.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import {
  POLICY_KINDS,
  getPolicyDocument,
  hasPolicyTranslation,
} from '../../src/lib/policyTranslations.js';
import { STOCKHAVEN_TERMS_OF_SERVICE } from '../../src/lib/stockhavenTermsOfService.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY } from '../../src/lib/stockhavenSubscriptionPolicy.js';
import { STOCKHAVEN_PRIVACY_POLICY } from '../../src/lib/stockhavenPrivacyPolicy.js';

const TRANCHE_1_LOCALES = ['am', 'ar', 'bn', 'bho'];

const TOKENS = [
  'Luminous StockHaven', 'Social Security', 'Medicare', 'SKU', 'UPC',
  'EAN', 'ISBN-10 / ISBN-13', 'ISBN', 'QR', 'Excel', 'Bluetooth',
  'USB', 'Wi-Fi', 'Ethernet', 'AirPrint', 'CSV', 'Shopify',
  'TikTok Shop', 'eBay', 'Amazon', 'Walmart', 'Etsy', 'Facebook',
  'Google', 'Business', 'Essentials', 'Stripe', 'USPS', 'UPS',
  'Square', 'POS',
];
const EXAMPLE_VALUES = new Set([
  'you@example.com', 'alex@example.com', 'Dana Ruiz',
  'Ingram Content Group', 'supplier.com', 'Harbor & Pine Books',
  'Alex Rivera',
]);

function legitIdentical(key, value) {
  if (typeof value !== 'string') return 'non-string';
  if (value === '') return 'empty';
  if (key === 'settings.deleteConfirmWord') return 'confirm-word';
  if (key.startsWith('settings.details.')) return 'language-label';
  const stripped = value.replace(/\{[^}]*\}/g, '').trim();
  if (stripped === '') return 'placeholder-only';
  if (!/\p{L}/u.test(stripped)) return 'no-letters';
  if (/^https?:\/\/\S+$/.test(stripped)) return 'url';
  let rest = stripped;
  for (const token of TOKENS) rest = rest.split(token).join(' ');
  if (rest.replace(/[\s\/·—\-,.…:;()%]/g, '') === '') return 'proper/technical tokens only';
  if (key.endsWith('Placeholder') && EXAMPLE_VALUES.has(value)) return 'example-data placeholder';
  if (key.endsWith('Placeholder') && /^[\w-]+(\.[\w-]+)+$/.test(value.trim())) return 'example-domain placeholder';
  return null;
}

function debtKeys(code) {
  const locale = LOCALES[code];
  return Object.keys(en).filter(
    (key) => locale[key] === en[key] && !legitIdentical(key, en[key]),
  );
}

test('tranche 1 locales carry zero translation debt', () => {
  for (const code of TRANCHE_1_LOCALES) {
    const debt = debtKeys(code);
    assert.deepEqual(
      debt,
      [],
      `${code} still has ${debt.length} untranslated keys: ${debt.slice(0, 10).join(', ')}`,
    );
  }
});

test('tranche 1 locales keep keyset parity and placeholder parity with English', () => {
  const agreement = new Set(['s', 'plural', 'suffix', 'us', 'cs', 'ps', 'fs', 'rs']);
  const placeholders = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  const enKeys = Object.keys(en).sort();
  for (const code of TRANCHE_1_LOCALES) {
    const locale = LOCALES[code];
    assert.deepEqual(Object.keys(locale).sort(), enKeys, `${code} keyset differs from en`);
    for (const [key, english] of Object.entries(en)) {
      const value = locale[key];
      assert.equal(typeof value, 'string', `${code} missing key: ${key}`);
      assert.ok(value.length > 0, `${code} empty value: ${key}`);
      const want = new Set([...placeholders(english)].filter((p) => !agreement.has(p)));
      const got = placeholders(value);
      for (const p of want) assert.ok(got.has(p), `${code} ${key} missing {${p}}`);
      for (const p of got) assert.ok(placeholders(english).has(p), `${code} ${key} extra {${p}}`);
      for (const p of agreement) assert.ok(!got.has(p), `${code} ${key} keeps agreement marker {${p}}`);
    }
  }
});

const ENGLISH_DOCUMENTS = {
  terms: STOCKHAVEN_TERMS_OF_SERVICE,
  subscription: STOCKHAVEN_SUBSCRIPTION_POLICY,
  privacy: STOCKHAVEN_PRIVACY_POLICY,
};

test('tranche 1 policy bodies are registered and served, merged over English', () => {
  for (const kind of POLICY_KINDS) {
    const english = ENGLISH_DOCUMENTS[kind];
    for (const code of TRANCHE_1_LOCALES) {
      assert.equal(hasPolicyTranslation(kind, code), true, `${kind}/${code} not registered`);
      const { document, translated } = getPolicyDocument(kind, code);
      assert.equal(translated, true, `${kind}/${code} should serve its translation`);
      // The translated furniture: title, scope (and the document's
      // own prose) are the locale's, never the English strings.
      assert.notEqual(document.title, english.title, `${kind}/${code} title is still English`);
      assert.notEqual(document.scope, english.scope, `${kind}/${code} scope is still English`);
      if (english.tagline) {
        assert.notEqual(document.tagline, english.tagline, `${kind}/${code} tagline is still English`);
      }
      if (english.introduction) {
        assert.notEqual(document.introduction, english.introduction, `${kind}/${code} introduction is still English`);
      }
      // Same skeleton: identical section ids, identical paragraph
      // counts — a translation can never drop or add content.
      assert.equal(document.sections.length, english.sections.length, `${kind}/${code} section count differs`);
      document.sections.forEach((section, i) => {
        assert.equal(section.id, english.sections[i].id, `${kind}/${code} section ${i} id differs`);
        assert.equal(
          section.paragraphs.length,
          english.sections[i].paragraphs.length,
          `${kind}/${code} section ${section.id} paragraph count differs`,
        );
        assert.notEqual(section.title, english.sections[i].title, `${kind}/${code} section ${section.id} title is still English`);
        section.paragraphs.forEach((paragraph, j) => {
          assert.notEqual(
            paragraph,
            english.sections[i].paragraphs[j],
            `${kind}/${code} section ${section.id} paragraph ${j} is still English`,
          );
        });
      });
      // The legal furniture the translation omits falls back to the
      // official English document at read time.
      assert.equal(document.owner, english.owner, `${kind}/${code} owner should fall back to English`);
      assert.equal(document.effectiveDate, english.effectiveDate, `${kind}/${code} dates should fall back to English`);
      // The protective line shown above a translated body is itself
      // translated in these locales.
      const notice = LOCALES[code]['policies.translationNotice'];
      assert.equal(typeof notice, 'string', `${code} is missing policies.translationNotice`);
      assert.notEqual(notice, en['policies.translationNotice'], `${code} protective line is still English`);
    }
    // A locale outside the tranche still falls back to English.
    assert.equal(hasPolicyTranslation(kind, 'de'), false, `${kind}/de should not be registered yet`);
    assert.equal(getPolicyDocument(kind, 'de').translated, false);
  }
});
