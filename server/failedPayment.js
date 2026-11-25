/**
 * The failed-payment road — owner's ruling Nov 19, 2026 (staff
 * access ruling Nov 20, 2026); built Nov 21, 2026 (release 341).
 *
 * THE ROAD:
 *   payment fails (verified invoice.payment_failed)
 *     → 14 days of FULL USE (the "payment grace"). Nothing changes
 *       for anyone; only the owner is ever told money is involved.
 *   3 days before the grace ends
 *     → the owner — and only the owner — gets ONE warning: a bell
 *       in her Team activity inbox + an email in her own language
 *       from noreply@luminousstockhaven.com.
 *   day 15
 *     → the subscription is CANCELLED (Stripe's own cancel_at is
 *       set to this instant when the failure lands; the sweep is
 *       the backstop when a webhook is missed) and 15 VIEW-ONLY
 *       days begin: every role can sign in and LOOK, nobody can
 *       change anything, and the shift bracket does not gate
 *       staff — a staffer can always reach their own pay stubs.
 *   view-only ends
 *     → the Nov 7 cancel→wipe sweep deletes the account, exactly
 *       as for a voluntary cancel (subscriptions.grace_ends_at is
 *       set to the view-only end at the transition, so the wipe
 *       machinery needs no second path).
 *   payment fixed at ANY point on the road (grace or view-only)
 *     → every road marker clears inside the grant's transaction;
 *       full use continues/restores with no trace for staff.
 *
 * MARKERS (migration 040): subscriptions.payment_failed_at is the
 * FIRST verified failure of the episode — retries never move it,
 * or a struggling card could hold a workspace in grace forever.
 * payment_grace_ends_at = failed + 14 days. Both mirror onto the
 * entitlements row the access gate reads.
 *
 * WHO NEVER ENTERS: founding-tester comped workspaces (release
 * 338) have no subscriptions row and no Stripe subscription, so
 * no failure can ever be recorded for them; the sweep also skips
 * any business whose entitlement carries the founding-tester
 * mark, as defense in depth (the trial sweep's pattern).
 *
 * STRIPE SIDE (TEST MODE ONLY — the stripeClient live guard
 * refuses live calls unless separately enabled): when the first
 * failure lands, billingRoutes sets the subscription's cancel_at
 * to the grace end, so Stripe itself cancels on day 15 and its
 * webhook confirms the transition. The sweep below attempts the
 * same cancel for any road Stripe has not closed, then runs the
 * app-side transition regardless — state here is driven by the
 * verified failure + the clock, never by assuming Stripe acted.
 */
import crypto from 'node:crypto';
import { withTx } from './billing.js';
import { sendMail, paymentFailedWarningEmail, resolveAccountLanguage } from './email.js';
import { stripeApi } from './stripeClient.js';

export const FAILED_PAYMENT_GRACE_DAYS = 14;
export const FAILED_PAYMENT_VIEW_ONLY_DAYS = 15;
export const FAILED_PAYMENT_WARNING_DAYS_BEFORE = 3;

const DAY_MS = 86_400_000;

/**
 * The road state for a marker pair at `now`:
 *   none       — no live road (no markers, or already recovered)
 *   grace      — inside the 14 full-use days
 *   view_only  — cancelled; inside the 15 view-only days
 *   deletion_due — view-only over; the wipe sweep owns it now
 * Pure: callers pass the row they already hold.
 */
export function failedPaymentRoadState(record, now = new Date()) {
  const failedMs = Date.parse(record?.payment_failed_at || '');
  const graceEndsMs = Date.parse(record?.payment_grace_ends_at || '');
  if (!Number.isFinite(failedMs) || !Number.isFinite(graceEndsMs)) {
    return { state: 'none', failedAt: null, graceEndsAt: null, viewOnlyEndsAt: null };
  }
  const graceEndsAt = new Date(graceEndsMs).toISOString();
  const viewOnlyEndsAt = new Date(graceEndsMs + FAILED_PAYMENT_VIEW_ONLY_DAYS * DAY_MS).toISOString();
  const nowMs = now.getTime();
  if (nowMs < graceEndsMs) return { state: 'grace', failedAt: new Date(failedMs).toISOString(), graceEndsAt, viewOnlyEndsAt };
  if (nowMs < graceEndsMs + FAILED_PAYMENT_VIEW_ONLY_DAYS * DAY_MS) {
    return { state: 'view_only', failedAt: new Date(failedMs).toISOString(), graceEndsAt, viewOnlyEndsAt };
  }
  return { state: 'deletion_due', failedAt: new Date(failedMs).toISOString(), graceEndsAt, viewOnlyEndsAt };
}

/**
 * Record a verified payment failure (webhook path). The FIRST
 * failure of an episode starts the clock; a repeat failure while
 * the road is live changes nothing. Returns the road markers
 * ({ alreadyOnRoad, failedAt, graceEndsAt }) or null when there
 * is no subscription row to mark (a comped workspace — the road
 * can never start there).
 */
export async function recordPaymentFailure(pool, businessId, now = new Date()) {
  return withTx(pool, async (client) => {
    const { rows } = await client.query(
      'SELECT id, payment_failed_at, payment_grace_ends_at FROM subscriptions WHERE business_id = $1 LIMIT 1',
      [businessId],
    );
    const sub = rows[0];
    if (!sub) return null;
    if (sub.payment_failed_at && sub.payment_grace_ends_at) {
      return {
        alreadyOnRoad: true,
        failedAt: new Date(sub.payment_failed_at).toISOString(),
        graceEndsAt: new Date(sub.payment_grace_ends_at).toISOString(),
      };
    }
    const failedAt = now.toISOString();
    const graceEndsAt = new Date(now.getTime() + FAILED_PAYMENT_GRACE_DAYS * DAY_MS).toISOString();
    await client.query(
      `UPDATE subscriptions
          SET payment_failed_at = $1, payment_grace_ends_at = $2,
              payment_warning_sent_at = NULL, payment_road_canceled_at = NULL,
              updated_at = NOW()
        WHERE business_id = $3`,
      [failedAt, graceEndsAt, businessId],
    );
    await client.query(
      `UPDATE entitlements
          SET payment_failed_at = $1, payment_grace_ends_at = $2, updated_at = NOW()
        WHERE business_id = $3`,
      [failedAt, graceEndsAt, businessId],
    );
    return { alreadyOnRoad: false, failedAt, graceEndsAt };
  });
}

/**
 * Clear every road marker (recovery). Runs inside the caller's
 * transaction when one is given (the grant path), or in its own.
 * Idempotent: clearing a road that is not there changes nothing.
 */
export async function clearPaymentRoad(clientOrPool, businessId) {
  await clientOrPool.query(
    `UPDATE subscriptions
        SET payment_failed_at = NULL, payment_grace_ends_at = NULL,
            payment_warning_sent_at = NULL, payment_road_canceled_at = NULL,
            updated_at = NOW()
      WHERE business_id = $1 AND payment_failed_at IS NOT NULL`,
    [businessId],
  );
  await clientOrPool.query(
    `UPDATE entitlements
        SET payment_failed_at = NULL, payment_grace_ends_at = NULL, updated_at = NOW()
      WHERE business_id = $1 AND payment_failed_at IS NOT NULL`,
    [businessId],
  );
}

/**
 * Is this business inside the failed-payment VIEW-ONLY window
 * right now? Judged from the subscriptions row (the road's record
 * of truth): markers live, grace ended, view-only not yet over.
 * The shift bracket (staffWindow.js) consults this so those days
 * never gate a staffer out of their own pay stubs.
 */
export async function businessInFailedPaymentViewOnly(pool, businessId, now = new Date()) {
  const { rows } = await pool.query(
    'SELECT payment_failed_at, payment_grace_ends_at FROM subscriptions WHERE business_id = $1 LIMIT 1',
    [businessId],
  );
  return failedPaymentRoadState(rows[0], now).state === 'view_only';
}

/** The owner's warning bell (workforce_notifications row pattern,
 * owner recipient only — the clock build's ringClockBell shape). */
async function ringOwnerWarningBell(pool, business, { graceEndsAt }) {
  const detail = `A subscription payment did not go through. Full use continues until ${new Date(graceEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} — update the payment method before then to keep everything running.`;
  await pool.query(
    `INSERT INTO workforce_notifications
       (id, business_id, recipient_user_id, recipient_staff_id, recipient_role, actor_staff_id, actor_name, event, detail, entry_id)
     VALUES ($1, $2, $3, NULL, 'owner', NULL, 'Luminous StockHaven', 'payment_failed_warning', $4, NULL)`,
    [crypto.randomUUID(), business.id, business.owner_id, detail],
  );
}

/**
 * One failed-payment sweep run:
 *   1. WARNINGS — roads whose grace ends within the warning
 *      window (3 days) and have not ended: claim the warning on
 *      the subscription row (UPDATE … WHERE payment_warning_sent_at
 *      IS NULL), ring the owner's bell, send the owner's email.
 *      A failed send releases the claim so a later sweep retries;
 *      the bell rings only with a successful claim+send pair, so
 *      the owner can never be warned twice.
 *   2. DAY-15 TRANSITIONS — roads whose grace has ended while the
 *      subscription is still past_due: attempt the Stripe cancel
 *      (TEST mode; a failure is logged, never blocking), then run
 *      the app-side transition in one transaction — subscriptions
 *      + entitlements become canceled with the paid-through date
 *      set to the grace end, and subscriptions.grace_ends_at set
 *      to the view-only end so the existing wipe sweep takes over
 *      from there.
 * Returns a summary in the other sweeps' shape. Never throws into
 * the scheduler (it isolates failures per business).
 */
export async function runFailedPaymentSweep(pool, { now = new Date(), logger = console, stripe = stripeApi } = {}) {
  const summary = { ranAt: now.toISOString(), warned: [], transitioned: [], failures: [] };

  // ---- 1. Warnings -------------------------------------------------
  const warnFrom = now.toISOString();
  const warnUntil = new Date(now.getTime() + FAILED_PAYMENT_WARNING_DAYS_BEFORE * DAY_MS).toISOString();
  const { rows: dueWarnings } = await pool.query(
    `SELECT s.*, u.email AS owner_email, b.language AS business_language, b.id AS biz_id, b.owner_id AS biz_owner_id
       FROM subscriptions s
       JOIN users u ON u.id = s.owner_id
       JOIN businesses b ON b.id = s.business_id
      WHERE s.status = 'past_due'
        AND s.payment_failed_at IS NOT NULL
        AND s.payment_warning_sent_at IS NULL
        AND s.payment_grace_ends_at > $1
        AND s.payment_grace_ends_at <= $2
        AND s.business_id NOT IN (
          SELECT business_id FROM entitlements WHERE status = 'founding_tester'
        )
      ORDER BY s.payment_grace_ends_at ASC`,
    [warnFrom, warnUntil],
  );
  for (const sub of dueWarnings) {
    try {
      const claim = await pool.query(
        `UPDATE subscriptions SET payment_warning_sent_at = $1, updated_at = NOW()
          WHERE id = $2 AND payment_warning_sent_at IS NULL
          RETURNING id`,
        [now.toISOString(), sub.id],
      );
      if (!claim.rows.length) continue; // another sweep holds it
      // The warning is mail to the PERSON about their account,
      // so it speaks the account's language first (migration
      // 052); the business's language is only the fallback for
      // an account that has not been seeded yet.
      const message = paymentFailedWarningEmail({
        to: sub.owner_email,
        plan: sub.plan,
        graceEndsAt: sub.payment_grace_ends_at,
        lang: (await resolveAccountLanguage(pool, sub.biz_owner_id)) || sub.business_language,
      });
      try {
        await sendMail(message);
      } catch (error) {
        await pool.query(
          'UPDATE subscriptions SET payment_warning_sent_at = NULL WHERE id = $1',
          [sub.id],
        );
        summary.failures.push({ businessId: sub.business_id, job: 'warning', reason: error.code || 'send_failed' });
        logger.log(`[twin] failed-payment warning for business ${sub.business_id} not sent (${error.message}) — left pending for the next sweep.`);
        continue;
      }
      await ringOwnerWarningBell(pool, { id: sub.biz_id, owner_id: sub.biz_owner_id }, { graceEndsAt: sub.payment_grace_ends_at });
      summary.warned.push({ businessId: sub.business_id, to: sub.owner_email });
    } catch (error) {
      summary.failures.push({ businessId: sub.business_id, job: 'warning', reason: error.message });
      logger.error(`[twin] failed-payment warning failed for business ${sub.business_id}: ${error.message}`);
    }
  }

  // ---- 2. Day-15 transitions ---------------------------------------
  const { rows: dueTransitions } = await pool.query(
    `SELECT * FROM subscriptions
      WHERE status = 'past_due'
        AND payment_failed_at IS NOT NULL
        AND payment_grace_ends_at IS NOT NULL
        AND payment_grace_ends_at <= $1
        AND business_id NOT IN (
          SELECT business_id FROM entitlements WHERE status = 'founding_tester'
        )
      ORDER BY payment_grace_ends_at ASC`,
    [now.toISOString()],
  );
  for (const sub of dueTransitions) {
    try {
      // Stripe side (TEST mode): cancel the subscription now if
      // Stripe has not already. The live guard inside stripeClient
      // refuses live calls; a failure here never blocks the
      // app-side transition — the verified failure + the ended
      // grace are the state, not Stripe's answer.
      if (sub.provider_subscription_id && stripe?.cancelSubscription) {
        try {
          await stripe.cancelSubscription(sub.provider_subscription_id);
        } catch (error) {
          logger.log(`[twin] failed-payment road: Stripe cancel for business ${sub.business_id} did not complete (${error.message}) — the app-side transition proceeds.`);
        }
      }
      const graceEndsAt = new Date(sub.payment_grace_ends_at).toISOString();
      const viewOnlyEndsAt = new Date(Date.parse(graceEndsAt) + FAILED_PAYMENT_VIEW_ONLY_DAYS * DAY_MS).toISOString();
      await withTx(pool, async (client) => {
        await client.query(
          `UPDATE subscriptions
              SET status = 'canceled', cancellation_effective_at = $1, current_period_end = $1,
                  grace_ends_at = $2, payment_road_canceled_at = $3, cancel_at_period_end = FALSE,
                  updated_at = NOW()
            WHERE business_id = $4 AND status = 'past_due'`,
          [graceEndsAt, viewOnlyEndsAt, now.toISOString(), sub.business_id],
        );
        await client.query(
          `UPDATE entitlements SET status = 'canceled', period_ends_at = $1, updated_at = NOW()
            WHERE business_id = $2`,
          [graceEndsAt, sub.business_id],
        );
      });
      summary.transitioned.push({ businessId: sub.business_id, graceEndsAt, viewOnlyEndsAt });
      logger.log(`[twin] failed-payment road: business ${sub.business_id} cancelled at grace end ${graceEndsAt}; view-only until ${viewOnlyEndsAt}.`);
    } catch (error) {
      summary.failures.push({ businessId: sub.business_id, job: 'transition', reason: error.message });
      logger.error(`[twin] failed-payment transition failed for business ${sub.business_id}: ${error.message}`);
    }
  }

  logger.log(`[twin] failed-payment sweep complete: ${summary.warned.length} owner warning(s), ${summary.transitioned.length} day-15 transition(s), ${summary.failures.length} failure(s).`);
  return summary;
}
