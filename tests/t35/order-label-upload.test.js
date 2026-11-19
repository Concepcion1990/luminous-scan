/**
 * T35 — The order form's own shipping-label door (the owner's
 * commission, Nov 18, 2026, made by hand during her final
 * Essentials retest).
 *
 * Beside Carrier / Tracking reference, the customer order form now
 * carries a Shipping label section: an Upload shipping label door,
 * a preview of the attached label in the form, and a Print link
 * under the preview. It is the SAME record the Print Center keeps
 * (order_shipping_labels, migration 025) — one label, two doors:
 * attach here and it shows there; replace or remove in either
 * place and both agree. Same file rules in both doors (PDF/PNG/
 * JPG, under 2 MB, byte-exact, authenticated business route),
 * both plans.
 *
 * On a NEW order the file stages in the form and attaches the
 * moment the order is saved; on an existing order it writes the
 * saved order at once. Either way the owner's ruling holds: the
 * label saves onto the order PERMANENTLY — reopen it later and
 * the label is still there.
 *
 * Three new strings (orders.shippingLabel, orders.uploadLabel,
 * orders.labelStagedNote), genuinely translated in all 52 locales;
 * every other word is the Print Center's own carrier vocabulary,
 * reused. The orders-basics shipping step (step 5) teaches the
 * form's door in all 52.
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
const field = readSrc('src/components/orders/OrderLabelField.jsx');
const panel = readSrc('src/components/print/CarrierLabelPanel.jsx');

test('order form: the label section renders in the form, ungated, beside the carrier area', () => {
  assert.ok(form.includes("import OrderLabelField from '@/components/orders/OrderLabelField'"), 'field imported');
  assert.ok(form.includes("import { useCarrierLabel } from '@/components/print/CarrierLabelPanel'"), 'the Print Center hook is reused — one record, two doors');
  const idx = form.indexOf('<OrderLabelField');
  assert.ok(idx !== -1, 'field rendered');
  assert.ok(idx > form.indexOf("{t('orders.trackingReference')}"), 'section sits after the Carrier/Tracking area');
  assert.ok(idx < form.indexOf("{t('orders.notes')}"), 'section sits before Notes');
  const before = form.slice(Math.max(0, idx - 500), idx);
  assert.ok(!/plan|entitlement|feature/i.test(before), 'no plan gate around the label section — both plans, like the Print Center door');
});

test('order form: a staged label attaches to the new order at save — and a retry never duplicates', () => {
  assert.ok(form.includes('labelFieldRef.current?.hasStaged()'), 'save asks the field for a staged label');
  assert.ok(form.includes('labelFieldRef.current.uploadStaged(savedId)'), 'save attaches the staged label to the saved order');
  assert.ok(form.includes('createdIdRef'), 'the just-created order is remembered');
  const retry = form.slice(form.indexOf('} else if (savedId) {'));
  assert.ok(retry.includes('base44.entities.Order.update(savedId, payload)'), 'a retry updates the same order instead of creating a duplicate');
  assert.ok(form.includes("setError(t('print.carrier.failed'))"), 'an attach failure speaks with the Print Center’s own failure words and keeps the form open');
});

test('label field: the same route, the same rulebook as the Print Center', () => {
  assert.ok(field.includes('/shipping-label'), 'posts to the carrier-label route');
  assert.ok(field.includes('`/api/businesses/${businessId}/orders/${newOrderId}/shipping-label`'), 'the staged attach posts to the very route the Print Center uses');
  assert.ok(field.includes("from '@/components/print/CarrierLabelPanel'"), 'shared constants come from the Print Center panel');
  assert.ok(field.includes('LABEL_MAX_BYTES') && field.includes('LABEL_TYPES'), 'the 2 MB cap and PDF/PNG/JPG rule are the shared ones');
  assert.ok(panel.includes('export const LABEL_MAX_BYTES'), 'the panel exports the shared cap');
  assert.ok(panel.includes('export const LABEL_TYPES'), 'the panel exports the shared types');
  assert.ok(panel.includes('export function savedDate'), 'the panel exports the saved-date formatter both doors use');
});

test('label field: door, preview and a Print link under the preview', () => {
  assert.ok(field.includes("{t('orders.shippingLabel')}"), 'section is headed by the new key');
  assert.ok(field.includes("t('orders.uploadLabel')"), 'the door carries the new upload key');
  assert.ok(field.includes('type="application/pdf"'), 'a PDF label previews in the form');
  assert.ok(field.includes('<img'), 'an image label previews in the form');
  const previewIdx = field.indexOf('preview.type');
  const printIdx = field.indexOf("{t('print.printButton')}");
  assert.ok(printIdx > previewIdx, 'the Print link sits under the preview');
  assert.ok(field.includes('printLabelFile(preview.url, preview.type)'), 'the Print link prints this label');
  assert.ok(field.includes('@page { size: 102mm 152mm; margin: 0; }'), 'an image label prints at its true 4×6, and only the label');
});

test('label field: replace and remove behave like the Print Center — remove asks first', () => {
  assert.ok(field.includes("t('print.carrier.replace')"), 'replace uses the Print Center word');
  assert.ok(field.includes("t('print.carrier.remove')"), 'remove uses the Print Center word');
  assert.ok(field.includes("window.confirm(t('print.carrier.removeConfirm'))"), 'removing a saved label confirms first, like the Print Center');
  assert.ok(field.includes('carrier.remove()'), 'remove goes through the shared hook — the same record');
  assert.ok(field.includes('carrier.upload(file)'), 'on an existing order, upload goes through the shared hook at once');
  assert.ok(field.includes("{t('orders.labelStagedNote')}"), 'a staged label on a new order says plainly it saves with the order');
});

test('the three new keys exist in all 52 locales, genuinely translated', () => {
  assert.equal(SUPPORTED_LOCALES.length, 52);
  assert.equal(en['orders.shippingLabel'], 'Shipping label');
  assert.equal(en['orders.uploadLabel'], 'Upload shipping label');
  assert.equal(en['orders.labelStagedNote'], 'This label will be saved on the order when you save the order.');
  for (const code of SUPPORTED_LOCALES) {
    for (const key of ['orders.shippingLabel', 'orders.uploadLabel', 'orders.labelStagedNote']) {
      const value = LOCALES[code][key];
      assert.ok(typeof value === 'string' && value.length > 0, `${code} carries ${key}`);
      if (!code.startsWith('en')) {
        assert.notEqual(value, en[key], `${code} ${key} is a genuine translation, not the English string`);
      }
    }
  }
});

test('orders-basics still ships 6 steps on both catalogs, ungated — and step 5 teaches the form door', () => {
  for (const [name, catalog] of [['client', CLIENT_LESSONS], ['server', SERVER_LESSONS]]) {
    const lesson = catalog.find((l) => l.id === 'orders-basics');
    assert.ok(lesson, `${name} catalog carries orders-basics`);
    assert.equal(lesson.steps, 6, `${name} orders-basics keeps 6 steps`);
    assert.ok(!lesson.feature, `${name} orders-basics has no feature gate (both plans)`);
  }
  const step5 = en['training.lessons.orders-basics.step5'];
  assert.ok(step5.includes('upload it under Shipping label'), 'en step 5 names the form door');
  assert.ok(step5.includes('stays on the order for good'), 'en step 5 says the label stays on the order');
  assert.ok(step5.includes('scan button beside Tracking reference'), 'the tracking-scan teaching is still there');
});

test('the step-5 form-door sentence is genuinely translated, not an English copy', async () => {
  const dir = new URL('../../src/lib/locales/', import.meta.url);
  const fragments = {
    'es-MX.js': 'Etiqueta de envío',
    'es-ES.js': 'Etiqueta de envío',
    'de.js': 'Versandetikett',
    'fr-FR.js': "Étiquette d'expédition",
    'ja.js': '配送ラベル',
    'zh-Hans.js': '承运商标签',
    'ru.js': 'Этикетка перевозчика',
  };
  for (const [file, fragment] of Object.entries(fragments)) {
    const dict = Object.values(await import(new URL(file, dir)))[0];
    const step = dict['training.lessons.orders-basics.step5'];
    assert.notEqual(step, en['training.lessons.orders-basics.step5'], `${file}: step5 translated`);
    assert.ok(step.includes(fragment), `${file}: step5 teaches the form door in its own words (${fragment})`);
  }
  for (const code of SUPPORTED_LOCALES) {
    const step = LOCALES[code]['training.lessons.orders-basics.step5'];
    assert.ok(typeof step === 'string' && step.length > 100, `${code} step5 carries the full shipping teaching`);
  }
});
