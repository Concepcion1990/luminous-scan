/**
 * Leftovers sweep, item 3 — server report labels (Nov 15, 2026):
 * report titles, value labels, group labels, group fallbacks and
 * movement-type names localize by the business's language
 * (42 strings per base language).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { REPORT_LABELS, REPORT_LABEL_KEYS, reportLabelsFor } from '../../server/reportLabels.js';
import { buildServerReport } from '../../server/reports.js';

const LOCALE_DIR = new URL('../../src/lib/locales/', import.meta.url);
const LOCALES = readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.js')).map((f) => f.replace('.js', ''));

test('item 3: report labels cover every base language of the 52 locales', () => {
  assert.equal(REPORT_LABEL_KEYS.length, 42);
  const bases = new Set(LOCALES.map((l) => l.split('-')[0]));
  for (const base of bases) {
    assert.ok(REPORT_LABELS[base], `missing report labels for base ${base}`);
    assert.deepEqual(Object.keys(REPORT_LABELS[base]).sort(), [...REPORT_LABEL_KEYS].sort(), base);
  }
});

test('item 3: buildServerReport localizes titles, groups, fallbacks and missing labels', () => {
  const source = {
    products: [{ id: 'p1', name: 'Cuaderno', sku: 'NB-1', category: '', cost: null, price: 10, status: 'active' }],
    levels: [{ product_id: 'p1', location_id: 'l1', quantity: 5 }],
    locations: [{ id: 'l1', name: 'Tienda', parent_id: null }],
    movements: [], movementsCapped: false,
  };
  const en = buildServerReport({ reportId: 'stock', groupBy: 'category', source });
  assert.equal(en.report.label, 'Stock on hand');
  assert.equal(en.rows[0].label, 'Uncategorized');
  const es = buildServerReport({ reportId: 'stock', groupBy: 'category', source, language: 'es-MX' });
  assert.equal(es.report.label, 'Existencias a mano');
  assert.equal(es.groupLabel, 'Categoría');
  assert.equal(es.valueLabel, 'Valor al costo');
  assert.equal(es.rows[0].label, 'Sin categoría');
  assert.equal(es.missing.label, 'costo');
  const ar = buildServerReport({ reportId: 'stock', groupBy: 'category', source, language: 'ar' });
  assert.equal(ar.report.label, reportLabelsFor('ar')['title.stock']);
  assert.notEqual(ar.report.label, 'Stock on hand');
});

