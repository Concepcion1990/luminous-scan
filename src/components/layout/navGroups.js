import {
  LayoutDashboard,
  ScanLine,
  Package,
  MapPin,
  ArrowLeftRight,
  CircleDollarSign,
  Settings2,
  Printer,
  ClipboardList,
  Truck,
  TriangleAlert,
  Download,
  Tags,
  BarChart3,
  BellRing,
  ShoppingBag,
  Undo2,
  ClipboardCheck,
  ChefHat,
  Boxes,
  LayoutGrid,
  Store,
  FileUp,
  Users,
  CalendarClock,
  MessagesSquare,
  NotebookPen,
  GraduationCap,
  Wallet,
  CreditCard,
  Inbox,
  Receipt,
} from 'lucide-react';

/**
 * The workspace's screens, grouped so a long module list stays findable on a
 * laptop. Each screen names the staff permission it needs; no `perm` means
 * everyone with access to the business.
 */
export const NAV_GROUPS = [
  {
    label: 'Overview', labelKey: 'nav.group.overview',
    items: [
      { to: '/', label: 'Overview', labelKey: 'nav.overview', icon: LayoutDashboard, end: true },
      { to: '/scan', label: 'Scan', labelKey: 'nav.scan', icon: ScanLine, perm: 'scan.use' },
    ],
  },
  {
    label: 'Inventory', labelKey: 'nav.group.inventory',
    items: [
      { to: '/products', label: 'Products', labelKey: 'nav.products', icon: Package, perm: 'products.view' },
      { to: '/inventory', label: 'My inventory', labelKey: 'nav.inventory', icon: Boxes, perm: 'products.view' },
      {
        to: '/inventory/categories',
        label: 'Inventory by category', labelKey: 'nav.inventoryByCategory',
        icon: LayoutGrid,
        perm: 'products.view',
      },
      { to: '/categories', label: 'Categories', labelKey: 'nav.categories', icon: Tags, perm: 'categories.manage' },
      { to: '/locations', label: 'Locations', labelKey: 'nav.locations', icon: MapPin, perm: 'locations.manage' },
      { to: '/movements', label: 'Movements', labelKey: 'nav.movements', icon: ArrowLeftRight, perm: 'scan.use' },
      { to: '/cross-store-inbox', label: 'Cross-store inbox', labelKey: 'nav.crossStoreInbox', icon: Inbox, feature: 'crossStore' },
      // Stock counts carries NO perm (owner ruling, Nov 19,
      // 2026): the page is one shared board every staff member
      // sees, so nobody double-counts the same count. What a
      // person may DO on it splits inside the page and on the
      // server — counting, saving and sending for review are
      // open to all; creating, approving, applying and
      // cancelling stay with counts.run.
      { to: '/counts', label: 'Stock counts', labelKey: 'nav.counts', icon: ClipboardCheck },
      { to: '/materials', label: 'Bundles & builds', labelKey: 'nav.bundles', icon: Boxes, perm: 'builds.manage', feature: 'builds' },
    ],
  },
  {
    label: 'Sales', labelKey: 'nav.group.sales',
    items: [
      { to: '/orders', label: 'Orders', labelKey: 'nav.orders', icon: ShoppingBag, perm: 'orders.manage' },
      // Till connections are Business only, and INVISIBLE off
      // Business (the owner's ruling, Nov 14, 2026, superseding
      // the Nov 13 locked-door treatment): the `feature` tag makes
      // Layout hide this entry on Essentials everywhere, and the
      // /pos route itself bounces to the Overview via
      // PlanRedirect — no gate page. The server still refuses
      // Essentials on every POS route, and off-Business webhook
      // sales are still held, never lost.
      { to: '/pos', label: 'Till connections', labelKey: 'nav.pos', icon: Receipt, feature: 'pos' },
      // Storefront connections are BOTH PLANS (the owner's
      // connection doctrine, Nov 23, 2026): no feature tag, no
      // perm — every signed-in member of either plan sees this
      // door; the server still decides who may manage it.
      { to: '/storefronts', label: 'Storefront connections', labelKey: 'nav.storefronts', icon: Store },
      { to: '/returns', label: 'Returns', labelKey: 'nav.returns', icon: Undo2, perm: 'returns.manage' },
      { to: '/listings', label: 'Listings', labelKey: 'nav.listings', icon: Store, perm: 'listings.manage' },
    ],
  },
  // The restaurant corner (the owner's ruling, Nov 21, 2026):
  // its own subheading, Business only. The entry carries the
  // restaurant feature, so on Essentials the group is empty
  // and never renders — the corner leaves no trace. Its pages
  // read the shared app's products, locations, suppliers and
  // purchase orders — no silo. Looking is free for every
  // member (no perm on the door); the doing splits inside
  // the pages on the owner's three ticks.
  // Release 377 (Nov 25, 2026): the corner is a Today page
  // over six shelves, and the menu carries ONE door into it —
  // the fourteen flat entries the corner grew in 359/361 now
  // live on the shelves inside the section (Today → shelf →
  // feature, ≤2 taps), per the owner's anti-clutter rules:
  // nothing new lands on the app's main navigation, and all
  // growth stays inside the Restaurant section.
  {
    label: 'Restaurant', labelKey: 'nav.group.restaurant',
    items: [
      { to: '/restaurant', label: 'Restaurant', labelKey: 'nav.restaurant', icon: ChefHat, feature: 'restaurant' },
    ],
  },
  {
    label: 'Purchasing', labelKey: 'nav.group.purchasing',
    items: [
      { to: '/purchasing', label: 'Purchasing', labelKey: 'nav.purchasing', icon: ClipboardList, perm: 'purchasing.manage', feature: 'purchasing' },
      { to: '/suppliers', label: 'Suppliers', labelKey: 'nav.suppliers', icon: Truck, perm: 'suppliers.manage', feature: 'suppliers' },
    ],
  },
  {
    label: 'Watchlist', labelKey: 'nav.group.watchlist',
    items: [
      // The grant field is the owner's alerts.view enrollment
      // tick (Nov 20, 2026): on Business these two doors hang
      // only for the owner and for members the owner ticked —
      // an unticked member never sees them, and the routes
      // bounce the same way (PlanRedirect carries the same tick).
      { to: '/low-stock', label: 'Low stock', labelKey: 'nav.lowStock', icon: TriangleAlert, perm: 'reports.view', feature: 'alerts', grant: 'alerts.view' },
      { to: '/alerts', label: 'Alerts', labelKey: 'nav.alerts', icon: BellRing, perm: 'reports.view', feature: 'alerts', grant: 'alerts.view' },
      { to: '/valuation', label: 'Stock value', labelKey: 'nav.valuation', icon: CircleDollarSign, perm: 'reports.view', feature: 'valuation' },
      { to: '/reports', label: 'Reports', labelKey: 'nav.reports', icon: BarChart3, perm: 'reports.view', feature: 'reports' },
    ],
  },
  {
    label: 'Workspace', labelKey: 'nav.group.workspace',
    items: [
      { to: '/print', label: 'Print', labelKey: 'nav.print', icon: Printer, perm: 'print.use' },
      { to: '/exports', label: 'Exports', labelKey: 'nav.exports', icon: Download, perm: 'exports.use', feature: 'exports' },
      // Import shares the exports.use permission key on purpose — do NOT
      // rename it to import.use. The key opens /import (both plans) as well
      // as /exports (Business-only), and stored roles and members already
      // hold exports.use; renaming would silently drop Import for staff who
      // should import. On Essentials the same key is offered, and named, as
      // import-only — see exportPermissionLabel in src/lib/staff.js.
      { to: '/import', label: 'Import', labelKey: 'nav.import', icon: FileUp, perm: 'exports.use' },
      // The Staff door follows staff.manage — plus the owner's
      // staff.roster tick (Nov 19, 2026): a manager the owner
      // gave the roster opens the page read-only, so the door
      // must hang for them too (Layout honors anyPerm beside
      // perm). The server scopes what they can read; the page
      // hides its manage furniture for them. The clock build
      // (Nov 21, 2026) adds the staff.clock tick the same way:
      // corrections live on this page, so a manager holding
      // only the clock tick must be able to open it — their
      // clock card renders, the manage furniture stays hidden.
      // The tick split (Nov 24, 2026) names both halves in the
      // anyPerm below: either clock tick (board or call-ins)
      // opens the door the same way.
      // The staff documents build (Nov 21, 2026) adds the
      // staff.documents tick the same way: the documents area
      // lives on this page, so a manager holding only that tick
      // must be able to open it — their documents card renders,
      // the manage furniture stays hidden.
      { to: '/staff', label: 'Staff', labelKey: 'nav.staff', icon: Users, perm: 'staff.manage', anyPerm: ['staff.roster', 'staff.clockBoard', 'staff.callins', 'staff.documents'] },
      // Workforce + Payroll carry no `perm`: every team member needs
      // the time clock and their own stubs. The server enforces the
      // owner > manager > staff hierarchy on every call.
      { to: '/workforce', label: 'Workforce', labelKey: 'nav.workforce', icon: CalendarClock },
      // The manager log book (release 378, Nov 25, 2026): a
      // general feature on BOTH plans (the owner's Q2 ruling)
      // — the official shift record every business keeps. No
      // perm, like Workforce: any trusted member of the
      // business reads and writes it, the daily-log fork.
      { to: '/log-book', label: 'Manager log book', labelKey: 'nav.logBook', icon: NotebookPen },
      // Checklists (plan release 369, Nov 26, 2026): a general
      // feature on BOTH plans (the owner's Q1 ruling) — opening,
      // closing, cleaning and any other list, ticked off on the
      // phone. No perm, like the log book: ticking off is plain
      // staff work; template management rides its own tick
      // inside the page.
      { to: '/checklists', label: 'Checklists', labelKey: 'nav.checklists', icon: ClipboardCheck },
      // Cross-store messages (the owner's ruling, Nov 23,
      // 2026): the second messaging door — everyone on the
      // account, across all their businesses. Business only
      // via the feature tag, so on Essentials the door never
      // renders and the route bounces quietly; the in-store
      // Messages inside Workforce are untouched by it. No
      // perm: every team member can reach their own people.
      { to: '/cross-store-messages', label: 'Cross-store messages', labelKey: 'nav.xstoreMessages', icon: MessagesSquare, feature: 'xstoreMessages' },
      // Training likewise: every team member has lessons matched to
      // their role, and role grants assign more. No perm, both plans.
      { to: '/training', label: 'Training', labelKey: 'nav.training', icon: GraduationCap },
      { to: '/payroll', label: 'Payroll', labelKey: 'nav.payroll', icon: Wallet },
      // Settings sits directly after Payroll (owner ruling,
      // Nov 14, 2026): it used to be the menu's very last item,
      // rendered below the All screens menu's scroll fold next to
      // Plan & limits, so owners could not see it and reported it
      // missing. Same route as the bottom tab bar's Settings tab.
      // Settings carries NO permission since Nov 19, 2026: every
      // signed-in person gets the door — the page itself renders
      // the boss's full Settings for the owner and a PERSONAL
      // Settings (account, security, appearance/language, Report
      // a problem, plus any sections the owner granted) for
      // everyone else. Business-level sections never render for
      // a non-owner, so the door is safe to show to all.
      { to: '/settings', label: 'Settings', labelKey: 'nav.settings', icon: Settings2 },
      // Plan & limits is the subscription's home — owner-only
      // money territory (Nov 19, 2026): hidden from non-owners,
      // and App.jsx bounces a typed URL quietly to Overview.
      { to: '/upgrade', label: 'Plan & limits', labelKey: 'nav.upgrade', icon: CreditCard, bossOnly: true },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);