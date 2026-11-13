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
  Boxes,
  LayoutGrid,
  Store,
  FileUp,
  Users,
  CreditCard,
  Inbox,
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
      { to: '/counts', label: 'Stock counts', labelKey: 'nav.counts', icon: ClipboardCheck, perm: 'counts.run' },
      { to: '/materials', label: 'Bundles & builds', labelKey: 'nav.bundles', icon: Boxes, perm: 'builds.manage', feature: 'builds' },
    ],
  },
  {
    label: 'Sales', labelKey: 'nav.group.sales',
    items: [
      { to: '/orders', label: 'Orders', labelKey: 'nav.orders', icon: ShoppingBag, perm: 'orders.manage' },
      { to: '/returns', label: 'Returns', labelKey: 'nav.returns', icon: Undo2, perm: 'returns.manage' },
      { to: '/listings', label: 'Listings', labelKey: 'nav.listings', icon: Store, perm: 'listings.manage' },
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
      { to: '/low-stock', label: 'Low stock', labelKey: 'nav.lowStock', icon: TriangleAlert, perm: 'reports.view', feature: 'alerts' },
      { to: '/alerts', label: 'Alerts', labelKey: 'nav.alerts', icon: BellRing, perm: 'reports.view', feature: 'alerts' },
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
      { to: '/staff', label: 'Staff', labelKey: 'nav.staff', icon: Users, perm: 'staff.manage' },
      { to: '/upgrade', label: 'Plan & limits', labelKey: 'nav.upgrade', icon: CreditCard },
      { to: '/settings', label: 'Settings', labelKey: 'nav.settings', icon: Settings2, perm: 'settings.manage' },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);