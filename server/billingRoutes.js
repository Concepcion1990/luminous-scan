/**
 * Billing routes — T4 (stripe-build-plan Phases 2–6, twin plan §5.2).
 *
 *   POST /api/billing/checkout            hosted Stripe Checkout (trial or paid)
 *   POST /api/billing/reconcile           Thank You auto-retry target (Stripe evidence only)
 *   GET  /api/billing/readiness           real config: keys, webhook secret, attestations
 *   GET  /api/billing/trial-eligibility   trial offered for this email? (owner only)
 *   GET  /api/billing/status              re-reads from Stripe, not just the local record
 *   GET  /api/billing/publisher-access     server-side yes/no (PR #63 ported shape)
 *   POST /api/billing/plan-change/preview  real quote from Stripe
 *   POST /api/billing/plan-change         upgrade/downgrade on the SAME subscription
 *   POST /api/billing/cancel              cancel_at_period_end only, never immediate delete
 *   POST /api/billing/payment-update      past-due payment update (Checkout setup mode)
 *   POST /api/billing/wipe-sweep          daily wipe job (job-secret protected)
 *   POST /api/billing/trial-reminder-sweep trial reminder job (job-secret protected)
 *   POST /webhooks/stripe                 Stripe webhook (mounted separately, express.raw)
 *
 * Every grant rides on Stripe-verified evidence (server/billing.js).
 * No route ever trusts browser-supplied amounts, dates, or plans.
 * No Customer Portal (Q-2 default: IN-APP ONLY). No tax line
 * (Q-1 default: prices stay tax_behavior unspecified).
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { getPool } from './db.js';
import {
  stripeApi,
  stripeMode,
  stripeConfigured,
  stripeLiveEnabled,
  stripeSecretKey,
  idempotencyKey,
  verifyWebhookSignature,
} from './stripeClient.js';
import {
  priceIdForPlan,
  priceForPlan,
  isValidPlan,
  planForPriceId,
  priceIdOfSubscription,
} from './stripeCatalog.js';
import { checkTrialEligibility, reserveTrial } from './trialEligibility.js';
import { runTrialReminderSweep } from './trialReminders.js';
import {
  evidenceFromSubscription,
  stripeTsToIso,
  isRenewalInvoice,
} from './stripeEvidence.js';
import {
  grantFromEvidence,
  graceStateFor,
  refundWindowFor,
  runWipeSweep,
  claimEvent,
  eventAlreadyClaimed,
  withTx,
  CANCELLATION_GRACE_DAYS,
  GRANDFATHERED_BUSINESS_ID,
} from './billing.js';

const PUBLISHER_OWNER_EMAIL = 'cperezcarrillo.1990@gmail.com';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({
      error: error.code || 'error',
      message: error.message,
      ...(error.state ? { state: error.state } : {}),
    });
  }
  console.error('[twin] billing route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

async function loadBusiness(pool, businessId) {
  if (!businessId) return null;
  const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1 LIMIT 1', [businessId]);
  return rows[0] ?? null;
}

async function requireOwnerBusiness(pool, user, businessId) {
  const business = await loadBusiness(pool, businessId);
  if (!business) throw err(404, 'business_not_found', 'That workspace could not be found.');
  if (business.owner_id !== user.id) {
    throw err(403, 'subscription_owner_required', 'Only the business owner can manage this subscription.');
  }
  return business;
}

function baseUrl(req) {
  const protocol = req.protocol || 'https';
  return `${protocol}://${req.get('host')}`;
}

/** Readiness from real config (Stripe keys, webhook secret, attestations). */
export function assessReadiness() {
  const mode = stripeMode();
  const stripe_configured = mode !== null;
  const webhook_configured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const attestations = {
    fulfillment_tests_passed: process.env.STRIPE_FULFILLMENT_TESTS_PASSED === 'true',
    test_containment_verified: process.env.STRIPE_TEST_CONTAINMENT_VERIFIED === 'true',
    checkout_enabled: process.env.STRIPE_CHECKOUT_ENABLED === 'true',
  };
  let test_prices_configured = null;
  if (mode === 'test') {
    test_prices_configured = Boolean(
      process.env.STRIPE_TEST_PRICE_ESSENTIALS && process.env.STRIPE_TEST_PRICE_BUSINESS,
    );
  }
  const ready = stripe_configured
    && webhook_configured
    && (mode !== 'test' || test_prices_configured === true)
    && attestations.fulfillment_tests_passed
    && attestations.test_containment_verified
    && attestations.checkout_enabled;
  return {
    ready,
    stripe_mode: mode,
    stripe_configured,
    stripe_live_enabled: stripeLiveEnabled(),
    webhook_configured,
    test_prices_configured,
    attestations,
    state: ready ? 'ready' : 'provider_test_mode_and_atomic_fulfillment_not_yet_verified',
  };
}

function requireReady() {
  const readiness = assessReadiness();
  if (!readiness.ready) {
    throw Object.assign(
      new Error('Subscriptions are not ready yet — Stripe checkout is still being verified. Nothing has been charged.'),
      { status: 503, code: 'stripe_not_configured', state: readiness.state },
    );
  }
  return readiness;
}

export function createBillingRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);

  // ---- Readiness ------------------------------------------------------
  router.get('/billing/readiness', auth, asyncHandler(async (_req, res) => {
    return res.json(assessReadiness());
  }));

  // ---- Publisher access (PR #63 ported shape: server-side yes/no) -----
  router.get('/billing/publisher-access', auth, asyncHandler(async (req, res) => {
    const pool = getPoolFn();
    const email = String(req.user?.email || '').trim().toLowerCase();
    let publisher = email === PUBLISHER_OWNER_EMAIL;
    if (!publisher) {
      const { rows } = await pool.query(
        'SELECT 1 FROM businesses WHERE id = $1 AND owner_id = $2 LIMIT 1',
        [GRANDFATHERED_BUSINESS_ID, req.user.id],
      );
      publisher = rows.length > 0;
    }
    return res.json({ publisher });
  }));

  // ---- Trial eligibility (owner only) ---------------------------------
  router.get('/billing/trial-eligibility', auth, asyncHandler(async (req, res) => {
    const pool = getPoolFn();
    const businessId = req.query.business_id;
    if (businessId) await requireOwnerBusiness(pool, req.user, businessId);
    const result = await checkTrialEligibility(pool, req.user.email);
    return res.json({
      trial_eligible: result.eligible,
      reason: result.reason,
      email: result.email,
      message: result.eligible
        ? 'This email is eligible for one 7-day free trial.'
        : 'This email has subscribed before, so a new trial is not available — you will be charged today.',
    });
  }));

  // ---- Checkout ---------------------------------------------------------
  router.post('/billing/checkout', auth, asyncHandler(async (req, res) => {
    const pool = getPoolFn();
    const plan = req.body?.plan;
    const businessId = req.body?.business_id;
    if (!isValidPlan(plan)) {
      throw err(400, 'invalid_plan', 'Choose Essentials or Business to continue.');
    }
    const business = await requireOwnerBusiness(pool, req.user, businessId);
    if (business.id === GRANDFATHERED_BUSINESS_ID) {
      throw err(403, 'complimentary_business_account_protected', 'That workspace has complimentary access and is never charged.');
    }
    const readiness = requireReady();
    const mode = readiness.stripe_mode;

    // No second simultaneous subscription: a live trialing/active/
    // past-due entitlement never gets a fresh checkout. A canceled
    // one may resubscribe (fresh subscription, no second trial).
    const { rows: entRows } = await pool.query(
      'SELECT status FROM entitlements WHERE business_id = $1 LIMIT 1',
      [business.id],
    );
    const entStatus = entRows[0]?.status;
    if (['active', 'trialing', 'past_due'].includes(entStatus)) {
      throw err(409, 'already_subscribed', 'This workspace already has a subscription. Plan changes use the existing subscription.');
    }

    // No-second-trial check by EMAIL, before any trial is offered.
    const eligibility = await checkTrialEligibility(pool, req.user.email);
    const trialEligible = eligibility.eligible;
    const priceId = priceIdForPlan(plan, mode);
    const amount = priceForPlan(plan);

    // Pending purchase FIRST — before the customer leaves the app.
    const purchaseId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO purchases (id, business_id, owner_id, plan, status, amount, currency, trial_eligible, created_by_id, created_by)
       VALUES ($1, $2, $3, $4, 'pending', $5, 'USD', $6, $3, $7)`,
      [purchaseId, business.id, req.user.id, plan, amount, trialEligible, req.user.email],
    );

    const metadata = { business_id: business.id, owner_id: req.user.id, purchase_id: purchaseId, plan };
    const origin = baseUrl(req);
    const session = await stripeApi.createCheckoutSession({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      ...(trialEligible ? { trial_period_days: 7 } : {}),
      success_url: `${origin}/ThankYou?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/subscribe?canceled=1`,
      customer_email: req.user.email,
      client_reference_id: purchaseId,
      metadata,
      'subscription_data[metadata][business_id]': business.id,
      'subscription_data[metadata][owner_id]': req.user.id,
      'subscription_data[metadata][purchase_id]': purchaseId,
      'subscription_data[metadata][plan]': plan,
    }, { idempotencyKey: idempotencyKey(business.id, purchaseId, 'checkout') });

    await pool.query(
      'UPDATE purchases SET provider_checkout_id = $1, updated_at = NOW() WHERE id = $2',
      [session.id, purchaseId],
    );
    if (trialEligible) {
      await reserveTrial(pool, req.user.email, plan);
    }
    return res.json({
      url: session.url,
      session_id: session.id,
      purchase_id: purchaseId,
      plan,
      trial_eligible: trialEligible,
      message: trialEligible
        ? 'Your 7-day free trial starts when checkout completes — you will not be charged today.'
        : 'This email has subscribed before, so a new trial is not available — you will be charged today.',
    });
  }));

  // ---- Reconcile (Thank You auto-retry target) ---------------------------
  router.post('/billing/reconcile', auth, asyncHandler(async (req, res) => {
    const pool = getPoolFn();
    const sessionId = req.body?.session_id;
    const requestedBusinessId = req.body?.business_id || null;
    if (!sessionId) {
      throw err(400, 'invalid_request', 'No checkout session to verify.');
    }
    const session = await stripeApi.getCheckoutSession(sessionId);
    const subscription = typeof session.subscription === 'object'
      ? session.subscription
      : session.subscription ? await stripeApi.getSubscription(session.subscription) : null;
    if (!subscription) {
      return res.json({ state: 'not_verified', detail: 'Stripe has not finished setting up this checkout yet.' });
    }
    const metadata = { ...(subscription.metadata || {}), ...(session.metadata || {}) };
    const businessId = metadata.business_id;
    if (!businessId) {
      return res.json({ state: 'not_verified', detail: 'Stripe did not confirm which workspace this checkout belongs to.' });
    }
    if (requestedBusinessId && requestedBusinessId !== businessId) {
      throw err(400, 'invalid_request', 'That checkout does not belong to this workspace.');
    }
    const business = await requireOwnerBusiness(pool, req.user, businessId);
    if (business.id === GRANDFATHERED_BUSINESS_ID) {
      throw err(403, 'complimentary_business_account_protected', 'That workspace has complimentary access and is never granted to by a billing flow.');
    }
    // The pending purchase is the join key — it must exist before any grant.
    const purchaseId = metadata.purchase_id;
    const { rows: purchaseRows } = await pool.query(
      'SELECT * FROM purchases WHERE id = $1 AND business_id = $2 LIMIT 1',
      [purchaseId, businessId],
    );
    if (!purchaseRows.length) {
      return res.json({ state: 'not_verified', detail: 'No pending checkout was found for this workspace.' });
    }
    // Defense in depth: a trial grant is refused if the email check
    // says ineligible — EXCEPT when this same subscription is already
    // granted to this business (an idempotent re-reconcile of the
    // trial that consumed it must not be refused for having done so).
    // The checkout-time reservation for THIS trial does not count
    // against it — only a *consumed* trial, or a *different* Stripe
    // subscription for the same email, refuses.
    const { rows: existingSub } = await pool.query(
      'SELECT provider_subscription_id FROM subscriptions WHERE business_id = $1 LIMIT 1',
      [businessId],
    );
    const alreadyGrantedHere = existingSub[0]?.provider_subscription_id === subscription.id;
    if (subscription.status === 'trialing' && !alreadyGrantedHere) {
      const { rows: historyRows } = await pool.query(
        'SELECT status FROM trial_history WHERE LOWER(email) = LOWER($1) LIMIT 1',
        [req.user.email],
      );
      if (historyRows[0]?.status === 'consumed') {
        return res.json({ state: 'trial_not_eligible', detail: 'This email has already used its one free trial.' });
      }
      const customers = await stripeApi.listCustomersByEmail(req.user.email);
      for (const customer of customers) {
        const subs = await stripeApi.listSubscriptionsByCustomer(customer.id);
        if (subs.some((sub) => sub.id !== subscription.id)) {
          return res.json({ state: 'trial_not_eligible', detail: 'This email has already used its one free trial.' });
        }
      }
    }
    const invoices = await stripeApi.listInvoicesBySubscription(subscription.id);
    const firstInvoice = invoices.find((invoice) => invoice.billing_reason === 'subscription_create') || invoices[0] || null;
    const result = await grantFromEvidence(pool, {
      businessId,
      ownerId: req.user.id,
      ownerEmail: req.user.email,
      subscription,
      invoice: firstInvoice,
      session,
      eventId: `reconcile:${sessionId}`,
      kind: 'reconcile',
    });
    return res.json({
      state: result.already ? 'already_active' : 'granted',
      plan: result.plan,
      status: result.status,
      trial_ends_at: result.trialEndsAt || null,
      period_ends_at: result.periodEndsAt || null,
    });
  }));

  // ---- Subscription status (re-reads from Stripe) -----------------------
  router.get('/billing/status', auth, asyncHandler(async (req, res) => {
    const pool = getPoolFn();
    const businessId = req.query.business_id;
    const business = await requireOwnerBusiness(pool, req.user, businessId);
    const { rows } = await pool.query(
      'SELECT * FROM subscriptions WHERE business_id = $1 LIMIT 1',
      [business.id],
    );
    const record = rows[0];
    if (!record || !record.provider_subscription_id) {
      return res.json({ state: 'unavailable', provider: 'stripe', billing_status: 'PENDING', business_id: business.id });
    }
    let subscription;
    try {
      subscription = await stripeApi.getSubscription(record.provider_subscription_id);
    } catch (error) {
      // A failed/unverified lookup is NOT proof billing stopped.
      console.error('[twin] billing status re-read failed:', error.message);
      return res.json({ state: 'unavailable', provider: 'stripe', billing_status: 'PENDING', business_id: business.id });
    }
    const statusMap = { trialing: 'TRIALING', active: 'ACTIVE', past_due: 'PAST_DUE', canceled: 'CANCELED' };
    const billingStatus = statusMap[subscription.status] || 'PENDING';
    // Keep the local record honest (best effort, never fails the read).
    try {
      await pool.query(
        `UPDATE subscriptions SET status = $1, trial_ends_at = $2, current_period_end = $3,
           cancel_at_period_end = $4, updated_at = NOW() WHERE business_id = $5`,
        [
          subscription.status,
          stripeTsToIso(subscription.trial_end),
          stripeTsToIso(subscription.current_period_end),
          subscription.cancel_at_period_end === true,
          business.id,
        ],
      );
    } catch (error) {
      console.error('[twin] billing status local update failed:', error.message);
    }
    const refund = await refundWindowFor(pool, stripeApi, subscription.id);
    return res.json({
      state: 'verified',
      provider: 'stripe',
      billing_status: billingStatus,
      checked_at: new Date().toISOString(),
      business_id: business.id,
      plan: planForPriceId(priceIdOfSubscription(subscription)) || record.plan,
      status: subscription.status,
      trial_ends_at: stripeTsToIso(subscription.trial_end),
      period_ends_at: stripeTsToIso(subscription.current_period_end),
      cancel_at_period_end: subscription.cancel_at_period_end === true,
      refund_window_open: refund.open,
      first_charge_at: refund.firstChargeAt,
    });
  }));

  // ---- Plan-change preview ----------------------------------------------
  router.post('/billing/plan-change/preview', auth, asyncHandler(async (req, res) => {
    const pool = getPoolFn();
    const targetPlan = req.body?.target_plan;
    const businessId = req.body?.business_id;
    if (!isValidPlan(targetPlan)) throw err(400, 'invalid_plan', 'Choose Essentials or Business.');
    await requireOwnerBusiness(pool, req.user, businessId);
    const { rows } = await pool.query(
      'SELECT * FROM subscriptions WHERE business_id = $1 LIMIT 1',
      [businessId],
    );
    const record = rows[0];
    if (!record || !record.provider_subscription_id) {
      throw err(400, 'no_verified_subscription_record', 'No verified subscription was found for this workspace.');
    }
    const subscription = await stripeApi.getSubscription(record.provider_subscription_id);
    if (!['trialing', 'active'].includes(subscription.status)) {
      throw err(400, 'subscription_not_changeable', 'Only a trial or active subscription can change plans.');
    }
    const currentPlan = planForPriceId(priceIdOfSubscription(subscription)) || record.plan;
    if (currentPlan === targetPlan) {
      throw err(400, 'invalid_plan', 'That is already the current plan.');
    }
    const isUpgrade = targetPlan === 'business';
    const trialEndsAt = stripeTsToIso(subscription.trial_end);
    const periodEndsAt = stripeTsToIso(subscription.current_period_end);
    // Upgrade: effective now, price difference on the NEXT invoice,
    // trial end unchanged (first Business charge at trial end).
    // Downgrade: Business until period end, then Essentials, no refund.
    return res.json({
      current_plan: currentPlan,
      target_plan: targetPlan,
      target_price: priceForPlan(targetPlan),
      effective_at: isUpgrade ? new Date().toISOString() : periodEndsAt,
      first_charge_at: isUpgrade
        ? (subscription.status === 'trialing' ? trialEndsAt : periodEndsAt)
        : periodEndsAt,
      trial_ends_at: trialEndsAt,
      proration_behavior: isUpgrade ? 'create_prorations' : 'none',
    });
  }));

  // ---- Plan-change execution (ONE function, same subscription) -----------
  router.post('/billing/plan-change', auth, asyncHandler(async (req, res) => {
    const pool = getPoolFn();
    const targetPlan = req.body?.target_plan;
    const businessId = req.body?.business_id;
    if (!isValidPlan(targetPlan)) throw err(400, 'invalid_plan', 'Choose Essentials or Business.');
    const business = await requireOwnerBusiness(pool, req.user, businessId);
    if (business.id === GRANDFATHERED_BUSINESS_ID) {
      throw err(403, 'complimentary_business_account_protected', 'That workspace has complimentary access and is never changed by a billing flow.');
    }
    const { rows } = await pool.query(
      'SELECT * FROM subscriptions WHERE business_id = $1 LIMIT 1',
      [businessId],
    );
    const record = rows[0];
    if (!record || !record.provider_subscription_id) {
      throw err(400, 'no_verified_subscription_record', 'No verified subscription was found for this workspace.');
    }
    const subscription = await stripeApi.getSubscription(record.provider_subscription_id);
    if (!['trialing', 'active'].includes(subscription.status)) {
      throw err(400, 'subscription_not_changeable', 'Only a trial or active subscription can change plans.');
    }
    const currentPlan = planForPriceId(priceIdOfSubscription(subscription)) || record.plan;
    if (currentPlan === targetPlan) {
      throw err(400, 'invalid_plan', 'That is already the current plan.');
    }
    // Double-tap cannot double-apply: a claimed plan change returns
    // the recorded answer without another Stripe call. (Checked after
    // the same-plan refusal, so an already-flipped plan answers
    // honestly as same-plan instead of already_recorded.)
    if (await eventAlreadyClaimed(pool, 'stripe', `plan-change:${businessId}:${record.provider_subscription_id}:${targetPlan}`)) {
      return res.json({ state: 'already_recorded', current_plan: record.plan, target_plan: targetPlan });
    }
    const isUpgrade = targetPlan === 'business';
    const mode = stripeMode();
    const targetPriceId = priceIdForPlan(targetPlan, mode);
    const itemId = subscription.items?.data?.[0]?.id;
    if (!itemId) {
      throw err(502, 'subscription_unverified', 'Stripe did not confirm the subscription items.');
    }
    const updateParams = {
      'items[0][id]': itemId,
      'items[0][price]': targetPriceId,
      proration_behavior: isUpgrade ? 'create_prorations' : 'none',
    };
    // Upgrade during a trial carries trial_end explicitly so the trial
    // is not ended early and the first Business charge lands at trial end.
    if (isUpgrade && subscription.status === 'trialing' && subscription.trial_end) {
      updateParams.trial_end = subscription.trial_end;
    }
    const updated = await stripeApi.updateSubscription(record.provider_subscription_id, updateParams, {
      idempotencyKey: idempotencyKey(businessId, record.provider_subscription_id, `plan-change:${targetPlan}`),
    });
    // Re-read and verify: new Price ID + trial end preserved.
    const verified = await stripeApi.getSubscription(record.provider_subscription_id);
    if (priceIdOfSubscription(verified) !== targetPriceId) {
      throw err(502, 'subscription_unverified', 'Stripe did not confirm the plan change. Nothing was changed in the app.');
    }
    if (isUpgrade && subscription.status === 'trialing' && verified.trial_end !== subscription.trial_end) {
      throw err(502, 'upgrade_trial_end_unverified', 'Stripe did not preserve the trial end. Nothing was changed in the app.');
    }
    const effectiveAt = isUpgrade
      ? new Date().toISOString()
      : stripeTsToIso(verified.current_period_end);
    const firstChargeAt = isUpgrade
      ? (verified.status === 'trialing' ? stripeTsToIso(verified.trial_end) : stripeTsToIso(verified.current_period_end))
      : stripeTsToIso(verified.current_period_end);
    await withTx(pool, async (client) => {
      await claimEvent(client, {
        eventId: `plan-change:${businessId}:${record.provider_subscription_id}:${targetPlan}`,
        businessId,
        kind: 'plan_change',
        payload: { from: currentPlan, to: targetPlan, subscription: verified.id },
      });
      if (isUpgrade) {
        // Upgrade is effective now: the entitlement flips now.
        await client.query(
          `UPDATE subscriptions SET plan = $1, status = $2, trial_ends_at = $3, current_period_end = $4,
             pending_plan = NULL, pending_plan_effective_at = NULL, updated_at = NOW() WHERE business_id = $5`,
          [targetPlan, verified.status, stripeTsToIso(verified.trial_end), stripeTsToIso(verified.current_period_end), businessId],
        );
        await client.query(
          `UPDATE entitlements SET plan = $1, status = $2, trial_ends_at = $3, period_ends_at = $4, updated_at = NOW()
            WHERE business_id = $5`,
          [targetPlan, verified.status, stripeTsToIso(verified.trial_end), stripeTsToIso(verified.current_period_end), businessId],
        );
      } else {
        // Downgrade is effective next cycle: Business until period end.
        // The entitlement flips AT the effective date via webhook, not now.
        await client.query(
          `UPDATE subscriptions SET pending_plan = $1, pending_plan_effective_at = $2, updated_at = NOW()
            WHERE business_id = $3`,
          [targetPlan, effectiveAt, businessId],
        );
      }
    });
    return res.json({
      state: 'plan_change_recorded',
      current_plan: currentPlan,
      target_plan: targetPlan,
      target_price: priceForPlan(targetPlan),
      effective_at: effectiveAt,
      first_charge_at: firstChargeAt,
      trial_ends_at: stripeTsToIso(verified.trial_end),
      proration_behavior: isUpgrade ? 'create_prorations' : 'none',
    });
  }));

  // ---- Cancel (cancel_at_period_end only) --------------------------------
  router.post('/billing/cancel', auth, asyncHandler(async (req, res) => {
    const pool = getPoolFn();
    const businessId = req.body?.business_id;
    const business = await requireOwnerBusiness(pool, req.user, businessId);
    if (business.id === GRANDFATHERED_BUSINESS_ID) {
      throw err(403, 'complimentary_business_account_protected', 'That workspace has complimentary access and is never canceled by a billing flow.');
    }
    const { rows } = await pool.query(
      'SELECT * FROM subscriptions WHERE business_id = $1 LIMIT 1',
      [businessId],
    );
    const record = rows[0];
    if (!record || !record.provider_subscription_id) {
      throw err(400, 'no_verified_subscription_record', 'No verified subscription was found for this workspace.');
    }
    // Double-tap cannot double-cancel: an already-canceled-at-period-end
    // subscription returns the same answer without another Stripe call.
    if (record.cancel_at_period_end) {
      const refund = await refundWindowFor(pool, stripeApi, record.provider_subscription_id);
      return res.json({
        state: 'already_canceled',
        access_until: record.current_period_end,
        grace_ends_at: record.grace_ends_at,
        refund_window_open: refund.open,
        first_charge_at: refund.firstChargeAt,
      });
    }
    const subscription = await stripeApi.getSubscription(record.provider_subscription_id);
    if (subscription.status === 'canceled') {
      throw err(400, 'already_ended', 'This subscription has already ended, so there is nothing more to cancel.');
    }
    const updated = await stripeApi.updateSubscription(
      record.provider_subscription_id,
      { cancel_at_period_end: 'true' },
      { idempotencyKey: idempotencyKey(businessId, record.provider_subscription_id, 'cancel') },
    );
    // Verify at Stripe before recording anything.
    const verified = await stripeApi.getSubscription(record.provider_subscription_id);
    if (verified.cancel_at_period_end !== true || !verified.current_period_end) {
      throw err(502, 'subscription_paid_through_unverified', 'Stripe did not confirm the cancellation. Nothing was changed.');
    }
    const periodEndsAt = stripeTsToIso(verified.current_period_end);
    const graceEndsAt = new Date(Date.parse(periodEndsAt) + CANCELLATION_GRACE_DAYS * 86_400_000).toISOString();
    await withTx(pool, async (client) => {
      await claimEvent(client, {
        eventId: `cancel:${businessId}:${record.provider_subscription_id}`,
        businessId,
        kind: 'cancel',
        payload: { subscription: verified.id, effective_at: periodEndsAt },
      });
      await client.query(
        `UPDATE subscriptions SET status = 'canceled', cancel_at_period_end = TRUE,
           cancellation_requested_at = NOW(), cancellation_effective_at = $1, grace_ends_at = $2,
           current_period_end = $1, updated_at = NOW() WHERE business_id = $3`,
        [periodEndsAt, graceEndsAt, businessId],
      );
      await client.query(
        `UPDATE entitlements SET status = 'canceled', period_ends_at = $1, updated_at = NOW()
          WHERE business_id = $2`,
        [periodEndsAt, businessId],
      );
    });
    const refund = await refundWindowFor(pool, stripeApi, record.provider_subscription_id);
    return res.json({
      state: 'cancellation_recorded',
      access_until: periodEndsAt,
      grace_ends_at: graceEndsAt,
      refund_window_open: refund.open,
      first_charge_at: refund.firstChargeAt,
    });
  }));

  // ---- Past-due payment update (Checkout setup mode; no portal) ----------
  router.post('/billing/payment-update', auth, asyncHandler(async (req, res) => {
    const pool = getPoolFn();
    const businessId = req.body?.business_id;
    const business = await requireOwnerBusiness(pool, req.user, businessId);
    requireReady();
    const { rows } = await pool.query(
      'SELECT * FROM subscriptions WHERE business_id = $1 LIMIT 1',
      [business.id],
    );
    const record = rows[0];
    if (!record || !record.provider_subscription_id) {
      throw err(400, 'no_verified_subscription_record', 'No verified subscription was found for this workspace.');
    }
    const origin = baseUrl(req);
    const session = await stripeApi.createCheckoutSession({
      mode: 'setup',
      success_url: `${origin}/settings?payment_updated=1`,
      cancel_url: `${origin}/upgrade?payment_canceled=1`,
      customer_email: req.user.email,
      metadata: { business_id: business.id, owner_id: req.user.id, purpose: 'payment_update' },
    }, { idempotencyKey: idempotencyKey(business.id, record.provider_subscription_id, 'payment-update') });
    return res.json({ url: session.url, session_id: session.id });
  }));

  // ---- Wipe sweep (job endpoint; job-secret protected) --------------------
  router.post('/billing/wipe-sweep', asyncHandler(async (req, res) => {
    const pool = getPoolFn();
    const jobSecret = process.env.BILLING_JOB_SECRET;
    if (!jobSecret) {
      return res.status(503).json({ error: 'wipe_job_not_configured', message: 'The wipe sweep is not configured.' });
    }
    const provided = req.get('x-job-secret');
    if (!provided || provided !== jobSecret) {
      return res.status(401).json({ error: 'not_authorized', message: 'A valid job secret is required.' });
    }
    const summary = await runWipeSweep(pool, { now: new Date() });
    return res.json(summary);
  }));

  // ---- Trial reminder sweep (job endpoint; job-secret protected) ---------
  router.post('/billing/trial-reminder-sweep', asyncHandler(async (req, res) => {
    const pool = getPoolFn();
    const jobSecret = process.env.BILLING_JOB_SECRET;
    if (!jobSecret) {
      return res.status(503).json({ error: 'reminder_job_not_configured', message: 'The trial reminder sweep is not configured.' });
    }
    const provided = req.get('x-job-secret');
    if (!provided || provided !== jobSecret) {
      return res.status(401).json({ error: 'not_authorized', message: 'A valid job secret is required.' });
    }
    const summary = await runTrialReminderSweep(pool, { now: new Date() });
    return res.json(summary);
  }));

  return router;
}

// ---------------------------------------------------------------------------
// Stripe webhook — POST /webhooks/stripe (express.raw, raw body kept).
// ---------------------------------------------------------------------------

export async function stripeWebhookHandler(req, res) {
  const pool = getPool();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'stripe_not_configured', message: 'Stripe webhook is not configured.' });
  }
  if (!pool) {
    return res.status(503).json({ error: 'database_not_configured', message: 'Postgres is not configured.' });
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  const check = verifyWebhookSignature(rawBody, req.get('stripe-signature'), secret);
  if (!check.ok) {
    console.error(`[twin] Stripe webhook rejected (${check.reason}) — never 200 for an unverified event.`);
    return res.status(400).json({ error: 'invalid_signature', reason: check.reason });
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_payload', message: 'Webhook body is not valid JSON.' });
  }
  const eventId = event?.id;
  const eventType = event?.type;
  if (!eventId || !eventType) {
    return res.status(400).json({ error: 'invalid_payload', message: 'Webhook event has no id or type.' });
  }
  // Idempotent claim BEFORE handling; a duplicate delivery is a 200 no-op.
  if (await eventAlreadyClaimed(pool, 'stripe', eventId)) {
    return res.json({ received: true, duplicate: true });
  }
  const claimed = await (async () => {
    try {
      return await withTx(pool, async (client) => claimEvent(client, {
        eventId, kind: eventType, payload: event,
      }));
    } catch {
      return false;
    }
  })();
  if (!claimed) return res.json({ received: true, duplicate: true });

  const fail = async (error) => {
    // Remove the claim so Stripe's retry can re-handle this event.
    console.error(`[twin] Stripe webhook ${eventType} (${eventId}) failed:`, error.message);
    await pool.query('DELETE FROM subscription_events WHERE provider = $1 AND event_id = $2', ['stripe', eventId]);
    return res.status(500).json({ error: 'webhook_handling_failed', message: 'The event could not be handled yet.' });
  };

  try {
    const result = await handleStripeEvent(pool, event);
    return res.json({ received: true, ...result });
  } catch (error) {
    return fail(error);
  }
}

async function businessAndOwnerFor(pool, metadata) {
  const businessId = metadata?.business_id;
  if (!businessId) return { business: null, owner: null };
  const business = await loadBusiness(pool, businessId);
  if (!business) return { business: null, owner: null };
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [business.owner_id]);
  return { business, owner: rows[0] || null };
}

async function handleStripeEvent(pool, event) {
  const type = event.type;
  const object = event.data?.object || {};
  console.log(`[twin] Stripe webhook ${type} (${event.id})`);

  switch (type) {
    case 'checkout.session.completed': {
      const session = await stripeApi.getCheckoutSession(object.id);
      const subscription = typeof session.subscription === 'object'
        ? session.subscription
        : session.subscription ? await stripeApi.getSubscription(session.subscription) : null;
      if (!subscription) return { handled: false, reason: 'no_subscription_yet' };
      const { business, owner } = await businessAndOwnerFor(pool, { ...(subscription.metadata || {}), ...(session.metadata || {}) });
      if (!business || !owner) return { handled: false, reason: 'unknown_business' };
      const invoices = await stripeApi.listInvoicesBySubscription(subscription.id);
      const firstInvoice = invoices.find((invoice) => invoice.billing_reason === 'subscription_create') || invoices[0] || null;
      const result = await grantFromEvidence(pool, {
        businessId: business.id, ownerId: owner.id, ownerEmail: owner.email,
        subscription, invoice: firstInvoice, session,
        eventId: event.id, kind: type, skipClaim: true,
      });
      return { handled: true, granted: result.granted, already: result.already };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      let subscription;
      try {
        subscription = await stripeApi.getSubscription(object.id);
      } catch {
        subscription = object;
      }
      const { business, owner } = await businessAndOwnerFor(pool, subscription.metadata || {});
      if (!business || !owner) return { handled: false, reason: 'unknown_business' };
      if (type === 'customer.subscription.created') {
        if (!['trialing', 'active'].includes(subscription.status)) return { handled: true, granted: false };
        const result = await grantFromEvidence(pool, {
          businessId: business.id, ownerId: owner.id, ownerEmail: owner.email,
          subscription, invoice: null, session: null,
          eventId: event.id, kind: type, skipClaim: true,
        });
        return { handled: true, granted: result.granted, already: result.already };
      }
      // Updated: apply status/period changes; flip a pending downgrade
      // AT its effective date, never before.
      const { rows } = await pool.query('SELECT * FROM subscriptions WHERE business_id = $1 LIMIT 1', [business.id]);
      const record = rows[0];
      const stripePlan = planForPriceId(priceIdOfSubscription(subscription));
      const effectiveAt = record?.pending_plan_effective_at ? Date.parse(record.pending_plan_effective_at) : null;
      const downgradeDue = record?.pending_plan
        && stripePlan === record.pending_plan
        && effectiveAt !== null && Date.now() >= effectiveAt;
      await withTx(pool, async (client) => {
        if (downgradeDue) {
          await client.query(
            `UPDATE subscriptions SET plan = $1, status = $2, trial_ends_at = $3, current_period_end = $4,
               pending_plan = NULL, pending_plan_effective_at = NULL, updated_at = NOW() WHERE business_id = $5`,
            [record.pending_plan, subscription.status, stripeTsToIso(subscription.trial_end), stripeTsToIso(subscription.current_period_end), business.id],
          );
          await client.query(
            `UPDATE entitlements SET plan = $1, status = $2, trial_ends_at = $3, period_ends_at = $4, updated_at = NOW()
              WHERE business_id = $5`,
            [record.pending_plan, subscription.status, stripeTsToIso(subscription.trial_end), stripeTsToIso(subscription.current_period_end), business.id],
          );
        } else {
          await client.query(
            `UPDATE subscriptions SET status = $1, trial_ends_at = $2, current_period_end = $3,
               cancel_at_period_end = $4, updated_at = NOW() WHERE business_id = $5`,
            [subscription.status, stripeTsToIso(subscription.trial_end), stripeTsToIso(subscription.current_period_end), subscription.cancel_at_period_end === true, business.id],
          );
          if (subscription.status === 'canceled' || subscription.cancel_at_period_end === true) {
            const periodEndsAt = stripeTsToIso(subscription.current_period_end);
            const graceEndsAt = periodEndsAt
              ? new Date(Date.parse(periodEndsAt) + CANCELLATION_GRACE_DAYS * 86_400_000).toISOString()
              : null;
            await client.query(
              `UPDATE subscriptions SET status = 'canceled', cancellation_effective_at = $1, grace_ends_at = $2, updated_at = NOW()
                WHERE business_id = $3`,
              [periodEndsAt, graceEndsAt, business.id],
            );
            await client.query(
              `UPDATE entitlements SET status = 'canceled', period_ends_at = $1, updated_at = NOW()
                WHERE business_id = $2`,
              [periodEndsAt, business.id],
            );
          } else if (stripePlan) {
            await client.query(
              `UPDATE entitlements SET plan = $1, status = $2, trial_ends_at = $3, period_ends_at = $4, updated_at = NOW()
                WHERE business_id = $5`,
              [stripePlan, subscription.status, stripeTsToIso(subscription.trial_end), stripeTsToIso(subscription.current_period_end), business.id],
            );
          }
        }
      });
      return { handled: true, downgrade_applied: Boolean(downgradeDue) };
    }

    case 'customer.subscription.deleted': {
      let subscription = object;
      try {
        subscription = await stripeApi.getSubscription(object.id);
      } catch {
        subscription = object;
      }
      const { business } = await businessAndOwnerFor(pool, subscription.metadata || {});
      if (!business) return { handled: false, reason: 'unknown_business' };
      const periodEndsAt = stripeTsToIso(subscription.current_period_end);
      const graceEndsAt = periodEndsAt
        ? new Date(Date.parse(periodEndsAt) + CANCELLATION_GRACE_DAYS * 86_400_000).toISOString()
        : null;
      await withTx(pool, async (client) => {
        await client.query(
          `UPDATE subscriptions SET status = 'canceled', cancellation_effective_at = $1, grace_ends_at = $2,
             current_period_end = $1, updated_at = NOW() WHERE business_id = $3`,
          [periodEndsAt, graceEndsAt, business.id],
        );
        await client.query(
          `UPDATE entitlements SET status = 'canceled', period_ends_at = $1, updated_at = NOW()
            WHERE business_id = $2`,
          [periodEndsAt, business.id],
        );
      });
      return { handled: true };
    }

    case 'invoice.paid': {
      let invoice = object;
      try {
        invoice = await stripeApi.getInvoice(object.id);
      } catch {
        invoice = object;
      }
      const subscriptionId = invoice.subscription || object.subscription;
      if (!subscriptionId) return { handled: false, reason: 'no_subscription' };
      const subscription = await stripeApi.getSubscription(subscriptionId);
      const { business, owner } = await businessAndOwnerFor(pool, subscription.metadata || {});
      if (!business || !owner) return { handled: false, reason: 'unknown_business' };
      // Renewal grant (subscription_cycle) extends the period; the
      // first payment (subscription_create) grants the same way.
      const result = await grantFromEvidence(pool, {
        businessId: business.id, ownerId: owner.id, ownerEmail: owner.email,
        subscription, invoice, session: null,
        eventId: event.id, kind: type, skipClaim: true,
      });
      return { handled: true, granted: result.granted, already: result.already, renewal: isRenewalInvoice(invoice) };
    }

    case 'invoice.payment_failed': {
      const subscriptionId = object.subscription;
      if (!subscriptionId) return { handled: false, reason: 'no_subscription' };
      let subscription;
      try {
        subscription = await stripeApi.getSubscription(subscriptionId);
      } catch {
        subscription = object;
      }
      const { business } = await businessAndOwnerFor(pool, subscription.metadata || {});
      if (!business) return { handled: false, reason: 'unknown_business' };
      // Past-due: mark it, do NOT revoke. Stripe retries on its own
      // schedule; the app never cancels a past-due subscription early.
      await pool.query(
        `UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE business_id = $1`,
        [business.id],
      );
      await pool.query(
        `UPDATE entitlements SET status = 'past_due', updated_at = NOW() WHERE business_id = $1`,
        [business.id],
      );
      return { handled: true };
    }

    case 'customer.subscription.trial_will_end': {
      // Fires 3 days before trial end. Trial reminders stay OFF
      // (delivery gated, owner go-ahead required) — log only.
      return { handled: true, note: 'trial reminders are off' };
    }

    case 'charge.refunded': {
      const charge = object;
      const invoiceId = charge.invoice;
      if (!invoiceId) return { handled: false, reason: 'no_invoice' };
      let invoice;
      try {
        invoice = await stripeApi.getInvoice(invoiceId);
      } catch {
        return { handled: false, reason: 'invoice_unverified' };
      }
      const subscriptionId = invoice.subscription;
      if (!subscriptionId) return { handled: false, reason: 'no_subscription' };
      const subscription = await stripeApi.getSubscription(subscriptionId);
      const { business } = await businessAndOwnerFor(pool, subscription.metadata || {});
      if (!business) return { handled: false, reason: 'unknown_business' };
      // Refund confirmed: paid access ends now; the 15-day grace
      // clock starts now. The subscription record itself is kept
      // (the no-second-trial check needs the history).
      const nowIso = new Date().toISOString();
      const graceEndsAt = new Date(Date.now() + CANCELLATION_GRACE_DAYS * 86_400_000).toISOString();
      await withTx(pool, async (client) => {
        await claimEvent(client, {
          eventId: `refund_confirmed:${business.id}:${subscriptionId}`,
          businessId: business.id,
          kind: 'refund_confirmed',
          payload: { charge: charge.id, invoice: invoiceId },
        });
        await client.query(
          `UPDATE subscriptions SET status = 'canceled', current_period_end = $1, grace_ends_at = $2,
             updated_at = NOW() WHERE business_id = $3`,
          [nowIso, graceEndsAt, business.id],
        );
        await client.query(
          `UPDATE entitlements SET status = 'canceled', period_ends_at = $1, updated_at = NOW()
            WHERE business_id = $2`,
          [nowIso, business.id],
        );
      });
      return { handled: true, refund_confirmed: true };
    }

    default:
      // Unknown events: 200, logged, ignored.
      return { handled: false, reason: 'unknown_event_ignored' };
  }
}
