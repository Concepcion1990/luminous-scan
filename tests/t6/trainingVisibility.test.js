/**
 * T6 — Training obeys the invisibility doctrine (owner ruling,
 * Nov 14, 2026, from her Essentials Training screenshots).
 *
 * A lesson whose subject is a Business-only feature does not
 * appear on Essentials at all — no card, no teaser, in every
 * track — and the counters count only the lessons the plan has.
 * On Business every lesson shows and the counts are whole. The
 * mixed 'Import, export and stock value' lesson is Business-only
 * (feature 'exports'); in its place Essentials gets 'owner-import'
 * (essentialsOnly), which teaches importing alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const BUSINESS_ONLY = {
  'owner-pricing': 'pricing', 'mgr-pricing': 'pricing',
  'owner-builds': 'builds',
  'owner-cross-store': 'crossStore', 'owner-move-stock': 'crossStore', 'mgr-cross-store': 'crossStore',
  'owner-give-rewards': 'rewards', 'owner-rewards-oversight': 'rewards',
  'mgr-give-rewards': 'rewards', 'staff-your-rewards': 'rewards',
  'owner-send-supplier-order': 'purchasing', 'mgr-send-supplier-order': 'purchasing',
  'mgr-suppliers-orders': 'suppliers',
  'mgr-reports-alerts': 'reports',
  'staff-reports': 'reports', 'staff-cross-store': 'crossStore', 'staff-builds': 'builds',
  'owner-pos-connect-square': 'pos', 'owner-pos-connect-shopify': 'pos',
  'owner-pos-connect-clover': 'pos', 'owner-pos-connect-toast': 'pos',
  'owner-pos-connect-lightspeed': 'pos', 'owner-pos-connect-zettle': 'pos',
  'owner-pos-connect-stripe-terminal': 'pos', 'owner-pos-connect-wix': 'pos',
  'owner-pos-mapping': 'pos', 'owner-pos-csv': 'pos', 'owner-pos-sales-list': 'pos',
  'staff-pos-till-sales': 'pos',
  'owner-import-export': 'exports',
  'owner-restaurant': 'restaurant', 'staff-restaurant-view': 'restaurant',
  'mgr-restaurant-build': 'restaurant', 'mgr-restaurant-pars': 'restaurant',
  'mgr-restaurant-money': 'restaurant',
  'owner-restaurant-ops': 'restaurant', 'staff-restaurant-daily': 'restaurant',
  'owner-tip-pooling': 'restaurant',
  'owner-labor-target': 'restaurant',
  'owner-catering-events': 'restaurant',
  'owner-reservations': 'restaurant',
  'owner-standing-orders': 'restaurant',
  'owner-production-order': 'restaurant',
  'owner-bar-counting': 'restaurant',
  'owner-locations-rollup': 'restaurant',
  'mgr-restaurant-invoices': 'restaurant', 'mgr-restaurant-reports': 'restaurant',
  'staff-food-safety': 'restaurant',
  'staff-kitchen-menu': 'restaurant',
  'owner-xstore-messages': 'xstoreMessages', 'mgr-xstore-messages': 'xstoreMessages',
  'staff-xstore-messages': 'xstoreMessages',
};

async function catalogs() {
  const client = await import('../../src/lib/trainingCatalog.js');
  const server = await import('../../server/trainingCatalog.js');
  return { client, server };
}

test('both catalogs tag exactly the Business-only lessons, identically', async () => {
  const { client, server } = await catalogs();
  for (const catalog of [client.TRAINING_LESSONS, server.TRAINING_LESSONS]) {
    const tagged = Object.fromEntries(
      catalog.filter((l) => l.feature).map((l) => [l.id, l.feature]),
    );
    assert.deepEqual(tagged, BUSINESS_ONLY);
    const essentialsOnly = catalog.filter((l) => l.essentialsOnly).map((l) => l.id);
    assert.deepEqual(essentialsOnly, ['owner-import']);
  }
});

test('plan-visible counts: Business whole, Essentials without the Business subjects', async () => {
  const { client } = await catalogs();
  const count = (track, isBusiness) => client.visibleLessonsForTrack(track, isBusiness).length;
  // Business: every lesson shows (owner-import is Essentials-only).
  // 37 since the set-once tax-rate lesson joined the owner track
  // (Nov 15, 2026); +1 per track for the shift-window lessons
  // (Nov 19, 2026): owner 38, manager 17, staff 34. The owner
  // confidentiality lesson (owner track only, same day) makes owner 39.
  // The owner store-policies lesson (Nov 19, 2026, both plans) makes
  // owner 40 on Business and 22 on Essentials.
  // The training builds (Nov 20, 2026) add the download-the-app
  // lesson (staff, both plans), three Business-only staff lessons
  // (reports, cross-store, builds), and the manager tax lesson
  // (both plans): staff 38/33, manager 18/12, owner unchanged.
  // The profile photos batch (Nov 21, 2026) adds one both-plans
  // lesson per affected track (staff your-profile-photo, owner
  // owner-profile-photos): staff 39/34, owner 41/23.
  // The clock build (Nov 21, 2026) adds the call-ins and clock
  // corrections lesson (manager track, both plans, riding the
  // staff.clock tick): manager 19/13.
  // The staff documents build (Nov 21, 2026) adds one both-plans
  // lesson per affected track (owner owner-staff-documents,
  // manager mgr-staff-documents riding the staff.documents
  // tick): owner 42/24, manager 20/14.
  // The restaurant corner build (Nov 23, 2026) adds five
  // Business-only lessons (owner-restaurant, staff-restaurant-view,
  // and the three tick lessons for managers): Business owner 43,
  // manager 23, staff 40; Essentials counts unchanged.
  // The cross-store messages build (Nov 23, 2026) adds three
  // Business-only lessons, one per track (owner/mgr/staff
  // xstore-messages): Business owner 44, manager 24, staff 41;
  // Essentials counts unchanged.
  // The restaurant operations build (release 361, Nov 23, 2026)
  // adds four Business-only lessons (owner-restaurant-ops,
  // staff-restaurant-daily, mgr-restaurant-invoices riding
  // restaurant.build, mgr-restaurant-reports riding
  // restaurant.money): Business owner 45, manager 26, staff 42;
  // Essentials counts unchanged.
  // The eBay storefront build (release 362, Nov 23, 2026) adds
  // ONE both-plans lesson (owner-ebay-connect, no feature tag —
  // storefront connections are both plans): owner 46 on
  // Business and 25 on Essentials; manager/staff unchanged.
  // The paper-trail build (release 378, Nov 25, 2026) adds ONE
  // both-plans staff lesson (staff-log-book, no feature tag —
  // the manager log book is a general feature): staff 43 on
  // Business and 35 on Essentials; owner/manager unchanged.
  // The prints build (Nov 25, 2026) adds ONE both-plans staff
  // lesson (staff-record-prints, no feature tag — the record
  // papers are general features): staff 44 on Business and 36
  // on Essentials; owner/manager unchanged.
  // The age check build (Nov 25, 2026) adds ONE both-plans
  // staff lesson (scanner-age-check, no feature tag — the age
  // check is a general feature): staff 45 on Business and 37
  // on Essentials; owner/manager unchanged.
  // The training build (Nov 25, 2026) adds ONE both-plans
  // owner lesson (owner-own-training, no feature tag — adding
  // your own training is a general feature): owner 47 on
  // Business and 26 on Essentials; manager/staff unchanged.
  // The barcode-pool build (Nov 25, 2026) adds ONE both-plans
  // owner lesson (owner-barcode-pool, no feature tag — the
  // barcode pool is a general feature): owner 48 on Business
  // and 27 on Essentials; manager/staff unchanged.
  // The checklists build (Nov 26, 2026) adds ONE both-plans
  // staff lesson (staff-checklists, no feature tag — checklists
  // are a general feature): staff 46 on Business and 38 on
  // Essentials; owner/manager unchanged.
  // The food-safety build (plan release 370, Nov 26, 2026) adds
  // ONE Business-only staff lesson (staff-food-safety, feature
  // restaurant — the food-safety file is Business-only): staff
  // 47 on Business and 38 on Essentials; owner/manager
  // unchanged.
  // The kitchen-menu build (plan release 371, Nov 26, 2026)
  // adds ONE Business-only staff lesson (staff-kitchen-menu,
  // feature restaurant — the kitchen display and guest menu
  // are Business-only): staff 48 on Business and 38 on
  // Essentials; owner/manager unchanged.
  // The equipment build (plan release 372, Nov 26, 2026) adds
  // ONE both-plans staff lesson (staff-equipment, no feature
  // tag — equipment records are a general feature): staff 49
  // on Business and 39 on Essentials; owner/manager unchanged.
  // The tip-pooling build (plan release 373, Nov 26, 2026)
  // adds ONE Business-only owner lesson (owner-tip-pooling,
  // feature restaurant — tip pooling is Business-only):
  // owner 49 on Business and 27 on Essentials; manager/staff
  // unchanged.
  // The labor-warnings build (plan release 374, Nov 26,
  // 2026) adds TWO owner lessons: owner-labor-warnings (no
  // feature tag — the warnings engine is general, both
  // plans) and owner-labor-target (feature restaurant —
  // the labor target is Business-only): owner 51 on
  // Business and 28 on Essentials; manager/staff unchanged.
  // The catering build (plan release 375, Nov 26, 2026)
  // adds ONE owner lesson: owner-catering-events (feature
  // restaurant — catering is Business-only): owner 52 on
  // Business; Essentials unchanged.
  // The reservations build (plan release 376, Nov 26, 2026)
  // adds ONE owner lesson: owner-reservations (feature
  // restaurant — the book is Business-only): owner 53 on
  // Business; Essentials unchanged.
  // The bar-counting build (plan release 379, Nov 26, 2026)
  // adds ONE owner lesson: owner-bar-counting (feature
  // restaurant — bar counting is Business-only): owner 56 on
  // Business; Essentials unchanged.
  // The locations-rollup build (plan release 380, Nov 26,
  // 2026) adds ONE owner lesson: owner-locations-rollup
  // (feature restaurant — the rollup is Business-only):
  // owner 57 on Business; Essentials unchanged.
  assert.equal(count('owner', true), 57);
  assert.equal(count('manager', true), 26);
  assert.equal(count('staff', true), 49);
  // Essentials: 21 owner subjects hidden, owner-import in their place.
  assert.equal(count('owner', false), 28); // +1 confidentiality lesson (Nov 19, 2026); +1 eBay storefront lesson (release 362, both plans); +1 own-training lesson (the training build, both plans); +1 barcode-pool lesson (the barcode-pool build, both plans)
  assert.equal(count('manager', false), 14);
  assert.equal(count('staff', false), 39);
  // Payroll / workforce / direct-deposit lessons stay on Essentials.
  const essentialsStaff = client.visibleLessonsForTrack('staff', false).map((l) => l.id);
  for (const id of ['stub-yours', 'dd-submit', 'clock-basics']) {
    assert.ok(essentialsStaff.includes(id), `${id} stays on Essentials`);
  }
  const essentialsOwner = client.visibleLessonsForTrack('owner', false).map((l) => l.id);
  assert.ok(essentialsOwner.includes('owner-import'), 'Essentials teaches importing');
  assert.ok(!essentialsOwner.includes('owner-import-export'), 'the mixed lesson is hidden');
});

test('the server catalog carries the same visibility helper', async () => {
  const { server } = await catalogs();
  const pos = server.TRAINING_LESSONS.find((l) => l.id === 'owner-pos-connect-square');
  assert.equal(server.lessonVisibleOnPlan(pos, false), false);
  assert.equal(server.lessonVisibleOnPlan(pos, true), true);
  const imp = server.TRAINING_LESSONS.find((l) => l.id === 'owner-import');
  assert.equal(server.lessonVisibleOnPlan(imp, false), true);
  assert.equal(server.lessonVisibleOnPlan(imp, true), false);
});

test('the Training page renders tracks, counters and assignments from the visible set', () => {
  const page = src('src/pages/Training.jsx');
  assert.match(page, /visibleLessonsForTrack\(track, isBusiness\)/);
  assert.match(page, /const isBusiness = state\.plan === 'business';/);
  assert.match(page, /assignments=\{state\.assignments\.map\(visibleAssignment\)\.filter\(Boolean\)\}/);
  assert.match(page, /lessonVisibleOnPlan\(l, isBusiness\)/);
});

test('server team counts and assignment doors use the visible set', () => {
  const routes = src('server/trainingRoutes.js');
  // Team total and team done both count plan-visible lessons only.
  const teamUses = routes.match(/tracks\.includes\(l\.track\) && lessonVisibleOnPlan\(l, isBusiness\)/g) || [];
  assert.equal(teamUses.length, 2, 'team total + team done are both plan-scoped');
  // Manual assignments expand to the module's FULL plan catalog
  // (owner ruling, Nov 15, 2026: assign everything) — plan-scoped
  // still, but never trimmed to the assignee's level.
  assert.match(routes, /TRAINING_LESSONS\.filter\(\s*\(lesson\) => lesson\.module === module && lessonVisibleOnPlan\(lesson, access\.planKey === 'business'\),\s*\)/);
  assert.doesNotMatch(routes, /lessonsForModuleAtLevel/);
  const core = src('server/trainingCore.js');
  assert.match(core, /\.filter\(\(lesson\) => lessonVisibleOnPlan\(lesson, isBusiness\)\)/);
});
