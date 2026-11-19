/**
 * T35 — Scan-to-fill for the order form's Tracking reference
 * (the owner's commission, Nov 18, 2026, made by hand during her
 * final Essentials retest).
 *
 * Beside Tracking reference on the customer order form sits a scan
 * button: scan the barcode on the 4×6 carrier label and the
 * tracking number drops straight into the field — USPS numbers run
 * ~30 digits and typing them breeds errors. The pattern is the
 * product form's proven in-form scanner (Nov 14, 2026): an overlay
 * INSIDE the dialog, the first capture latched, the decoded text
 * (trimmed) REPLACING the field's contents, focus back to the
 * field, and Save as the only write. One dialog serves both the
 * new-order and edit-order forms, so both carry the button; orders
 * are a both-plans surface, so nothing is plan-gated.
 *
 * One new string (orders.scanTracking, the button's aria-label),
 * genuinely translated in all 52 locales; the orders-basics
 * lesson's shipping step (step 5) teaches the scan in all 52.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, SUPPORTED_LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const form = readSrc('src/components/orders/OrderFormDialog.jsx');

test('order form: the scan button sits beside Tracking reference, product-form pattern', () => {
  assert.ok(form.includes("import BarcodeScanner from '@/components/scan/BarcodeScanner'"), 'scanner imported');
  assert.ok(form.includes('ScanBarcode'), 'scan icon imported');
  // The tracking input and its button share one flex row, exactly
  // like the product form's code fields.
  const labelIdx = form.indexOf("{t('orders.trackingReference')}");
  assert.ok(labelIdx !== -1, 'tracking label present');
  const row = form.slice(labelIdx, labelIdx + 900);
  assert.ok(row.includes('id="tracking_ref"'), 'tracking input carries its id');
  assert.ok(row.includes("aria-label={t('orders.scanTracking')}"), 'button labelled by the new key');
  assert.ok(row.includes('onClick={openTrackingScanner}'), 'button opens the scanner');
  assert.ok(row.includes('<ScanBarcode className="h-4 w-4" />'), 'button carries the scan icon');
});

test('order form: the scanner overlay lives inside the dialog and Cancel uses the orders key', () => {
  assert.ok(form.includes('{trackingScanOpen && ('), 'overlay gated on its open state');
  assert.ok(form.includes('<BarcodeScanner onDetect={handleTrackingScan} />'), 'overlay renders the scanner');
  const overlay = form.slice(form.indexOf('{trackingScanOpen && ('));
  assert.ok(overlay.includes("onClick={() => setTrackingScanOpen(false)}"), 'overlay cancel closes it');
  assert.ok(overlay.includes("{t('orders.cancel')}"), 'overlay cancel label is the orders cancel key');
});

test('order form: a capture replaces the field, trimmed — and never saves', () => {
  const start = form.indexOf('const handleTrackingScan');
  assert.ok(start !== -1, 'handler exists');
  const body = form.slice(start, form.indexOf('};', start));
  assert.ok(body.includes("String(raw || '').trim()"), 'decoded text is trimmed');
  assert.ok(body.includes('tracking_ref: value'), 'the field is set to the scanned value');
  assert.ok(body.includes('trackingScanHandledRef.current = true'), 'first capture is latched');
  assert.ok(body.includes("document.getElementById('tracking_ref')?.focus()"), 'focus returns to the field');
  assert.ok(!body.includes('base44'), 'handler talks to no API');
  assert.ok(!body.includes('save'), 'handler never saves — Save stays the only write');
});

test('order form: one dialog serves create and edit, so the button covers both', () => {
  assert.ok(form.includes('base44.entities.Order.create'), 'create path present');
  assert.ok(form.includes('base44.entities.Order.update'), 'edit path present');
  // The button is rendered unconditionally — no plan or mode gate.
  const btnIdx = form.indexOf("aria-label={t('orders.scanTracking')}");
  const before = form.slice(Math.max(0, btnIdx - 400), btnIdx);
  assert.ok(!/plan|entitlement|feature/i.test(before), 'no plan gate around the scan button');
});

test('orders.scanTracking exists in all 52 locales, genuinely translated', () => {
  assert.equal(SUPPORTED_LOCALES.length, 52);
  assert.equal(en['orders.scanTracking'], 'Scan tracking number');
  for (const code of SUPPORTED_LOCALES) {
    const value = LOCALES[code]['orders.scanTracking'];
    assert.ok(typeof value === 'string' && value.length > 0, `${code} carries orders.scanTracking`);
    if (!code.startsWith('en')) {
      assert.notEqual(value, en['orders.scanTracking'], `${code} is a genuine translation, not the English string`);
    }
  }
});

test('orders-basics still ships 6 steps on both catalogs, ungated — and step 5 teaches the scan', () => {
  for (const [name, catalog] of [['client', CLIENT_LESSONS], ['server', SERVER_LESSONS]]) {
    const lesson = catalog.find((l) => l.id === 'orders-basics');
    assert.ok(lesson, `${name} catalog carries orders-basics`);
    assert.equal(lesson.steps, 6, `${name} orders-basics keeps 6 steps`);
    assert.ok(!lesson.feature, `${name} orders-basics has no feature gate (both plans)`);
  }
  const step5 = en['training.lessons.orders-basics.step5'];
  assert.ok(step5.includes('scan button beside Tracking reference'), 'en step 5 names the button and the field');
  assert.ok(step5.includes('fills itself in'), 'en step 5 says the number fills itself in');
});

test('the step-5 teaching sentence is genuinely translated, not an English copy', async () => {
  const dir = new URL('../../src/lib/locales/', import.meta.url);
  const fragments = {
    'es-MX.js': 'rastreo',
    'es-ES.js': 'seguimiento',
    'de.js': 'Sendungsnummer',
    'fr-FR.js': 'suivi',
    'ja.js': '追跡',
    'zh-Hans.js': '单号',
    'ru.js': 'отслеживания',
  };
  for (const [file, fragment] of Object.entries(fragments)) {
    const dict = Object.values(await import(new URL(file, dir)))[0];
    const step = dict['training.lessons.orders-basics.step5'];
    assert.notEqual(step, en['training.lessons.orders-basics.step5'], `${file}: step5 translated`);
    assert.ok(step.includes(fragment), `${file}: step5 teaches the scan in its own words (${fragment})`);
    // A fixed floor, not a margin off the English length: CJK
    // scripts say the same thing in far fewer characters, and the
    // English step has since grown a second teaching sentence
    // (the label-upload door, Nov 18, 2026) — the fragment checks
    // above are what pin THIS build's sentence.
    assert.ok(step.length > 100, `${file}: step5 carries the appended sentence`);
  }
  // Every locale's step 5 grew the teaching sentence: none is the
  // bare pre-scan text (each ends with its own final sentence).
  for (const code of SUPPORTED_LOCALES) {
    const step = LOCALES[code]['training.lessons.orders-basics.step5'];
    assert.ok(typeof step === 'string' && step.length > 100, `${code} step5 carries the full shipping teaching`);
  }
});
