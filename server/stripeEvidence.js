/**
 * Stripe evidence adapter — T4 (stripe-build-plan Phase 3 §3.1).
 *
 * Maps Stripe objects to the grant's inputs. Stripe has no "cycle
 * number" and no "order APPROVED": renewal ordering is by invoice
 * number + billing_reason (subscription_create = first payment,
 * subscription_cycle = renewal). A grant for an already-applied
 * invoice is a no-op (idempotent), never a re-grant.
 *
 * The grant NEVER trusts the browser: plan comes from the Stripe
 * Price ID (server catalog), dates come from Stripe's trial_end /
 * current_period_end, amounts come from the Stripe invoice.
 */
import { planForPriceId, priceIdOfSubscription } from './stripeCatalog.js';

export const GRANTABLE_STATUSES = ['trialing', 'active', 'past_due'];

export function stripeStatusToEntitlement(status) {
  if (status === 'trialing') return 'trialing';
  if (status === 'active') return 'active';
  if (status === 'past_due') return 'past_due';
  if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') return 'canceled';
  return null; // incomplete, incomplete_expired, paused, etc. — refused
}

/** Unix seconds → ISO string (or null). */
export function stripeTsToIso(seconds) {
  if (!seconds || !Number.isFinite(Number(seconds))) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

/**
 * Evidence for a grant, from a Stripe subscription (+ its first
 * invoice when one is known). Throws an Error with .status/.code
 * when the evidence cannot support a grant.
 */
export function evidenceFromSubscription({ subscription, invoice = null, session = null } = {}) {
  if (!subscription || typeof subscription !== 'object') {
    throw Object.assign(new Error('No Stripe subscription to verify.'), { status: 502, code: 'subscription_unverified' });
  }
  const priceId = priceIdOfSubscription(subscription);
  const plan = planForPriceId(priceId);
  if (!plan) {
    throw Object.assign(new Error('The Stripe subscription is for a price this app does not sell.'), { status: 502, code: 'price_mismatch' });
  }
  const entitlementStatus = stripeStatusToEntitlement(subscription.status);
  if (!entitlementStatus || entitlementStatus === 'canceled') {
    throw Object.assign(new Error('The Stripe subscription is not in a state that grants access.'), { status: 502, code: 'subscription_not_grantable' });
  }
  if (invoice && String(invoice.currency || '').toLowerCase() !== 'usd') {
    throw Object.assign(new Error('The Stripe invoice is not in USD.'), { status: 502, code: 'currency_mismatch' });
  }
  const trialEndsAt = stripeTsToIso(subscription.trial_end);
  const periodEndsAt = stripeTsToIso(subscription.current_period_end);
  if (!periodEndsAt) {
    throw Object.assign(new Error('Stripe did not confirm a paid-through date.'), { status: 502, code: 'subscription_paid_through_unverified' });
  }
  return {
    plan,
    priceId,
    status: entitlementStatus,
    stripeStatus: subscription.status,
    subscriptionId: subscription.id,
    customerId: subscription.customer || session?.customer || null,
    trialEndsAt,
    periodEndsAt,
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    invoiceNumber: invoice?.number || null,
    billingReason: invoice?.billing_reason || null,
    amountPaid: invoice?.amount_paid ?? null,
    currency: invoice ? String(invoice.currency || 'usd').toUpperCase() : 'USD',
    metadata: { ...(subscription.metadata || {}), ...(session?.metadata || {}) },
  };
}

/** Renewal ordering key: invoice number + billing_reason. */
export function invoiceOrderingKey(invoice) {
  return { number: invoice?.number || null, billingReason: invoice?.billing_reason || null };
}

/** True when this invoice is a renewal (not the first payment). */
export function isRenewalInvoice(invoice) {
  return invoice?.billing_reason === 'subscription_cycle';
}

/** True when this invoice is the first paid charge (refund clock starts here). */
export function isFirstPaidCharge(invoice) {
  return invoice?.billing_reason === 'subscription_create'
    && Number(invoice?.amount_paid || 0) > 0
    && invoice?.status === 'paid';
}
