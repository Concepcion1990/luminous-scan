/**
 * Training lesson catalog — server side (Training phase).
 *
 * GENERATED from ~/workspace/luminous-stockhaven/i18n-batch2/
 * training-content.mjs by gen-training-catalog.mjs — edit the
 * content file and re-run the generator, never this file.
 *
 * The same lesson shape the client catalog holds (the t10 suite
 * proves they agree), plus the two things only the server needs:
 * the permission -> module map that drives the role-grant training
 * flag, and the English module labels used in workforce bell
 * details (bell details are composed server-side in English
 * everywhere in this codebase).
 */
export const TRAINING_TRACKS = ['owner', 'manager', 'staff'];

export const TRAINING_MODULES = [
  "getting-started",
  "language",
  "scanner",
  "printing",
  "products",
  "categories",
  "locations",
  "movements",
  "counts",
  "orders",
  "returns",
  "listings",
  "import",
  "workforce",
  "messaging",
  "payroll",
  "direct-deposit",
  "training",
  "staff",
  "cross-store",
  "reports",
  "purchasing",
  "settings",
  "billing",
  "exports",
  "builds"
];

export const MODULE_LABELS = {
  "getting-started": "Getting started",
  "language": "Language",
  "scanner": "Scanner",
  "printing": "Printing",
  "products": "Products",
  "categories": "Categories",
  "locations": "Locations & aisles",
  "movements": "Stock movements",
  "counts": "Stock counts",
  "orders": "Orders",
  "returns": "Returns",
  "listings": "Listings",
  "import": "Importing",
  "workforce": "Workforce & time clock",
  "messaging": "Messages",
  "payroll": "Payroll",
  "direct-deposit": "Direct deposit",
  "training": "Training",
  "staff": "Staff & roles",
  "cross-store": "Cross-store",
  "reports": "Reports & alerts",
  "purchasing": "Suppliers & purchasing",
  "settings": "Settings",
  "billing": "Plan & billing",
  "exports": "Exports",
  "builds": "Bundles & builds"
};

export const TRAINING_LESSONS = [
  { id: 'welcome-basics', track: 'staff', module: 'getting-started', steps: 4 },
  { id: 'your-language', track: 'staff', module: 'language', steps: 4 },
  { id: 'scanner-lookup', track: 'staff', module: 'scanner', steps: 4 },
  { id: 'scanner-website-qr', track: 'staff', module: 'scanner', steps: 4 },
  { id: 'scanner-shelf-counts', track: 'staff', module: 'scanner', steps: 4 },
  { id: 'scanner-receiving', track: 'staff', module: 'scanner', steps: 4 },
  { id: 'scanner-move-stock', track: 'staff', module: 'scanner', steps: 4 },
  { id: 'scanner-name-lookup', track: 'staff', module: 'scanner', steps: 4 },
  { id: 'scanner-damaged', track: 'staff', module: 'scanner', steps: 4 },
  { id: 'print-shelf-tag', track: 'staff', module: 'printing', steps: 4 },
  { id: 'products-find-edit', track: 'staff', module: 'products', steps: 4 },
  { id: 'categories-basics', track: 'staff', module: 'categories', steps: 4 },
  { id: 'locations-basics', track: 'staff', module: 'locations', steps: 4 },
  { id: 'movements-what', track: 'staff', module: 'movements', steps: 4 },
  { id: 'counts-run', track: 'staff', module: 'counts', steps: 4 },
  { id: 'orders-basics', track: 'staff', module: 'orders', steps: 4 },
  { id: 'returns-basics', track: 'staff', module: 'returns', steps: 4 },
  { id: 'listings-basics', track: 'staff', module: 'listings', steps: 4 },
  { id: 'import-basics', track: 'staff', module: 'import', steps: 4 },
  { id: 'clock-basics', track: 'staff', module: 'workforce', steps: 4 },
  { id: 'schedule-yours', track: 'staff', module: 'workforce', steps: 4 },
  { id: 'timeoff-request', track: 'staff', module: 'workforce', steps: 4 },
  { id: 'tasks-yours', track: 'staff', module: 'workforce', steps: 4 },
  { id: 'inbox-notifications', track: 'staff', module: 'workforce', steps: 4 },
  { id: 'messages-private', track: 'staff', module: 'messaging', steps: 4 },
  { id: 'stub-yours', track: 'staff', module: 'payroll', steps: 4 },
  { id: 'dd-submit', track: 'staff', module: 'direct-deposit', steps: 4 },
  { id: 'mgr-schedules', track: 'manager', module: 'workforce', steps: 4 },
  { id: 'mgr-timeoff-decide', track: 'manager', module: 'workforce', steps: 4 },
  { id: 'mgr-tasks-assign', track: 'manager', module: 'workforce', steps: 4 },
  { id: 'mgr-clock-oversight', track: 'manager', module: 'workforce', steps: 4 },
  { id: 'mgr-payroll-preview', track: 'manager', module: 'payroll', steps: 4 },
  { id: 'mgr-stub-push', track: 'manager', module: 'payroll', steps: 4 },
  { id: 'mgr-cash-up', track: 'manager', module: 'payroll', steps: 4 },
  { id: 'mgr-team-training', track: 'manager', module: 'training', steps: 4 },
  { id: 'mgr-staff-permissions', track: 'manager', module: 'staff', steps: 4 },
  { id: 'mgr-cross-store', track: 'manager', module: 'cross-store', steps: 4 },
  { id: 'mgr-reports-alerts', track: 'manager', module: 'reports', steps: 4 },
  { id: 'mgr-suppliers-orders', track: 'manager', module: 'purchasing', steps: 4 },
  { id: 'owner-setup', track: 'owner', module: 'getting-started', steps: 4 },
  { id: 'owner-white-label', track: 'owner', module: 'settings', steps: 4 },
  { id: 'owner-staff-roles', track: 'owner', module: 'staff', steps: 4 },
  { id: 'owner-training-admin', track: 'owner', module: 'training', steps: 4 },
  { id: 'owner-workforce-settings', track: 'owner', module: 'workforce', steps: 4 },
  { id: 'owner-payroll-config', track: 'owner', module: 'payroll', steps: 4 },
  { id: 'owner-payroll-runs', track: 'owner', module: 'payroll', steps: 4 },
  { id: 'owner-irs-box', track: 'owner', module: 'payroll', steps: 4 },
  { id: 'owner-dd-setup', track: 'owner', module: 'direct-deposit', steps: 4 },
  { id: 'owner-billing', track: 'owner', module: 'billing', steps: 4 },
  { id: 'owner-printing', track: 'owner', module: 'printing', steps: 4 },
  { id: 'owner-import-export', track: 'owner', module: 'exports', steps: 4 },
  { id: 'owner-builds', track: 'owner', module: 'builds', steps: 4 },
  { id: 'owner-messages-oversight', track: 'owner', module: 'messaging', steps: 4 },
  { id: 'owner-cross-store', track: 'owner', module: 'cross-store', steps: 4 },
];

/** permission -> the training modules gaining it should teach. */
export const MODULE_BY_PERMISSION = {
  "products.view": [
    "products"
  ],
  "products.edit": [
    "products"
  ],
  "categories.manage": [
    "categories"
  ],
  "locations.manage": [
    "locations"
  ],
  "scan.use": [
    "scanner",
    "movements"
  ],
  "movements.reverse": [
    "movements"
  ],
  "counts.run": [
    "counts"
  ],
  "builds.manage": [
    "builds"
  ],
  "orders.manage": [
    "orders"
  ],
  "returns.manage": [
    "returns"
  ],
  "listings.manage": [
    "listings"
  ],
  "purchasing.manage": [
    "purchasing"
  ],
  "suppliers.manage": [
    "purchasing"
  ],
  "reports.view": [
    "reports"
  ],
  "print.use": [
    "printing"
  ],
  "exports.use": [
    "exports",
    "import"
  ],
  "settings.manage": [
    "settings"
  ],
  "staff.manage": [
    "staff",
    "training"
  ]
};

export const lessonById = (id) => TRAINING_LESSONS.find((lesson) => lesson.id === id) || null;

export const lessonsForTrack = (track) => TRAINING_LESSONS.filter((lesson) => lesson.track === track);

/** Tracks a level may see, own track first (owner sees all three). */
export function visibleTracksForLevel(level) {
  if (level === 'owner') return ['owner', 'manager', 'staff'];
  if (level === 'manager') return ['manager', 'staff'];
  return ['staff'];
}

/** Lessons of one module within the tracks a level may see. */
export function lessonsForModuleAtLevel(module, level) {
  const tracks = visibleTracksForLevel(level);
  return TRAINING_LESSONS.filter((lesson) => lesson.module === module && tracks.includes(lesson.track));
}
