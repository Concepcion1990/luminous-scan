/**
 * FICTITIOUS LOCAL DEMONSTRATION ONLY.
 *
 * This module does not call Base44, Stripe, fetch, storage or an SDK.
 * Its one pajama product is a simulated copy inspired by the retained test
 * item; NOT the actual Product row. No database record can be edited here.
 *
 * A provider-verified original subscription + paid renewal + entitlement
 * reconciliation will be required before the real Confirm Upgrade is enabled.
 */

const clone = value => JSON.parse(JSON.stringify(value));

export const DEMO_UPGRADE_PRICES = Object.freeze({
  essentialsCents: 1499,
  businessCents: 2999,
});

/** Entirely fictional customer/subscription/stock fixture. */
export function createUpgradeDryRunFixture() {
  return {
    ownerId: 'fictional-owner-do-not-bill',
    rootBusinessId: 'fictional-business-do-not-bill',
    businesses: [{ id: 'fictional-business-do-not-bill', name: 'Example test workspace' }],
    subscription: {
      id: 'fictional-stripe-subscription-no-api',
      provider: 'fictional_stripe_fixture',
      plan: 'essentials',
      status: 'active',
      monthlyCents: DEMO_UPGRADE_PRICES.essentialsCents,
      currentCycle: 2,
      billingAnchor: '2030-01-15T00:00:00Z',
      paidThrough: '2030-02-15T00:00:00Z',
      trialEndsAt: '2030-01-10T00:00:00Z',
      trialsEverGranted: 1,
    },
    entitlement: {
      id: 'fictional-original-entitlement',
      businessId: 'fictional-business-do-not-bill',
      plan: 'essentials',
      status: 'active',
    },
    inventory: {
      products: [{
        id: 'fictional-pajama-sample',
        name: 'TEST — Pajama Pants (simulated copy only)',
        upc: '195464952825',
        sku: 'TEST - PJ - 001',
        notes: 'Fictitious fixture. This is not the app database.',
      }],
      stockLevels: [{ productId: 'fictional-pajama-sample', locationId: 'demo-site', quantity: 1 }],
      movements: [{ id: 'fictional-movement', productId: 'fictional-pajama-sample', type: 'receive' }],
      locations: [{ id: 'demo-site', name: 'Example site' }],
    },
  };
}

/**
 * Pure proposed NEXT-cycle change; no payment, provider call or access grant.
 * The current entitlement remains Essentials pending verified paid renewal.
 */
export function runUpgradeDryRun(fixture = createUpgradeDryRunFixture()) {
  const reject = reason => ({ passed: false, reason, realPaymentAttempted: false, recordsChanged: false });
  if (!fixture || typeof fixture !== 'object') return reject('fixture_missing');
  const original = clone(fixture);
  const s = original.subscription;
  const e = original.entitlement;
  if (!original.ownerId || !original.rootBusinessId ||
      !Array.isArray(original.businesses) || original.businesses.length !== 1 ||
      original.businesses[0]?.id !== original.rootBusinessId ||
      !s || !e || !original.inventory) return reject('fixture_structure_invalid');

  if (!s.id || s.provider !== 'fictional_stripe_fixture' ||
      s.status !== 'active' || s.plan !== 'essentials' ||
      s.monthlyCents !== DEMO_UPGRADE_PRICES.essentialsCents ||
      !Number.isSafeInteger(s.currentCycle) || s.currentCycle < 0 ||
      !s.billingAnchor || !s.paidThrough ||
      !Number.isSafeInteger(s.trialsEverGranted) || s.trialsEverGranted !== 1 ||
      e.id !== 'fictional-original-entitlement' ||
      e.businessId !== original.rootBusinessId ||
      e.plan !== 'essentials' || e.status !== 'active') {
    return reject('existing_subscription_or_trial_not_verified');
  }

  const scheduled = {
    ...original,
    subscription: {
      ...s,
      // This is a fictional plan-change OFFER on the SAME single subscription,
      // not a second subscription or an immediate entitlement mutation.
      pendingChange: {
        targetPlan: 'business',
        targetMonthlyCents: DEMO_UPGRADE_PRICES.businessCents,
        targetCycle: s.currentCycle + 1,
        tax: 'provider-quote-required',
        proration: 'provider-quote-required',
        state: 'requires_provider_quote_and_paid_renewal',
      },
    },
  };

  const unchanged = ['ownerId','rootBusinessId','businesses','inventory','entitlement']
    .every(key => JSON.stringify(original[key]) === JSON.stringify(scheduled[key]));
  const subUnchanged = ['id','provider','plan','status','monthlyCents','currentCycle',
    'billingAnchor','paidThrough','trialEndsAt','trialsEverGranted']
    .every(key => original.subscription[key] === scheduled.subscription[key]);
  const sourceUnchanged = JSON.stringify(fixture) === JSON.stringify(original);
  if (!unchanged || !subUnchanged || !sourceUnchanged)
    return reject('original_workspace_or_trial_was_changed');

  return {
    passed: true,
    reason: 'local_fictional_next_cycle_upgrade_checks_passed',
    realPaymentAttempted: false,
    recordsChanged: false,
    currentPlan: scheduled.entitlement.plan,
    scheduledPlan: scheduled.subscription.pendingChange.targetPlan,
    existingSubscriptionPreserved: scheduled.subscription.id === original.subscription.id,
    subscriptionCount: 1,
    newTrialStarted: false,
    trialEndPreserved: scheduled.subscription.trialEndsAt === s.trialEndsAt,
    inventorySamplePreserved: scheduled.inventory.products[0].upc === '195464952825',
    ownerAccessChanged: false,
    currentMonthlyCents: s.monthlyCents,
    proposedMonthlyCents: scheduled.subscription.pendingChange.targetMonthlyCents,
    taxAndProration: 'Unknown until an actual provider quote is verified',
    nextStep: 'Inspect a genuine isolated Stripe TEST subscription and quote before ever enabling Confirm Upgrade.',
  };
}
