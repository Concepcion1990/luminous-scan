/**
 * T15 test helpers — trial reminders (owner decision 2026-11-12:
 * reminders ON). Builds on the T4 harness (real Express app over
 * pg-mem, mock Stripe, in-memory mail sink) and adds a direct
 * subscription fixture plus a mailer kill switch: the "mailer
 * unconfigured" case is simulated by a sink that throws
 * EmailNotConfigured, exactly what sendMail does when no Resend key
 * is set.
 */
export * from '../t4/helpers.js';
import crypto from 'node:crypto';
import { pool, mailbox } from '../t4/helpers.js';
import { __setMailSink, EmailNotConfigured } from '../../server/email.js';

/** Insert a subscriptions row directly (the sweep's source of truth). */
export async function insertSubscription({
  businessId,
  ownerId,
  plan = 'essentials',
  status = 'trialing',
  trialEndsAt = null,
  cancelAtPeriodEnd = false,
}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO subscriptions (id, business_id, owner_id, provider_subscription_id, provider_customer_id, plan, status, trial_ends_at, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, businessId, ownerId, `sub_test_${id.slice(0, 8)}`, `cus_test_${id.slice(0, 8)}`, plan, status, trialEndsAt, cancelAtPeriodEnd],
  );
  return id;
}

/** Reminder emails in the sink for one recipient (optionally one kind by subject part). */
export function reminderMail(email, subjectPart) {
  return mailbox.filter(
    (m) => m.to === email && m.subject.includes('trial') && (!subjectPart || m.subject.includes(subjectPart)),
  );
}

/** The mailer goes down: every send throws EmailNotConfigured. */
export function mailerDown() {
  __setMailSink(async () => {
    throw new EmailNotConfigured('RESEND_API_KEY is not set (test simulation).');
  });
}

/** The mailer comes back: sends land in the shared sink again. */
export function mailerUp() {
  __setMailSink(async (message) => {
    mailbox.push(message);
  });
}

export async function ledgerRows(subscriptionId) {
  const { rows } = await pool.query(
    'SELECT * FROM trial_reminder_sends WHERE subscription_id = $1 ORDER BY kind',
    [subscriptionId],
  );
  return rows;
}
