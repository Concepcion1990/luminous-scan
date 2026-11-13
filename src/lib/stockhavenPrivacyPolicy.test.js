import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STOCKHAVEN_PRIVACY_POLICY as p } from './stockhavenPrivacyPolicy.js';
import { CANCELLATION_GRACE_PARAGRAPH } from './cancellationGrace.js';

const body = p.sections.flatMap(section => [section.title, ...section.paragraphs]).join('\n');
const read = path => fs.readFileSync(path, 'utf8');

test('StockHaven privacy policy is effective November 8, 2026 and never says draft', () => {
  assert.equal(p.status, 'effective');
  assert.equal(p.version, '2026-11-09-v4');
  assert.equal(p.effectiveDate, 'November 9, 2026');
  assert.equal(p.lastReviewed, 'November 9, 2026');
  // T1 twin: the "switching to Stripe" launchNotice is REMOVED entirely.
  assert.equal(p.launchNotice, undefined, 'no launchNotice on the twin');
  assert.doesNotMatch(JSON.stringify(p), /launchNotice|being switched to Stripe|subscriptions will be back soon/i);
  assert.doesNotMatch(p.scope, /proposed policy/i);
  assert.doesNotMatch(body, /draft|not yet effective/i);
});

test('privacy policy page shows the effective date, not a draft header', () => {
  const page = read('src/pages/PrivacyPolicy.jsx');
  assert.match(page, /Effective \{policy\.effectiveDate\} · Reviewed \{policy\.lastReviewed\}/);
  assert.doesNotMatch(page, /Draft reviewed|Effective date pending|privacy — draft|This draft does not override/i);
});

test('privacy policy is linked from Plans, Terms and Subscription Policy', () => {
  const plans = read('src/pages/Plans.jsx');
  assert.match(plans, /to="\/privacy-policy"/);
  assert.doesNotMatch(plans, /Both documents are drafts while customer billing is being configured/);
  // The Plans page states the policy effective dates from the policy
  // modules, never hardcoded — see the dedicated test in
  // src/pages/SettingsPolicyLinks.test.js.
  assert.match(plans, /STOCKHAVEN_TERMS_OF_SERVICE/);
  assert.match(plans, /STOCKHAVEN_SUBSCRIPTION_POLICY/);
  assert.doesNotMatch(plans, /effective November 8, 2026/i);
  const terms = read('src/pages/TermsOfService.jsx');
  assert.match(terms, /to="\/privacy-policy"/);
  const subscription = read('src/pages/SubscriptionPolicy.jsx');
  assert.match(subscription, /to="\/privacy-policy"/);
});

test('policy covers the StockHaven app and direct website subscriptions, not marketplace policies', () => {
  assert.match(p.scope, /Luminous StockHaven/i);
  assert.match(p.scope, /eBay/);
  assert.match(p.scope, /Shopify/);
  assert.match(p.scope, /Google Play/);
  assert.match(p.scope, /Apple App Store/);
});

test('policy describes what is collected, including camera use and Stripe payment handling', () => {
  assert.match(body, /barcode and QR scanner/i);
  assert.match(body, /device camera only while you are scanning/i);
  assert.match(body, /payments are processed by Stripe/i);
  assert.match(body, /do not see or store card numbers/i);
  assert.match(body, /do not sell your personal information/i);
});

test('retention states the canonical grace + wipe copy and export is Business-only (audit findings 1/13/34)', () => {
  const retention = p.sections.find(s => s.id === 'retention-and-deletion');
  assert.ok(retention, 'section 4 exists');
  const retentionBody = retention.paragraphs.join('\n');
  assert.ok(retentionBody.includes(CANCELLATION_GRACE_PARAGRAPH),
    'section 4 states the canonical grace paragraph verbatim');
  assert.ok(retentionBody.includes('your account and all its information are permanently deleted and cannot be recovered'),
    'section 4 states the account is permanently deleted after grace');
  assert.doesNotMatch(retentionBody, /recovery period applies before records are removed/i);
  assert.doesNotMatch(retentionBody, /does not itself delete your account/i);
  assert.match(retentionBody, /export them before the 15-day grace period ends/i);
  assert.match(retentionBody, /Essentials has no export — write down anything you need first/);
  const use = p.sections.find(s => s.id === 'how-we-use-information');
  assert.match(use.paragraphs.join('\n'), /imports and exports \(Business plan only\)/);
  const choices = p.sections.find(s => s.id === 'your-choices');
  assert.match(choices.paragraphs.join('\n'),
    /export your inventory data from the application \(Business plan; Essentials can view and write down products during the grace period but cannot export\)/);
  assert.doesNotMatch(body, /Your data is not deleted/i);
  assert.doesNotMatch(body, /Data is never deleted/i);
});

test('store billing is qualified as future-only (audit finding 35)', () => {
  assert.match(body, /If you ever subscribe through Google Play or the Apple App Store/);
  assert.match(body, /if you ever buy the mobile plan through Google Play or the Apple App Store/);
  assert.doesNotMatch(body, /Subscriptions bought through Google Play/i);
});

test('policy covers retention, account deletion and children', () => {
  assert.match(body, /request deletion of your account from Settings/i);
  assert.match(body, /does not by itself cancel a paid subscription/i);
  assert.match(body, /not directed at children/i);
  assert.match(body, /under 13/i);
});

test('policy names only the real support email, no invented domain; Stripe is the named payment provider', () => {
  assert.match(body, /theluminousbookshop@outlook\.com/);
  const emails = body.match(/[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? [];
  assert.deepEqual(emails, ['theluminousbookshop@outlook.com']);
  assert.doesNotMatch(body, /https?:\/\/stockhaven/i);
  assert.match(body, /Stripe/i);
  assert.doesNotMatch(body, /Wix/i);
  assert.match(body, /official.*support channel/i);
});

test('policy page is public and available without sign-in or a payment action', () => {
  const app = read('src/App.jsx'), page = read('src/pages/PrivacyPolicy.jsx');
  assert.match(app, /pathname === '\/privacy-policy'/);
  assert.match(app, /<Route path="\/privacy-policy" element={<PrivacyPolicy \/>} \/>/);
  const publicRoute = app.indexOf('<Route path="/privacy-policy"');
  const protectedRoutes = app.indexOf('<Route element={<ProtectedRoute');
  assert.ok(publicRoute >= 0 && publicRoute < protectedRoutes);
  assert.doesNotMatch(page, /base44\.functions\.invoke|stripe\.checkout|createCheckout/);
});

test('privacy page links to the terms and subscription policy', () => {
  const page = read('src/pages/PrivacyPolicy.jsx');
  assert.match(page, /to="\/terms-of-service"/);
  assert.match(page, /to="\/subscription-policy"/);
});

test('policy URL aliases and Thank You route sit above the catch-all', () => {
  const app = read('src/App.jsx');
  assert.match(app, /<Route path="\/policies\/terms" element={<TermsOfService \/>} \/>/);
  assert.match(app, /<Route path="\/policies\/subscription" element={<SubscriptionPolicy \/>} \/>/);
  assert.match(app, /<Route path="\/thankyou" element={<ThankYou \/>} \/>/);
  const thankYou = app.indexOf('<Route path="/ThankYou"');
  const catchAll = app.indexOf('<Route path="*"');
  assert.ok(thankYou >= 0 && thankYou < catchAll);
});
