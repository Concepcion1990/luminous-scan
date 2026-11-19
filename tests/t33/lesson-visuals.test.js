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
  'welcome-basics',
  'scanner-lookup', 'scanner-website-qr', 'scanner-shelf-counts',
  'scanner-receiving', 'scanner-move-stock', 'scanner-name-lookup',
  'scanner-damaged', 'products-find-edit', 'owner-pricing',
  'orders-basics',
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

test('owner ruling (Nov 18, 2026): owner-tax-rate and owner-setup carry NO visuals, words intact', () => {
  // "Go ahead and remove those visuals though from the two
  // trainings" — the lessons and their steps stay; only the
  // pictures go. Every other lesson is untouched by the ruling.
  for (const [id, steps] of [['owner-tax-rate', 3], ['owner-setup', 4]]) {
    const lesson = TRAINING_LESSONS.find((l) => l.id === id);
    assert.ok(lesson, `${id} still exists`);
    assert.equal(lesson.steps, steps, `${id}: step count unchanged`);
    assert.equal(lesson.visuals, undefined, `${id}: visuals removed completely`);
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

test('StepVisual pans inside the picture and opens it wide (owner fix, Nov 15, 2026)', () => {
  const visual = readFileSync('src/components/training/StepVisual.jsx', 'utf8');
  // A gesture layer translates drags into scrolling inside the
  // still-inert frame, both axes; pull-to-refresh must not claim
  // drags that start on the picture.
  assert.match(visual, /data-visual-gesture/);
  assert.match(visual, /data-pull-refresh-ignore/);
  assert.match(visual, /contentWindow\?\.scrollBy/);
  assert.match(visual, /touch-none/);
  // The stage is measured against the viewport (full bleed
  // below the desktop breakpoint) so the framed page renders
  // at the reader's true width, never squeezed.
  assert.match(visual, /documentElement\.clientWidth/);
  assert.match(visual, /getBoundingClientRect/);
  // The wide view: the same live page, full screen, portaled
  // out of the page-transition wrappers, with the labelled
  // open/close affordances.
  assert.match(visual, /data-visual-wide/);
  assert.match(visual, /createPortal/);
  assert.match(visual, /training\.visualOpen/);
  assert.match(visual, /training\.visualClose/);
  // The ring re-measures when the frame scrolls (it rides
  // along with a pan instead of detaching from its target).
  assert.match(visual, /addEventListener\('scroll', scheduleMeasure/);
});

test('logout inside the wide view logs out the WHOLE app (owner ruling, Nov 15, 2026)', () => {
  // One session, one door out — every plan, every role: the frame
  // and the parent are the same app on the same cookie session.
  const client = readFileSync('src/api/client.js', 'utf8');
  assert.match(client, /isEmbedVisual\(\)/, 'the client logout knows when it runs in a frame');
  assert.match(client, /postMessage\(\{ type: 'sh:session-ended' \}/, 'the framed app tells the parent its session ended');
  assert.ok(
    client.indexOf("postMessage({ type: 'sh:session-ended' }") < client.indexOf("request('/api/auth/logout'"),
    'the message goes before the logout request — the navigation may tear the frame down',
  );
  const visual = readFileSync('src/components/training/StepVisual.jsx', 'utf8');
  assert.match(visual, /event\.origin !== window\.location\.origin/, 'the parent origin-checks the message');
  assert.match(visual, /event\.source !== frame\.contentWindow/, 'only the visual’s own wide frame may end the outer session');
  assert.match(visual, /logoutRef\.current\?\.\(\)/, 'the parent walks out through its own logout');
  assert.match(visual, /location\?\.pathname === '\/login'/, 'a framed landing on /login ends the outer session too');
});
