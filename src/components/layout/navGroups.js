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
} from 'lucide-react';

/**
 * The workspace's screens, grouped so a long module list stays findable on a
 * laptop. Each screen names the staff permission it needs; no `perm` means
 * everyone with access to the business.
 */
export const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/scan', label: 'Scan', icon: ScanLine, perm: 'scan.use' },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { to: '/products', label: 'Products', icon: Package, perm: 'products.view' },
      { to: '/inventory', label: 'My inventory', icon: Boxes, perm: 'products.view' },
      {
        to: '/inventory/categories',
        label: 'Inventory by category',
        icon: LayoutGrid,
        perm: 'products.view',
      },
      { to: '/categories', label: 'Categories', icon: Tags, perm: 'categories.manage' },
      { to: '/locations', label: 'Locations', icon: MapPin, perm: 'locations.manage' },
      { to: '/movements', label: 'Movements', icon: ArrowLeftRight, perm: 'scan.use' },
      { to: '/counts', label: 'Stock counts', icon: ClipboardCheck, perm: 'counts.run' },
      { to: '/materials', label: 'Bundles & builds', icon: Boxes, perm: 'builds.manage', feature: 'builds' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/orders', label: 'Orders', icon: ShoppingBag, perm: 'orders.manage' },
      { to: '/returns', label: 'Returns', icon: Undo2, perm: 'returns.manage' },
      { to: '/listings', label: 'Listings', icon: Store, perm: 'listings.manage' },
    ],
  },
  {
    label: 'Purchasing',
    items: [
      { to: '/purchasing', label: 'Purchasing', icon: ClipboardList, perm: 'purchasing.manage', feature: 'purchasing' },
      { to: '/suppliers', label: 'Suppliers', icon: Truck, perm: 'suppliers.manage', feature: 'suppliers' },
    ],
  },
  {
    label: 'Watchlist',
    items: [
      { to: '/low-stock', label: 'Low stock', icon: TriangleAlert, perm: 'reports.view', feature: 'alerts' },
      { to: '/alerts', label: 'Alerts', icon: BellRing, perm: 'reports.view', feature: 'alerts' },
      { to: '/valuation', label: 'Stock value', icon: CircleDollarSign, perm: 'reports.view', feature: 'valuation' },
      { to: '/reports', label: 'Reports', icon: BarChart3, perm: 'reports.view', feature: 'reports' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { to: '/print', label: 'Print', icon: Printer, perm: 'print.use' },
      { to: '/exports', label: 'Exports', icon: Download, perm: 'exports.use', feature: 'exports' },
      // Import shares the exports.use permission key on purpose — do NOT
      // rename it to import.use. The key opens /import (both plans) as well
      // as /exports (Business-only), and stored roles and members already
      // hold exports.use; renaming would silently drop Import for staff who
      // should import. On Essentials the same key is offered, and named, as
      // import-only — see exportPermissionLabel in src/lib/staff.js.
      { to: '/import', label: 'Import', icon: FileUp, perm: 'exports.use' },
      { to: '/staff', label: 'Staff', icon: Users, perm: 'staff.manage' },
      { to: '/upgrade', label: 'Plan & limits', icon: CreditCard },
      { to: '/settings', label: 'Settings', icon: Settings2, perm: 'settings.manage' },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);