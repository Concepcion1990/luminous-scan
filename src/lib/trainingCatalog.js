/**
 * Training lesson catalog — client side (Training phase).
 *
 * GENERATED from ~/workspace/luminous-stockhaven/i18n-batch2/
 * training-content.mjs by gen-training-catalog.mjs — edit the
 * content file and re-run the generator, never this file.
 *
 * Lesson TEXT lives in the locale files under
 * training.lessons.<id>.title / .step1..stepN, like every other
 * string in the app; this catalog holds only the shape: which
 * lessons exist, which track and module they belong to, and how
 * many steps each carries. The server catalog
 * (server/trainingCatalog.js) holds the same shape and the t10
 * suite proves the two agree.
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
  { id: 'spare-keys-setup', track: 'staff', module: 'settings', steps: 4 },
  { id: 'lost-email-recovery', track: 'staff', module: 'settings', steps: 4 },
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
  { id: 'owner-staff-email-fix', track: 'owner', module: 'staff', steps: 4 },
];

export const lessonById = (id) => TRAINING_LESSONS.find((lesson) => lesson.id === id) || null;

export const lessonsForTrack = (track) => TRAINING_LESSONS.filter((lesson) => lesson.track === track);

/** Tracks a level may see, own track first (owner sees all three). */
export function visibleTracksForLevel(level) {
  if (level === 'owner') return ['owner', 'manager', 'staff'];
  if (level === 'manager') return ['manager', 'staff'];
  return ['staff'];
}
