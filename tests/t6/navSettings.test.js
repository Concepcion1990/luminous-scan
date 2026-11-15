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
  assert.match(
    nav,
    /\{ to: '\/settings', label: 'Settings', labelKey: 'nav\.settings', icon: Settings2, perm: 'settings\.manage' \}/,
    'the Settings entry keeps its label, key, icon and permission',
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
    '/privacy-policy', '/terms-of-service', '/subscription-policy',
    '/policies/terms', '/policies/subscription',
    '/payroll/direct-deposit-form',
  ]);
  const appScreens = routePaths.filter((p) => !publicRoutes.has(p));
  assert.ok(appScreens.length >= 30, `audit covers the full screen list (saw ${appScreens.length})`);
  for (const path of appScreens) {
    assert.ok(navPaths.has(path), `screen ${path} is missing from the All screens menu`);
  }
});
