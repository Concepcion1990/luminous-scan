// Extension 3, wave 1 (Nov 15, 2026): lesson visuals are the
// app's OWN pages rendered live in an embed frame — never a
// drawing, never a screenshot file. Pins: the wave-1 lessons
// carry one visual slot per step; every spec names a real app
// route; the embed trim exists (no tab bar inside the frame,
// no service worker registered in a frame); StepVisual rings
// the target and stays inert; Training renders it per step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRAINING_LESSONS } from '../../src/lib/trainingCatalog.js';

const WAVE1 = [
  'welcome-basics', 'owner-setup',
  'scanner-lookup', 'scanner-website-qr', 'scanner-shelf-counts',
  'scanner-receiving', 'scanner-move-stock', 'scanner-name-lookup',
  'scanner-damaged', 'products-find-edit', 'owner-pricing',
  'orders-basics', 'owner-tax-rate',
];
const ROUTES = new Set([
  '/', '/scan', '/products', '/orders', '/settings', '/locations',
  '/staff', '/counts', '/movements', '/plans',
]);

test('wave-1 lessons carry exactly one visual slot per step', () => {
  for (const id of WAVE1) {
    const lesson = TRAINING_LESSONS.find((l) => l.id === id);
    assert.ok(lesson, `${id} exists`);
    assert.ok(Array.isArray(lesson.visuals), `${id} carries visuals`);
    assert.equal(lesson.visuals.length, lesson.steps, `${id}: one slot per step`);
    for (const visual of lesson.visuals) {
      if (visual === null) continue;
      assert.ok(ROUTES.has(visual.route), `${id}: ${visual.route} is a real route`);
      if (visual.target) assert.match(visual.target, /^\[data-tour="|^#/);
    }
  }
});

test('every data-tour target named by a visual exists in the app', () => {
  const sources = [
    'src/components/Layout.jsx', 'src/pages/Dashboard.jsx',
    'src/pages/Scan.jsx', 'src/components/scan/ScanProductList.jsx',
    'src/pages/Products.jsx', 'src/pages/Orders.jsx',
    'src/pages/Locations.jsx', 'src/pages/Staff.jsx',
    'src/pages/Counts.jsx', 'src/pages/Movements.jsx',
    'src/components/business/DetailsCard.jsx',
    'src/components/business/IdentityCard.jsx',
  ].map((f) => readFileSync(f, 'utf8')).join('\n');
  const named = new Set();
  for (const lesson of TRAINING_LESSONS) {
    for (const visual of lesson.visuals || []) {
      const m = visual?.target?.match(/data-tour="([a-z-]+)"/);
      if (m) named.add(m[1]);
      if (visual?.target === '#business-tax-rate') assert.match(sources, /id="business-tax-rate"/);
      if (visual?.target === '#business-name') assert.match(sources, /id="business-name"/);
    }
  }
  assert.ok(named.size >= 12, 'a real spread of targets');
  for (const name of named) {
    assert.ok(sources.includes(`data-tour="${name}"`), `target ${name} is rendered somewhere`);
  }
});

test('the embed trim: frames render the page without the tab bar or a worker', () => {
  const embed = readFileSync('src/lib/embedMode.js', 'utf8');
  assert.match(embed, /embed.*visual|visual.*embed/);
  assert.match(embed, /sessionStorage/);
  const layout = readFileSync('src/components/Layout.jsx', 'utf8');
  assert.match(layout, /isEmbedVisual\(\)/);
  assert.match(layout, /\{!embedVisual && \(/);
  const main = readFileSync('src/main.jsx', 'utf8');
  assert.match(main, /URLSearchParams\(window\.location\.search\)\.has\('embed'\)/);
});

test('StepVisual renders the live page inert, rings the target, mounts lazily', () => {
  const visual = readFileSync('src/components/training/StepVisual.jsx', 'utf8');
  assert.match(visual, /visualUrl\(visual\.route\)/);
  assert.match(visual, /pointer-events-none/);
  assert.match(visual, /IntersectionObserver/);
  assert.match(visual, /data-visual-ring/);
  assert.match(visual, /scrollIntoView/);
  const training = readFileSync('src/pages/Training.jsx', 'utf8');
  assert.match(training, /lesson\.visuals\?\.\[i\]/);
  assert.match(training, /<StepVisual visual=\{lesson\.visuals\[i\]\}/);
});
