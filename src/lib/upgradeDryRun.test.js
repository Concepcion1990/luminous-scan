import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { en } from './locales/en.js';
import {
  createUpgradeDryRunFixture,
  runUpgradeDryRun,
  DEMO_UPGRADE_PRICES,
} from './upgradeDryRun.js';

const read = file => fs.readFileSync(file, 'utf8');

test('fictional local simulation preserves original subscription and current Essentials access', () => {
  const result = runUpgradeDryRun();
  assert.equal(result.passed, true);
  assert.equal(result.subscriptionCount, 1);
  assert.equal(result.existingSubscriptionPreserved, true);
  assert.equal(result.currentPlan, 'essentials');
  assert.equal(result.scheduledPlan, 'business');
  assert.equal(result.ownerAccessChanged, false);
  assert.equal(result.realPaymentAttempted, false);
  assert.equal(result.recordsChanged, false);
  assert.equal(result.newTrialStarted, false);
  assert.equal(result.trialEndPreserved, true);
  assert.equal(result.inventorySamplePreserved, true);
  assert.equal(result.proposedMonthlyCents, 2999);
  assert.equal(result.currentMonthlyCents, 1499);
  assert.match(result.taxAndProration, /Unknown/);
});
test('sample product and all fictional fixtures remain unchanged', () => {
  const before = createUpgradeDryRunFixture();
  const frozen = JSON.stringify(before);
  runUpgradeDryRun(before);
  assert.equal(JSON.stringify(before), frozen);
  assert.equal(before.inventory.products[0].upc, '195464952825');
  assert.equal(before.subscription.id, 'fictional-stripe-subscription-no-api');
  assert.equal(before.subscription.provider, 'fictional_stripe_fixture');
  assert.equal(before.subscription.trialsEverGranted, 1);
});
test('rejects a malformed or ineligible initial trial and subscription', () => {
  const invalid = [
    null,
    {...createUpgradeDryRunFixture(), ownerId:null},
    {...createUpgradeDryRunFixture(), subscription:{...createUpgradeDryRunFixture().subscription, plan:'business'}},
    {...createUpgradeDryRunFixture(), subscription:{...createUpgradeDryRunFixture().subscription, trialsEverGranted:2}},
    {...createUpgradeDryRunFixture(), subscription:{...createUpgradeDryRunFixture().subscription, monthlyCents:9999}},
    {...createUpgradeDryRunFixture(), entitlement:{...createUpgradeDryRunFixture().entitlement, businessId:'other-business'}},
  ];
  for (const fixture of invalid) {
    const result = runUpgradeDryRun(fixture);
    assert.equal(result.passed, false, JSON.stringify(fixture));
    assert.equal(result.realPaymentAttempted, false);
    assert.equal(result.recordsChanged, false);
  }
});
test('code never contacts customer providers, Base44 or storage — Stripe is the named (fictional) provider only', () => {
  const source = read('src/lib/upgradeDryRun.js');
  const component = read('src/components/billing/UpgradeDryRunPanel.jsx');
  // Stripe is now the named provider, but only as a fictional fixture
  // name — the module still makes no provider call of any kind.
  assert.match(source, /fictional_stripe_fixture/);
  assert.doesNotMatch(source, /fictional_wix_fixture/);
  assert.doesNotMatch(source, /fetch\s*\(|base44\.(?:functions|entities)|Deno\.env|localStorage|sessionStorage|stripe\.|WIX_CHECKOUT_/);
  assert.doesNotMatch(component, /base44\.(?:functions|entities)|fetch\s*\(|localStorage|sessionStorage/);
  // T6.3: the panel copy moved into en.js (billing.dryRun.*) and renders
  // through t() — assert the panel references the keys and the English
  // values still say the words.
  assert.match(component, /t\('billing\.dryRun\.body'\)/);
  assert.match(en['billing.dryRun.body'], /fictional records/i);
  assert.match(component, /t\('billing\.dryRun\.runButton'\)/);
  assert.match(en['billing.dryRun.runButton'], /no charge/i);
  assert.match(component, /t\('billing\.dryRun\.limitations'\)/);
  assert.match(en['billing.dryRun.limitations'], /Stripe subscription changes/);
  assert.deepEqual(DEMO_UPGRADE_PRICES, {essentialsCents:1499,businessCents:2999});
});
test('only owner screens display the practice panel; the Wix upgrade flow stays gone', () => {
  const settings = read('src/pages/Settings.jsx');
  const upgrade = read('src/pages/Upgrade.jsx');
  // Owner-only gating, via the canShowPrivateBillingDiagnostics flag.
  assert.match(settings,/canShowPrivateBillingDiagnostics = Boolean\(\s*user\?\.id && record\?\.created_by_id === user\.id && isBase44BuilderPreview/);
  assert.match(settings,/canShowPrivateBillingDiagnostics && <UpgradeDryRunPanel \/>/);
  assert.match(upgrade,/canShowPrivateBillingDiagnostics && \(/);
  assert.ok(upgrade.includes('<UpgradeDryRunPanel />'));
  // The Wix upgrade flow is gone: no invoke of the deleted
  // upgrade-to-business function, no Confirm Upgrade handler, and no
  // create-checkout call. (T6.3: the old "Upgrades will be available
  // once Stripe payments are live." assertion is removed — Stripe
  // payments ARE live now, so that switching copy no longer exists
  // anywhere in the app; git grep on the pre-T6.3 tree shows it only
  // in this test file itself. The Upgrade to Business button renders
  // through t() instead.)
  assert.doesNotMatch(upgrade, /invoke\('upgrade-to-business'/);
  assert.doesNotMatch(upgrade, /confirmUpgrade/);
  assert.doesNotMatch(upgrade, /invoke\('create-checkout'/);
  assert.doesNotMatch(upgrade, /invoke\('apply-upgrade-plan-flip'/);
  assert.match(upgrade, /t\('upgrade\.upgradeToBusiness'\)/);
  assert.equal(en['upgrade.upgradeToBusiness'], 'Upgrade to Business');
});
