import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STOCKHAVEN_SUBSCRIPTION_POLICY as p } from './stockhavenSubscriptionPolicy.js';
import { CANCELLATION_GRACE_PARAGRAPH, CANCELLATION_WIPE_SENTENCE } from './cancellationGrace.js';

const body = p.sections.flatMap(section => [section.title, ...section.paragraphs]).join('\n');
const read = path => fs.readFileSync(path, 'utf8');

test('StockHaven policy is effective, names Stripe billing, and never names Wix',()=>{
  assert.equal(p.status,'effective');
  assert.equal(p.version,'2026-11-09-v5');
  assert.equal(p.effectiveDate,'November 9, 2026');
  assert.equal(p.lastReviewed,'November 9, 2026');
  // T1 twin: the "switching to Stripe" launchNotice is REMOVED entirely.
  assert.equal(p.launchNotice, undefined, 'no launchNotice on the twin');
  assert.doesNotMatch(JSON.stringify(p), /launchNotice|being switched to Stripe|subscriptions will be back soon/i);
  assert.match(body,/15-day read-only grace period/i);
  assert.doesNotMatch(p.scope,/proposed policy/i);
  assert.doesNotMatch(body,/Wix/i);
  assert.doesNotMatch(body,/draft|not yet effective/i);
});
test('policy covers direct StockHaven website subscriptions, not five marketplace return policies',()=>{
  assert.match(p.scope,/only to Luminous StockHaven website subscriptions/i);
  assert.match(p.scope,/eBay/);
  assert.match(p.scope,/Shopify/);
  assert.match(p.scope,/Google Play/);
  assert.match(p.scope,/Apple App Store/);
  assert.doesNotMatch(p.scope,/all purchases from The Luminous Book Shop/i);
});
test('policy uses approved exact recurring plan prices, with taxes disclosed',()=>{
  assert.match(body,/\$14\.99 USD per month/);
  assert.match(body,/\$29\.99 USD per month/);
  assert.match(body,/taxes.*shown before checkout/i);
  assert.match(body,/automatically renew monthly/);
});
test('trial is once per eligible customer and no trial restart on plan change',()=>{
  assert.match(body,/seven-day trial/i);
  assert.match(body,/one seven-day trial/i);
  assert.match(body,/does not start or restore another introductory trial/i);
});
test('customer can cancel future renewals but existing period is preserved when required',()=>{
  assert.match(body,/cancel a Luminous StockHaven website subscription at any time/i);
  assert.match(body,/Cancel Subscription button in Settings or on the Upgrade page/i);
  assert.match(body,/cancellation stops future automatic renewals/i);
  assert.match(body,/end of the month you already paid for/i);
  assert.ok(body.includes(CANCELLATION_WIPE_SENTENCE),'cancellation states the canonical wipe sentence');
  assert.match(body,/15-day read-only grace period/i);
});
test('voluntary cancellation retains only the ALREADY paid period, not an extra month',()=>{
  assert.match(body,/cancel at any time/i);
  assert.match(body,/provider-confirmed paid-through date/i);
  assert.match(body,/no additional free month is added/i);
  assert.match(body,/future renewals stop upon confirmed cancellation/i);
});
test('first successful paid subscription charge starts one three-day refund window',()=>{
  assert.match(body,/within three days \(72 hours\)/i);
  assert.match(body,/first successful paid Luminous StockHaven website subscription charge/i);
  assert.match(body,/not when an eligible seven-day free trial begins/i);
  assert.match(body,/cancel within the three-day window/i);
  assert.match(body,/original charge and the cancellation time/i);
});
test('refund grace never resets for renewals, upgrades, or resubscriptions',()=>{
  assert.match(body,/after this initial three-day window.*nonrefundable/i);
  assert.match(body,/no ordinary partial refunds/i);
  assert.match(body,/does not restart for monthly renewals, plan upgrades, resubscriptions/i);
  assert.match(body,/paid subscription access may end when the refund is confirmed/i);
});
test('billing error exceptions and statutory refund rights remain protected',()=>{
  assert.match(body,/accidental duplicate charges/i);
  assert.match(body,/confirmed billing errors/i);
  assert.match(body,/required by applicable law/i);
  assert.match(body,/statutory rights/i);
});
test('upgrades retain original merchant account and require clear informed price and timing',()=>{
  assert.match(body,/existing StockHaven customer account/i);
  assert.match(body,/before the customer confirms/i);
  assert.match(body,/does not create a second business workspace/i);
  assert.match(body,/Existing inventory and business records remain/i);
});
test('refund policy does not invent a support email or postal address',()=>{
  assert.doesNotMatch(body,/[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/);
  assert.match(body,/official.*support contact/i);
});
test('policy page is public and available without sign-in or a payment action',()=>{
  const app=read('src/App.jsx'),page=read('src/pages/SubscriptionPolicy.jsx');
  assert.match(app,/pathname === '\/subscription-policy'/);
  assert.match(app,/<Route path="\/subscription-policy" element={<SubscriptionPolicy \/>} \/>/);
  const publicRoute=app.indexOf('<Route path="/subscription-policy"');
  const protectedRoutes=app.indexOf('<Route element={<ProtectedRoute');
  assert.ok(publicRoute>=0&&publicRoute<protectedRoutes);
  assert.doesNotMatch(page,/base44\.functions\.invoke|stripe\.checkout|createCheckout/);
});
test('cancellation copy is the canonical grace + wipe copy (audit findings 1/34)',()=>{
  const cancel = p.sections.find(s => s.id === 'cancel');
  assert.ok(cancel, 'section 3 exists');
  const cancelBody = cancel.paragraphs.join('\n');
  assert.ok(cancelBody.includes(CANCELLATION_GRACE_PARAGRAPH),
    'section 3 states the canonical grace paragraph verbatim');
  assert.ok(cancelBody.includes('your account and all its information are permanently deleted and cannot be recovered'),
    'section 3 states the account is permanently deleted after grace');
  assert.doesNotMatch(body,/Your data is not deleted/i);
  assert.doesNotMatch(body,/no longer accessible until you subscribe again/i);
  assert.doesNotMatch(body,/Data is never deleted/i);
  const failed = p.sections.find(s => s.id === 'failed-payments');
  assert.match(failed.paragraphs.join('\n'),/15-day read-only grace period described in section 3/i);
});
test('policy links are reachable from plans, settings and upgrade',()=>{
  for(const name of ['Plans','Settings','Upgrade']){
    assert.match(read('src/pages/'+name+'.jsx'),/to="\/subscription-policy"/);
  }
});
