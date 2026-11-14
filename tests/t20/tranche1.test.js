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
 *     literally, or one of the fictional example names);
 *   - a VERIFIED COGNATE (tranche 2, Nov 13, 2026): a short value
 *     whose correct translation is spelled identically in the target
 *     language. Spanish is the first case: Total, Subtotal, Digital,
 *     Roles, Kit, kg, the table-header abbreviation No, and
 *     "{count} roles" (roles is the Spanish plural of rol) are the
 *     same words in Spanish. These keys are pinned per locale in
 *     COGNATE_KEYS below — the exemption names exact keys, verified
 *     one by one, never a pattern, so a genuinely untranslated string
 *     can never hide inside it.
 * English regional variants (en-GB/CA/AU/IN) are adaptations, not
 * translations — most values are identical by design and they are
 * out of scope for the debt census.
 *
 * TRANCHE 2 (Nov 13, 2026): the six Spanish variants — es-MX, es-ES,
 * es-US, es-CU, es-PR, es-VE — retired their debt in the same shape
 * (UI keys + all three policy bodies registered). The locale list
 * below is the union of completed tranches; later tranches append.
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

const TRANCHE_1_LOCALES = [
  'am', 'ar', 'bn', 'bho',
  // Tranche 2 (Nov 13, 2026): the six Spanish variants.
  'es-MX', 'es-ES', 'es-US', 'es-CU', 'es-PR', 'es-VE',
  // Tranche 3 (Nov 13, 2026): French and Portuguese.
  'fr-FR', 'fr-CA', 'pt-BR', 'pt-PT',
  // Tranche 4 (Nov 13, 2026): Chinese Simplified + Traditional,
  // Cantonese and Wu.
  'zh-Hans', 'zh-Hant', 'yue', 'wuu',
  // Tranche 5 (Nov 13, 2026): German, Italian, Japanese.
  'de', 'it', 'ja',
  // Tranche 6 registrations (Nov 13, 2026)
  'ko', 'ru', 'uk',
  // Tranche 7 registrations (Nov 13, 2026)
  'fa', 'prs', 'ur',
  // Tranche 8 registrations (Nov 13, 2026)
  'hi', 'tg', 'tr',
  // Tranche 9 registrations (Nov 13, 2026)
  'gu', 'kn', 'mr',
  // Tranche 10 registrations (Nov 13, 2026)
  'ta', 'te', 'pa-Guru',
  // Tranche 11 registrations (Nov 13, 2026)
  'pa-Arab', 'id', 'ms',
];

// Verified cognates: keys whose correct Spanish value is spelled
// identically to the English (see the census definition above).
// Verified key-by-key for every Spanish variant — the identical set
// was the same 15 keys in all six.
const SPANISH_COGNATE_KEYS = new Set([
  'products.exportNo', 'print.no',
  'productForm.fulfillDigital', 'productForm.unitKg',
  'orders.subtotal', 'orders.total',
  'purchasing.subtotal', 'purchasing.total',
  'reports.total', 'print.subtotal', 'print.total',
  'staff.rolesCount', 'staff.rolesHeading', 'staff.statRoles',
  'bomLib.kindBundleShort',
]);
const FR_FR_COGNATE_KEYS = new Set([
  'dashboard.minReorder', 'importLib.field.description', 'importLib.updateField.description',
  'importLib.updateField.dimensions', 'inventoryLib.movementCorrection', 'locations.limitLabel',
  'locations.typeLabel', 'movements.typeCorrections', 'orders.total',
  'payroll.cash.date', 'payroll.config.customKind', 'payroll.dd.form.date',
  'payroll.dd.form.signature', 'print.total', 'productDetails.descriptionTitle',
  'productDetails.rowDimensions', 'productForm.descriptionLabel', 'productForm.dimensionsLabel',
  'productForm.photosLabel', 'productForm.unitKg', 'products.colActions',
  'products.colCodes', 'products.conditionAcceptable', 'products.photoAlt',
  'purchasing.total', 'reports.total', 'returns.type',
  'rewards.code', 'rewards.slip.code', 'scan.adjustment.correction',
  'scan.destination', 'settings.identity.logoLabel', 'settings.software.application',
  'staffLib.area.stock', 'suppliers.contact', 'training.module.exports',
  'training.module.messaging', 'training.module.scanner', 'workforce.messages.title',
  'workforce.tasks.notes',
]);
const FR_CA_COGNATE_KEYS = new Set([
  'counts.notesLabel', 'dashboard.minReorder', 'importLib.field.description',
  'importLib.receiveField.note', 'importLib.updateField.description', 'importLib.updateField.dimensions',
  'importLib.updateField.notes', 'inventory.noteLabel', 'inventoryLib.movementCorrection',
  'listings.notes', 'locations.limitLabel', 'locations.typeLabel',
  'materials.notes', 'movements.typeCorrections', 'orders.notes',
  'orders.total', 'payroll.cash.date', 'payroll.config.customKind',
  'payroll.dd.form.date', 'payroll.dd.form.signature', 'print.colNotes',
  'print.note', 'print.notes', 'print.total',
  'productDetails.descriptionTitle', 'productDetails.notesTitle', 'productDetails.rowDimensions',
  'productForm.descriptionLabel', 'productForm.dimensionsLabel', 'productForm.notesLabel',
  'productForm.photosLabel', 'productForm.unitKg', 'products.colActions',
  'products.colCodes', 'products.conditionAcceptable', 'products.exportColNotes',
  'products.photoAlt', 'purchasing.note', 'purchasing.total',
  'reports.total', 'returns.notes', 'returns.type',
  'rewards.code', 'rewards.slip.code', 'scan.adjustment.correction',
  'scan.destination', 'settings.identity.logoLabel', 'settings.software.application',
  'staff.memberDialog.notesLabel', 'staffLib.area.stock', 'suppliers.contact',
  'suppliers.notes', 'training.module.messaging', 'workforce.messages.title',
  'workforce.tasks.notes',
]);
const PT_BR_COGNATE_KEYS = new Set([
  'bomLib.kindBundleShort', 'dashboard.skusCount', 'exports.backupJson',
  'listings.status', 'locations.kindVan', 'locations.skusLabel',
  'orders.subtotal', 'orders.total', 'print.colItem',
  'print.status', 'print.subtotal', 'print.total',
  'productDetails.rowStatus', 'productForm.fulfillDigital', 'productForm.statusLabel',
  'productForm.unitKg', 'products.bulkChangeStatus', 'purchasing.status',
  'purchasing.subtotal', 'purchasing.total', 'reports.total',
  'staff.memberDialog.statusLabel', 'training.module.scanner',
]);
const PT_PT_COGNATE_KEYS = new Set([
  'auth.emailLabel', 'bomLib.kindBundleShort', 'dashboard.skusCount',
  'locations.skusLabel', 'orders.subtotal', 'orders.total',
  'print.colItem', 'print.subtotal', 'print.total',
  'productForm.fulfillDigital', 'productForm.unitKg', 'purchasing.subtotal',
  'purchasing.total', 'reports.total', 'staffLib.area.stock',
]);
const DE_COGNATE_KEYS = new Set([
  'alerts.nameLabel', 'bomLib.kindBundle', 'categories.nameLabel',
  'dashboard.skusCount', 'import.colName', 'import.problemColProblem',
  'importLib.field.barcode', 'inventory.notePlaceholder', 'layout.scanCodes',
  'listings.status', 'locations.nameLabel', 'locations.optionalPlaceholder',
  'locations.skusLabel', 'nav.import', 'orders.customerNamePlaceholder',
  'payroll.bonus', 'payroll.config.customName', 'print.barcodeLabel',
  'print.status', 'print.templateBarcode', 'productDetails.codeBarcode',
  'productDetails.rowStatus', 'productForm.barcodeLabel', 'productForm.fulfillDigital',
  'productForm.statusLabel', 'productForm.unitKg', 'products.colCodes',
  'products.exportColBarcode', 'products.exportColName', 'products.sortCodes',
  'purchasing.status', 'rewards.code', 'rewards.slip.code',
  'settings.identity.logoLabel', 'settings.switcher.taglinePlaceholder', 'staff.eyebrow',
  'staff.member.administrator', 'staff.memberDialog.statusLabel', 'staff.teamHeading',
  'suppliers.website', 'training.module.scanner',
]);
const IT_COGNATE_KEYS = new Set([
  'auth.emailLabel', 'auth.passwordLabel', 'bomLib.kindBundleShort',
  'dashboard.minReorder', 'exports.backupJson', 'orders.email',
  'payroll.bonus', 'print.no', 'productForm.unitKg',
  'products.exportNo', 'reports.fieldReport', 'settings.identity.logoLabel',
  'staff.memberDialog.emailLabel', 'suppliers.email', 'training.module.scanner',
]);
const JA_COGNATE_KEYS = new Set([
  'productForm.unitKg',
]);
const KO_COGNATE_KEYS = new Set([
  'productForm.unitKg',
]);
const FA_COGNATE_KEYS = new Set([
  'productForm.unitKg',
]);
const PRS_COGNATE_KEYS = new Set([
  'productForm.unitKg',
]);
const UR_COGNATE_KEYS = new Set([
  'businessLib.dateFormat.dMmmYyyy', 'businessLib.dateFormat.mmmDyyyy', 'dashboard.skusCount',
  'layout.scanCodes', 'locations.skusLabel', 'productForm.unitKg',
]);
const TR_COGNATE_KEYS = new Set([
  'bomLib.kindBundleShort', 'dashboard.minReorder', 'inventoryLib.movementTransfer',
  'print.refSuffix', 'productForm.unitKg', 'scan.action.transfer',
  'settings.identity.logoLabel',
]);
const KN_COGNATE_KEYS = new Set([
  'productForm.unitKg',
]);
const MR_COGNATE_KEYS = new Set([
  'productForm.unitKg',
]);
const TA_COGNATE_KEYS = new Set([
  'productForm.unitKg',
]);
const TE_COGNATE_KEYS = new Set([
  'businessLib.dateFormat.dMmmYyyy', 'businessLib.dateFormat.mmmDyyyy', 'payroll.dd.checking',
  'payroll.dd.savings', 'productForm.unitKg',
]);
const PA_GURU_COGNATE_KEYS = new Set([
  'locations.skusLabel', 'productForm.unitKg',
]);
const PA_ARAB_COGNATE_KEYS = new Set([
  'businessLib.dateFormat.dMmmYyyy', 'businessLib.dateFormat.mmmDyyyy', 'layout.scanCodes',
  'productForm.unitKg',
]);
const ID_COGNATE_KEYS = new Set([
  'dashboard.minReorder', 'exports.eyebrow', 'import.eyebrow',
  'listings.status', 'orders.subtotal', 'payroll.bonus',
  'print.status', 'print.subtotal', 'productDetails.rowSerial',
  'productDetails.rowStatus', 'productForm.customLabelPlaceholder', 'productForm.statusLabel',
  'productForm.unitKg', 'products.bulkChangeStatus', 'purchasing.status',
  'purchasing.subtotal', 'staff.member.administrator', 'staff.memberDialog.statusLabel',
]);
const MS_COGNATE_KEYS = new Set([
  'alerts.editRule', 'bomLib.kindBundleShort', 'businessLib.brandColor.plum',
  'businessLib.dateFormat.dMmmYyyy', 'categories.editAria', 'categories.kindTag',
  'dashboard.minReorder', 'exports.eyebrow', 'import.eyebrow',
  'listings.editAria', 'listings.status', 'locations.editAria',
  'locations.kindVan', 'materials.edit', 'nav.import',
  'orders.edit', 'orders.editTitle', 'payroll.bonus',
  'print.colItem', 'print.factUnit', 'print.status',
  'productDetails.rowStatus', 'productDetails.rowUnit', 'productForm.customLabelPlaceholder',
  'productForm.fulfillDigital', 'productForm.statusLabel', 'productForm.unitKg',
  'products.bulkChangeStatus', 'products.editAria', 'products.exportColUnit',
  'purchasing.edit', 'purchasing.editTitle', 'purchasing.status',
  'returns.edit', 'returns.editTitle', 'settings.identity.logoLabel',
  'staff.member.edit', 'staff.memberDialog.statusLabel', 'staff.roleCard.edit',
  'staffLib.importOnly',
]);
const COGNATE_KEYS = {
  'es-MX': SPANISH_COGNATE_KEYS,
  'es-ES': SPANISH_COGNATE_KEYS,
  'es-US': SPANISH_COGNATE_KEYS,
  'es-CU': SPANISH_COGNATE_KEYS,
  'es-PR': SPANISH_COGNATE_KEYS,
  'es-VE': SPANISH_COGNATE_KEYS,
  'fr-FR': FR_FR_COGNATE_KEYS,
  'fr-CA': FR_CA_COGNATE_KEYS,
  'pt-BR': PT_BR_COGNATE_KEYS,
  'pt-PT': PT_PT_COGNATE_KEYS,
  'de': DE_COGNATE_KEYS,
  'it': IT_COGNATE_KEYS,
  'ja': JA_COGNATE_KEYS,

  'ko': KO_COGNATE_KEYS,

  'fa': FA_COGNATE_KEYS,
  'prs': PRS_COGNATE_KEYS,
  'ur': UR_COGNATE_KEYS,

  'tr': TR_COGNATE_KEYS,

  'kn': KN_COGNATE_KEYS,
  'mr': MR_COGNATE_KEYS,

  'ta': TA_COGNATE_KEYS,
  'te': TE_COGNATE_KEYS,
  'pa-Guru': PA_GURU_COGNATE_KEYS,

  'pa-Arab': PA_ARAB_COGNATE_KEYS,
  'id': ID_COGNATE_KEYS,
  'ms': MS_COGNATE_KEYS,
};

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
  const cognates = COGNATE_KEYS[code] || new Set();
  return Object.keys(en).filter(
    (key) => locale[key] === en[key] && !legitIdentical(key, en[key]) && !cognates.has(key),
  );
}

test('completed-tranche locales carry zero translation debt', () => {
  for (const code of TRANCHE_1_LOCALES) {
    const debt = debtKeys(code);
    assert.deepEqual(
      debt,
      [],
      `${code} still has ${debt.length} untranslated keys: ${debt.slice(0, 10).join(', ')}`,
    );
  }
});

test('completed-tranche locales keep keyset parity and placeholder parity with English', () => {
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

test('completed-tranche policy bodies are registered and served, merged over English', () => {
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
    // A locale outside the completed tranches still falls back to English.
    assert.equal(hasPolicyTranslation(kind, 'th'), false, `${kind}/th should not be registered yet`);
    assert.equal(getPolicyDocument(kind, 'th').translated, false);
  }
});
