import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
// Wix removal (2026-11-08): while payments switch to Stripe there is no
// checkout at all — Subscribe shows the switching notice and makes no
// call to create-checkout. The workspace setup stays, so a customer can
// be ready the moment subscriptions return. Backend assertions about
// the checkout/catalog/webhook live with the backend removal agent.

test('Subscribe no longer links "Open workspace" to the gated workspace', () => {
  const screen = readFileSync('src/pages/Subscribe.jsx', 'utf8');
  // No dead link into the entitlement-gated workspace.
  assert.doesNotMatch(screen, /<Link to="\/"[^>]*>Open workspace<\/Link>/);
  assert.doesNotMatch(screen, /to="\/"[^>]*>Open workspace/);
  // The workspace is attached on this page instead.
  assert.match(screen, /Set up my workspace/);
  assert.match(screen, /attachWorkspace/);
  assert.match(screen, /setupWorkspace/);
  assert.match(screen, /switchTo\(businessId\)/);
  assert.match(screen, /createBusiness\(\{ name \}\)/);
});

test('Subscribe flow is create-account, then workspace, then the Stripe switching notice — no checkout', () => {
  const screen = readFileSync('src/pages/Subscribe.jsx', 'utf8');
  // Step 1 — a new customer creates an account first (email + password
  // only — Google sign-in is not offered on the twin, owner's decision
  // Nov 9) and is sent straight back here.
  assert.match(screen, /\/register\?returnTo=/);
  assert.match(screen, /Create your account|Create account/);
  assert.match(screen, /\/login\?returnTo=/);
  // Step 2 — workspace setup happens on this page, with copy that says so.
  assert.match(screen, /does not open\s*\n?\s*the app, start a trial, or charge anything/);
  // Step 3 — while payments switch to Stripe there is NO checkout: the
  // switching notice replaces both checkout buttons, and the page never
  // calls create-checkout.
  assert.match(screen, /We're switching payments to Stripe — subscriptions will be back soon\./);
  assert.doesNotMatch(screen, /base44\.functions\.invoke\('create-checkout'/);
  assert.doesNotMatch(screen, /functions\.invoke\('create-checkout'/);
  assert.doesNotMatch(screen, /Start 7-day free trial/);
  assert.doesNotMatch(screen, /Subscribe monthly/);
  assert.doesNotMatch(screen, /Opening Wix checkout/);
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
  assert.match(screen, /That plan link isn&apos;t valid — choose a plan/);
  assert.match(screen, /const returnTo = planKey \? `\/subscribe\?plan=\$\{planKey\}` : '\/plans'/);
  assert.match(screen, /const plan = planKey \? PLANS\[planKey\] : null/);
  // The Plans page offers Business with a Subscribe link that carries
  // ?plan=business (same link pattern as Essentials).
  const plans = readFileSync('src/pages/Plans.jsx', 'utf8');
  assert.match(plans, /<Link to=\{`\/subscribe\?plan=\$\{option\.key\}`\}>Subscribe<\/Link>/);
  const plansLib = readFileSync('src/lib/plans.js', 'utf8');
  assert.match(plansLib, /key: 'business',\s*\n\s*name: 'Luminous Stockhaven Business',\s*\n\s*price: 29\.99/);
  assert.match(plansLib, /key: 'essentials',\s*\n\s*name: 'Luminous Stockhaven Essentials',\s*\n\s*price: 14\.99/);
});

test('an unknown or missing ?plan= shows a chooser instead of silently subscribing to Essentials', () => {
  // Audit finding 17: ?plan=premium (or no param) used to fall through
  // to Essentials with no warning. Now the page names the problem and
  // offers both plans — and never reads PLANS[null].
  const screen = readFileSync('src/pages/Subscribe.jsx', 'utf8');
  assert.match(screen, /const plan = planKey \? PLANS\[planKey\] : null/);
  assert.match(screen, /That plan link isn&apos;t valid — choose a plan/);
  assert.match(screen, /nothing has been subscribed/);
  assert.match(screen, /<Link to="\/subscribe\?plan=essentials">Essentials — \$14\.99\/month<\/Link>/);
  assert.match(screen, /<Link to="\/subscribe\?plan=business">Business — \$29\.99\/month<\/Link>/);
  assert.match(screen, /<Link to="\/plans"[^>]*>Compare plans<\/Link>/);
  // The checkout buttons only render inside the valid-plan branch.
  assert.match(screen, /\{!planKey \? \(/);
});

test('the monthly plan says plainly that it forfeits the trial', () => {
  // Audit finding 17: the two equal-weight buttons gave no hint that
  // monthly starts paid billing immediately and includes no trial.
  // The buttons are gone while payments switch to Stripe, but the
  // warning stays in the switching copy.
  const screen = readFileSync('src/pages/Subscribe.jsx', 'utf8');
  assert.match(
    screen,
    /A monthly subscription starts paid\s*\n?\s*billing immediately and does not include a trial\./
  );
});

test('a past-due customer is told payment updates return with Stripe, on the page they land on', () => {
  // Audit finding 9: Subscribe sends past-due customers to /upgrade,
  // where the past-due block now explains payment updates return with
  // Stripe. Subscribe names the problem the same way.
  const screen = readFileSync('src/pages/Subscribe.jsx', 'utf8');
  assert.match(screen, /status === 'past_due' \? \(/);
  assert.match(screen, /Your payment is past due\. Payment updates will return once Stripe payments are live/);
  assert.match(screen, /theluminousbookshop@outlook\.com/);
  assert.match(screen, /<Link to="\/upgrade">Review plan options<\/Link>/);
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
  assert.match(plans, /Your plan/);
  assert.match(plans, /Current plan/);
  assert.match(plans, /<Link to="\/upgrade">Change plan<\/Link>/);
  // pending_checkout has no subscription yet, so the Subscribe links stay.
  assert.match(plans, /status !== 'pending_checkout'/);
  // The full feature lists show — the slice(0, 6) that hid the Business
  // differentiators is gone.
  assert.doesNotMatch(plans, /slice\(0, 6\)/);
  assert.match(plans, /option=\{option\}/);
  // Tagline no longer contradicts Business covering five businesses.
  assert.match(plans, /One account, whichever plan you choose — Business covers up to five businesses\./);
  assert.doesNotMatch(plans, /One account, one inventory, whichever plan you choose/);
  // A visitor who is not signed in still gets the plain Subscribe links.
  assert.match(plans, /<Link to=\{`\/subscribe\?plan=\$\{option\.key\}`\}>Subscribe<\/Link>/);
});

test('the Mobile plan button says the same thing on Plans and Welcome', () => {
  // Audit finding 36: Welcome said "Sold in the App Store and Google
  // Play" (wrong — Mobile is not live) while Plans said "Available at
  // mobile launch". Both now say the same thing.
  const plans = readFileSync('src/pages/Plans.jsx', 'utf8');
  const welcome = readFileSync('src/pages/Welcome.jsx', 'utf8');
  assert.match(plans, /Available at mobile launch/);
  assert.match(welcome, /Available at mobile launch/);
  assert.doesNotMatch(welcome, /Sold in the App Store and Google Play/);
});
