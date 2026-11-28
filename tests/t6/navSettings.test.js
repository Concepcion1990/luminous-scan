/**
 * T6 — Settings in the All screens menu (owner catch, Nov 14, 2026).
 *
 * Settings was the Workspace group's very last item, rendered below
 * the mobile menu's scroll fold, so the owner reported it missing
 * from 'All screens' even though the entry existed. Her ruling:
 * Settings belongs in the menu right after Payroll, linking to the
 * same /settings route as the bottom tab bar. These pins hold the
 * position, and audit the whole menu against the app's route list:
 * every signed-in screen must appear in the nav (public/front-door
 * routes are intentionally absent).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('Settings sits in the Workspace group directly after Payroll', () => {
  const nav = src('src/components/layout/navGroups.js');
  const payrollAt = nav.indexOf("to: '/payroll'");
  const settingsAt = nav.indexOf("to: '/settings'");
  const upgradeAt = nav.indexOf("to: '/upgrade'");
  assert.ok(payrollAt !== -1 && settingsAt !== -1 && upgradeAt !== -1, 'all three entries exist');
  assert.ok(payrollAt < settingsAt, 'Settings comes after Payroll');
  assert.ok(settingsAt < upgradeAt, 'Settings comes before Plan & limits');
  // Nothing but the explanatory comment may sit between the Payroll
  // entry and the Settings entry.
  const payrollEntryEnd = nav.indexOf('},', payrollAt);
  const between = nav.slice(payrollEntryEnd, settingsAt);
  assert.doesNotMatch(between, /\{ to: '/, 'no other screen sits between Payroll and Settings');
  // The Settings entry carries NO permission since the staff
  // batch (Nov 19, 2026): every signed-in person — owner, staff,
  // viewer — reaches their Settings (personal scope for
  // non-owners). It previously pinned perm: 'settings.manage',
  // which is exactly what locked staff out of Settings entirely.
  assert.match(
    nav,
    /\{ to: '\/settings', label: 'Settings', labelKey: 'nav\.settings', icon: Settings2 \}/,
    'the Settings entry keeps its label, key and icon, with no permission gate',
  );
});

test('every signed-in app screen appears in the nav (menu audit)', () => {
  const app = src('src/App.jsx');
  const nav = src('src/components/layout/navGroups.js');
  const routePaths = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  const navPaths = new Set([...nav.matchAll(/to: '([^']+)'/g)].map((m) => m[1]));
  // Public / front-door / flow routes: correctly absent from the
  // signed-in All screens menu.
  const publicRoutes = new Set([
    '*', '/login', '/register', '/verify-email', '/forgot-password',
    '/reset-password', '/account-recovery', '/welcome', '/plans',
    '/subscribe', '/ThankYou', '/thankyou', '/grace', '/about',
    // The one-time first-login welcome (Nov 19, 2026) is a flow
    // screen like /grace: shown before the shell, never a menu door.
    '/staff-welcome',
    // The public guest menu (plan release 371, Nov 26, 2026):
    // a guest page behind a share slug — no account, never a
    // menu door.
    '/menu/:slug',
    '/privacy-policy', '/terms-of-service', '/subscription-policy',
    '/policies/terms', '/policies/subscription',
    '/payroll/direct-deposit-form',
    // The member's own pay-stub print page (Nov 21, 2026) is a
    // document screen like the direct-deposit form: reached from
    // Payroll's stub list, printed, never a menu door.
    '/payroll/stub/:stubId',
    // The dish page (Nov 23, 2026) is a detail screen like the
    // pay stub: reached from the Recipes list (itself a menu
    // door), printed as the dish card, never a menu door.
    '/restaurant/recipes/:id',
    // Release 377 (Nov 25, 2026): the Restaurant corner's screens
    // are reached from the Restaurant home (the Today page) — the
    // six shelves and every feature behind them — never from the
    // All screens menu, whose Restaurant group is the one
    // '/restaurant' door (the anti-clutter rule). The shelf pages
    // and the feature pages are all in this set for the same
    // reason: in-section doors, not menu doors.
    '/restaurant/recipes',
    '/restaurant/kitchen', '/restaurant/stock', '/restaurant/money',
    '/restaurant/safety', '/restaurant/floor', '/restaurant/team',
    '/restaurant/locations',
    '/restaurant/order-guide', '/restaurant/invoices', '/restaurant/waste',
    '/restaurant/expiry', '/restaurant/allergens', '/restaurant/temp-logs',
    '/restaurant/86', '/restaurant/transfers', '/restaurant/staff-meals',
    '/restaurant/menu', '/restaurant/variance', '/restaurant/prep',
    '/restaurant/ledger',
    // Release 370 (Nov 26, 2026): the food-safety file's five
    // screens are Food Safety shelf doors in the corner, reached
    // from the shelf like every feature above — never menu doors.
    '/restaurant/safety-logs', '/restaurant/inspection',
    '/restaurant/certificates', '/restaurant/mock-inspection',
    '/restaurant/sds',
    // Plan release 371 (Nov 26, 2026): the kitchen display
    // and the guest-menu page are Kitchen & Recipes / Floor
    // & Guests shelf doors in the corner, like every feature
    // above — never menu doors.
    '/restaurant/kitchen-display', '/restaurant/guest-menu',
    // Plan release 373 (Nov 26, 2026): the tip-pooling page
    // is a Team & Place shelf door in the corner, like every
    // feature above — never a menu door.
    '/restaurant/tip-pooling',
    // Plan release 374 (Nov 26, 2026): the labor-target page
    // is a Team & Place shelf door in the corner, like every
    // feature above — never a menu door.
    '/restaurant/labor-target',
    // Plan release 375 (Nov 26, 2026): the catering page is
    // a Floor & Guests shelf door in the corner, like every
    // feature above — never a menu door.
    '/restaurant/catering',
    // Plan release 376 (Nov 26, 2026): the reservations page
    // is a Floor & Guests shelf door in the corner, like every
    // feature above — never a menu door.
    '/restaurant/reservations',
    // Plan release 377 (Nov 26, 2026): the standing-orders
    // page is a Stock & Ordering shelf door in the corner,
    // like every feature above — never a menu door.
    '/restaurant/standing-orders',
    // Plan release 378 (Nov 26, 2026): the production-order
    // page is a Stock & Ordering shelf door in the corner,
    // like every feature above — never a menu door.
    '/restaurant/production-order',
    // Plan release 379 (Nov 26, 2026): the bar-counting page
    // is a Stock & Ordering shelf door in the corner — and a
    // hidden one until the owner turns it on — never a menu
    // door.
    '/restaurant/bar-counting',
  ]);
  const appScreens = routePaths.filter((p) => !publicRoutes.has(p));
  assert.ok(appScreens.length >= 30, `audit covers the full screen list (saw ${appScreens.length})`);
  for (const path of appScreens) {
    assert.ok(navPaths.has(path), `screen ${path} is missing from the All screens menu`);
  }
});
