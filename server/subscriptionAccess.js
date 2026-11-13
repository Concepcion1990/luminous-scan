/**
 * Server-side subscription access gate — pre-launch loophole fix
 * (2026-11-13).
 *
 * THE HOLE THIS CLOSES: SubscriptionAccessRoute.jsx is a SCREEN gate.
 * It keeps an unpaid workspace's pages from rendering, but the API
 * never checked the entitlement itself — business routes authorized
 * by ownership/staff access and plan limits only, and planFor()
 * defaults a missing entitlement row to restricted Essentials. A
 * signed-in customer with a pending_checkout (or no) workspace could
 * call the business APIs directly and use the whole app for free.
 * The owner's rule is absolute: only a Stripe-confirmed trial or
 * payment unlocks the app — "we do not want anybody getting on
 * there for free."
 *
 * THE RULE (mirrors SubscriptionAccessRoute + cancellationGrace):
 *   full    — entitlement status active / trialing / past_due;
 *             canceled while period_ends_at is still in the future;
 *             grandfathered ONLY for the publisher's own complimentary
 *             Business workspace (see isPublisherUser) — a
 *             grandfathered row on any other business, or for any
 *             other user, grants nothing.
 *   grace   — canceled, paid period ended, inside the 15-day window:
 *             read-only migration view (products/SKUs/ISBNs only).
 *   denied  — no entitlement row, pending_checkout, canceled past
 *             grace, canceled with no verifiable paid-through date,
 *             or any unknown status. Fail closed, always.
 *
 * ENFORCEMENT (one shared helper, called from every surface):
 *   - server/app.js: path middleware for /api/businesses/:bid/*
 *     (shop, T6 sync/cross-store, workforce, rewards, POS, training,
 *     the Settings business PATCH, the recovery staff-email fix).
 *   - server/entities.js: the generic entity API (its business id
 *     travels in filters/rows, not the path), with the Entitlement
 *     entity itself always readable and grace reads limited to the
 *     products + stock levels the grace view shows.
 *   - POS webhooks: a sale for a business without full access is
 *     recorded HELD (never applied, never lost) — see posSquare /
 *     posShopify holdForPlan.
 *
 * NOT gated (pre-checkout and account flows must keep working):
 * auth (register/verify/login/logout/reset), business list/create/
 * switch, the entitlement read, every /api/billing/* route
 * (eligibility, checkout, reconcile, status, plan change, cancel,
 * payment update), /api/account/* recovery kit, and webhooks.
 */
import { entitlementFor } from './plans.js';
import { loadBusiness } from './authz.js';
import { GRANDFATHERED_BUSINESS_ID, CANCELLATION_GRACE_DAYS } from './billing.js';

/** The publisher/admin login — mirrors src/lib/publisherAccess.js. */
export const PUBLISHER_OWNER_EMAIL = 'cperezcarrillo.1990@gmail.com';

const GRACE_MS = CANCELLATION_GRACE_DAYS * 86_400_000;
const FULL_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** Entities the read-only grace view may still read (GraceInventory). */
export const GRACE_READABLE_ENTITIES = new Set(['Product', 'StockLevel']);

/**
 * The publisher, identified the same way as everywhere else in this
 * codebase (src/lib/publisherAccess.js, /api/billing/publisher-access):
 * the app-owner login, or the creator-owner of the grandfathered
 * business itself.
 */
export function isPublisherUser(user, business) {
  if (!user || !business) return false;
  const email = String(user.email || '').trim().toLowerCase();
  if (email && email === PUBLISHER_OWNER_EMAIL) return true;
  return (
    business.id === GRANDFATHERED_BUSINESS_ID &&
    business.owner_id === user.id &&
    business.created_by_id === user.id
  );
}

/**
 * Pure assessment — the server twin of SubscriptionAccessRoute's
 * `allowed` plus assessCancellationGrace's states.
 * record: the entitlements row (or null). Returns
 * { state: 'full' | 'grace' | 'denied', reason, status, plan,
 *   paidThrough, graceEndsAt }.
 */
export function assessSubscriptionAccess(record, { user = null, business = null, now = new Date() } = {}) {
  const base = {
    status: record?.status ?? null,
    plan: record?.plan ?? null,
    paidThrough: null,
    graceEndsAt: null,
  };
  if (!record) return { ...base, state: 'denied', reason: 'no_entitlement' };
  if (FULL_STATUSES.has(record.status)) return { ...base, state: 'full', reason: 'ok' };
  if (record.status === 'grandfathered') {
    const ok =
      record.plan === 'business' &&
      business?.id === GRANDFATHERED_BUSINESS_ID &&
      (user ? isPublisherUser(user, business) : true);
    return ok
      ? { ...base, state: 'full', reason: 'ok' }
      : { ...base, state: 'denied', reason: 'grandfathered_not_publisher' };
  }
  if (record.status === 'canceled') {
    const paidThroughMs = Date.parse(record.period_ends_at || '');
    if (!Number.isFinite(paidThroughMs)) {
      // Fail closed: canceled with no verifiable paid-through date.
      return { ...base, state: 'denied', reason: 'canceled_no_date' };
    }
    const paidThrough = new Date(paidThroughMs).toISOString();
    const graceEndsAt = new Date(paidThroughMs + GRACE_MS).toISOString();
    if (now.getTime() < paidThroughMs) return { ...base, state: 'full', reason: 'ok', paidThrough, graceEndsAt };
    if (now.getTime() < paidThroughMs + GRACE_MS) return { ...base, state: 'grace', reason: 'in_grace', paidThrough, graceEndsAt };
    return { ...base, state: 'denied', reason: 'past_grace', paidThrough, graceEndsAt };
  }
  // pending_checkout and anything unknown never grant access.
  return { ...base, state: 'denied', reason: 'status_not_granting' };
}

/** Load the business + entitlement and assess, in one call. */
export async function subscriptionAccessFor(pool, user, businessId) {
  const business = await loadBusiness(pool, businessId);
  if (!business) {
    return { state: 'denied', reason: 'no_business', status: null, plan: null, paidThrough: null, graceEndsAt: null, business: null, record: null };
  }
  const record = await entitlementFor(pool, businessId);
  return { ...assessSubscriptionAccess(record, { user, business }), business, record };
}

export function subscriptionDeniedError(gate) {
  return Object.assign(
    new Error('This workspace does not have an active subscription. Subscribe to a plan to use it — access starts only when the trial or payment is confirmed.'),
    { status: 403, code: 'subscription_required', gate },
  );
}

export function graceReadOnlyError(gate) {
  return Object.assign(
    new Error('This workspace is read-only: the subscription ended and the 15-day grace period allows viewing products only. No changes, scanning, importing, or exporting.'),
    {
      status: 403,
      code: 'grace_read_only',
      grace: { state: gate?.state || 'grace', paidThrough: gate?.paidThrough ?? null, graceEndsAt: gate?.graceEndsAt ?? null },
    },
  );
}

/**
 * The assert every business-data surface calls after ownership/staff
 * access is resolved. Options:
 *   write     — a mutation (or scanner use): full access required;
 *               grace refuses with grace_read_only.
 *   graceRead — a read the grace view is allowed (products/stock):
 *               full OR grace passes; anything else refuses.
 * A plain read (write:false, graceRead:false) requires full access —
 * in grace, only the grace view's own reads are open.
 * Returns the gate assessment when access is allowed.
 */
export async function assertSubscriptionAccess(pool, user, businessId, { write = false, graceRead = false } = {}) {
  const gate = await subscriptionAccessFor(pool, user, businessId);
  if (gate.state === 'full') return gate;
  if (gate.state === 'grace') {
    if (!write && graceRead) return gate;
    throw graceReadOnlyError(gate);
  }
  throw subscriptionDeniedError(gate);
}

/** Webhook/internal callers: is this business fully entitled right now? */
export async function hasFullSubscriptionAccess(pool, businessId) {
  const gate = await subscriptionAccessFor(pool, null, businessId);
  return gate.state === 'full';
}
