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
  { path: '/alerts', feature: 'alerts', component: 'Alerts', page: 'src/pages/Alerts.jsx', perm: 'alerts.view' },
  { path: '/low-stock', feature: 'alerts', component: 'LowStock', page: 'src/pages/LowStock.jsx', perm: 'alerts.view' },
];

test('PlanRedirect is the one mechanism: children when allowed, quiet bounce otherwise', () => {
  const redirect = src('src/components/plan/PlanRedirect.jsx');
  assert.match(redirect, /if \(!can\(feature\)\) return <Navigate to="\/" replace \/>;/);
  // The per-person layer (the low-stock ticks, Nov 20, 2026): a
  // route may also carry an owner-handed tick; an unticked member
  // bounces just as quietly.
  assert.match(redirect, /if \(perm && !canStaff\(perm\)\) return <Navigate to="\/" replace \/>;/);
  assert.match(redirect, /return children;/);
});

test('every audited Business-only route bounces via PlanRedirect, gate-free', () => {
  const app = src('src/App.jsx');
  for (const { path, feature, component, perm } of ROUTES) {
    assert.match(app, new RegExp(`path="${path.replace(/\//g, '\\/')}"`), `${path} route exists`);
    assert.match(
      app,
      new RegExp(`<PlanRedirect feature="${feature}"${perm ? ` perm="${perm}"` : ''}>\\s*<${component} \\/>`),
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
      new RegExp(`\\{ to: '${path.replace(/\//g, '\\/')}'[^}]*feature: '${feature}'[^}]*\\}`),
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

test('Overview: no Business teaser cards or upsell panel on Essentials; Business unchanged', () => {
  const dashboard = src('src/pages/Dashboard.jsx');
  // The real cards are entitlement-gated exactly as the purchasing
  // cards are — and off Business the slots render nothing at all.
  assert.match(dashboard, /const showAlerts = !entitlementLoading && can\('alerts'\) && canStaff\('alerts\.view'\);/);
  assert.match(dashboard, /const showValuation = !entitlementLoading && can\('valuation'\);/);
  assert.match(dashboard, /\{showAlerts && \(\s*<StatCard\s+label=\{t\('dashboard\.lowStock'\)\}/);
  assert.match(dashboard, /\{showValuation && \(\s*<StatCard\s+label=\{t\('dashboard\.stockValue'\)\}/);
  // No teaser components, no padlock cards, no upsell links anywhere
  // on the Overview.
  assert.doesNotMatch(dashboard, /LockedStatCard/);
  assert.doesNotMatch(dashboard, /LockedAttentionPanel/);
  assert.doesNotMatch(dashboard, /dashboard\.seeBusiness/);
  assert.doesNotMatch(dashboard, /dashboard\.attentionLocked/);
  assert.doesNotMatch(dashboard, /dashboard\.seeWhatBusinessIncludes/);
  // Needs attention: the box is the Business low-stock home (owner
  // ruling, Nov 20, 2026): real rows on Business, and on Essentials
  // the box does not render at all — no empty panel, no placeholder.
  assert.match(dashboard, /: showAlerts \? \(\s*<AttentionPanel low=\{stats\.low\} \/>/);
  assert.match(dashboard, /<AttentionPanel low=\{stats\.low\} \/>\s*\) : null\}/);
  assert.doesNotMatch(dashboard, /<AttentionPanel low=\{\[\]\}/);
  assert.equal((dashboard.match(/<AttentionPanel low=\{stats\.low\} \/>/g) || []).length, 1);
  // The ungated cards stay on both plans.
  assert.match(dashboard, /<StatCard label=\{t\('dashboard\.unitsOnHand'\)\}/);
  assert.match(dashboard, /<StatCard label=\{t\('dashboard\.activeSkus'\)\}/);
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

test('PlanRedirect itself: allowed plans render the page untouched, others bounce', () => {
  const redirect = readFileSync(new URL('../../src/components/plan/PlanRedirect.jsx', import.meta.url), 'utf8');
  assert.ok(
    redirect.includes('if (!can(feature)) return <Navigate to="/" replace />;'),
    'only a plan lacking the feature is bounced, quietly, to Overview',
  );
  assert.ok(redirect.includes('return children;'), 'a plan with the feature renders the real page exactly as before');
});
