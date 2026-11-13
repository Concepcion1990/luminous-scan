/**
 * No-second-trial check — T4 (stripe-build-plan §6.5, shared by
 * checkout AND reconcile — defense in depth).
 *
 * A trial is offered only when BOTH sources say the email is fresh:
 *   (a) TrialHistory for the email: status reserved/consumed = no
 *       new trial. TrialHistory is NEVER wiped (see 004_billing.sql).
 *   (b) Stripe by email: any prior subscription in ANY status
 *       (trialing, active, past_due, canceled, incomplete, unpaid)
 *       counts — a trial that never paid still used its trial.
 *
 * A returning customer pays in full up front; the UI says plainly
 * the email already subscribed. The check never trusts the browser.
 */
import crypto from 'node:crypto';
import { stripeApi } from './stripeClient.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function checkTrialEligibility(pool, email, stripe = stripeApi) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { eligible: false, reason: 'invalid_email', email: normalized };

  const { rows } = await pool.query(
    'SELECT * FROM trial_history WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [normalized],
  );
  const history = rows[0] || null;
  if (history && (history.status === 'reserved' || history.status === 'consumed')) {
    return { eligible: false, reason: 'trial_history', email: normalized, history };
  }

  // Stripe by email: customers with this email, then their subscriptions.
  const customers = await stripe.listCustomersByEmail(normalized);
  for (const customer of customers) {
    const subscriptions = await stripe.listSubscriptionsByCustomer(customer.id);
    if (subscriptions.length > 0) {
      return { eligible: false, reason: 'stripe_prior_subscription', email: normalized, customerId: customer.id };
    }
  }
  return { eligible: true, reason: null, email: normalized, history };
}

/** Reserve a trial for an email (called when a trial checkout starts). */
export async function reserveTrial(client, email, plan) {
  const normalized = normalizeEmail(email);
  const { rows } = await client.query(
    `INSERT INTO trial_history (id, email, plan, status, source, first_trial_at)
     VALUES ($1, $2, $3, 'reserved', 'stripe_checkout', NOW())
     ON CONFLICT (email) DO UPDATE SET plan = EXCLUDED.plan, status = 'reserved',
       first_trial_at = COALESCE(trial_history.first_trial_at, NOW()),
       updated_at = NOW()
     RETURNING *`,
    [crypto.randomUUID(), normalized, plan],
  );
  return rows[0];
}

/** Mark a trial as consumed (trial grant landed). */
export async function consumeTrial(client, email, plan) {
  const normalized = normalizeEmail(email);
  const { rows } = await client.query(
    `INSERT INTO trial_history (id, email, plan, status, source, first_trial_at, consumed_at)
     VALUES ($1, $2, $3, 'consumed', 'stripe_checkout', NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET plan = EXCLUDED.plan, status = 'consumed',
       consumed_at = NOW(), updated_at = NOW()
     RETURNING *`,
    [crypto.randomUUID(), normalized, plan],
  );
  return rows[0];
}
