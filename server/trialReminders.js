/**
 * Trial reminders — scheduling + in-app notice windows (owner's
 * Nov 7 design, switched ON 2026-11-12).
 *
 * EMAILS — exactly two per trial, sent by the sweep below:
 *   email_day4      on day 4 of the 7-day trial (once 3 full days
 *                   have passed: trial end more than 24h and at most
 *                   96h away).
 *   email_final24h  inside the last 24 hours before the trial ends.
 * IN-APP NOTICES — three, computed by trialNoticeStage() with the
 * EXACT windows the client uses (src/lib/trialNotices.js), from the
 * same live state: her words are the locale strings
 * plans.trialNoticeFiveDay / ThreeDay / OneDay. The client renders
 * them from the entitlement record it already loads (Dashboard banner
 * + plan summary card); the entitlement's trial_ends_at is written by
 * the same verified grant that writes the subscription row, so the
 * two never disagree. This module is the server-side source of the
 * windows so the sweep and any future reader share one definition.
 *
 * IDEMPOTENCY: migration 013's trial_reminder_sends ledger, UNIQUE
 * (subscription_id, kind). A sweep claims a (subscription, kind) row
 * atomically (INSERT ... ON CONFLICT DO NOTHING) BEFORE sending; only
 * the claim holder sends; success marks the row 'sent'. The claim
 * check compares the returned id against the fresh UUID the sweep
 * generated — a conflict returns either no row (Postgres) or the
 * pre-existing row (some test doubles), and both mean "not yours".
 * A failed send (mailer unconfigured or rejected) RELEASES the claim
 * — the row is deleted — so the email stays pending and a later sweep
 * retries it. Nothing is ever marked sent that did not go out, and no
 * email can be sent twice by repeated or overlapping sweeps.
 *
 * Source of truth is the LIVE subscriptions row at sweep time:
 * status must be 'trialing' with a trial_ends_at in the future.
 * Upgrades that carry trial_end simply move the stored end, and the
 * next sweep/display follows it. Paid (non-trial) subscriptions are
 * never selected. A trial cancelled at period end still receives its
 * reminders — the subscriber keeps the full 7 days (owner's spec) —
 * with the truthful no-charge copy branch.
 *
 * MOBILE/STORE SUBSCRIBERS: Apple/Google hold their trial clock and
 * the mobile app is not built yet, so no store subscriptions exist in
 * this table today. When they do, store trials will feed the same
 * subscriptions state and this sweep + the notice windows will serve
 * them unchanged — no store machinery is invented here.
 */
import crypto from 'node:crypto';
import { sendMail, trialReminderDay4Email, trialReminderFinalEmail } from './email.js';

const HOUR_MS = 60 * 60 * 1000;

export const TRIAL_REMINDER_KINDS = ['email_day4', 'email_final24h'];

/**
 * The in-app notice stage for a subscription-shaped record at `now`,
 * or null. Windows are disjoint — at most one notice ever applies —
 * and identical to src/lib/trialNotices.js:
 *   'one-day'   last 24 hours            -> "24 hours until your trial ends."
 *   'three-day' more than 48h, up to 72h -> "You have 3 more days left on your trial."
 *   'five-day'  more than 96h, up to 120h -> "You have 5 more days left on your trial."
 * Only a live trial (status 'trialing', end in the future) qualifies;
 * a paid or ended subscription gets nothing.
 */
export function trialNoticeStage(record, now = new Date()) {
  if (!record || record.status !== 'trialing' || !record.trial_ends_at) return null;
  const endsMs = Date.parse(record.trial_ends_at);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(endsMs) || !Number.isFinite(nowMs)) return null;
  const remainingMs = endsMs - nowMs;
  if (remainingMs <= 0) return null;
  if (remainingMs <= 24 * HOUR_MS) return 'one-day';
  if (remainingMs > 48 * HOUR_MS && remainingMs <= 72 * HOUR_MS) return 'three-day';
  if (remainingMs > 96 * HOUR_MS && remainingMs <= 120 * HOUR_MS) return 'five-day';
  return null;
}

/**
 * Which reminder emails are DUE for a trialing subscription at `now`.
 * email_day4's own window closes when the final day begins, so a trial
 * first seen inside its last 24 hours receives only the final email,
 * never a stale "day 4" note.
 */
export function dueReminderKinds(record, now = new Date()) {
  if (!record || record.status !== 'trialing' || !record.trial_ends_at) return [];
  const endsMs = Date.parse(record.trial_ends_at);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(endsMs) || !Number.isFinite(nowMs)) return [];
  const remainingMs = endsMs - nowMs;
  if (remainingMs <= 0) return [];
  if (remainingMs <= 24 * HOUR_MS) return ['email_final24h'];
  if (remainingMs <= 96 * HOUR_MS) return ['email_day4'];
  return [];
}

/**
 * One reminder sweep run. Selects every live trial, and for each due
 * kind claims the ledger row, sends, and marks it sent — or releases
 * the claim on failure so a later sweep retries. Returns a summary
 * ({ ranAt, sent, pending, skipped }) in the wipe sweep's shape.
 */
export async function runTrialReminderSweep(pool, { now = new Date(), logger = console } = {}) {
  const { rows: trials } = await pool.query(
    `SELECT s.*, u.email AS owner_email
       FROM subscriptions s
       JOIN users u ON u.id = s.owner_id
      WHERE s.status = 'trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at > $1
      ORDER BY s.trial_ends_at ASC`,
    [now.toISOString()],
  );
  const sent = [];
  const pending = [];
  let skipped = 0;
  for (const sub of trials) {
    for (const kind of dueReminderKinds(sub, now)) {
      const claimId = crypto.randomUUID();
      const claim = await pool.query(
        `INSERT INTO trial_reminder_sends (id, subscription_id, business_id, kind, recipient)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (subscription_id, kind) DO NOTHING
         RETURNING id`,
        [claimId, sub.id, sub.business_id, kind, sub.owner_email],
      );
      if (!claim.rows.length || claim.rows[0].id !== claimId) {
        skipped += 1; // already sent, or another sweep holds the claim
        continue;
      }
      const message = kind === 'email_day4'
        ? trialReminderDay4Email({
          to: sub.owner_email,
          plan: sub.plan,
          trialEndsAt: sub.trial_ends_at,
          cancelAtPeriodEnd: sub.cancel_at_period_end === true,
        })
        : trialReminderFinalEmail({
          to: sub.owner_email,
          plan: sub.plan,
          trialEndsAt: sub.trial_ends_at,
          cancelAtPeriodEnd: sub.cancel_at_period_end === true,
        });
      try {
        await sendMail(message);
      } catch (error) {
        // Release the claim: the email stays pending for a later sweep.
        await pool.query('DELETE FROM trial_reminder_sends WHERE id = $1', [claimId]);
        pending.push({ subscriptionId: sub.id, kind, reason: error.code || 'send_failed' });
        logger.log(`[twin] trial reminder ${kind} for subscription ${sub.id} not sent (${error.message}) — left pending for the next sweep.`);
        continue;
      }
      await pool.query(
        `UPDATE trial_reminder_sends SET status = 'sent', sent_at = $1 WHERE id = $2`,
        [now.toISOString(), claimId],
      );
      sent.push({ subscriptionId: sub.id, kind, to: sub.owner_email });
    }
  }
  const summary = { ranAt: now.toISOString(), sent, pending, skipped, trialCount: trials.length };
  logger.log(`[twin] trial reminder sweep complete: ${sent.length} sent, ${pending.length} pending, ${skipped} already handled, ${trials.length} live trial(s).`);
  return summary;
}
