import {
  ArrowRightLeft,
  BadgeCheck,
  Ban,
  BookOpen,
  Boxes,
  CalendarClock,
  ChefHat,
  Coins,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FlaskConical,
  MapPin,
  Monitor,
  NotebookPen,
  PackageOpen,
  Scale,
  SearchCheck,
  Thermometer,
  Trash2,
  TrendingUp,
  Users,
  UtensilsCrossed,
  Wrench,
  Wheat,
} from 'lucide-react';
import { expiringSoon } from './restaurantOps.js';

/**
 * The Restaurant corner's shelves (release 377, Nov 25, 2026 —
 * plan release 367, the restaurant build-it-all program's
 * information architecture). One model for the whole corner:
 * the Today page, the shelf pages and the feature pages'
 * breadcrumbs all read their organization from here, so a
 * feature's home is stated exactly once.
 *
 * The corner is a "Today" page over six shelves, plus a
 * Locations shelf that exists only for owners with two or
 * more businesses (progressive disclosure — the owner's
 * anti-clutter rules, Nov 24, 2026: nothing new on the app's
 * main navigation, every feature ≤2 taps from Restaurant
 * home, shelves appear only when they apply).
 *
 * Membership follows the plan's Part 1 table. Two judgment
 * calls the table leaves open, flagged in the build record:
 * the waste log's only table entry is its Floor & Guests
 * cross-link, so Floor is its home here; theoretical-vs-actual
 * variance is not in the table at all and sits on Invoices &
 * Money, the cost-control shelf. Unit conversion has no door
 * of its own — it lives in the Recipes page's Units &
 * allergens section (the product kitchen dialog), unchanged,
 * so it rides the Kitchen & Recipes shelf with Recipes.
 * Prep sheets and batch production share the one Prep page,
 * as built in release 361 — one door, whose own body line
 * names both.
 *
 * Doors may repeat across shelves only as cross-links
 * (menu engineering: Kitchen home, cross-linked from
 * Invoices & Money, exactly as the plan's table states).
 * Later releases add their doors to these lists — including
 * cross-links from Team & Place to the general homes of
 * checklists, the manager log book, equipment records and
 * the schedule warnings (the owner's Q1–Q4 rulings made
 * those features general, both plans; the shelf links to
 * them when they land, the 369 pattern).
 */
export const RESTAURANT_HOME = '/restaurant';

const door = (to, titleKey, bodyKey, icon, extra = {}) => ({ to, titleKey, bodyKey, icon, ...extra });

export const SHELVES = [
  {
    id: 'kitchen',
    route: '/restaurant/kitchen',
    labelKey: 'restaurant.shelf.kitchen',
    icon: ChefHat,
    doors: [
      door('/restaurant/recipes', 'nav.recipes', 'restaurant.doorRecipes', ChefHat),
      door('/restaurant/prep', 'nav.prep', 'restaurant.doorPrep', NotebookPen),
      door('/restaurant/menu', 'nav.menu', 'restaurant.doorMenu', TrendingUp),
      door('/restaurant/kitchen-display', 'nav.kitchenDisplay', 'restaurant.doorKitchenDisplay', Monitor),
    ],
  },
  {
    id: 'stock',
    route: '/restaurant/stock',
    labelKey: 'restaurant.shelf.stock',
    icon: Boxes,
    doors: [
      door('/restaurant/order-guide', 'nav.orderGuide', 'restaurant.doorOrderGuide', ClipboardList),
      door('/restaurant/transfers', 'nav.transfers', 'restaurant.doorTransfers', ArrowRightLeft),
      // Release 378: stock counts are a general feature (both
      // plans) whose home is the shared Counts page — the
      // shelf cross-links to it, the 377 pattern for general
      // features, now that its sheets walk in shelf order.
      door('/counts', 'nav.counts', 'restaurant.doorCounts', ClipboardCheck, { crossLink: true }),
    ],
  },
  {
    id: 'money',
    route: '/restaurant/money',
    labelKey: 'restaurant.shelf.money',
    icon: FileText,
    doors: [
      door('/restaurant/invoices', 'nav.invoices', 'restaurant.doorInvoices', FileText),
      door('/restaurant/variance', 'nav.variance', 'restaurant.doorVariance', Scale),
      door('/restaurant/ledger', 'nav.ledger', 'restaurant.doorLedger', BookOpen),
      door('/restaurant/menu', 'nav.menu', 'restaurant.doorMenu', TrendingUp, { crossLink: true }),
    ],
  },
  {
    id: 'safety',
    route: '/restaurant/safety',
    labelKey: 'restaurant.shelf.safety',
    icon: Thermometer,
    doors: [
      door('/restaurant/temp-logs', 'nav.tempLogs', 'restaurant.doorTempLogs', Thermometer),
      door('/restaurant/expiry', 'nav.expiry', 'restaurant.doorExpiry', CalendarClock),
      door('/restaurant/allergens', 'nav.allergens', 'restaurant.doorAllergens', Wheat),
      // The food-safety file, completed (plan release 370):
      // the temperature log's sibling logs, the packet that
      // gathers the family's papers, certificate tracking on
      // the staff-documents machinery, the mock inspection on
      // the checklist engine, and the SDS shelf.
      door('/restaurant/safety-logs', 'nav.safetyLogs', 'restaurant.doorSafetyLogs', ClipboardCheck),
      door('/restaurant/inspection', 'nav.inspectionPacket', 'restaurant.doorInspectionPacket', PackageOpen),
      door('/restaurant/certificates', 'nav.foodCerts', 'restaurant.doorFoodCerts', BadgeCheck),
      door('/restaurant/mock-inspection', 'nav.mockInspection', 'restaurant.doorMockInspection', SearchCheck),
      door('/restaurant/sds', 'nav.sds', 'restaurant.doorSds', FlaskConical),
    ],
  },
  {
    id: 'floor',
    route: '/restaurant/floor',
    labelKey: 'restaurant.shelf.floor',
    icon: UtensilsCrossed,
    doors: [
      door('/restaurant/86', 'nav.eightySix', 'restaurant.doorEightySix', Ban),
      door('/restaurant/guest-menu', 'nav.guestMenu', 'restaurant.doorGuestMenu', BookOpen),
      door('/restaurant/waste', 'nav.waste', 'restaurant.doorWaste', Trash2),
    ],
  },
  {
    id: 'team',
    route: '/restaurant/team',
    labelKey: 'restaurant.shelf.team',
    icon: Users,
    doors: [
      door('/restaurant/staff-meals', 'nav.staffMeals', 'restaurant.doorStaffMeals', UtensilsCrossed),
      // Release 378: the manager log book is a general
      // feature (both plans, the owner's Q2 ruling) whose
      // home is its own page — the shelf cross-links to it,
      // the 377 pattern for the Q1–Q4 general features.
      door('/log-book', 'nav.logBook', 'restaurant.doorLogBook', NotebookPen, { crossLink: true }),
      // Plan release 369: checklists are a general feature
      // too (both plans, the owner's Q1 ruling) — the shelf
      // cross-links to their general home the same way.
      door('/checklists', 'nav.checklists', 'restaurant.doorChecklists', ClipboardCheck, { crossLink: true }),
      // Plan release 372: equipment records are a general
      // feature too (both plans, the owner's Q3 ruling) —
      // the shelf cross-links to their general home the
      // same way.
      door('/equipment', 'nav.equipment', 'restaurant.doorEquipment', Wrench, { crossLink: true }),
      // Plan release 373: tip pooling + tip reporting
      // records — a Business-only corner feature whose home
      // is its own page on this shelf.
      door('/restaurant/tip-pooling', 'nav.tipPooling', 'restaurant.doorTipPooling', Coins),
    ],
  },
];

/** The seventh shelf: only for owners with 2+ businesses.
 *  Its features (the all-locations rollup, commissary mode)
 *  land in later releases; today the shelf page lists the
 *  owner's businesses, each opening its own corner. */
export const LOCATIONS_SHELF = {
  id: 'locations',
  route: '/restaurant/locations',
  labelKey: 'restaurant.shelf.locations',
  icon: MapPin,
  doors: [],
};

/** The shelves this owner sees, in order. The Locations
 *  shelf joins only when the account holds 2+ businesses. */
export function shelvesFor(businessCount) {
  return Number(businessCount) >= 2 ? [...SHELVES, LOCATIONS_SHELF] : [...SHELVES];
}

export function shelfById(id) {
  return [...SHELVES, LOCATIONS_SHELF].find((shelf) => shelf.id === id) ?? null;
}

/** The shelf a feature route calls home (its primary listing,
 *  never a cross-link) — the feature pages' breadcrumbs read
 *  this, so the way back is stated once, here. */
export function homeShelfForRoute(route) {
  for (const shelf of SHELVES) {
    if (shelf.doors.some((d) => d.to === route && !d.crossLink)) return shelf;
  }
  return null;
}

/** Every feature door in the corner, primary listings only. */
export function featureDoors() {
  return SHELVES.flatMap((shelf) => shelf.doors.filter((d) => !d.crossLink));
}

const sameLocalDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * What the Today page surfaces, computed from the same rows
 * the feature pages read — nothing invented, nothing cached:
 *
 * - outNow: the 86 board's active items (what is out, now).
 * - temps: the temperature units the business has ever
 *   logged, split into those with a reading today and those
 *   still to check today (a unit with no reading yet today
 *   is due — the corner keeps no separate schedule), plus
 *   today's out-of-range readings.
 * - expiring: dated batches out of date or within a week,
 *   FEFO order — the expiry page's own `expiringSoon` window.
 * - runsToday: batch production runs made today.
 * - logBook: the manager log book's latest entries (release
 *   378) — the general feature's rows, read like every other
 *   source here; the newest three, newest first.
 *
 * A section with nothing behind it comes back empty and the
 * page shows no card for it — no placeholder ever claims a
 * feature or a fact that is not there.
 */
export function summarizeToday({ eightySixItems = [], tempLogs = [], batches = [], batchRuns = [], logEntries = [], checklistToday = null, now = new Date() } = {}) {
  const outNow = (eightySixItems || []).filter((item) => item.active !== false);

  const units = new Map();
  for (const log of tempLogs || []) {
    if (!log.unit_name) continue;
    if (!units.has(log.unit_name)) units.set(log.unit_name, { unit: log.unit_name, readToday: false });
    const when = log.created_date ? new Date(log.created_date) : null;
    if (when && Number.isFinite(when.getTime()) && sameLocalDay(when, now)) {
      units.get(log.unit_name).readToday = true;
    }
  }
  const todaysLogs = (tempLogs || []).filter((log) => {
    const when = log.created_date ? new Date(log.created_date) : null;
    return when && Number.isFinite(when.getTime()) && sameLocalDay(when, now);
  });
  const temps = {
    known: units.size > 0,
    dueUnits: [...units.values()].filter((u) => !u.readToday).map((u) => u.unit),
    readingsToday: todaysLogs.length,
    outOfRangeToday: todaysLogs.filter((log) => log.in_range === false),
  };

  const expiring = expiringSoon(batches || [], 7, now);

  const runsToday = (batchRuns || []).filter((run) => {
    const when = run.created_date ? new Date(run.created_date) : null;
    return when && Number.isFinite(when.getTime()) && sameLocalDay(when, now);
  });

  // The manager log book's latest entries (release 378):
  // the plan's Today list names them — whoever opens next
  // reads the last few entries first. The log book is a
  // general feature (both plans); its rows are read here the
  // same way as every other Today source, newest first,
  // latest three.
  const logBook = [...(logEntries || [])]
    .sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')))
    .slice(0, 3);

  // Today's checklists (plan release 369): the general
  // feature's own day view, read from its engine — how many
  // of today's items are ticked, and how many lists are
  // running. Null when the read has not landed (or failed):
  // the Today page then simply shows no checklist card.
  const checklists = checklistToday?.summary
    ? { done: checklistToday.summary.done || 0, total: checklistToday.summary.total || 0, lists: checklistToday.summary.lists || 0 }
    : null;

  return { outNow, temps, expiring, runsToday, logBook, checklists };
}

/** True when at least one Today card has something to say. */
export function todayHasContent(summary) {
  return Boolean(
    summary.outNow.length ||
    summary.temps.known ||
    summary.expiring.length ||
    summary.runsToday.length ||
    (summary.logBook || []).length ||
    Boolean(summary.checklists?.total),
  );
}
