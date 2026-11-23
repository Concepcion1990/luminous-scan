// Release 356 (Nov 23, 2026): BUSINESS #2 INHERITS THE PLAN.
//
// The defect, mapped by the owner's own hand on a fresh Business
// account: subscribe → business #1 fine → header "+ New" →
// business #2 born with NO entitlement row (the add-business path
// is the first-signup path) → the new workspace read as
// never-paid → boot/sign-in/deep links all fixated on it and
// bounced her to the public journey → Subscribe offered her a
// SECOND $29.99 subscription ("you will be charged $29.99
// today") for a business her one plan already covers.
//
// The fix pinned here:
//  - plans.js entitlementInheritance: a business with no row of
//    its own resolves its owner's OLDEST business's row. A
//    'grandfathered' row never inherits. Nothing is copied.
//  - subscriptionAccessFor assesses the effective row against
//    the target business (one account road for 341).
//  - The Entitlement entity read synthesizes the inherited row
//    for display, wearing the reading business's id.
//  - POST /billing/checkout refuses a second subscription for a
//    covered business BEFORE Stripe is touched.
//  - Guards: first-ever subscription still needs payment
//    confirmation; Essentials still refuses a second business;
//    the 338 comp door and the 341 road are unchanged in shape.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import {
  ownerWithBusiness,
  registerVerifiedUser,
  trialCheckout,
  setEntitlement,
  req,
  pool,
  close,
  mock,
  insertCompEntry,
  entitlementRowOf,
  subscriptionRowOf,
} from './helpers.js';
import { entitlementInheritance } from '../../server/plans.js';
import { subscriptionAccessFor } from '../../server/subscriptionAccess.js';

after(close);

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
let seq = 0;
const email = (label) => `${label}${++seq}@example.com`;

async function addBusiness(cookie, name) {
  return req('/api/businesses', { method: 'POST', body: { name }, cookie });
}

async function accessFor(user, businessId) {
  return subscriptionAccessFor(pool, user.user ?? user, businessId);
}

// ---------------------------------------------------------------------------
// The owner's journey, server side: subscribe #1 → add #2 → #2 is
// inside the plan, with no row of its own and no second charge.
// ---------------------------------------------------------------------------

test('business #2 inherits the account plan at the access gate', async () => {
  const owner = await ownerWithBusiness(email('inherit'));
  await trialCheckout(owner, owner.business.id, 'business');

  const added = await addBusiness(owner.cookie, 'Second Shop');
  assert.equal(added.status, 201);
  const biz2 = added.json.id;

  // The new business was born with no rows of its own — the fix
  // resolves the account's row at read time instead of copying.
  assert.equal(await entitlementRowOf(biz2), null);
  assert.equal(await subscriptionRowOf(biz2), null);

  const access = await accessFor(owner, biz2);
  assert.equal(access.state, 'full');
  assert.equal(access.plan, 'business');
  assert.equal(access.inheritedFrom, owner.business.id);

  // Business #1 is untouched by any of this.
  const first = await accessFor(owner, owner.business.id);
  assert.equal(first.state, 'full');
  assert.equal(first.inheritedFrom, null);
});

test('the Entitlement read shows the account row on business #2, wearing its id', async () => {
  const owner = await ownerWithBusiness(email('inheritread'));
  await trialCheckout(owner, owner.business.id, 'business');
  const added = await addBusiness(owner.cookie, 'Second Shop');
  const biz2 = added.json.id;

  const res = await req('/api/entities/Entitlement/query', {
    method: 'POST',
    cookie: owner.cookie,
    body: { filter: { business_id: biz2 } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.items.length, 1);
  assert.equal(res.json.items[0].business_id, biz2);
  assert.equal(res.json.items[0].status, 'trialing');
  assert.equal(res.json.items[0].plan, 'business');

  // Still nothing stored for #2.
  assert.equal(await entitlementRowOf(biz2), null);
});

test('checkout for a covered business never reaches Stripe (the double-charge door)', async () => {
  const owner = await ownerWithBusiness(email('inheritpay'));
  await trialCheckout(owner, owner.business.id, 'business');
  const added = await addBusiness(owner.cookie, 'Second Shop');
  const biz2 = added.json.id;

  const paramsBefore = mock.getLastCheckoutParams();
  const res = await req('/api/billing/checkout', {
    method: 'POST',
    cookie: owner.cookie,
    body: { business_id: biz2, plan: 'business' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.comped, true);
  assert.equal(res.json.covered, true);
  assert.equal(res.json.state, 'covered_by_account_plan');
  assert.equal(res.json.plan, 'business');
  // No new Stripe checkout session was created, and no local
  // billing rows exist for #2.
  assert.deepEqual(mock.getLastCheckoutParams(), paramsBefore);
  assert.equal(await subscriptionRowOf(biz2), null);
  assert.equal(await entitlementRowOf(biz2), null);
  const { rows: purchases } = await pool.query(
    'SELECT id FROM purchases WHERE business_id = $1',
    [biz2],
  );
  assert.equal(purchases.length, 0);
});

test('businesses #2–#5 all inherit; the 6th is refused by the existing limit', async () => {
  const owner = await ownerWithBusiness(email('inheritfive'));
  await trialCheckout(owner, owner.business.id, 'business');
  for (const name of ['Two', 'Three', 'Four', 'Five']) {
    const added = await addBusiness(owner.cookie, name);
    assert.equal(added.status, 201, `add ${name}`);
    const access = await accessFor(owner, added.json.id);
    assert.equal(access.state, 'full', `${name} inherits`);
  }
  const list = await req('/api/businesses', { cookie: owner.cookie });
  assert.equal(list.json.items.length, 5);
  const sixth = await addBusiness(owner.cookie, 'Six');
  assert.equal(sixth.status, 403);
  assert.equal(sixth.json.error, 'business_limit_reached');
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

test('NEGATIVE: a brand-new account with no subscription still cannot enter', async () => {
  const owner = await ownerWithBusiness(email('inheritnone'));
  const access = await accessFor(owner, owner.business.id);
  assert.equal(access.state, 'denied');
  assert.equal(access.reason, 'no_entitlement');

  // The entity gate agrees: a data read for the unpaid business
  // is refused, exactly as before this release.
  const gated = await req('/api/entities/Product/query', {
    method: 'POST',
    cookie: owner.cookie,
    body: { filter: { business_id: owner.business.id } },
  });
  assert.equal(gated.status, 403);

  // And its checkout is a REAL checkout (a Stripe session), not
  // the covered answer — the front door still demands payment
  // confirmation before access.
  const res = await req('/api/billing/checkout', {
    method: 'POST',
    cookie: owner.cookie,
    body: { business_id: owner.business.id, plan: 'business' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.covered, undefined);
  assert.ok(res.json.session_id, 'a real Stripe checkout session was created');
});

test('Essentials still refuses a second business at creation (byte-identical road)', async () => {
  const owner = await ownerWithBusiness(email('inheritess'));
  await trialCheckout(owner, owner.business.id, 'essentials');
  const added = await addBusiness(owner.cookie, 'Second Shop');
  assert.equal(added.status, 403);
  assert.equal(added.json.error, 'business_limit_reached');
});

test('a business with its OWN row is governed by it, not by the account row', async () => {
  const owner = await ownerWithBusiness(email('inheritown'));
  await trialCheckout(owner, owner.business.id, 'business');
  const added = await addBusiness(owner.cookie, 'Second Shop');
  const biz2 = added.json.id;
  await setEntitlement(biz2, { plan: 'essentials', status: 'active' });

  const access = await accessFor(owner, biz2);
  assert.equal(access.state, 'full');
  assert.equal(access.plan, 'essentials');
  assert.equal(access.inheritedFrom, null);
});

test('the 341 failed-payment road is ONE account road through inheritance', async () => {
  const owner = await ownerWithBusiness(email('inheritroad'));
  await trialCheckout(owner, owner.business.id, 'business');
  const added = await addBusiness(owner.cookie, 'Second Shop');
  const biz2 = added.json.id;
  const now = Date.now();

  // Payment failed on the account's one subscription: #2 runs
  // the same payment grace the subscription-owning business
  // runs (state 'full' while the road's grace runs). The road
  // is computed from the marker pair alone (failedPayment.js).
  await pool.query(
    `UPDATE entitlements
        SET status = 'past_due',
            payment_failed_at = $2,
            payment_grace_ends_at = $3
      WHERE business_id = $1`,
    [owner.business.id, iso(now - DAY), iso(now + 13 * DAY)],
  );
  let access = await accessFor(owner, biz2);
  assert.equal(access.state, 'full');
  assert.equal(access.reason, 'ok');
  assert.ok(access.paymentGraceEndsAt, 'the grace end rides the inherited row');

  // Stripe cancels at the grace end; the day-15 transition
  // lands period_ends_at ON the grace end, and the 15
  // view-only days count from there — #2 sees them too, never
  // its own second road.
  await pool.query(
    `UPDATE entitlements
        SET status = 'canceled',
            payment_failed_at = $2,
            payment_grace_ends_at = $3,
            period_ends_at = $3
      WHERE business_id = $1`,
    [owner.business.id, iso(now - 15 * DAY), iso(now - DAY)],
  );
  access = await accessFor(owner, biz2);
  assert.equal(access.state, 'grace');
  assert.equal(access.reason, 'failed_payment_view_only');

  // View-only over (grace end more than 15 days past): the
  // door closes for #2 exactly as for #1.
  await pool.query(
    `UPDATE entitlements
        SET payment_failed_at = $2, payment_grace_ends_at = $3, period_ends_at = $3
      WHERE business_id = $1`,
    [owner.business.id, iso(now - 30 * DAY), iso(now - 16 * DAY)],
  );
  access = await accessFor(owner, biz2);
  assert.equal(access.state, 'denied');
});

test('the 338 comp door is unchanged: a comped owner adds businesses under the comp', async () => {
  const compEmail = email('comp356');
  await insertCompEntry(compEmail);
  const user = await registerVerifiedUser(compEmail);
  const first = await req('/api/businesses', { method: 'POST', body: { name: 'Comp One' }, cookie: user.cookie });
  assert.equal(first.status, 201);
  const biz1 = first.json.id;
  const row1 = await entitlementRowOf(biz1);
  assert.equal(row1.status, 'founding_tester');

  const added = await addBusiness(user.cookie, 'Comp Two');
  assert.equal(added.status, 201);
  const biz2 = added.json.id;
  // Release 338's creation path comps EVERY business a listed
  // owner creates, so #2 is born with its own founding-tester
  // row (unchanged by this release) — and reads full either way.
  const row2 = await entitlementRowOf(biz2);
  assert.equal(row2.status, 'founding_tester');
  const access = await subscriptionAccessFor(pool, user.user, biz2);
  assert.equal(access.state, 'full');
  assert.equal(access.plan, 'business');

  // Checkout on the comped account's #2 still creates nothing.
  const paramsBefore = mock.getLastCheckoutParams();
  const res = await req('/api/billing/checkout', {
    method: 'POST',
    cookie: user.cookie,
    body: { business_id: biz2, plan: 'business' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.comped, true);
  assert.deepEqual(mock.getLastCheckoutParams(), paramsBefore);
});

test('a grandfathered row never inherits (the publisher workspace is personal)', async () => {
  const owner = await ownerWithBusiness(email('inheritgf'));
  await setEntitlement(owner.business.id, { plan: 'business', status: 'grandfathered' });

  const added = await addBusiness(owner.cookie, 'Second Shop');
  // Creation reads the oldest plan (business) so the add itself
  // succeeds — but the new business inherits NOTHING.
  assert.equal(added.status, 201);
  const biz2 = added.json.id;
  const inherited = await entitlementInheritance(pool, biz2);
  assert.equal(inherited.record, null);
  const access = await accessFor(owner, biz2);
  assert.equal(access.state, 'denied');
});

test('inheritance resolves the OLDEST business, not just any sibling', async () => {
  const owner = await ownerWithBusiness(email('inheritoldest'));
  await trialCheckout(owner, owner.business.id, 'business');
  const added2 = await addBusiness(owner.cookie, 'Second Shop');
  assert.equal(added2.status, 201);
  const added3 = await addBusiness(owner.cookie, 'Third Shop');
  assert.equal(added3.status, 201);
  // Now move the plan onto #2 alone (fixture surgery): #2 keeps
  // a live row of its own, #1's row is removed. #3 must NOT
  // inherit from #2 — the account row is the OLDEST business's,
  // the codebase's standing convention — so with #1 row-less,
  // #3 resolves nothing.
  await setEntitlement(added2.json.id, { plan: 'business', status: 'active' });
  await pool.query('DELETE FROM entitlements WHERE business_id = $1', [owner.business.id]);
  const access2 = await accessFor(owner, added2.json.id);
  assert.equal(access2.state, 'full');
  assert.equal(access2.inheritedFrom, null);
  const access3 = await accessFor(owner, added3.json.id);
  assert.equal(access3.state, 'denied');
});

test('inheritance is a Business-plan feature: Essentials stays byte-identical', async () => {
  // Essentials covers exactly ONE business — its own. A second
  // workspace on an Essentials account (inserted directly, as
  // the t4 fixtures do — the API's Essentials cap refuses a
  // second business, so no customer path creates one) inherits
  // NOTHING: not at the access gate, and not at checkout, for
  // either plan. The t4 one-trial corpus owns that road.
  const owner = await ownerWithBusiness(email('inheritcover'));
  await trialCheckout(owner, owner.business.id, 'essentials');
  const biz2 = crypto.randomUUID();
  await pool.query(
    `INSERT INTO businesses (id, owner_id, name, currency, created_by_id) VALUES ($1, $2, 'Second Shop', 'USD', $2)`,
    [biz2, owner.user.id],
  );
  await pool.query(
    `INSERT INTO business_memberships (id, business_id, user_id, role, created_by_id) VALUES ($1, $2, $3, 'owner', $3)`,
    [crypto.randomUUID(), biz2, owner.user.id],
  );

  const access = await accessFor(owner, biz2);
  assert.equal(access.state, 'denied');
  assert.equal(access.inheritedFrom, null);

  for (const plan of ['business', 'essentials']) {
    const res = await req('/api/billing/checkout', {
      method: 'POST',
      cookie: owner.cookie,
      body: { business_id: biz2, plan },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.covered, undefined, `${plan} request is not covered`);
    assert.equal(res.json.trial_eligible, false, `${plan} request gets no second trial`);
    assert.ok(res.json.session_id, `${plan} request creates a real checkout session`);
  }
});

// ---------------------------------------------------------------------------
// Source pins: the client half of the fix.
// ---------------------------------------------------------------------------

test('source pins: boot rescue + signed-in doors on the public pages', () => {
  const route = readFileSync(new URL('../../src/components/plan/SubscriptionAccessRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /pending_checkout/);
  assert.match(route, /rowGrantsEntry/);
  assert.match(route, /switchTo\(rescueTarget\.id\)/);
  const welcome = readFileSync(new URL('../../src/pages/Welcome.jsx', import.meta.url), 'utf8');
  assert.match(welcome, /isAuthenticated && \([\s\S]*?subscribe\.memberOpenApp/);
  const plansPage = readFileSync(new URL('../../src/pages/Plans.jsx', import.meta.url), 'utf8');
  assert.match(plansPage, /isAuthenticated && \([\s\S]*?subscribe\.memberOpenApp/);
});
