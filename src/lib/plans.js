/**
 * The two plans and every allowance that follows from them.
 *
 * One place, so a limit is never restated in a page: a screen asks
 * `limit('products')` and gets 50 or null (unlimited), and asks
 * `can('suppliers')` rather than testing the plan name.
 */

export const PLANS = {
  essentials: {
    key: 'essentials',
    name: 'Essentials',
    price: 14.99,
    // "additional staff": the owner holds no staff seat — the cap counts
    // StaffMember records (active + invited) only, so 3 seats sit on top
    // of the owner. See Finding 15 and staffSeatCount in
    // base44/shared/planLimits.ts.
    blurb: 'One store, fifty products, three additional staff.',
    limits: { businesses: 1, sites: 1, products: 50, staff: 3, customRoles: false },
    includes: [
      'Product catalog, categories and tags',
      'CSV and Excel product imports',
      'Barcode, UPC, ISBN and QR scanning',
      'Manual receiving, counts and adjustments',
      'Customer orders, returns and listings',
      'Product labels and customer documents',
      'Up to 3 additional staff',
      'The five built-in staff roles',
    ],
  },
  business: {
    key: 'business',
    name: 'Business',
    price: 29.99,
    blurb: 'Five businesses, unlimited products and staff.',
    limits: { businesses: 5, sites: 5, products: null, staff: null, customRoles: true },
    includes: [
      'Everything in Essentials',
      'Unlimited products and staff',
      'Custom staff roles',
      'Up to 5 businesses and 5 sites',
      'Stock valuation and advanced reports',
      'Low-stock alerts',
      'CSV and Excel exports',
      'Suppliers, purchasing and PO receiving',
      'Bundles, recipes and builds',
      'Supplier purchasing documents',
    ],
  },
};

/** Business-only modules, by the key used in navigation and the gate. */
export const FEATURES = {
  valuation: 'Stock valuation',
  reports: 'Advanced reports',
  alerts: 'Low-stock alerts',
  exports: 'CSV and Excel exports',
  suppliers: 'Suppliers',
  purchasing: 'Purchasing',
  builds: 'Bundles & builds',
  supplierPrint: 'Supplier purchasing documents',
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
  return limit == null ? 'Unlimited' : String(limit);
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
  blurb:
    'Keep inventory management simple and convenient. Scan products, manage quantities, receive stock, and stay organized directly from your phone.',
  available: false,
  includes: [
    'Simplified inventory management',
    'Barcode and QR scanning',
    'Product lookup by SKU, UPC, ISBN or name',
    'Product creation, editing, descriptions and photos',
    'Viewing current quantities',
    'Manual receiving and basic adjustments',
    'Stock counts',
    'Recording ordinary sales and deductions',
    'Basic movement history',
    'Basic customer orders where supported',
    'Seven-day free trial',
  ],
};

/** The three choices the first-launch screen presents, in order. */
export const WELCOME_OPTIONS = [
  MOBILE_PLAN,
  {
    key: 'essentials',
    name: 'Luminous StockHaven Essentials',
    price: 14.99,
    blurb:
      'Need a more complete inventory workspace? Our website Essentials Plan gives you additional inventory-management tools for one business.',
    available: true,
    includes: [
      'One business',
      'One operating site',
      'Up to 50 distinct products',
      'Unlimited quantities of those products',
      'Three additional staff members',
      'Core inventory tools',
      'Desktop and laptop access',
      'Mobile companion included',
      'One seven-day trial for eligible new website customers (not per plan)',
    ],
  },
  {
    key: 'business',
    name: 'Luminous StockHaven Business',
    price: 29.99,
    blurb:
      'Ready for advanced inventory management? Explore our complete Business Plan for growing businesses, multiple sites, purchasing, reporting and more.',
    available: true,
    includes: [
      'Up to five businesses',
      'Up to five operating sites in total',
      'Unlimited products and quantities',
      'Unlimited staff',
      'Stock valuation reports',
      'Low-stock alerts',
      'CSV and Excel exports',
      'Suppliers and purchase orders',
      'Bundles & Builds',
      'Advanced business reports',
      'Mobile companion included',
      'One seven-day trial for eligible new website customers (not per plan)',
    ],
  },
];

/** Where a plan's allowances are not approved yet, say so instead of guessing. */
const UNSET = 'Set at launch';

/** Row-per-feature comparison, plus the mobile-only column. */
export const COMPARISON_ROWS = [
  { label: 'Businesses', mobile: UNSET, essentials: 'One', business: 'Up to five' },
  { label: 'Operating sites', mobile: UNSET, essentials: 'One', business: 'Up to five in total' },
  { label: 'Distinct active products', mobile: UNSET, essentials: 'Up to 50', business: 'Unlimited' },
  { label: 'Inventory quantities', mobile: 'Unlimited', essentials: 'Unlimited', business: 'Unlimited' },
  { label: 'Additional staff', mobile: UNSET, essentials: 'Up to three', business: 'Unlimited' },
  { label: 'Custom staff roles', mobile: UNSET, essentials: false, business: true },
  { label: 'Barcode, UPC, ISBN and QR scanning', mobile: true, essentials: true, business: true },
  { label: 'Product creation, editing and photos', mobile: true, essentials: true, business: true },
  { label: 'Receiving, counts and adjustments', mobile: true, essentials: true, business: true },
  { label: 'Movement history', mobile: 'Basic', essentials: 'Full', business: 'Full' },
  { label: 'Customer orders', mobile: 'Basic, where supported', essentials: true, business: true },
  { label: 'Desktop and laptop workspace', mobile: false, essentials: true, business: true },
  { label: 'Stock valuation reports', mobile: false, essentials: false, business: true },
  // Low-stock counts are core, not an alert: every page shows them on
  // both plans (Products, Inventory, Categories) — only the alerts and
  // notifications are Business. Stated here so the row above is never
  // read as "Essentials cannot see low stock at all".
  { label: 'Low-stock counts', mobile: UNSET, essentials: 'On every page', business: 'On every page' },
  { label: 'Low-stock alerts', mobile: false, essentials: false, business: true },
  { label: 'CSV and Excel exports', mobile: false, essentials: false, business: true },
  { label: 'Suppliers and purchase orders', mobile: false, essentials: false, business: true },
  { label: 'Bundles & Builds', mobile: false, essentials: false, business: true },
  { label: 'Mobile companion included', mobile: false, essentials: true, business: true },
];

export function formatPrice(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}