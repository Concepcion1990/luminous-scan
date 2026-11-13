import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { featureAllowed } from './plans.js';

/**
 * Purchasing cards on the home (Overview) page: Business-only.
 *
 * LIVE FINDING (2026-11-07, on the fresh Essentials account): the Overview
 * page showed the "Incoming stock" card (with a Purchasing link, "Nothing
 * on order.") and the "Reorder suggestions" card ("Low stock becomes a
 * purchase order in one tap" with a Purchase orders link). Purchasing and
 * purchase orders are Business-only. Concepcion clicked through to
 * Purchasing and it correctly said it belongs in Business — the PlanGate
 * on the page itself was already fine; only the home cards were leaking.
 *
 * The fix gates both cards on the loaded entitlement, following the PR #44
 * unknown-null pattern: while the entitlement row is still loading the plan
 * is unknown, so neither card renders (and the purchase-order rows are not
 * even fetched) rather than flashing Business cards to an Essentials
 * account. Business keeps both cards exactly as before.
 *
 * Data path: there is no backend function behind either card. The
 * incoming-stock list is a client-side PurchaseOrder entity read and the
 * reorder suggestions are derived client-side from low-stock levels (the
 * panel also reads Supplier entities and creates PurchaseOrder entities
 * directly). Nothing here is served by a backend function, so there is no
 * server read to refuse — the render guard and the skipped fetch are the
 * enforcement, and the panel can only create a purchase order when it is
 * rendered, i.e. on Business. (The same panel on /low-stock is already
 * behind PlanGate feature="alerts", so it is unreachable on Essentials.)
 */

test('purchasing is a Business-only feature', () => {
  assert.equal(featureAllowed('essentials', 'purchasing'), false);
  assert.equal(featureAllowed('business', 'purchasing'), true);
  // A missing or unknown plan resolves to restricted Essentials.
  assert.equal(featureAllowed(undefined, 'purchasing'), false);
  assert.equal(featureAllowed(null, 'purchasing'), false);
});

test('the Overview gates both purchasing cards on the loaded entitlement', () => {
  const page = readFileSync('src/pages/Dashboard.jsx', 'utf8');
  assert.match(
    page,
    /const \{ record: entitlementRecord, can, limits, isLoading: entitlementLoading \} = useEntitlements\(\);/
  );
  // Unknown while loading — never another plan's state (PR #44 pattern).
  assert.match(page, /const showPurchasing = !entitlementLoading && can\('purchasing'\);/);
  assert.match(page, /\{showPurchasing && <IncomingStock purchaseOrders=\{ops\.purchaseOrders\} \/>\}/);
  assert.match(page, /\{showPurchasing && \(\s*<ReorderPanel items=\{stats\.low\}/);
  // Nothing else on the Overview is gated away: orders to fulfil stay.
  assert.match(page, /<OrdersToFulfil orders=\{ops\.orders\} currency=\{profile\.currency\} \/>/);
});

test('the Overview never asks for purchase orders unless the cards may show', () => {
  const page = readFileSync('src/pages/Dashboard.jsx', 'utf8');
  const calls = page.match(/loadOperations\(activeId \|\| '', \{ includePurchaseOrders: showPurchasing \}\)/g) || [];
  // Both the initial load and pull-to-refresh pass the flag.
  assert.equal(calls.length, 2);
  const ops = readFileSync('src/lib/dashboardOps.js', 'utf8');
  assert.match(
    ops,
    /export async function loadOperations\(businessId = '', \{ includePurchaseOrders = true \} = \{\}\) \{/
  );
  assert.match(ops, /includePurchaseOrders\s*\n?\s*\? base44\.entities\.PurchaseOrder\.filter\(/);
  assert.match(ops, /: Promise\.resolve\(\{ items: \[\] \}\)/);
});

test('no backend function serves the purchasing cards', () => {
  // Client-side entity reads only: if a backend function ever starts
  // serving incoming stock or reorder data, this fails until the Essentials
  // refusal is added alongside it.
  for (const file of [
    'src/lib/dashboardOps.js',
    'src/pages/Dashboard.jsx',
    'src/components/dashboard/IncomingStock.jsx',
    'src/components/dashboard/ReorderPanel.jsx',
  ]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /functions\.invoke/, file);
  }
});

/**
 * AUDIT FINDING 4: the same leak, one layer down. The Low-stock card, the
 * Stock-value card and the Needs-attention panel all rendered for
 * Essentials while /low-stock, /alerts and /valuation sat behind PlanGate
 * — an Essentials click on the panel even landed on the lock screen.
 * The fix gates them on the loaded entitlement with the same
 * `!entitlementLoading && can(…)` pattern, and shows locked teasers
 * linking to /upgrade instead of a silent gap, so the customer sees what
 * Business adds. Units on hand and Active SKUs stay ungated on both plans.
 */
test('the Overview gates the Low-stock and Stock-value cards on the loaded entitlement', () => {
  const page = readFileSync('src/pages/Dashboard.jsx', 'utf8');
  assert.match(page, /const showAlerts = !entitlementLoading && can\('alerts'\);/);
  assert.match(page, /const showValuation = !entitlementLoading && can\('valuation'\);/);
  // The real cards only render when the plan is known to allow them.
  assert.match(page, /\{showAlerts \? \(\s*<StatCard\s*\n?\s*label="Low stock"/);
  assert.match(page, /\{showValuation \? \(\s*<StatCard\s*\n?\s*label="Stock value"/);
  // Otherwise a locked teaser in the same grid slot, linking to /upgrade.
  assert.match(
    page,
    /<LockedStatCard label="Low stock" hint="Low-stock alerts are a Business feature\." \/>/
  );
  assert.match(
    page,
    /<LockedStatCard label="Stock value" hint="Stock valuation is a Business feature\." \/>/
  );
  assert.match(page, /function LockedStatCard\(\{ label, hint \}\) \{/);
  // While the plan is still loading the gated slots hold their shape
  // (skeleton), never a Business figure and never a lock.
  assert.match(page, /\{entitlementLoading \? \(\s*<>\s*\n?\s*<div className="h-\[104px\] animate-pulse/);
  // The two ungated cards are untouched.
  assert.match(page, /<StatCard label="Units on hand"/);
  assert.match(page, /<StatCard label="Active SKUs"/);
});

test('the Overview gates the Needs-attention panel behind alerts', () => {
  const page = readFileSync('src/pages/Dashboard.jsx', 'utf8');
  assert.match(page, /: showAlerts \? \(\s*<AttentionPanel low=\{stats\.low\} \/>/);
  assert.match(page, /: \(\s*<LockedAttentionPanel \/>/);
  assert.match(page, /function LockedAttentionPanel\(\) \{/);
  assert.match(page, /Low-stock alerts are a Business feature/);
  assert.match(page, /<Link\s*\n?\s*to="\/upgrade"/);
  // Exactly one AttentionPanel render, and it sits inside the showAlerts
  // ternary — never rendered unconditionally the way it was before.
  assert.equal((page.match(/<AttentionPanel low=\{stats\.low\} \/>/g) || []).length, 1);
});

/**
 * FINDING 36: the trial banner only speaks at 5 days, 3 days and the last
 * 24 hours, so on every other trial day the Dashboard said nothing about
 * the trial at all. A quiet chip using the existing trialLabel fills the
 * gaps; the loud banners stay exactly as they were.
 */
test('the Overview shows a quiet trial chip on every trial day', () => {
  const page = readFileSync('src/pages/Dashboard.jsx', 'utf8');
  assert.match(page, /import \{ trialLabel, trialWarningDetails \} from '@\/lib\/entitlements';/);
  assert.match(page, /const trialChip = trialLabel\(entitlementRecord\);/);
  assert.match(page, /\{trialChip && \(/);
  // The 5/3/24h banner is untouched: the chip is quiet, the banner is loud.
  assert.match(page, /const inAppNotice = trialInAppNotice\(entitlementRecord\);/);
  assert.match(page, /const showTrialBanner = isPrelaunch \? Boolean\(trialNoticeStage\) : Boolean\(inAppNotice\);/);
});

/**
 * FINDING 36: a customer at 50/50 only discovered the cap on the Products
 * page. The Dashboard says so under the New product button, at the cap.
 */
test('the Overview warns at the product cap before the Products page does', () => {
  const page = readFileSync('src/pages/Dashboard.jsx', 'utf8');
  assert.match(page, /import \{ displayLimit \} from '@\/lib\/plans';/);
  assert.match(page, /const productLimit = displayLimit\(limits\.products, entitlementLoading\);/);
  assert.match(
    page,
    /const atProductLimit =\s*\n?\s*productLimit != null && stats != null && stats\.activeSkus >= productLimit;/
  );
  assert.match(page, /Products \{stats\.activeSkus\} of \{productLimit\} —/);
  assert.match(page, /Upgrade for unlimited products/);
  // Only at the cap — below it the Dashboard stays quiet.
  assert.match(page, /\{atProductLimit && \(/);
});
