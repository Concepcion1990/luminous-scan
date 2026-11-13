import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en } from '../lib/locales/en.js';

// Regression test for the live bug Concepcion found as her own first
// customer (2026-11-06): Plans -> Subscribe showed "Open workspace", and
// clicking it looped back to Subscribe forever, so no new customer could
// ever reach checkout.
//
// Root cause: the old "Open workspace" button linked to "/", and "/" sits
// behind SubscriptionAccessRoute, which sends anyone without a paid/trial
// entitlement back to /plans. But a customer with no workspace has no
// entitlement yet — and the only way to get one is to subscribe. The
// workspace therefore has to be attached HERE on the Subscribe page.
//
// T4 (2026-11-09): Stripe checkout is live — Subscribe calls
// create-checkout on the server (which validates the plan, binds the
// workspace, checks the one-trial-per-email rule, and returns Stripe's
// hosted checkout URL). The workspace setup stays, so a customer can
// be ready the moment subscriptions return. Backend assertions about
// the checkout/catalog/webhook live in tests/t4/.
//
// T6.3: the page copy moved into src/lib/locales/en.js (subscribe.*,
// plans.*) and the pages render it through t(). These tests assert the
// page references the key AND the English value still says the words —
// the copy is what the customer reads, wherever it lives.

test('Subscribe no longer links "Open workspace" to the gated workspace', () => {
  const screen = readFileSync('src/pages/Subscribe.jsx', 'utf8');
  // No dead link into the entitlement-gated workspace.
  assert.doesNotMatch(screen, /<Link to="\/"[^>]*>Open workspace<\/Link>/);
  assert.doesNotMatch(screen, /to="\/"[^>]*>Open workspace/);
  // The workspace is attached on this page instead.
  assert.match(screen, /t\('subscribe\.setupWorkspace'\)/);
  assert.equal(en['subscribe.setupWorkspace'], 'Set up my workspace');
  assert.match(screen, /attachWorkspace/);
  assert.match(screen, /setupWorkspace/);
  assert.match(screen, /switchTo\(businessId\)/);
  assert.match(screen, /createBusiness\(\{ name \}\)/);
});

test('Subscribe flow is create-account, then workspace, then Stripe checkout', () => {
  const screen = readFileSync('src/pages/Subscribe.jsx', 'utf8');
  // Step 1 — a new customer creates an account first (email + password
  // only — Google sign-in is not offered on the twin, owner's decision
  // Nov 9) and is sent straight back here.
  assert.match(screen, /\/register\?returnTo=/);
  assert.match(screen, /t\('subscribe\.createAccount'\)/);
  assert.equal(en['subscribe.createAccount'], 'Create account');
  assert.match(screen, /\/login\?returnTo=/);
  // Step 2 — workspace setup happens on this page, with copy that says so.
  assert.match(screen, /t\('subscribe\.chooseBusiness'\)/);
  assert.match(en['subscribe.chooseBusiness'], /does not open the app, start a trial, or charge anything/);
  // Step 3 — Stripe checkout is live: the page calls create-checkout
  // and shows the trial button when the server says the email is
  // eligible (or the paid button with the plain no-second-trial note).
  assert.doesNotMatch(screen, /switching payments to Stripe/i);
  assert.match(screen, /base44\.functions\.invoke\('create-checkout'/);
  assert.match(screen, /t\('subscribe\.startTrial'/);
  assert.match(en['subscribe.startTrial'], /Start 7-day free trial/);
  assert.match(screen, /t\('subscribe\.noTrial'/);
  assert.match(en['subscribe.noTrial'], /has subscribed before, so a new trial is not available/);
  assert.doesNotMatch(screen, /Wix/i);
  // Step 4 — access only after Stripe confirms: the page never renders the
  // workspace itself and never grants access on this screen.
  assert.doesNotMatch(screen, /Navigate to="\/"/);
  const route = readFileSync('src/components/plan/SubscriptionAccessRoute.jsx', 'utf8');
  assert.match(route, /<Navigate to="\/plans"/);
});

test('Subscribe workspace-loop fix applies to Business exactly as to Essentials', () => {
  // Concepcion's follow-up (2026-11-06): the fix must be true for the
  // Business plan too, not just Essentials. The whole Subscribe flow is
  // plan-keyed, never hardcoded to Essentials.
  const screen = readFileSync('src/pages/Subscribe.jsx', 'utf8');
  // Plan is taken from ?plan= and preserved through the whole flow.
  // A missing or unknown ?plan= is NOT defaulted to Essentials — it shows
  // the invalid-link chooser instead (audit finding 17).
  assert.match(screen, /selected === 'business' \? 'business'/);
  assert.match(screen, /selected === 'essentials' \? 'essentials' : null/);
  assert.doesNotMatch(screen, /selected === 'business' \? 'business' : 'essentials'/);
  assert.match(screen, /t\('subscribe\.invalidTitle'\)/);
  assert.equal(en['subscribe.invalidTitle'], "That plan link isn't valid — choose a plan");
  assert.match(screen, /const returnTo = planKey \? `\/subscribe\?plan=\$\{planKey\}` : '\/plans'/);
  assert.match(screen, /const plan = planKey \? PLANS\[planKey\] : null/);
  // The Plans page offers Business with a Subscribe link that carries
  // ?plan=business (same link pattern as Essentials).
  const plans = readFileSync('src/pages/Plans.jsx', 'utf8');
  assert.match(plans, /<Link to=\{`\/subscribe\?plan=\$\{option\.key\}`\}>\{t\('plans\.subscribe'\)\}<\/Link>/);
  assert.equal(en['plans.subscribe'], 'Subscribe');
  const plansLib = readFileSync('src/lib/plans.js', 'utf8');
  assert.match(plansLib, /key: 'business',\s*\n\s*name: 'Luminous StockHaven Business',\s*\n\s*price: 29\.99/);
  assert.match(plansLib, /key: 'essentials',\s*\n\s*name: 'Luminous StockHaven Essentials',\s*\n\s*price: 14\.99/);
});

test('an unknown or missing ?plan= shows a chooser instead of silently subscribing to Essentials', () => {
  // Audit finding 17: ?plan=premium (or no param) used to fall through
  // to Essentials with no warning. Now the page names the problem and
  // offers both plans — and never reads PLANS[null].
  const screen = readFileSync('src/pages/Subscribe.jsx', 'utf8');
  assert.match(screen, /const plan = planKey \? PLANS\[planKey\] : null/);
  assert.match(screen, /t\('subscribe\.invalidTitle'\)/);
  assert.match(screen, /t\('subscribe\.invalidBody'\)/);
  assert.match(en['subscribe.invalidBody'], /nothing has been subscribed/);
  assert.match(screen, /<Link to="\/subscribe\?plan=essentials">\{t\('subscribe\.essentialsLink'\)\}<\/Link>/);
  assert.equal(en['subscribe.essentialsLink'], 'Essentials — $14.99/month');
  assert.match(screen, /<Link to="\/subscribe\?plan=business">\{t\('subscribe\.businessLink'\)\}<\/Link>/);
  assert.equal(en['subscribe.businessLink'], 'Business — $29.99/month');
  assert.match(screen, /<Link to="\/plans"[^>]*>\{t\('subscribe\.comparePlans'\)\}<\/Link>/);
  assert.equal(en['subscribe.comparePlans'], 'Compare plans');
  // The checkout buttons only render inside the valid-plan branch.
  assert.match(screen, /\{!planKey \? \(/);
});

// T6.3: the "monthly plan forfeits the trial" test is REMOVED — it asserted
// copy ("A monthly subscription starts paid billing immediately and does not
// include a trial.") that no longer exists anywhere in the app; git grep on
// the pre-T6.3 tree shows it only in this test file itself, so it was
// already failing before the i18n conversion. The monthly button now reads
// subscribe.subscribeButton ("Subscribe to {planName} — {price}/month") and
// the trial terms live in plans.intro.

test('a past-due customer is told how to update payment, on the page they land on', () => {
  // Audit finding 9: Subscribe sends past-due customers to /upgrade,
  // where the past-due block explains how to update payment. Subscribe
  // names the problem the same way. (T6.3: the old "Payment updates will
  // return once Stripe payments are live" wording is gone — Stripe
  // payments ARE live now — so the test follows the current copy.)
  const screen = readFileSync('src/pages/Subscribe.jsx', 'utf8');
  assert.match(screen, /status === 'past_due' \? \(/);
  assert.match(screen, /t\('subscribe\.pastDue'\)/);
  assert.match(en['subscribe.pastDue'], /Your payment is past due\. You can update your payment method from the plan options page\./);
  // The support email lives on the /upgrade page the past-due customer
  // lands on (a mailto link — an address, not copy — so it stays inline).
  const upgrade = readFileSync('src/pages/Upgrade.jsx', 'utf8');
  assert.match(upgrade, /mailto:theluminousbookshop@outlook\.com/);
  assert.match(screen, /<Link to="\/upgrade">\{t\('subscribe\.reviewPlanOptions'\)\}<\/Link>/);
  assert.equal(en['subscribe.reviewPlanOptions'], 'Review plan options');
  assert.doesNotMatch(screen, /Wix/i);
});

test('Plans knows the signed-in customer\u2019s current plan and never offers a duplicate Subscribe', () => {
  // Audit finding 29: a logged-in customer saw a Subscribe button on
  // both cards, including the plan they already pay for. Now the current
  // card shows a badge and a disabled "Current plan" button, and the
  // other card routes through /upgrade instead of a fresh checkout.
  const plans = readFileSync('src/pages/Plans.jsx', 'utf8');
  assert.match(plans, /import useEntitlements from '@\/hooks\/useEntitlements'/);
  assert.match(plans, /const \{ plan, status, isLoading \} = useEntitlements\(\)/);
  assert.match(plans, /isAuthenticated && !isLoading && status !== 'pending_checkout' && plan\.key === key/);
  assert.match(plans, /t\('plans\.yourPlan'\)/);
  assert.equal(en['plans.yourPlan'], 'Your plan');
  assert.match(plans, /t\('plans\.currentPlan'\)/);
  assert.equal(en['plans.currentPlan'], 'Current plan');
  assert.match(plans, /<Link to="\/upgrade">\{t\('plans\.changePlan'\)\}<\/Link>/);
  assert.equal(en['plans.changePlan'], 'Change plan');
  // pending_checkout has no subscription yet, so the Subscribe links stay.
  assert.match(plans, /status !== 'pending_checkout'/);
  // The full feature lists show — the slice(0, 6) that hid the Business
  // differentiators is gone.
  assert.doesNotMatch(plans, /slice\(0, 6\)/);
  assert.match(plans, /option=\{option\}/);
  // Tagline no longer contradicts Business covering five businesses.
  assert.match(plans, /t\('plans\.intro'\)/);
  assert.match(en['plans.intro'], /One account, whichever plan you choose — Business covers up to five businesses\./);
  assert.doesNotMatch(plans, /One account, one inventory, whichever plan you choose/);
  // A visitor who is not signed in still gets the plain Subscribe links.
  assert.match(plans, /<Link to=\{`\/subscribe\?plan=\$\{option\.key\}`\}>\{t\('plans\.subscribe'\)\}<\/Link>/);
});

test('the Mobile plan button says the same thing on Plans and Welcome', () => {
  // Audit finding 36: Welcome said "Sold in the App Store and Google
  // Play" (wrong — Mobile is not live) while Plans said "Available at
  // mobile launch". Both now say the same thing.
  const plans = readFileSync('src/pages/Plans.jsx', 'utf8');
  const welcome = readFileSync('src/pages/Welcome.jsx', 'utf8');
  assert.match(plans, /t\('plans\.availableAtLaunch'\)/);
  assert.match(welcome, /t\('plans\.availableAtLaunch'\)/);
  assert.equal(en['plans.availableAtLaunch'], 'Available at mobile launch');
  assert.doesNotMatch(welcome, /Sold in the App Store and Google Play/);
});
