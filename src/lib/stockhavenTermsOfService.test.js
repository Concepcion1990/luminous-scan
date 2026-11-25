import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STOCKHAVEN_TERMS_OF_SERVICE as terms } from './stockhavenTermsOfService.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY as policy } from './stockhavenSubscriptionPolicy.js';
import { CANCELLATION_GRACE_PARAGRAPH } from './cancellationGrace.js';

const body = terms.sections.flatMap(s => [s.title, ...s.paragraphs]).join('\n');
const policyBody = policy.sections.flatMap(s => s.paragraphs).join('\n');
const read = file => fs.readFileSync(file, 'utf8');

test('Terms are effective, name Stripe as the payment provider, and never name Wix', () => {
  assert.equal(terms.status, 'effective');
  assert.equal(terms.version, '2026-11-24-v6');
  assert.equal(terms.effectiveDate, 'November 9, 2026');
  assert.equal(terms.lastReviewed, 'November 24, 2026');
  // T1 twin: the "switching to Stripe" launchNotice is REMOVED entirely —
  // the twin IS Stripe from day one, so there is no switch to announce.
  assert.equal(terms.launchNotice, undefined, 'no launchNotice on the twin');
  assert.doesNotMatch(JSON.stringify(terms), /launchNotice|being switched to Stripe|subscriptions will be back soon/i);
  assert.doesNotMatch(body, /Wix/i);
  assert.doesNotMatch(body, /draft|not yet effective|proposed terms/i);
});
test('Terms name Stripe billing and honest cancellation handling', () => {
  assert.match(body, /Payment processing is performed by Stripe/i);
  assert.match(body, /official customer-support channel/i);
});
test('Terms apply to StockHaven website subscriptions only', () => {
  assert.match(terms.scope, /website subscriptions purchased directly/i);
  for (const source of ['eBay','Shopify','Amazon','Walmart','TikTok Shop','Google Play','Apple App Store']) {
    assert.ok(terms.scope.includes(source));
  }
});
test('Plans and site allowances match existing subscription terms', () => {
  assert.match(body, /\$14\.99 USD per month/);
  assert.match(body, /\$29\.99 USD per month/);
  assert.match(body, /five top-level operating sites TOTAL/i);
  assert.match(body, /50 active products/);
  assert.match(body, /three additional staff/);
  assert.match(body, /applicable taxes/);
  assert.match(body, /automatically renew monthly/i);
});
test('Trials cancel, refund and paid-through rules match canonical refund policy', () => {
  assert.match(body, /ONE seven-day introductory free trial/i);
  assert.match(body, /does not restart or extend the initial trial/i);
  assert.match(body, /cancel.*at any time/i);
  assert.match(body, /only through the provider-confirmed end/i);
  assert.match(body, /never provides an additional free month/i);
  assert.match(body, /THREE DAYS \(72 hours\)/);
  assert.match(body, /FIRST successful paid/i);
  assert.match(body, /AFTER the trial/i);
  assert.match(body, /never restarts on monthly renewals/i);
  assert.match(body, /accidental duplicate charges and billing errors/i);
  assert.match(body, /rights.*required by applicable law/i);
  assert.match(policyBody, /within three days \(72 hours\)/i);
  assert.match(policyBody, /provider-confirmed paid-through date/i);
});
test('Terms state the canonical grace paragraph in section 6 and the approved payment sentence in section 10', () => {
  const cancel = terms.sections.find(s => s.id === 'cancellation');
  assert.ok(cancel, 'section 6 exists');
  assert.ok(cancel.paragraphs.join('\n').includes(CANCELLATION_GRACE_PARAGRAPH),
    'section 6 states the canonical grace paragraph verbatim');
  const retention = terms.sections.find(s => s.id === 'access-retention');
  assert.ok(retention, 'section 10 exists');
  // The owner's approved Wording 2 (Nov 23, 2026) replaced section 10's
  // old paragraphs 1-2 as ONE paragraph, verbatim — including its own
  // word 'cancelled' in the US base. The account-recovery paragraph
  // that followed them stays as paragraph 2.
  assert.equal(retention.paragraphs.length, 2, 'section 10 carries two paragraphs');
  assert.equal(retention.paragraphs[0],
    'If we are unable to collect a payment, your subscription continues with full access for 14 days, with a reminder before the deadline; if payment is not received, the subscription is cancelled, followed by 15 days of view-only access, after which your workspace and its data are deleted.',
    'section 10 states the owner-approved payment sentence verbatim');
  assert.match(retention.paragraphs[1], /Account recovery, requests for deletion and data retention/);
  assert.doesNotMatch(body, /does not automatically delete your account/i);
  assert.doesNotMatch(body, /Your data is not deleted/i);
  assert.doesNotMatch(body, /Data is never deleted/i);
});
test('Customer records, same-subscription upgrades and launch limits are explicit', () => {
  assert.match(body, /SAME existing account and subscription/i);
  assert.match(body, /existing business identity, inventory, staff, history and trial records are preserved/i);
  assert.match(body, /customer.*retain ownership/i);
});
test('Public route is outside auth gate and the new page never charges', () => {
  const app=read('src/App.jsx'), page=read('src/pages/TermsOfService.jsx');
  assert.match(app, /pathname === '\/terms-of-service'/);
  assert.match(app, /<Route path="\/terms-of-service" element={<TermsOfService \/>} \/>/);
  assert.ok(app.indexOf('<Route path="/terms-of-service"') < app.indexOf('<Route element={<ProtectedRoute'));
  assert.doesNotMatch(page, /base44\.functions\.invoke|stripe\.checkout|createCheckout|window\.location\.href/);
  assert.match(page, /policy\.|\/subscription-policy/);
});
test('Terms links appear on customer plan, policy, upgrade, and settings pages', () => {
  for (const name of ['Plans','SubscriptionPolicy','Upgrade','Settings']) {
    assert.match(read('src/pages/'+name+'.jsx'), /to="\/terms-of-service"/);
  }
});
test('No invented support e-mail or domain is used', () => {
  assert.doesNotMatch(body, /[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(body, /https?:\/\/stockhaven/i);
  assert.match(body, /official.*support channel/i);
});
