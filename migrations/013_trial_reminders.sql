-- 013_trial_reminders.sql — Trial reminder emails (owner decision
-- 2026-11-12: reminders ON; Nov 7 design).
--
-- The reminder sweep (server/trialReminders.js) sends exactly TWO
-- emails per trial: one on day 4 and one 24 hours before the trial
-- ends. This ledger is the idempotency memory: one row per
-- (subscription, kind), claimed atomically before the send is
-- attempted, marked 'sent' only after the mailer accepts the message.
-- A claim whose send fails is RELEASED (row deleted by the sweep), so
-- an email whose mailer is down stays pending and a later sweep
-- retries it — never marked sent, never silently dropped.
--
-- Rows cascade away with their subscription (which itself cascades
-- with the business/account wipe) — the ledger only needs to live as
-- long as the trial it guards.

CREATE TABLE IF NOT EXISTS trial_reminder_sends (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions (id) ON DELETE CASCADE,
  business_id TEXT REFERENCES businesses (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('email_day4', 'email_final24h')),
  status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'sent')),
  recipient TEXT NOT NULL DEFAULT '',
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subscription_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_trial_reminder_sends_subscription_id ON trial_reminder_sends (subscription_id);
