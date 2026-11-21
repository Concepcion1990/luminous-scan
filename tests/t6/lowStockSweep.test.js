/**
 * The low-stock sweep off Essentials (owner rulings, Nov 20, 2026,
 * ~12:08 AM / ~01:12 AM / ~01:14 AM MST): EVERYTHING connected to
 * low stock comes off Essentials — the Reorder at field, the LOW
 * markers, the Overview traces, and the phrase "At or below reorder
 * point" wherever it rendered there. The Overview "Needs attention"
 * box does not belong on Essentials at all; on Business it is where
 * low-stock alerts show. Stored reorder_point VALUES are never
 * deleted or altered — saved, unseen on Essentials, revealed
 * working on Business. Business does not change anywhere.
 *
 * The gate is the codebase's Business-only pattern: the loaded
 * entitlement check `!entitlementLoading && can('alerts')` (feature
 * 'alerts' is Business-only in planFeatures). While the plan is
 * still loading the surfaces stay hidden rather than flashing.
 *
 * The US-spelling fixes ride the same build: base `en` only —
 * fulfil→fulfill, colour→color ×3, labelled→labeled,
 * recognise→recognize (incl. its "recognises" forms in lessons).
 * The other four Englishes keep their regional spellings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { importFieldsForPlan, IMPORT_FIELDS } from '../../src/lib/csvImport.js';
import { en } from '../../src/lib/locales/en.js';
import { enGB } from '../../src/lib/locales/en-GB.js';

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('Overview: the Needs-attention box and per-location low counts are Business-only', () => {
  const dashboard = src('src/pages/Dashboard.jsx');
  assert.match(dashboard, /<LocationStockPanel perLocation=\{stats\.perLocation\} showLow=\{showAlerts\} \/>/);
  assert.doesNotMatch(dashboard, /<AttentionPanel low=\{\[\]\}/, 'no forced-empty attention render remains');
  const panel = src('src/components/dashboard/LocationStockPanel.jsx');
  assert.match(panel, /showLow = false/);
  assert.match(panel, /\{showLow && row\.low > 0 &&/);
});

test('Products: LOW badge follows the alert tick; reorder values stay plan-gated and visible', () => {
  const page = src('src/pages/Products.jsx');
  // Since the low-stock ticks (Nov 20, 2026): the reorder VALUES
  // (column, sort, expanded line) follow the plan alone and stay
  // visible to everyone on Business; only the LOW badge is an
  // alert surface, so it alone takes the per-person tick.
  assert.match(page, /const showReorderValues = !entitlementLoading && canPlan\('alerts'\);/);
  assert.match(page, /const showAlerts = showReorderValues && can\('alerts\.view'\);/);
  assert.match(page, /\{showAlerts && isLow && <span[^>]*>\{t\('products\.lowBadge'\)\}<\/span>\}/);
  assert.match(page, /\{showReorderValues && \(\s*<span className="numeric hidden text-right text-xs text-muted-foreground xl:block">\s*\{product\.reorder_point \|\| 0\}/);
  assert.match(page, /\.\.\.\(showReorderValues \? \[\{ value: 'reorder', label: t\('products\.sortReorder'\) \}\] : \[\]\),/);
  assert.match(page, /\{showReorderValues && \(\s*<SortHeader\s+label=\{t\('products\.colReorder'\)\}/);
  // The expanded-row line itself survives (Business renders it) —
  // it is the render that is gated, not the string.
  assert.match(page, /t\('products\.reorderLine', \{/);
});

test('Inventory: the Low stat card (with the reorder-point phrase) is Business-only', () => {
  const page = src('src/pages/Inventory.jsx');
  assert.match(page, /const showAlerts = !entitlementLoading && canPlan\('alerts'\) && can\('alerts\.view'\);/);
  assert.match(page, /\{showAlerts && \(\s*<StatCard label=\{t\('inventory\.statLow'\)\} value=\{low\} tone=\{low \? 'warn' : 'default'\} hint=\{t\('inventory\.lowHint'\)\} \/>/);
  assert.match(page, /showReorder=\{showAlerts\}/);
  const row = src('src/components/inventory/InventoryRow.jsx');
  assert.match(row, /showReorder = false/);
  assert.match(row, /const atReorder = showReorder && \(product\.reorder_point \|\| 0\) > 0 && total <= product\.reorder_point;/);
});

test('Categories and Locations: low counts and the LOW stat are Business-only', () => {
  const categories = src('src/pages/InventoryCategories.jsx');
  assert.match(categories, /const showLow = !entitlementLoading && can\('alerts'\) && canStaff\('alerts\.view'\);/);
  assert.match(categories, /\{showLow && group\.low \? t\('inventory\.groupLowSuffix'/);
  assert.match(categories, /\{showLow && low \? t\('inventory\.reorderLabel'/);
  const locations = src('src/pages/Locations.jsx');
  assert.match(locations, /const showAlerts = !entitlementLoading && canPlan\('alerts'\) && can\('alerts\.view'\);/);
  assert.match(locations, /showLow=\{showAlerts\}/);
  const card = src('src/components/locations/LocationTreeCard.jsx');
  assert.match(card, /showLow = false/);
  assert.match(card, /\{showLow && \(\s*<div>\s*<p[^>]*>\{t\('locations\.lowLabel'\)\}<\/p>/);
});

test('Scan: the amber at/below-reorder coloring is Business-only', () => {
  const scan = src('src/pages/Scan.jsx');
  assert.match(scan, /const showLow = !entitlementLoading && canPlan\('alerts'\) && can\('alerts\.view'\);/);
  assert.match(scan, /const isLow = showLow && product\.reorder_point > 0 && q <= product\.reorder_point;/);
});

test('Product form: the Reorder at field hides off Business; the stored value round-trips untouched', () => {
  const form = src('src/components/products/ProductFormDialog.jsx');
  assert.match(form, /const canAlerts = can\('alerts'\);/);
  assert.match(form, /\{canAlerts && \(\s*<div className="grid gap-2">\s*<Label htmlFor="reorder">/);
  // The save payload still writes the form's value back on every
  // plan — hiding the field never zeroes or drops a stored point.
  assert.match(form, /reorder_point: Number\(form\.reorder_point\) \|\| 0,/);
  // The owner's one approved invisibility exception stays: the
  // inline clearance note still renders on both plans.
  assert.match(form, /t\('pricing\.clearanceHint'\)/);
});

test('Product details and Bulk edit: reorder displays are Business-only', () => {
  const details = src('src/components/products/ProductDetailsDialog.jsx');
  assert.match(details, /const canAlerts = can\('alerts'\);/);
  assert.match(details, /\{canAlerts && \(\s*<div>\s*<p[^>]*>\{t\('productDetails\.reorderLabel'\)\}<\/p>/);
  assert.match(details, /canAlerts && product\.reorder_point/);
  const bulk = src('src/components/products/BulkEditDialog.jsx');
  assert.match(bulk, /\{planKey === 'business' && \(\s*<div className="grid gap-2">\s*<Label htmlFor="bulk-reorder">/);
});

test('Import: the reorder target is offered, templated and mapped on Business only', () => {
  // Behavioral: the plan-filtered field lists.
  assert.ok(IMPORT_FIELDS.some((field) => field.key === 'reorder_point'), 'the full list keeps the field');
  assert.ok(importFieldsForPlan('business').some((field) => field.key === 'reorder_point'));
  assert.ok(!importFieldsForPlan('essentials').some((field) => field.key === 'reorder_point'));
  assert.ok(!importFieldsForPlan('mobile').some((field) => field.key === 'reorder_point'));
  // Create workbench: filtered fields drive the mapper + templates;
  // guessed/restored mappings to reorder_point drop to Ignore.
  const create = src('src/components/import/ImportWorkbench.jsx');
  assert.match(create, /const visibleFields = importFieldsForPlan\(planKey\);/);
  assert.match(create, /fields=\{visibleFields\}/);
  assert.match(create, /entries\.map\(\(field\) => \(field === 'reorder_point' \? '' : field\)\)/);
  // Update mode: same treatment.
  const modes = src('src/lib/importModes.js');
  assert.match(modes, /export function updateFieldsForPlan\(planKey\)/);
  assert.match(modes, /UPDATE_FIELDS\.filter\(\(field\) => field\.key !== 'reorder_point'\)/);
  const update = src('src/components/import/UpdateWorkbench.jsx');
  assert.match(update, /const visibleFields = updateFieldsForPlan\(planKey\);/);
  assert.match(update, /fields=\{visibleFields\}/);
});

test('Stored reorder points are never stripped: the server keeps the field on every plan', () => {
  const entities = src('server/entities.js');
  assert.match(entities, /numeric: \['cost', 'price', 'reorder_point', 'clearance_price', 'sale_price'\]/);
  const strip = entities.slice(entities.indexOf('function stripPricing'), entities.indexOf('function stripPricing') + 700);
  assert.doesNotMatch(strip, /reorder_point/, 'plan shaping never touches reorder_point');
  // The low computation itself stays — Business surfaces feed on it.
  const inventory = src('src/lib/inventory.js');
  assert.match(inventory, /\(level\.quantity \|\| 0\) > product\.reorder_point\) return null;/);
});

test('US spellings: base en only; the other Englishes keep theirs', () => {
  assert.equal(en['dashboard.ordersToFulfil'], 'Orders to fulfill');
  assert.match(en['alerts.nameRequired'], /recognize/);
  assert.doesNotMatch(en['alerts.nameRequired'], /recognise/);
  assert.match(en['productForm.variantOptionsHint'], /color/);
  assert.doesNotMatch(en['productForm.variantOptionsHint'], /colour/);
  assert.match(en['exports.subtitleRest'], /labeled/);
  assert.doesNotMatch(en['exports.subtitleRest'], /labelled/);
  assert.match(en['training.lessons.owner-white-label.step1'], /brand color/);
  assert.match(en['training.lessons.owner-white-label.step2'], /logo and color/);
  // en-GB is untouched: its regional spellings stand.
  assert.equal(enGB['dashboard.ordersToFulfil'], 'Orders to fulfil');
  assert.match(enGB['productForm.variantOptionsHint'], /colour/);
});
