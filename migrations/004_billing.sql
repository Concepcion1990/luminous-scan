-- 004_billing.sql — T4 Stripe billing (twin plan §7 Phase T4; stripe-build-plan Phases 1–6).
--
-- Tables:
--   subscriptions       one row per business: Stripe ids, plan/status,
--                       trial + period ends, cancel-at-period-end,
--                       pending plan change (downgrade), last event id.
--   trial_history       one row per email. PERMANENT RETENTION: the
--                       post-grace wipe sweep NEVER deletes this table —
--                       it is the no-second-trial memory (with Stripe's
--                       own records by email). See server/billing.js.
--   subscription_events idempotency + audit log: every Stripe event is
--                       claimed here first (provider + event id UNIQUE);
--                       a duplicate delivery is a no-op.
--   purchases           pending purchase created BEFORE the customer
--                       leaves for Stripe Checkout; completed by the
--                       grant, never by the browser.
--
-- Conventions as in 003_shop.sql: TEXT ids, TIMESTAMPTZ dates,
-- NUMERIC money, audit columns on every row.

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE REFERENCES businesses (id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_subscription_id TEXT NOT NULL DEFAULT '',
  provider_customer_id TEXT NOT NULL DEFAULT '',
  provider_checkout_id TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'essentials' CHECK (plan IN ('essentials', 'business')),
  status TEXT NOT NULL DEFAULT 'pending_checkout',
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancellation_requested_at TIMESTAMPTZ,
  cancellation_effective_at TIMESTAMPTZ,
  grace_ends_at TIMESTAMPTZ,
  pending_plan TEXT CHECK (pending_plan IS NULL OR pending_plan IN ('essentials', 'business')),
  pending_plan_effective_at TIMESTAMPTZ,
  last_provider_event_id TEXT NOT NULL DEFAULT '',
  last_invoice_number TEXT NOT NULL DEFAULT '',
  amount NUMERIC,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_business_id ON subscriptions (business_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_subscription_id ON subscriptions (provider_subscription_id);

-- TrialHistory: NEVER wiped. The wipe sweep (server/billing.js
-- runWipeSweep) deletes the account and all its information but keeps
-- these rows (email + plan + dates only), so a returning email never
-- gets a second free trial.
CREATE TABLE IF NOT EXISTS trial_history (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'essentials' CHECK (plan IN ('essentials', 'business')),
  status TEXT NOT NULL DEFAULT 'eligible' CHECK (status IN ('eligible', 'reserved', 'consumed', 'needs_review')),
  source TEXT NOT NULL DEFAULT 'stripe_checkout',
  first_trial_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trial_history_email ON trial_history (email);

CREATE TABLE IF NOT EXISTS subscription_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'stripe',
  event_id TEXT NOT NULL,
  business_id TEXT REFERENCES businesses (id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_id)
);
CREATE INDEX IF NOT EXISTS idx_subscription_events_business_id ON subscription_events (business_id);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'essentials' CHECK (plan IN ('essentials', 'business')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'canceled')),
  provider_checkout_id TEXT NOT NULL DEFAULT '',
  provider_subscription_id TEXT NOT NULL DEFAULT '',
  amount NUMERIC,
  currency TEXT NOT NULL DEFAULT 'USD',
  trial_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchases_business_id ON purchases (business_id);
CREATE INDEX IF NOT EXISTS idx_purchases_provider_checkout_id ON purchases (provider_checkout_id);
