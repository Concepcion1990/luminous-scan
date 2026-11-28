/**
 * Plans-description dedupe guard (owner's ruling, Nov 19, 2026).
 *
 * Plan DESCRIPTIONS only — no behavior changed. On every surface
 * where plans are described, Business' feature list reads:
 * "Everything in Essentials" first, then ONLY Business' own
 * extras. No Essentials feature may be repeated in Business'
 * list, in either list family (PLANS feeds the Plans page,
 * /upgrade and the Settings plan summary; WELCOME_OPTIONS feeds
 * the Welcome page). Essentials lists and the Mobile list are
 * pinned byte-for-byte by key so the cleanup can never quietly
 * become a rewrite of them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const src = read('src/lib/plans.js');

/** The t('…') keys of one `get includes()` block, in order. */
function keysOf(block) {
  return [...block.matchAll(/t\('([^']+)'\)/g)].map((m) => m[1]);
}

/** All `get includes()` blocks between two source markers. */
function includesBlocks(fromMarker, toMarker) {
  const start = src.indexOf(fromMarker);
  const end = src.indexOf(toMarker, start);
  assert.ok(start >= 0 && end > start, `section ${fromMarker} found`);
  const section = src.slice(start, end);
  return section
    .split('get includes()')
    .slice(1)
    .map((part) => part.slice(0, part.indexOf('];')));
}

const EVERYTHING = 'plansLib.businessIncludes.everything';

const plansBlocks = includesBlocks('export const PLANS = {', 'export const FEATURES');
const plansEssentialsKeys = keysOf(plansBlocks[0]);
const plansBusinessKeys = keysOf(plansBlocks[1]);

const mobileBlocks = includesBlocks('export const MOBILE_PLAN = {', 'export const WELCOME_OPTIONS');
const mobileKeys = keysOf(mobileBlocks[0]);

const welcomeBlocks = includesBlocks('export const WELCOME_OPTIONS = [', 'export const COMPARISON_ROWS');
const welcomeEssentialsKeys = keysOf(welcomeBlocks[0]);
const welcomeBusinessKeys = keysOf(welcomeBlocks[1]);

test('PLANS family: Business opens with Everything in Essentials and repeats no Essentials key', () => {
  assert.equal(plansBusinessKeys[0], EVERYTHING);
  const overlap = plansBusinessKeys.filter((k) => plansEssentialsKeys.includes(k));
  assert.deepEqual(overlap, [], `Business repeats Essentials keys: ${overlap.join(', ')}`);
});

test('WELCOME family: Business opens with Everything in Essentials and repeats no Essentials key', () => {
  assert.equal(welcomeBusinessKeys[0], EVERYTHING);
  const overlap = welcomeBusinessKeys.filter((k) => welcomeEssentialsKeys.includes(k));
  assert.deepEqual(overlap, [], `Welcome Business repeats Essentials keys: ${overlap.join(', ')}`);
});

test('the deduped Business lists are exactly the everything line plus Business-only extras', () => {
  assert.deepEqual(plansBusinessKeys, [
    'plansLib.businessIncludes.everything',
    'plansLib.businessIncludes.unlimited',
    'plansLib.businessIncludes.roles',
    'plansLib.businessIncludes.businesses',
    'plansLib.businessIncludes.valuation',
    'plansLib.businessIncludes.alerts',
    'plansLib.businessIncludes.exports',
    'plansLib.businessIncludes.suppliers',
    'plansLib.businessIncludes.bundles',
    'plansLib.businessIncludes.supplierDocs',
    'plansLib.businessIncludes.rewards',
    'plansLib.businessIncludes.tillConnections',
    'plansLib.includes.crossStore',
    'plansLib.includes.pricing',
    'plansLib.includes.sendPo',
    'plansLib.includes.documents',
    'plansLib.businessIncludes.restaurantKitchen',
    'plansLib.businessIncludes.restaurantStock',
    'plansLib.businessIncludes.restaurantMoney',
    'plansLib.businessIncludes.restaurantSafety',
    'plansLib.businessIncludes.foodSafetyFile',
    'plansLib.businessIncludes.kitchenDisplay',
    'plansLib.businessIncludes.guestMenuPage',
    'plansLib.businessIncludes.tipPooling',
    'plansLib.businessIncludes.laborTarget',
    'plansLib.businessIncludes.cateringEvents',
    'plansLib.businessIncludes.reservations',
    'plansLib.businessIncludes.standingOrders',
    'plansLib.businessIncludes.productionOrder',
    'plansLib.businessIncludes.barCounting',
    'plansLib.businessIncludes.locationsRollup',
    'plansLib.businessIncludes.recipeCostLink',
    'plansLib.businessIncludes.restaurantFloor',
    'plansLib.businessIncludes.restaurantTeam',
    'plansLib.businessIncludes.xstoreMessages',
  ]);
  assert.deepEqual(welcomeBusinessKeys, [
    'plansLib.businessIncludes.everything',
    'plansLib.welcomeBusinessIncludes.businesses',
    'plansLib.welcomeBusinessIncludes.sites',
    'plansLib.welcomeBusinessIncludes.products',
    'plansLib.welcomeBusinessIncludes.staff',
    'plansLib.businessIncludes.roles',
    'plansLib.welcomeBusinessIncludes.valuation',
    'plansLib.businessIncludes.alerts',
    'plansLib.businessIncludes.exports',
    'plansLib.welcomeBusinessIncludes.suppliers',
    'plansLib.welcomeBusinessIncludes.bundles',
    'plansLib.welcomeBusinessIncludes.reports',
    'plansLib.businessIncludes.rewards',
    'plansLib.businessIncludes.tillConnections',
    'plansLib.includes.crossStore',
    'plansLib.includes.pricing',
    'plansLib.includes.sendPo',
    'plansLib.includes.documents',
    'plansLib.businessIncludes.restaurantKitchen',
    'plansLib.businessIncludes.restaurantStock',
    'plansLib.businessIncludes.restaurantMoney',
    'plansLib.businessIncludes.restaurantSafety',
    'plansLib.businessIncludes.foodSafetyFile',
    'plansLib.businessIncludes.kitchenDisplay',
    'plansLib.businessIncludes.guestMenuPage',
    'plansLib.businessIncludes.tipPooling',
    'plansLib.businessIncludes.laborTarget',
    'plansLib.businessIncludes.cateringEvents',
    'plansLib.businessIncludes.reservations',
    'plansLib.businessIncludes.standingOrders',
    'plansLib.businessIncludes.productionOrder',
    'plansLib.businessIncludes.barCounting',
    'plansLib.businessIncludes.locationsRollup',
    'plansLib.businessIncludes.recipeCostLink',
    'plansLib.businessIncludes.restaurantFloor',
    'plansLib.businessIncludes.restaurantTeam',
    'plansLib.businessIncludes.xstoreMessages',
  ]);
});

test('Essentials lists are unchanged by the cleanup (pinned by key, both families)', () => {
  assert.deepEqual(plansEssentialsKeys, [
    'plansLib.welcomeEssentialsIncludes.oneBusiness',
    'plansLib.welcomeEssentialsIncludes.oneSite',
    'plansLib.welcomeEssentialsIncludes.products',
    'plansLib.essentialsIncludes.catalog',
    'plansLib.essentialsIncludes.imports',
    'plansLib.includes.bulkEdit',
    'plansLib.includes.listPrices',
    'plansLib.essentialsIncludes.scanning',
    'plansLib.essentialsIncludes.receiving',
    'plansLib.essentialsIncludes.orders',
    'plansLib.essentialsIncludes.labels',
    'plansLib.includes.shippingLabels',
    'plansLib.includes.docStyle',
    'plansLib.includes.taxRate',
    'plansLib.includes.taxAuto',
    'plansLib.includes.codeGenerator',
    'plansLib.includes.gs1Codes',
    'plansLib.includes.movements',
    'plansLib.essentialsIncludes.staff',
    'plansLib.essentialsIncludes.roles',
    'plansLib.includes.workforce',
    'plansLib.includes.payroll',
    'plansLib.includes.training',
    'plansLib.includes.teamSettings',
    'plansLib.includes.shiftWindows',
    'plansLib.includes.ownerOnlyBilling',
    'plansLib.includes.settingsGrants',
    'plansLib.includes.appDownload',
    'plansLib.includes.staffWelcome',
    'plansLib.includes.storePolicies',
    'plansLib.includes.profilePhotos',
    'plansLib.includes.staffDocuments',
    'plansLib.includes.ebaySync',
    'plansLib.includes.inviteLink',
    'plansLib.includes.inbox',
    'plansLib.includes.logBook',
    'plansLib.includes.recordPrints',
    'plansLib.includes.ageCheck',
    'plansLib.includes.ownTraining',
    'plansLib.includes.barcodePool',
    'plansLib.includes.checklists',
    'plansLib.includes.equipment',
    'plansLib.includes.laborWarnings',
    'plansLib.includes.shiftSwaps',
    'plansLib.includes.recovery',
    'plansLib.includes.support',
    'plansLib.includes.offline',
    'plansLib.includes.languages',
    'plansLib.includes.branding',
    'plansLib.welcomeEssentialsIncludes.mobile',
  ]);
  assert.deepEqual(welcomeEssentialsKeys, [
    'plansLib.welcomeEssentialsIncludes.oneBusiness',
    'plansLib.welcomeEssentialsIncludes.oneSite',
    'plansLib.welcomeEssentialsIncludes.products',
    'plansLib.welcomeEssentialsIncludes.quantities',
    'plansLib.welcomeEssentialsIncludes.staff',
    'plansLib.welcomeEssentialsIncludes.tools',
    'plansLib.essentialsIncludes.scanning',
    'plansLib.essentialsIncludes.imports',
    'plansLib.includes.bulkEdit',
    'plansLib.includes.listPrices',
    'plansLib.essentialsIncludes.labels',
    'plansLib.includes.shippingLabels',
    'plansLib.includes.docStyle',
    'plansLib.includes.taxRate',
    'plansLib.includes.taxAuto',
    'plansLib.includes.codeGenerator',
    'plansLib.includes.gs1Codes',
    'plansLib.includes.movements',
    'plansLib.includes.workforce',
    'plansLib.includes.payroll',
    'plansLib.includes.training',
    'plansLib.includes.teamSettings',
    'plansLib.includes.shiftWindows',
    'plansLib.includes.ownerOnlyBilling',
    'plansLib.includes.settingsGrants',
    'plansLib.includes.appDownload',
    'plansLib.includes.staffWelcome',
    'plansLib.includes.storePolicies',
    'plansLib.includes.profilePhotos',
    'plansLib.includes.staffDocuments',
    'plansLib.includes.ebaySync',
    'plansLib.includes.inviteLink',
    'plansLib.includes.inbox',
    'plansLib.includes.logBook',
    'plansLib.includes.recordPrints',
    'plansLib.includes.ageCheck',
    'plansLib.includes.ownTraining',
    'plansLib.includes.barcodePool',
    'plansLib.includes.checklists',
    'plansLib.includes.equipment',
    'plansLib.includes.laborWarnings',
    'plansLib.includes.shiftSwaps',
    'plansLib.includes.recovery',
    'plansLib.includes.support',
    'plansLib.includes.offline',
    'plansLib.includes.languages',
    'plansLib.includes.branding',
    'plansLib.welcomeEssentialsIncludes.desktop',
    'plansLib.welcomeEssentialsIncludes.mobile',
    'plansLib.welcomeEssentialsIncludes.trial',
  ]);
});

test('Mobile list is untouched by the cleanup (pinned by key)', () => {
  assert.deepEqual(mobileKeys, [
    'plansLib.mobileIncludes.simplified',
    'plansLib.welcomeEssentialsIncludes.products',
    'plansLib.mobileIncludes.scanning',
    'plansLib.mobileIncludes.lookup',
    'plansLib.mobileIncludes.creation',
    'plansLib.mobileIncludes.quantities',
    'plansLib.mobileIncludes.receiving',
    'plansLib.mobileIncludes.counts',
    'plansLib.mobileIncludes.sales',
    'plansLib.mobileIncludes.history',
    'plansLib.mobileIncludes.orders',
    'plansLib.includes.codeGenerator',
    'plansLib.includes.gs1Codes',
    'plansLib.mobileIncludes.labels',
    'plansLib.includes.shippingLabels',
    'plansLib.mobileIncludes.training',
    'plansLib.mobileIncludes.trial',
  ]);
});

test('rendered lists: Business shows the everything line first and no Essentials wording twice', async () => {
  const { PLANS, WELCOME_OPTIONS } = await import('../../src/lib/plans.js');
  const { en } = await import('../../src/lib/locales/en.js');
  const everythingLine = en[EVERYTHING];
  assert.equal(typeof everythingLine, 'string');

  const welcomeOf = (key) => WELCOME_OPTIONS.find((o) => o.key === key);
  const families = [
    ['PLANS', PLANS.essentials.includes, PLANS.business.includes],
    ['WELCOME', welcomeOf('essentials').includes, welcomeOf('business').includes],
  ];
  for (const [name, essentials, business] of families) {
    assert.equal(business[0], everythingLine, `${name}: Business opens with "${everythingLine}"`);
    const doubled = business.filter((line) => essentials.includes(line));
    assert.deepEqual(doubled, [], `${name}: Business renders Essentials lines again: ${doubled.join(' | ')}`);
    // The extras survive: Business-only lines still named.
    assert.ok(business.some((line) => /till connections/i.test(line)), `${name}: till connections still named`);
    assert.ok(business.some((line) => /rewards/i.test(line)), `${name}: rewards still named`);
  }
});
