/**
 * Leftovers sweep, item 4 — embedded PDF fonts (Nov 15, 2026):
 * non-Latin labels print in the business's language (Arabic shaped
 * + visual order, CJK, Hangul, Cyrillic, Thai...); Indic LABELS
 * keep the per-string English fallback (jsPDF has no shaping
 * engine), while Indic DATA draws in the embedded font.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printLabelsFor } from '../../server/printLabels.js';
import {
  embeddedFontFor, isPrintRenderable, shapeArabicText, scriptOfCodepoint,
} from '../../server/printFonts.js';
import { buildLabelsPdf, buildPoPdf, buildReportPdf } from '../../server/printPdf.js';
import { buildServerReport } from '../../server/reports.js';

test('item 4: script routing and renderability', () => {
  assert.equal(embeddedFontFor('中文笔记本'), 'cjk');
  assert.equal(embeddedFontFor('한국어 라벨'), 'hangul');
  assert.equal(embeddedFontFor('Этикетки'), 'base');
  assert.equal(embeddedFontFor('ملصقات'), 'arabic');
  assert.equal(embeddedFontFor('ป้าย'), 'thai');
  assert.equal(embeddedFontFor('Plain label'), null);
  assert.equal(scriptOfCodepoint(0x0627), 'arabic');
  // Labels: Arabic/CJK/Cyrillic/Thai render; Indic labels fall back.
  assert.equal(isPrintRenderable(printLabelsFor('ar').packingSlip), true);
  assert.equal(isPrintRenderable(printLabelsFor('zh-Hans').packingSlip), true);
  assert.equal(isPrintRenderable(printLabelsFor('ru').packingSlip), true);
  assert.equal(printLabelsFor('hi').packingSlip, 'Packing slip');
  // Data: an Indic product name still draws in its embedded font.
  assert.equal(isPrintRenderable('हिंदी नोटबुक', { forLabel: false }), true);
  assert.equal(embeddedFontFor('हिंदी नोटबुक'), 'devanagari');
});

test('item 4: the Arabic shaper joins letters and orders runs', () => {
  const shaped = shapeArabicText('أمر شراء');
  // Presentation forms, visual order: ء ا ر ش (شراء) then ر م أ (أمر).
  assert.ok(shaped.includes('\uFEA1') || shaped.includes('\uFEB7') || shaped.includes('\uFEB5'), 'initial/medial forms present');
  assert.ok(!shaped.includes('شراء'), 'logical-order Arabic must not survive shaping');
  const withDate = shapeArabicText('تم الطلب في 2026-11-15');
  assert.ok(withDate.includes('2026-11-15'), 'a date stays one LTR phrase');
  const withMoney = shapeArabicText('المجموع الفرعي 1,234.50 US$');
  assert.ok(withMoney.includes('1,234.50 US$'), 'money stays one LTR phrase');
});

test('item 4: PDFs render Arabic and Chinese labels, Spanish control intact', () => {
  const items = [{ name: 'دفتر ملاحظات', price: 10, sku: 'NB-1', barcode: '123456789012' }];
  for (const lang of ['ar', 'zh-Hans', 'es-MX']) {
    const pdf = buildLabelsPdf(items, { businessName: 'Tienda', language: lang });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 20000, `${lang} labels pdf suspiciously small (${pdf.length})`);
  }
  const arPdf = buildLabelsPdf(items, { businessName: 'Tienda', language: 'ar' });
  assert.ok(arPdf.includes(Buffer.from('print-arabic')), 'Arabic font embedded');
  const zhPdf = buildLabelsPdf(items, { businessName: 'Tienda', language: 'zh-Hans' });
  assert.ok(zhPdf.includes(Buffer.from('print-cjk')), 'CJK font embedded');
  const esPdf = buildLabelsPdf([{ name: 'Cuaderno', price: 10, sku: 'NB-1', barcode: '123456789012' }], { businessName: 'Tienda', language: 'es-MX' });
  assert.ok(!esPdf.includes(Buffer.from('print-arabic')), 'no Arabic font in a Spanish document');
  const po = buildPoPdf(
    { number: 'PO-1', supplier_name: 'مورد', order_date: '2026-11-15', status: 'ordered', lines: [{ product_name: 'دفتر', qty_ordered: 2, unit_cost: 5 }], subtotal: 10, total: 10 },
    { name: 'متجر', language: 'ar', currency: 'USD' },
  );
  assert.equal(po.subarray(0, 5).toString(), '%PDF-');
  const report = buildServerReport({
    reportId: 'stock', groupBy: 'location', language: 'ar',
    source: { products: [], levels: [], locations: [], movements: [], movementsCapped: false },
  });
  const reportPdf = buildReportPdf(report, { name: 'متجر', language: 'ar', currency: 'USD' });
  assert.equal(reportPdf.subarray(0, 5).toString(), '%PDF-');
});

