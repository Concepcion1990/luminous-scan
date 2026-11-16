/**
 * The full-app translation sweep (Nov 15, 2026) — the owner's
 * escalation: "I need EVERY page on this app to translate."
 *
 * Pins:
 *  - the sweep keys (About / notice / legal chrome / 404 /
 *    stragglers) exist in all 52 locales, with genuinely translated
 *    values in the spot-checked locales;
 *  - the server print PDFs render their labels in the business's
 *    language (server/printLabels.js), with the per-string English
 *    fallback for strings the standard PDF fonts cannot encode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { printLabelsFor, fillLabel, PRINT_LABEL_KEYS } from '../../server/printLabels.js';
import { buildPackingSlipPdf, buildLabelsPdf, buildPoPdf } from '../../server/printPdf.js';

const LOCALE_DIR = new URL('../../src/lib/locales/', import.meta.url);

async function loadLocale(code) {
  const mod = await import(new URL(code + '.js', LOCALE_DIR));
  return mod.default || mod[Object.keys(mod)[0]];
}

const SWEEP_KEYS = [
  'about.eyebrow', 'about.pageTitle', 'about.founderHeading',
  'about.founder.p1', 'about.founder.p2', 'about.founder.p3', 'about.founder.p4',
  'notice.ariaLabel', 'notice.heading', 'notice.intro', 'notice.legalHeading',
  'notice.legalBody', 'notice.acquisitionHeading', 'notice.acquisitionBody',
  'footer.trademarkLine',
  'legalNav.viewPlans', 'legalNav.terms', 'legalNav.subscription', 'legalNav.privacy',
  'legalNav.comparePlans', 'legalNav.backToWelcome', 'legalNav.relatedInfo', 'legalNav.relatedLegal',
  'policies.legalInfoEyebrow', 'policies.billingInfoEyebrow', 'policies.operatedBy',
  'policies.effectiveLine', 'policies.termsAsideTitle', 'policies.privacyAsideTitle',
  'policies.subscriptionAsideTitle', 'policies.termsReviewBefore', 'policies.termsReviewMid',
  'policies.termsReviewAfter', 'policies.privacyReviewBefore', 'policies.privacyReviewMid',
  'policies.privacyReviewAfter',
  'notFound.title', 'notFound.bodyBefore', 'notFound.bodyAfter', 'notFound.adminTitle',
  'notFound.adminBody', 'notFound.goHome',
  'products.colPhoto', 'scan.eyebrow', 'ui.close',
  'productForm.namePlaceholder', 'productForm.categoryPlaceholder', 'productForm.authorPlaceholder',
  'productForm.tagsPlaceholder', 'productForm.dimensionsPlaceholder', 'productForm.warrantyPlaceholder',
  'productForm.variantLabelPlaceholder', 'productForm.variantNamePlaceholder',
  'productForm.variantValuePlaceholder', 'locations.namePlaceholder',
  'import.receiveNotePlaceholder', 'products.bulkTagsPlaceholder',
  'categories.exampleTag', 'categories.exampleSubcategory', 'categories.exampleCategory',
  'import.referencePlaceholderBusiness', 'import.referencePlaceholderEssentials',
  'products.bulkTagExampleBusiness', 'products.bulkTagExampleEssentials',
];

test('the sweep keys exist in all 52 locales (zero locale debt)', async () => {
  const files = readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.js'));
  assert.equal(files.length, 52, 'the app ships 52 locales');
  for (const file of files) {
    const locale = await loadLocale(file.replace(/\.js$/, ''));
    for (const key of SWEEP_KEYS) {
      assert.ok(typeof locale[key] === 'string' && locale[key].length > 0, `${file} is missing ${key}`);
    }
  }
});

test('the founder story is genuinely translated, not copied English', async () => {
  const en = await loadLocale('en');
  for (const code of ['es-MX', 'fr-FR', 'de', 'ja', 'ar', 'pt-BR', 'tg', 'prs', 'jv', 'wuu', 'yue', 'zh-Hant', 'pa-Arab']) {
    const locale = await loadLocale(code);
    assert.notEqual(locale['about.founder.p1'], en['about.founder.p1'], `${code} p1 must be translated`);
    assert.notEqual(locale['notice.acquisitionBody'], en['notice.acquisitionBody'], `${code} notice must be translated`);
    assert.notEqual(locale['notFound.title'], en['notFound.title'], `${code} 404 must be translated`);
  }
  const esMX = await loadLocale('es-MX');
  assert.match(esMX['about.founder.p1'], /fundadora/);
  assert.match(esMX['about.founderHeading'], /Sobre la fundadora/);
});

test('print labels resolve per language, variants inherit their base', () => {
  assert.equal(printLabelsFor('es').packingSlip, 'Nota de empaque');
  assert.equal(printLabelsFor('jv').packingSlip, 'Slip paketan');
  assert.equal(printLabelsFor('es-MX').packingSlip, 'Nota de empaque');
  assert.equal(printLabelsFor('fr-CA').packingSlip, 'Bon de livraison');
  assert.equal(printLabelsFor('en').packingSlip, 'Packing slip');
  assert.equal(printLabelsFor('xx-unknown').packingSlip, 'Packing slip');
  assert.equal(printLabelsFor(undefined).packingSlip, 'Packing slip');
  for (const key of PRINT_LABEL_KEYS) {
    assert.ok(printLabelsFor('de')[key], `de print label ${key} present`);
  }
});

test('print labels fall back per string when the PDF fonts cannot encode them', () => {
  // Chinese labels are genuine in the table, but jsPDF's standard
  // fonts cannot render the script — those strings fall back to
  // English rather than printing garbage; pure-ASCII strings in
  // the same row (SKU line) still resolve.
  const zh = printLabelsFor('zh');
  assert.equal(zh.packingSlip, 'Packing slip');
  assert.equal(zh.skuLine, 'SKU {sku}');
  // Greek is likewise outside WinAnsi.
  assert.equal(printLabelsFor('el').product, 'Product');
  // Spanish diacritics are inside WinAnsi and survive.
  assert.equal(printLabelsFor('es').noCode, 'SIN CÓDIGO');
});

test('server PDFs render in the business language', () => {
  const order = {
    number: 'ORD-7', customer_name: 'Ana', order_date: '2026-11-15',
    lines: [{ product_name: 'Libro', qty: 2 }],
  };
  const esText = buildPackingSlipPdf(order, { name: 'Tienda', language: 'es', currency: 'USD' }).toString('latin1');
  assert.ok(esText.startsWith('%PDF-'));
  assert.ok(esText.includes('Nota de empaque'), 'Spanish packing-slip title');
  assert.ok(esText.includes('Pedido ORD-7'), 'Spanish order line');
  const enText = buildPackingSlipPdf(order, { name: 'Shop', language: 'en', currency: 'USD' }).toString('latin1');
  assert.ok(enText.includes('Packing slip'), 'English stays English');
  assert.ok(enText.includes('Order ORD-7'));

  const labelsText = buildLabelsPdf([{ name: 'Libro' }], { businessName: 'Tienda', language: 'es' }).toString('latin1');
  assert.ok(labelsText.includes('SIN CÓDIGO'), 'Spanish no-code label');

  const po = {
    number: 'PO-9', supplier_name: 'Proveedor SA', order_date: '2026-11-15', status: 'open',
    lines: [{ product_name: 'Libro', qty_ordered: 3, unit_cost: 5 }], subtotal: 15, total: 15,
  };
  const poText = buildPoPdf(po, { name: 'Tienda', language: 'es', currency: 'USD' }).toString('latin1');
  assert.ok(poText.includes('Orden de compra'), 'Spanish PO title');
  assert.ok(poText.includes('Proveedor Proveedor SA'), 'Spanish supplier line');
});

test('fillLabel fills placeholders and leaves unknown ones alone', () => {
  assert.equal(fillLabel('Page {page} of {pages}', { page: 2, pages: 5 }), 'Page 2 of 5');
  assert.equal(fillLabel('Order {number}', {}), 'Order {number}');
});
