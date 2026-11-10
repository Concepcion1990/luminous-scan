import { base44 } from '@/api/client';
import { DEFAULT_PLAN, featureAllowed, limitFor, planOf } from '@/lib/plans';

/** The plan record for one business — a row only exists once it has been set. */
export async function loadEntitlement(businessId) {
  if (!businessId) return null;
  const page = await base44.entities.Entitlement.filter({ business_id: businessId }, { limit: 1 });
  return (page.items ?? [])[0] ?? null;
}

/** The plan rows for several businesses in one call. */
export async function loadEntitlements(businessIds) {
  if (!businessIds?.length) return [];
  const page = await base44.entities.Entitlement.filter(
    { business_id: { $in: businessIds } },
    { limit: 50 }
  );
  return page.items ?? [];
}

/** Whole days left on a trial, or null when the business is not trialing. */
export function trialDaysLeft(record) {
  if (record?.status !== 'trialing' || !record?.trial_ends_at) return null;
  const ms = new Date(record.trial_ends_at).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/**
 * Seven-day notice model for actual trials AND complimentary pre-launch previews.
 *
 * These are deliberately different: the pre-launch preview checkpoint is an
 * informational milestone, not an entitlement expiry, a new free trial, or a
 * provider-confirmed charge date. Only records with the precise pre-launch note
 * created by our server qualify. Use the persisted creation timestamp so an
 * existing workspace cannot restart its countdown by refreshing or switching.
 */
export function trialWarningDetails(record, now = Date.now()) {
  if (!record || !Number.isFinite(now)) return null;
  const prelaunch = record.status === 'grandfathered' &&
    record.note === 'Complimentary pre-launch workspace. No seven-day trial was started.';
  const paidTrial = record.status === 'trialing';
  if (!prelaunch && !paidTrial) return null;

  const startingMs = Date.parse(prelaunch ? record.created_date ?? '' : record.trial_ends_at ?? '');
  if (!Number.isFinite(startingMs)) return null;
  const endsMs = prelaunch ? startingMs + 7 * 86_400_000 : startingMs;
  const remainingMs = endsMs - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;

  return {
    kind: prelaunch ? 'prelaunch' : 'trial',
    endsAt: new Date(endsMs).toISOString(),
    daysLeft: Math.ceil(remainingMs / 86_400_000),
    warningStage: remainingMs <= 24 * 60 * 60 * 1000
      ? 'one-day'
      : remainingMs <= 72 * 60 * 60 * 1000 ? 'three-day' : null,
  };
}

/** "Trial · 6 days left" for a trialing business, null for every other state. */
export function trialLabel(record) {
  const days = trialDaysLeft(record);
  if (days == null) return null;
  if (days === 0) return 'Trial ended';
  return days === 1 ? 'Trial · 1 day left' : `Trial · ${days} days left`;
}

/** Missing billing records resolve to restricted Essentials. */
export function effectivePlanKey(record, user) {
  // Preserve the publisher's existing complimentary admin workspace, but do not
  // let a legacy/default grandfathered Business row grant access to new users.
  if (record?.plan === 'business' &&
      record?.status === 'grandfathered' &&
      user?.role !== 'admin') return DEFAULT_PLAN;
  return record?.plan === 'business' ? 'business' : DEFAULT_PLAN;
}

export function resolveEntitlement(record, user = null) {
  const planKey = effectivePlanKey(record, user);
  const plan = planOf(planKey);
  return {
    planKey,
    plan,
    status: record?.status || 'pending_checkout',
    record: record || null,
    limits: plan.limits,
    limit: (key) => limitFor(planKey, key),
    can: (feature) => featureAllowed(planKey, feature),
    isEssentials: planKey === 'essentials',
  };
}

/** Active catalog products: distinct sellable records, archived ones excluded. */
export async function countActiveProducts(businessId) {
  if (!businessId) return 0;
  return base44.entities.Product.count({ business_id: businessId, status: { $ne: 'archived' } });
}

/** Staff seats: active members plus invitations, which reserve a seat. */
export async function countStaffSeats(businessId) {
  if (!businessId) return 0;
  return base44.entities.StaffMember.count({
    business_id: businessId,
    status: { $in: ['active', 'invited'] },
  });
}

async function invoke(fn, payload) {
  try {
    const response = await base44.functions.invoke(fn, payload);
    return response.data;
  } catch (error) {
    const message = error?.response?.data?.error || error?.message || 'Something went wrong.';
    throw new Error(message);
  }
}

/**
 * Ask the server to re-verify a checkout Stripe completed but the webhook
 * never granted (first live trial, 2026-11-06). The server re-reads the
 * checkout from Stripe and grants only from verified provider evidence; the
 * browser never grants access itself. Returns the server's state string
 * (for example 'granted', 'already_active', or
 * 'no_completed_stripe_checkout_for_subscription'). Non-2xx responses still carry
 * a state, so surface it instead of throwing it away.
 */
export async function reconcileSubscriptionAccess(businessId, sessionId = null) {
  try {
    const response = await base44.functions.invoke('reconcile-subscription-access', {
      action: 'reconcile_subscription_access',
      business_id: businessId,
      session_id: sessionId,
    });
    return response?.data ?? {};
  } catch (error) {
    const state = error?.response?.data?.state;
    if (typeof state === 'string') return { state };
    throw error;
  }
}

/**
 * Creation goes through the server so the plan's allowance is decided there.
 * The screens' own checks are only a courtesy that fails earlier and faster.
 */
export async function createProducts(businessId, products) {
  const data = await invoke('create-products', { business_id: businessId, products });
  return data?.created ?? [];
}

export async function createStaffMember(businessId, member) {
  const data = await invoke('create-staff-member', { business_id: businessId, member });
  return data?.member;
}

/**
 * Custom roles go through the server so the Business-only rule is decided
 * there: Essentials uses the five built-in roles and cannot create its own.
 * Editing an existing custom role stays a direct entity update.
 */
export async function createRole(businessId, role) {
  const data = await invoke('create-role', { business_id: businessId, role });
  return data?.role;
}

export async function createLocation(businessId, location) {
  const data = await invoke('create-location', { business_id: businessId, location });
  return data?.location;
}

/** One operating site, as opposed to a shelf, bin or van inside one. */
const OPERATING_SITE_KINDS = ['store', 'warehouse', 'other'];

/**
 * The one site predicate, shared by the Locations page and the server
 * count below: a top-level store, warehouse or other place. A root stored
 * with parent_id: null is a site either way — `!parent_id` covers a
 * missing field and an explicit null alike.
 */
export function isOperatingSite(location) {
  if (!location) return false;
  return !location.parent_id && OPERATING_SITE_KINDS.includes(location.kind || 'store');
}

/** Separately operating sites, as opposed to shelves and bins inside one. */
export async function countOperatingSites(businessId) {
  if (!businessId) return 0;
  return base44.entities.Location.count({
    business_id: businessId,
    kind: { $in: OPERATING_SITE_KINDS },
    // Same predicate as isOperatingSite above: a site has no parent, whether
    // the field is missing or stored as null.
    $or: [{ parent_id: { $exists: false } }, { parent_id: null }],
  });
}