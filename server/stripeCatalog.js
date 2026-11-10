/**
 * Stripe catalog — T4 (stripe-build-plan Phase 1 §1.3, adapted).
 *
 * App-owned prices: Essentials $14.99/mo, Business $29.99/mo.
 * Live Price IDs are the verified values (Nov 8, live mode):
 *   Essentials price_1UZatSQ5knDt27cX7ggcUR6k
 *   Business   price_1UZatvQ5knDt27cXQ7yip3cU
 * Test Price IDs are UNKNOWN — they do not exist yet because the
 * test-mode products have not been created. They are NEVER invented:
 * in test mode they come from the Fly secrets
 * STRIPE_TEST_PRICE_ESSENTIALS / STRIPE_TEST_PRICE_BUSINESS, set
 * when the test products are created (T4 blocker: the test secret
 * key has not landed yet). Until then, test-mode checkout fails
 * closed with stripe_test_prices_not_configured.
 *
 * Tax: Q-1 default — NO tax line; prices stay tax_behavior
 * unspecified. Never guess a txcd_ value.
 */
export const PLAN_PRICES = { essentials: 14.99, business: 29.99 };

export const LIVE_PRICE_IDS = {
  essentials: 'price_1UZatSQ5knDt27cX7ggcUR6k',
  business: 'price_1UZatvQ5knDt27cXQ7yip3cU',
};

export const LIVE_PRODUCT_IDS = {
  essentials: 'prod_VamSsCjHOAPYhV',
  business: 'prod_VamSsluwWMnryy',
};

export function isValidPlan(plan) {
  return plan === 'essentials' || plan === 'business';
}

/** Price ID for a plan in a mode. Mode comes from the key, never the browser. */
export function priceIdForPlan(plan, mode) {
  if (!isValidPlan(plan)) {
    throw Object.assign(new Error('Unknown plan.'), { status: 400, code: 'invalid_plan' });
  }
  if (mode === 'live') return LIVE_PRICE_IDS[plan];
  if (mode !== 'test') {
    throw Object.assign(new Error('Stripe is not configured.'), { status: 503, code: 'stripe_not_configured' });
  }
  const testId = process.env[plan === 'essentials' ? 'STRIPE_TEST_PRICE_ESSENTIALS' : 'STRIPE_TEST_PRICE_BUSINESS'];
  if (!testId) {
    throw Object.assign(
      new Error(`Test-mode Stripe price for ${plan} is not configured yet.`),
      { status: 503, code: 'stripe_test_prices_not_configured' },
    );
  }
  return testId;
}

/** Plan for a Price ID (live or test), or null when unknown. */
export function planForPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === LIVE_PRICE_IDS.essentials) return 'essentials';
  if (priceId === LIVE_PRICE_IDS.business) return 'business';
  const testEssentials = process.env.STRIPE_TEST_PRICE_ESSENTIALS;
  const testBusiness = process.env.STRIPE_TEST_PRICE_BUSINESS;
  if (testEssentials && priceId === testEssentials) return 'essentials';
  if (testBusiness && priceId === testBusiness) return 'business';
  return null;
}

/** The Price ID on a Stripe subscription object (first line item), or null. */
export function priceIdOfSubscription(subscription) {
  return subscription?.items?.data?.[0]?.price?.id
    || subscription?.items?.data?.[0]?.plan?.id
    || null;
}

/** Amount (dollars) for a plan, from the server catalog — never the browser. */
export function priceForPlan(plan) {
  if (!isValidPlan(plan)) {
    throw Object.assign(new Error('Unknown plan.'), { status: 400, code: 'invalid_plan' });
  }
  return PLAN_PRICES[plan];
}
