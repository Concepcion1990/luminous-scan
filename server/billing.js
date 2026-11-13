/**
 * Billing core — T4 (stripe-build-plan Phases 3 + 6, twin plan §2.5).
 *
 * ATOMICITY DECISION (twin plan §5.2 — decided here by the fact the
 * twin HAS real Postgres, and tested in tests/t4/grant.test.js):
 * the grant's multi-row write runs inside ONE Postgres transaction
 * (BEGIN/COMMIT via a single client). If any row fails, the whole
 * grant rolls back — no half-granted business, no claimed event
 * without its entitlement. This is the honest version of atomicity:
 * a real transaction, not a claim of one. The idempotent event
 * claim (provider + event id, UNIQUE) sits inside the same
 * transaction, so a duplicate delivery is a no-op and a retry after
 * a partial failure is safe.
 *
 * Grant only on Stripe-verified evidence — never browser-supplied
 * amounts, dates, or plan names (see server/stripeEvidence.js).
 */
import crypto from 'node:crypto';
import { evidenceFromSubscription, stripeTsToIso, isFirstPaidCharge } from './stripeEvidence.js';
import { consumeTrial } from './trialEligibility.js';
import { priceForPlan } from './stripeCatalog.js';

export const CANCELLATION_GRACE_DAYS = 15;
export const REFUND_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 72 hours
export const CANCELLATION_WIPE_SENTENCE =
  'After the 15-day grace period ends, your account and all its information are permanently deleted and cannot be recovered.';

export const GRANDFATHERED_BUSINESS_ID = '6aeaec9b141cfe26e5a411be';

/** Run fn inside one Postgres transaction on a single client. */
export async function withTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rollback failing means the connection is already dead; the
      // transaction is gone either way.
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Claim a Stripe event idempotently (provider + event id). Returns
 * true when this call claimed it, false when it was already claimed
 * (duplicate delivery → no-op). Must run inside the grant's
 * transaction so claim and grant commit together.
 */
export async function claimEvent(client, { provider = 'stripe', eventId, businessId = null, kind = '', payload = null }) {
  if (!eventId) {
    throw Object.assign(new Error('Cannot claim a Stripe event without an event id.'), { status: 500, code: 'event_claim_failed' });
  }
  // Select-then-insert (not ON CONFLICT ... RETURNING row-count):
  // pg-mem returns the conflicting row from a DO NOTHING RETURNING,
  // so the count cannot tell a fresh claim from a duplicate there.
  // The UNIQUE (provider, event_id) constraint still guards real
  // Postgres against a race — a violation here means already claimed.
  const existing = await client.query(
    'SELECT id FROM subscription_events WHERE provider = $1 AND event_id = $2 LIMIT 1',
    [provider, eventId],
  );
  if (existing.rows.length > 0) return false;
  try {
    await client.query(
      `INSERT INTO subscription_events (id, provider, event_id, business_id, kind, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), provider, eventId, businessId, kind, payload ? JSON.stringify(payload) : ''],
    );
  } catch (error) {
    if (String(error.message || '').includes('duplicate') || error.code === '23505') return false;
    throw error;
  }
  return true;
}

export async function eventAlreadyClaimed(pool, provider, eventId) {
  const { rows } = await pool.query(
    'SELECT id FROM subscription_events WHERE provider = $1 AND event_id = $2 LIMIT 1',
    [provider, eventId],
  );
  return rows.length > 0;
}

async function upsertSubscription(client, { businessId, ownerId, ownerEmail, evidence, sessionId }) {
  const { rows } = await client.query(
    `INSERT INTO subscriptions
       (id, business_id, owner_id, provider, provider_subscription_id, provider_customer_id,
        provider_checkout_id, plan, status, trial_ends_at, current_period_end,
        cancel_at_period_end, grace_ends_at, last_provider_event_id, last_invoice_number,
        amount, currency, created_by_id, created_by)
     VALUES ($1, $2, $3, 'stripe', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'USD', $3, $16)
     ON CONFLICT (business_id) DO UPDATE SET
       provider_subscription_id = EXCLUDED.provider_subscription_id,
       provider_customer_id = EXCLUDED.provider_customer_id,
       provider_checkout_id = CASE WHEN EXCLUDED.provider_checkout_id = '' THEN subscriptions.provider_checkout_id ELSE EXCLUDED.provider_checkout_id END,
       plan = EXCLUDED.plan,
       status = EXCLUDED.status,
       trial_ends_at = EXCLUDED.trial_ends_at,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       grace_ends_at = EXCLUDED.grace_ends_at,
       last_provider_event_id = EXCLUDED.last_provider_event_id,
       last_invoice_number = CASE WHEN EXCLUDED.last_invoice_number = '' THEN subscriptions.last_invoice_number ELSE EXCLUDED.last_invoice_number END,
       amount = EXCLUDED.amount,
       updated_at = NOW()
     RETURNING *`,
    [
      crypto.randomUUID(), businessId, ownerId,
      evidence.subscriptionId, evidence.customerId || '', sessionId || '',
      evidence.plan, evidence.status, evidence.trialEndsAt, evidence.periodEndsAt,
      evidence.cancelAtPeriodEnd,
      evidence.status === 'canceled' && evidence.periodEndsAt
        ? new Date(Date.parse(evidence.periodEndsAt) + CANCELLATION_GRACE_DAYS * 86_400_000).toISOString()
        : null,
      evidence.eventId || '', evidence.invoiceNumber || '',
      priceForPlan(evidence.plan), ownerEmail,
    ],
  );
  return rows[0];
}

async function upsertEntitlement(client, { businessId, ownerId, ownerEmail, evidence }) {
  const { rows } = await client.query(
    `INSERT INTO entitlements (id, business_id, plan, status, trial_ends_at, period_ends_at, created_by_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (business_id) DO UPDATE SET
       plan = EXCLUDED.plan,
       status = EXCLUDED.status,
       trial_ends_at = EXCLUDED.trial_ends_at,
       period_ends_at = EXCLUDED.period_ends_at,
       updated_at = NOW()
     RETURNING *`,
    [
      crypto.randomUUID(), businessId, evidence.plan, evidence.status,
      evidence.trialEndsAt, evidence.periodEndsAt, ownerId, ownerEmail,
    ],
  );
  return rows[0];
}

/**
 * Grant (or renew) access from Stripe-verified evidence, atomically.
 * `eventId` is the idempotency key for this grant (a Stripe event id
 * for webhooks, a Checkout Session id for reconcile). A second call
 * with the same eventId is a no-op returning { already: true }.
 * A renewal (same subscription, newer invoice) extends the period.
 *
 * Returns { granted: true, already: false, plan, status,
 * trialEndsAt, periodEndsAt, subscription, entitlement }.
 */
export async function grantFromEvidence(pool, { businessId, ownerId, ownerEmail, subscription, invoice = null, session = null, eventId, kind = 'grant', skipClaim = false }) {
  if (businessId === GRANDFATHERED_BUSINESS_ID) {
    throw Object.assign(new Error('That workspace has complimentary access and is never granted to by a billing flow.'), { status: 403, code: 'complimentary_business_account_protected' });
  }
  const evidence = evidenceFromSubscription({ subscription, invoice, session });
  evidence.eventId = eventId;
  return withTx(pool, async (client) => {
    if (!skipClaim) {
      const claimed = await claimEvent(client, {
        eventId,
        businessId,
        kind,
        payload: { subscription: subscription.id, plan: evidence.plan, status: evidence.status, invoice: evidence.invoiceNumber },
      });
      if (!claimed) return { granted: false, already: true, plan: evidence.plan, status: evidence.status };
    }
    // Renewal ordering: refuse an older invoice than the one already applied.
    const existing = await client.query('SELECT last_invoice_number FROM subscriptions WHERE business_id = $1 LIMIT 1', [businessId]);
    const lastNumber = existing.rows[0]?.last_invoice_number || '';
    if (evidence.invoiceNumber && lastNumber && evidence.invoiceNumber <= lastNumber && evidence.billingReason === 'subscription_cycle') {
      return { granted: false, already: true, plan: evidence.plan, status: evidence.status, reason: 'older_invoice' };
    }
    const subscriptionRow = await upsertSubscription(client, { businessId, ownerId, ownerEmail, evidence, sessionId: session?.id || null });
    const entitlement = await upsertEntitlement(client, { businessId, ownerId, ownerEmail, evidence });
    // Mark the pending purchase completed (join key: session id or subscription id).
    if (session?.id || evidence.subscriptionId) {
      await client.query(
        `UPDATE purchases SET status = 'completed', provider_subscription_id = $3, updated_at = NOW()
          WHERE business_id = $1 AND status = 'pending'
            AND (provider_checkout_id = $2 OR provider_subscription_id = $3)`,
        [businessId, session?.id || '', evidence.subscriptionId],
      );
    }
    // A trial grant consumes the email's one trial (defense in depth:
    // checkout already checked eligibility before offering it).
    if (evidence.status === 'trialing') {
      await consumeTrial(client, ownerEmail, evidence.plan);
    }
    return {
      granted: true,
      already: false,
      plan: evidence.plan,
      status: evidence.status,
      trialEndsAt: evidence.trialEndsAt,
      periodEndsAt: evidence.periodEndsAt,
      subscription: subscriptionRow,
      entitlement,
    };
  });
}

/**
 * The cancel → grace → wipe state for one business, from its
 * entitlement row (server-side mirror of src/lib/cancellationGrace.js).
 *   full_access — canceled but the paid period has not ended yet.
 *   grace       — paid period ended, inside the 15-day read-only window.
 *   locked      — grace ended (wipe due) or canceled with no verifiable date.
 *   not_applicable — any non-canceled status.
 */
export async function graceStateFor(pool, businessId, now = new Date()) {
  const { rows } = await pool.query(
    'SELECT plan, status, period_ends_at FROM entitlements WHERE business_id = $1 LIMIT 1',
    [businessId],
  );
  const record = rows[0];
  if (!record || record.status === 'grandfathered') return { state: 'not_applicable', paidThrough: null, graceEndsAt: null };
  if (record.status !== 'canceled') return { state: 'not_applicable', paidThrough: null, graceEndsAt: null };
  const paidThroughMs = Date.parse(record.period_ends_at || '');
  if (!Number.isFinite(paidThroughMs)) {
    // Fail closed: a canceled entitlement with no verifiable
    // paid-through date is locked, never silently granted.
    return { state: 'locked', paidThrough: null, graceEndsAt: null };
  }
  const paidThrough = new Date(paidThroughMs).toISOString();
  const graceEndsAt = new Date(paidThroughMs + CANCELLATION_GRACE_DAYS * 86_400_000).toISOString();
  if (now.getTime() < paidThroughMs) return { state: 'full_access', paidThrough, graceEndsAt };
  if (now.getTime() < paidThroughMs + CANCELLATION_GRACE_DAYS * 86_400_000) return { state: 'grace', paidThrough, graceEndsAt };
  return { state: 'locked', paidThrough, graceEndsAt };
}

/** Throw 403 grace_read_only when the business is in grace or locked. */
export async function assertNotInGrace(pool, businessId) {
  const grace = await graceStateFor(pool, businessId);
  if (grace.state === 'grace' || grace.state === 'locked') {
    throw Object.assign(
      new Error('This workspace is read-only: the subscription ended and the 15-day grace period allows viewing products only. No changes, scanning, importing, or exporting.'),
      { status: 403, code: 'grace_read_only', grace },
    );
  }
}

/**
 * The 3-day refund window, from Stripe's FIRST paid charge (the
 * first invoice.paid with billing_reason subscription_create and
 * amount_paid > 0) — not from the trial start, not from a local
 * record. Returns { open, firstChargeAt, firstChargeId }.
 */
export async function refundWindowFor(pool, stripe, subscriptionId, now = new Date()) {
  const invoices = await stripe.listInvoicesBySubscription(subscriptionId);
  const first = invoices
    .filter((invoice) => isFirstPaidCharge(invoice))
    .sort((a, b) => Number(a.created || 0) - Number(b.created || 0))[0];
  if (!first) return { open: false, firstChargeAt: null, firstChargeId: null };
  const firstChargeAt = stripeTsToIso(first.created);
  const open = now.getTime() - Number(first.created) * 1000 <= REFUND_WINDOW_MS;
  return { open, firstChargeAt, firstChargeId: first.id || null };
}

// ---------------------------------------------------------------------------
// Wipe sweep — the twin MUST build it (Base44 never did).
// Deletes the account + ALL its information 15 days after paid-through,
// KEEPS the TrialHistory row, logs every deletion.
// ---------------------------------------------------------------------------

/** Businesses whose grace has ended (subscription- or entitlement-driven). */
export async function wipeCandidates(pool, now = new Date()) {
  const { rows } = await pool.query(
    `SELECT DISTINCT b.id AS business_id, b.owner_id
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       LEFT JOIN entitlements e ON e.business_id = b.id
      WHERE (s.status = 'canceled' AND s.grace_ends_at IS NOT NULL AND s.grace_ends_at <= $1)
         OR (e.status = 'canceled' AND e.period_ends_at IS NOT NULL
             AND e.period_ends_at <= $2)`,
    [now.toISOString(), new Date(now.getTime() - CANCELLATION_GRACE_DAYS * 86_400_000).toISOString()],
  );
  return rows;
}

/**
 * One sweep run. For each candidate business, the OWNER's account is
 * wiped only when EVERY business they own is past grace — a user with
 * another live business is never wiped because one business lapsed.
 * Deleting the user row cascades businesses, memberships, sessions,
 * products, stock, staff, orders, subscriptions, purchases and
 * events (FK ON DELETE CASCADE). TrialHistory has no user FK and is
 * deliberately NOT deleted. Returns the run summary (also logged).
 */
export async function runWipeSweep(pool, { now = new Date(), logger = console } = {}) {
  const candidates = await wipeCandidates(pool, now);
  const wiped = [];
  const skipped = [];
  for (const candidate of candidates) {
    const ownerId = candidate.owner_id;
    const { rows: owned } = await pool.query(
      'SELECT id FROM businesses WHERE owner_id = $1 ORDER BY created_at ASC',
      [ownerId],
    );
    // Is every business this owner has past grace?
    let allPastGrace = true;
    for (const business of owned) {
      const grace = await graceStateFor(pool, business.id, now);
      if (grace.state !== 'locked') {
        // A business with no canceled entitlement is live — never wipe.
        const { rows: sub } = await pool.query('SELECT status, grace_ends_at FROM subscriptions WHERE business_id = $1 LIMIT 1', [business.id]);
        const subPastGrace = sub[0]?.status === 'canceled' && sub[0]?.grace_ends_at && Date.parse(sub[0].grace_ends_at) <= now.getTime();
        if (!subPastGrace) { allPastGrace = false; break; }
      }
    }
    if (!allPastGrace) {
      skipped.push({ ownerId, businessId: candidate.business_id, reason: 'owner_has_live_business' });
      continue;
    }
    const { rows: userRows } = await pool.query('SELECT email FROM users WHERE id = $1 LIMIT 1', [ownerId]);
    const email = userRows[0]?.email || null;
    const businessIds = owned.map((business) => business.id);
    await withTx(pool, async (client) => {
      // Explicit deletes for rows the user-delete cascade may not
      // cover (defense in depth — the cascade is the primary path).
      for (const businessId of businessIds) {
        await client.query('DELETE FROM subscription_events WHERE business_id = $1', [businessId]);
        await client.query('DELETE FROM purchases WHERE business_id = $1', [businessId]);
        await client.query('DELETE FROM subscriptions WHERE business_id = $1', [businessId]);
      }
      await client.query('DELETE FROM users WHERE id = $1', [ownerId]);
    });
    const entry = { ownerId, email, businessIds, wipedAt: now.toISOString() };
    wiped.push(entry);
    logger.log(`[twin] wipe sweep: deleted account ${ownerId} (${email || 'no email'}) — businesses ${businessIds.join(', ')} — 15-day grace ended. TrialHistory row kept.`);
  }
  const summary = { ranAt: now.toISOString(), wiped, skipped, candidateCount: candidates.length };
  logger.log(`[twin] wipe sweep complete: ${wiped.length} account(s) wiped, ${skipped.length} skipped, ${candidates.length} candidate business(es).`);
  return summary;
}
