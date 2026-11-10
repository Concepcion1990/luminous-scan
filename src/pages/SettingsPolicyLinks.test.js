import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STOCKHAVEN_TERMS_OF_SERVICE as terms } from '../lib/stockhavenTermsOfService.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY as policy } from '../lib/stockhavenSubscriptionPolicy.js';

// Audit item #6.2: the Privacy Policy must be linked everywhere the other two
// effective documents are linked. PR #33 linked it from Plans, Terms and the
// Subscription Policy; Settings and Upgrade were still missing it (and both
// still called the documents "drafts" after they became effective Nov 7, 2026).

const POLICY_ROUTES = ['/terms-of-service', '/subscription-policy', '/privacy-policy'];

function assertLinksAllPolicies(screen, page) {
  for (const route of POLICY_ROUTES) {
    assert.match(
      screen,
      new RegExp(`to="${route.replace(/\//g, '\\/')}"`),
      `${page} must link to ${route}`,
    );
  }
}

test('Settings links all three effective policies and no longer calls them drafts', () => {
  const screen = readFileSync('src/pages/Settings.jsx', 'utf8');
  assertLinksAllPolicies(screen, 'Settings');
  assert.match(screen, /Privacy Policy/);
  assert.match(screen, /import \{ STOCKHAVEN_TERMS_OF_SERVICE as terms \} from '@\/lib\/stockhavenTermsOfService'/);
  assert.match(screen, /import \{ STOCKHAVEN_SUBSCRIPTION_POLICY as policy \} from '@\/lib\/stockhavenSubscriptionPolicy'/);
  assert.doesNotMatch(screen, /effective November 8, 2026/);
  assert.doesNotMatch(screen, /These are drafts for the upcoming customer billing service/);
});

test('Settings states billing is through Stripe and self-service cancellation is available', () => {
  const screen = readFileSync('src/pages/Settings.jsx', 'utf8');
  assert.doesNotMatch(screen, /Billing and self-service cancellation are not active in this app yet/);
  assert.doesNotMatch(screen, /Trial billing is not active in this app yet/);
  assert.doesNotMatch(screen, /Self-service cancellation inside the app is not yet available/);
  assert.doesNotMatch(screen, /Wix/i);
  assert.doesNotMatch(screen, /switching to Stripe/i);
  assert.match(screen, /Website subscription billing is through Stripe\./);
  assert.match(screen, /Trial billing is through Stripe\./);
  assert.match(screen, /cancel your subscription yourself at any time using the\s+Cancel Subscription button/i);
  assert.match(screen, /theluminousbookshop@outlook\.com/);
});

test('Upgrade links all three effective policies and no longer calls them drafts', () => {
  const screen = readFileSync('src/pages/Upgrade.jsx', 'utf8');
  assertLinksAllPolicies(screen, 'Upgrade');
  assert.match(screen, /Privacy Policy/);
  assert.match(screen, /import \{ STOCKHAVEN_TERMS_OF_SERVICE as terms \} from '@\/lib\/stockhavenTermsOfService'/);
  assert.match(screen, /import \{ STOCKHAVEN_SUBSCRIPTION_POLICY as policy \} from '@\/lib\/stockhavenSubscriptionPolicy'/);
  assert.doesNotMatch(screen, /effective November 8, 2026/);
  assert.doesNotMatch(screen, /These documents are drafts while provider billing is being configured/);
});

test('Settings and Upgrade state the policy effective dates from the policy modules, never hardcoded', () => {
  // Both pages used to hardcode "effective November 8, 2026", which went
  // stale the moment the policies bumped to v5. They now read the dates
  // from the policy modules, so the line can never go stale again.
  for (const page of ['src/pages/Settings.jsx', 'src/pages/Upgrade.jsx']) {
    const screen = readFileSync(page, 'utf8');
    assert.match(screen, /import \{ STOCKHAVEN_TERMS_OF_SERVICE as terms \} from '@\/lib\/stockhavenTermsOfService'/, `${page} must import the Terms module`);
    assert.match(screen, /import \{ STOCKHAVEN_SUBSCRIPTION_POLICY as policy \} from '@\/lib\/stockhavenSubscriptionPolicy'/, `${page} must import the Subscription Policy module`);
    assert.match(screen, /terms\.effectiveDate === policy\.effectiveDate/, `${page} must derive the line from both modules`);
    assert.match(screen, /are effective \$\{terms\.effectiveDate\}/, `${page} must render the shared date when both agree`);
    assert.match(screen, /is effective \$\{terms\.effectiveDate\}, and the Subscription, Cancellation & Refund Policy is effective \$\{policy\.effectiveDate\}/, `${page} must render each date when they differ`);
    assert.match(screen, /\{policyEffectiveLine\}/, `${page} must render the derived line`);
    assert.doesNotMatch(screen, /effective November \d+, \d{4}/, `${page} must carry no hardcoded effective date`);
  }
  // The two modules agree today, so the shared-date branch is the one
  // that renders; the differing-date branch is covered by the regexes above.
  assert.equal(terms.effectiveDate, policy.effectiveDate);
});

test('Plans, Terms and Subscription Policy still link the Privacy Policy (PR #33)', () => {
  for (const page of ['src/pages/Plans.jsx', 'src/pages/TermsOfService.jsx', 'src/pages/SubscriptionPolicy.jsx']) {
    const screen = readFileSync(page, 'utf8');
    assert.match(screen, /to="\/privacy-policy"/, `${page} must still link to /privacy-policy`);
  }
});

test('Plans states the policy effective dates from the policy modules, never hardcoded', () => {
  // The Plans page used to hardcode "effective November 8, 2026", which
  // went stale the moment the policies bumped to v5/v4. It now reads the
  // dates from the policy modules, so the line can never go stale again.
  const screen = readFileSync('src/pages/Plans.jsx', 'utf8');
  assert.match(screen, /import \{ STOCKHAVEN_TERMS_OF_SERVICE as terms \} from '@\/lib\/stockhavenTermsOfService'/);
  assert.match(screen, /import \{ STOCKHAVEN_SUBSCRIPTION_POLICY as policy \} from '@\/lib\/stockhavenSubscriptionPolicy'/);
  assert.match(screen, /terms\.effectiveDate === policy\.effectiveDate/);
  assert.match(screen, /are effective \$\{terms\.effectiveDate\}/);
  assert.match(screen, /is effective \$\{terms\.effectiveDate\}, and the Subscription, Cancellation & Refund Policy is effective \$\{policy\.effectiveDate\}/);
  assert.doesNotMatch(screen, /effective November \d+, \d{4}/);
  // The two modules agree today, so the shared-date branch is the one
  // that renders; the differing-date branch is covered by the regexes above.
  assert.equal(terms.effectiveDate, policy.effectiveDate);
});

// Audit findings 1, 2, 9, 11-14, 31, 34, 35: the canonical cancellation /
// grace / wipe copy. The JSX screens use the shared constants from
// src/lib/cancellationGrace.js, whose exact text is asserted in
// src/lib/cancellationGrace.test.js; these tests prove each screen uses
// them and carries no leftover contradicting copy.

test('Settings replaces the invented 14-day recovery with the canonical grace paragraph (findings 1/2/34)', () => {
  const screen = readFileSync('src/pages/Settings.jsx', 'utf8');
  assert.doesNotMatch(screen, /14-day recovery period/i);
  assert.doesNotMatch(screen, /recovery period begins/i);
  assert.doesNotMatch(screen, /data-export options remain accessible/i);
  assert.match(screen, /CANCELLATION_GRACE_PARAGRAPH/);
  assert.match(screen, /After your paid period ends — 15-day grace, then deletion/);
});

test('Settings shows a past-due payment block with Stripe instructions and the support contact (finding 9)', () => {
  const screen = readFileSync('src/pages/Settings.jsx', 'utf8');
  assert.match(screen, /entitlementStatus === 'past_due'/);
  assert.match(screen, /Payment past due — payment updates return with Stripe/);
  assert.match(screen, /Payment updates will be available once Stripe payments are live/);
  assert.match(screen, /theluminousbookshop@outlook\.com/);
  assert.doesNotMatch(screen, /Wix/i);
});

test('Settings shows the trial-cancel line with the trial end date (finding 11)', () => {
  const screen = readFileSync('src/pages/Settings.jsx', 'utf8');
  assert.match(screen, /entitlementRecord\?\.trial_ends_at/);
  assert.match(screen, /Cancelling during your trial keeps your full 7 days — access ends on \{trialEndsOn\}, and you will not be charged\./);
});

test('Settings delete-account dialog warns per plan about export (finding 31)', () => {
  const screen = readFileSync('src/pages/Settings.jsx', 'utf8');
  assert.match(screen, /Export your inventory first if you need to keep your records\./);
  assert.match(screen, /Essentials has no export — write down anything you need before requesting deletion\./);
  assert.match(screen, /plan\?\.key === 'business'/);
});

test('Settings qualifies store billing as future-only (finding 35)', () => {
  const screen = readFileSync('src/pages/Settings.jsx', 'utf8');
  assert.match(screen, /If you ever subscribe\s+through Google Play or the Apple App Store/);
  assert.doesNotMatch(screen, /If you purchase\s*\n?\s*your subscription through Google Play/i);
});

test('Cancel dialog uses the canonical wipe copy and plain-language errors (findings 1/14)', () => {
  const dialog = readFileSync('src/components/billing/CancelSubscriptionDialog.jsx', 'utf8');
  assert.match(dialog, /CANCELLATION_WIPE_SENTENCE/);
  assert.doesNotMatch(dialog, /Your data is not deleted/i);
  assert.doesNotMatch(dialog, /just no longer accessible until you subscribe again/i);
  assert.doesNotMatch(dialog, /Data is never deleted/i);
  assert.doesNotMatch(dialog, /could not be completed \(\{\s*error\s*\}\)/);
  assert.match(dialog, /CANCEL_ERROR_DETAILS/);
  assert.match(dialog, /stripe_not_configured/);
  assert.match(dialog, /Payments are being switched to Stripe, so subscriptions can/);
  assert.doesNotMatch(dialog, /Wix would not accept the cancellation/);
  assert.match(dialog, /mention this code: \{error\}/);
  assert.match(dialog, /subscription_cancellation_unavailable/);
});

test('Cancel dialog shows the trial-cancel line from the trial end date (finding 11)', () => {
  const dialog = readFileSync('src/components/billing/CancelSubscriptionDialog.jsx', 'utf8');
  assert.match(dialog, /trialEndsAt/);
  assert.match(dialog, /Cancelling during your trial keeps your full 7 days — access ends on/);
  assert.match(dialog, /and you will not be charged\./);
  assert.match(dialog, /status === 'trialing'/);
});

test('Cancel dialog qualifies store billing as future-only (finding 35)', () => {
  const dialog = readFileSync('src/components/billing/CancelSubscriptionDialog.jsx', 'utf8');
  assert.match(dialog, /If you ever subscribe through Google Play or the Apple App Store/);
  assert.doesNotMatch(dialog, /If your subscription was purchased through Google Play/i);
});

test('Grace view uses the canonical grace paragraph and shows the product total (findings 1/12)', () => {
  const screen = readFileSync('src/pages/GraceInventory.jsx', 'utf8');
  assert.match(screen, /CANCELLATION_GRACE_PARAGRAPH/);
  assert.doesNotMatch(screen, /Your data is not deleted/i);
  assert.doesNotMatch(screen, /Data is never deleted/i);
  assert.match(screen, /Product\.count\(scoped\(\{\}, activeId\)\)/);
  assert.match(screen, /Showing the first \$\{products\.length\} of \$\{totalProducts\} products — subscribe again to see the rest\./);
  assert.match(screen, /limit: 200/);
});
