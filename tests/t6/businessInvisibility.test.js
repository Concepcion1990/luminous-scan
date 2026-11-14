/**
 * Business-only invisibility, extended (the owner's ruling,
 * Nov 14, 2026, ~15:50 PM MST — "Yes, send them back quietly").
 *
 * The correction train gave Till connections the invisibility
 * treatment: nav entry hidden off Business, the route wrapped in
 * PlanRedirect so a typed URL bounces quietly to the Overview, and
 * no gate page anywhere. The gate audit then found every OTHER
 * Business-only surface still showing a PlanGate upsell page on
 * Essentials via direct URL. This file pins the extension of the
 * same treatment to all of them:
 *
 *   /materials (builds), /cross-store-inbox (crossStore),
 *   /purchasing (purchasing), /suppliers (suppliers),
 *   /exports (exports), /valuation (valuation),
 *   /reports (reports), /alerts + /low-stock (alerts),
 *
 * plus the Rewards TAB inside Workforce: the page is both-plans and
 * stays fully visible, but the tab itself must not appear at all on
 * non-Business plans. Business behavior is unchanged everywhere —
 * PlanRedirect renders its children untouched when the plan allows
 * the feature. Import stays both-plans by design and is not wrapped.
 * Server-side plan enforcement is untouched (defense in depth).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const ROUTES = [
  { path: '/materials', feature: 'builds', component: 'Materials', page: 'src/pages/Materials.jsx' },
  { path: '/cross-store-inbox', feature: 'crossStore', component: 'CrossStoreInbox', page: 'src/pages/CrossStoreInbox.jsx' },
  { path: '/purchasing', feature: 'purchasing', component: 'Purchasing', page: 'src/pages/Purchasing.jsx' },
  { path: '/suppliers', feature: 'suppliers', component: 'Suppliers', page: 'src/pages/Suppliers.jsx' },
  { path: '/exports', feature: 'exports', component: 'Exports', page: 'src/pages/Exports.jsx' },
  { path: '/valuation', feature: 'valuation', component: 'Valuation', page: 'src/pages/Valuation.jsx' },
  { path: '/reports', feature: 'reports', component: 'Reports', page: 'src/pages/Reports.jsx' },
  { path: '/alerts', feature: 'alerts', component: 'Alerts', page: 'src/pages/Alerts.jsx' },
  { path: '/low-stock', feature: 'alerts', component: 'LowStock', page: 'src/pages/LowStock.jsx' },
];

test('PlanRedirect is the one mechanism: children when allowed, quiet bounce otherwise', () => {
  const redirect = src('src/components/plan/PlanRedirect.jsx');
  assert.match(redirect, /if \(!can\(feature\)\) return <Navigate to="\/" replace \/>;/);
  assert.match(redirect, /return children;/);
});

test('every audited Business-only route bounces via PlanRedirect, gate-free', () => {
  const app = src('src/App.jsx');
  for (const { path, feature, component } of ROUTES) {
    assert.match(app, new RegExp(`path="${path.replace(/\//g, '\\/')}"`), `${path} route exists`);
    assert.match(
      app,
      new RegExp(`<PlanRedirect feature="${feature}">\\s*<${component} \\/>`),
      `${path} is wrapped in PlanRedirect(${feature}) so Essentials bounces to the Overview`,
    );
    assert.doesNotMatch(
      app,
      new RegExp(`<PlanGate feature="${feature}">`),
      `${path} must not render the PlanGate upsell page`,
    );
  }
  // No route in the app renders a gate page anymore.
  assert.doesNotMatch(app, /PlanGate/, 'App.jsx carries no PlanGate wrapper or import');
});

test('every audited page renders no gate of its own', () => {
  for (const { page } of ROUTES) {
    assert.doesNotMatch(src(page), /<PlanGate/, `${page} must not render a gate door`);
  }
});

test('nav entries for every audited surface carry the feature (hidden off Business)', () => {
  const nav = src('src/components/layout/navGroups.js');
  for (const { path, feature } of ROUTES) {
    assert.match(
      nav,
      new RegExp(`\\{ to: '${path.replace(/\//g, '\\/')}'[^}]*feature: '${feature}' \\}`),
      `the ${path} nav item carries feature '${feature}'`,
    );
  }
  const layout = src('src/components/Layout.jsx');
  assert.match(
    layout,
    /\(!item\.feature \|\| planAllows\(item\.feature\)\)/,
    'Layout hides any nav item whose feature the plan does not allow',
  );
});

test('Import stays both-plans: its route is wrapped in neither gate nor redirect', () => {
  const app = src('src/App.jsx');
  const importLine = app.split('\n').find((line) => line.includes('path="/import"'));
  assert.match(importLine, /<Route path="\/import" element=\{<ImportCenter \/>\} \/>/);
  assert.doesNotMatch(importLine, /PlanGate|PlanRedirect/);
});

test('Rewards tab: absent on Essentials, present on Business, Workforce itself untouched', () => {
  const workforce = src('src/pages/Workforce.jsx');
  // The tab is still declared (Business sees it exactly as before)…
  assert.match(workforce, /\{ id: 'rewards', labelKey: 'workforce\.tab\.rewards', icon: Gift \}/);
  // …but visibility is entitlement-driven, hidden until Business is known.
  assert.match(workforce, /const showRewards = !entitlementLoading && can\('rewards'\);/);
  assert.match(
    workforce,
    /TABS\.filter\(\(\{ id \}\) => id !== 'rewards' \|\| showRewards\)/,
    'the tab bar filters the Rewards tab out unless showRewards',
  );
  assert.match(
    workforce,
    /\{tab === 'rewards' && showRewards && \(/,
    'the Rewards tab body renders only when showRewards',
  );
  assert.doesNotMatch(workforce, /PlanGate/, 'the Rewards tab renders no gate door');
  // The page itself is both-plans: its route is a plain route, and the
  // other tabs render with no plan condition at all.
  const app = src('src/App.jsx');
  const workforceLine = app.split('\n').find((line) => line.includes('path="/workforce"'));
  assert.match(workforceLine, /<Route path="\/workforce" element=\{<Workforce \/>\} \/>/);
  assert.doesNotMatch(workforceLine, /PlanGate|PlanRedirect/);
  for (const other of ['clock', 'schedule', 'timeoff', 'tasks', 'inbox']) {
    assert.match(
      workforce,
      new RegExp(`\\{tab === '${other}' && <`),
      `the ${other} tab renders unconditionally`,
    );
  }
});
