/**
 * The two plans and every allowance that follows from them.
 *
 * One place, so a limit is never restated in a page: a screen asks
 * `limit('products')` and gets 50 or null (unlimited), and asks
 * `can('suppliers')` rather than testing the plan name.
 */

import { t } from './i18n.js';

export const PLANS = {
  essentials: {
    key: 'essentials',
    name: 'Essentials',
    price: 14.99,
    // "additional staff": the owner holds no staff seat — the cap counts
    // StaffMember records (active + invited) only, so 3 seats sit on top
    // of the owner. See Finding 15 and staffSeatCount in
    // base44/shared/planLimits.ts.
    // T6.3: blurb/includes are getters, not import-time t() calls, so a
    // language switch re-renders the plan copy live instead of freezing
    // the locale that was active when this module first loaded.
    get blurb() { return t('plansLib.essentialsBlurb'); },
    limits: { businesses: 1, sites: 1, products: 50, staff: 3, customRoles: false },
    get includes() {
      return [
        t('plansLib.essentialsIncludes.catalog'),
        t('plansLib.essentialsIncludes.imports'),
        t('plansLib.essentialsIncludes.scanning'),
        t('plansLib.essentialsIncludes.receiving'),
        t('plansLib.essentialsIncludes.orders'),
        t('plansLib.essentialsIncludes.labels'),
        t('plansLib.essentialsIncludes.staff'),
        t('plansLib.essentialsIncludes.roles'),
      ];
    },
  },
  business: {
    key: 'business',
    name: 'Business',
    price: 29.99,
    get blurb() { return t('plansLib.businessBlurb'); },
    limits: { businesses: 5, sites: 5, products: null, staff: null, customRoles: true },
    get includes() {
      return [
        t('plansLib.businessIncludes.everything'),
        t('plansLib.businessIncludes.unlimited'),
        t('plansLib.businessIncludes.roles'),
        t('plansLib.businessIncludes.businesses'),
        t('plansLib.businessIncludes.valuation'),
        t('plansLib.businessIncludes.alerts'),
        t('plansLib.businessIncludes.exports'),
        t('plansLib.businessIncludes.suppliers'),
        t('plansLib.businessIncludes.bundles'),
        t('plansLib.businessIncludes.supplierDocs'),
      ];
    },
  },
};

/** Business-only modules, by the key used in navigation and the gate. */
// T6.3: getters (see PLANS above) — the labels follow the live locale.
export const FEATURES = {
  get valuation() { return t('plansLib.feature.valuation'); },
  get reports() { return t('plansLib.feature.reports'); },
  get alerts() { return t('plansLib.businessIncludes.alerts'); },
  get exports() { return t('plansLib.businessIncludes.exports'); },
  get suppliers() { return t('plansLib.feature.suppliers'); },
  get purchasing() { return t('plansLib.feature.purchasing'); },
  get builds() { return t('plansLib.feature.builds'); },
  get supplierPrint() { return t('plansLib.businessIncludes.supplierDocs'); },
  get crossStore() { return t('plansLib.feature.crossStore'); },
};

/**
 * Bundle movement types — the four ledger types that only exist because a
 * bundle was built or taken apart. Essentials has no Bundles feature, so
 * these never appear as options there; Business keeps all twelve movement
 * types. The full MOVEMENT_TYPES map in src/lib/inventory.js stays intact
 * so historical rows still render their labels.
 *
 * LIVE FINDING (2026-11-07): the Essentials Movements filter offered
 * Consumed (builds), Built, Taken apart and Parts recovered.
 */
export const BUNDLE_MOVEMENT_TYPES = ['consume', 'produce', 'disassemble', 'recovered'];

export function isBundleMovementType(type) {
  return BUNDLE_MOVEMENT_TYPES.includes(type);
}

/**
 * Supplier print styles — the two Labels & sheets styles that send documents
 * to a supplier. Both belong to the Business-only buying side; the other
 * twelve styles (labels, sheets, pick lists, customer documents, returns)
 * stay on both plans.
 *
 * LIVE FINDING (2026-11-07): the Essentials Print Center offered
 * "Purchase order" and "Supplier packing slip".
 */
export const SUPPLIER_PRINT_TEMPLATES = ['po', 'packing'];

export function isSupplierPrintTemplate(key) {
  return SUPPLIER_PRINT_TEMPLATES.includes(key);
}

/**
 * Missing or unverified entitlement records resolve to restricted Essentials.
 * The publisher's existing admin-owned complimentary workspace is preserved.
 */
export const DEFAULT_PLAN = 'essentials';

export const TRIAL_DAYS = 7;

export function planOf(key) {
  return PLANS[key] || PLANS[DEFAULT_PLAN];
}

/** Every gated module belongs to Business; Essentials gets none of them. */
export function featureAllowed(planKey, feature) {
  if (!feature) return true;
  return planOf(planKey).key === 'business';
}

export function limitFor(planKey, key) {
  const value = planOf(planKey).limits[key];
  return value === undefined ? null : value;
}

/**
 * A limit whose entitlement row has not loaded yet is unknown — never
 * another plan's cap.
 *
 * LIVE FINDING (2026-11-07): a fresh Business login briefly showed
 * "1 OF 1" businesses with the Essentials sentence, and its Staff page
 * briefly capped seats at 3, because the entitlement query had not
 * returned yet and the missing row resolved to restricted Essentials.
 * The stored entitlement was Business all along; only the display was
 * wrong. `null` here means "unknown, show nothing and enforce nothing
 * yet" — the server still enforces the real limit on every write, so a
 * brief unknown window can never grant anything extra. Once the row has
 * loaded, the limit is the plan's own value (`null` for unlimited).
 */
export function displayLimit(limit, loading) {
  return loading ? null : limit;
}

/**
 * The business allowance for a login, from its oldest workspace's plan.
 * While the plan rows have not loaded — or the read failed — the allowance
 * is unknown (`null`), never the Essentials 1. `plansKnown` is false until
 * the plan-row query has settled (or there are no businesses to read rows
 * for). A missing plan row for a loaded login still resolves to Essentials
 * through `effectivePlanKey`; only the not-yet-loaded case is unknown.
 */
export function businessLimitForPlan(planKey, plansKnown) {
  if (!plansKnown) return null;
  return planKey === 'essentials'
    ? PLANS.essentials.limits.businesses
    : PLANS.business.limits.businesses;
}

export function formatLimit(limit) {
  return limit == null ? t('plansLib.unlimited') : String(limit);
}

/**
 * The mobile-only offering, shown on the welcome and comparison screens.
 *
 * It grants nothing yet on purpose: store billing is not live, and the mobile
 * product, site and staff allowances have not been approved, so they are never
 * inferred from the website tiers. Nothing here is read by an entitlement check.
 */
export const MOBILE_PLAN = {
  key: 'mobile',
  name: 'Luminous StockHaven Mobile',
  price: 4.99,
  get blurb() { return t('plansLib.mobileBlurb'); },
  available: false,
  get includes() {
    return [
      t('plansLib.mobileIncludes.simplified'),
      t('plansLib.mobileIncludes.scanning'),
      t('plansLib.mobileIncludes.lookup'),
      t('plansLib.mobileIncludes.creation'),
      t('plansLib.mobileIncludes.quantities'),
      t('plansLib.mobileIncludes.receiving'),
      t('plansLib.mobileIncludes.counts'),
      t('plansLib.mobileIncludes.sales'),
      t('plansLib.mobileIncludes.history'),
      t('plansLib.mobileIncludes.orders'),
      t('plansLib.mobileIncludes.trial'),
    ];
  },
};

/** The three choices the first-launch screen presents, in order. */
// T6.3: blurb/includes are getters (see PLANS above) — the copy follows
// the live locale instead of freezing at import time.
export const WELCOME_OPTIONS = [
  MOBILE_PLAN,
  {
    key: 'essentials',
    name: 'Luminous StockHaven Essentials',
    price: 14.99,
    get blurb() { return t('plansLib.welcomeEssentialsBlurb'); },
    available: true,
    get includes() {
      return [
        t('plansLib.welcomeEssentialsIncludes.oneBusiness'),
        t('plansLib.welcomeEssentialsIncludes.oneSite'),
        t('plansLib.welcomeEssentialsIncludes.products'),
        t('plansLib.welcomeEssentialsIncludes.quantities'),
        t('plansLib.welcomeEssentialsIncludes.staff'),
        t('plansLib.welcomeEssentialsIncludes.tools'),
        t('plansLib.welcomeEssentialsIncludes.desktop'),
        t('plansLib.welcomeEssentialsIncludes.mobile'),
        t('plansLib.welcomeEssentialsIncludes.trial'),
      ];
    },
  },
  {
    key: 'business',
    name: 'Luminous StockHaven Business',
    price: 29.99,
    get blurb() { return t('plansLib.welcomeBusinessBlurb'); },
    available: true,
    get includes() {
      return [
        t('plansLib.welcomeBusinessIncludes.businesses'),
        t('plansLib.welcomeBusinessIncludes.sites'),
        t('plansLib.welcomeBusinessIncludes.products'),
        t('plansLib.welcomeBusinessIncludes.staff'),
        t('plansLib.welcomeBusinessIncludes.valuation'),
        t('plansLib.businessIncludes.alerts'),
        t('plansLib.businessIncludes.exports'),
        t('plansLib.welcomeBusinessIncludes.suppliers'),
        t('plansLib.welcomeBusinessIncludes.bundles'),
        t('plansLib.welcomeBusinessIncludes.reports'),
        t('plansLib.welcomeEssentialsIncludes.mobile'),
        t('plansLib.welcomeEssentialsIncludes.trial'),
      ];
    },
  },
];

/** Row-per-feature comparison, plus the mobile-only column. */
// T6.3: every string cell is a getter (see PLANS above). Where a plan's
// allowances are not approved yet, say so instead of guessing — the
// "unset" wording is a getter too, so it follows the live locale.
export const COMPARISON_ROWS = [
  { get label() { return t('plansLib.compare.businesses'); }, get mobile() { return t('plansLib.unset'); }, get essentials() { return t('plansLib.compare.one'); }, get business() { return t('plansLib.compare.upToFive'); } },
  { get label() { return t('plansLib.compare.sites'); }, get mobile() { return t('plansLib.unset'); }, get essentials() { return t('plansLib.compare.one'); }, get business() { return t('plansLib.compare.upToFiveTotal'); } },
  { get label() { return t('plansLib.compare.products'); }, get mobile() { return t('plansLib.unset'); }, get essentials() { return t('plansLib.compare.upToFifty'); }, get business() { return t('plansLib.unlimited'); } },
  { get label() { return t('plansLib.compare.quantities'); }, get mobile() { return t('plansLib.unlimited'); }, get essentials() { return t('plansLib.unlimited'); }, get business() { return t('plansLib.unlimited'); } },
  { get label() { return t('plansLib.compare.staff'); }, get mobile() { return t('plansLib.unset'); }, get essentials() { return t('plansLib.compare.upToThree'); }, get business() { return t('plansLib.unlimited'); } },
  { get label() { return t('plansLib.compare.customRoles'); }, get mobile() { return t('plansLib.unset'); }, essentials: false, business: true },
  { get label() { return t('plansLib.essentialsIncludes.scanning'); }, mobile: true, essentials: true, business: true },
  { get label() { return t('plansLib.compare.creation'); }, mobile: true, essentials: true, business: true },
  { get label() { return t('plansLib.compare.receiving'); }, mobile: true, essentials: true, business: true },
  { get label() { return t('plansLib.compare.history'); }, get mobile() { return t('plansLib.compare.basic'); }, get essentials() { return t('plansLib.compare.full'); }, get business() { return t('plansLib.compare.full'); } },
  { get label() { return t('plansLib.compare.orders'); }, get mobile() { return t('plansLib.compare.basicWhereSupported'); }, essentials: true, business: true },
  { get label() { return t('plansLib.compare.desktop'); }, mobile: false, essentials: true, business: true },
  { get label() { return t('plansLib.welcomeBusinessIncludes.valuation'); }, mobile: false, essentials: false, business: true },
  // Low-stock counts are core, not an alert: every page shows them on
  // both plans (Products, Inventory, Categories) — only the alerts and
  // notifications are Business. Stated here so the row above is never
  // read as "Essentials cannot see low stock at all".
  { get label() { return t('plansLib.compare.lowStockCounts'); }, get mobile() { return t('plansLib.unset'); }, get essentials() { return t('plansLib.compare.onEveryPage'); }, get business() { return t('plansLib.compare.onEveryPage'); } },
  { get label() { return t('plansLib.businessIncludes.alerts'); }, mobile: false, essentials: false, business: true },
  { get label() { return t('plansLib.businessIncludes.exports'); }, mobile: false, essentials: false, business: true },
  { get label() { return t('plansLib.welcomeBusinessIncludes.suppliers'); }, mobile: false, essentials: false, business: true },
  { get label() { return t('plansLib.welcomeBusinessIncludes.bundles'); }, mobile: false, essentials: false, business: true },
  { get label() { return t('plansLib.welcomeEssentialsIncludes.mobile'); }, mobile: false, essentials: true, business: true },
];

export function formatPrice(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}