/**
 * T6.2 — the cross-store inbox page: the data flow behind it and the
 * plan gating around it.
 *
 * Data flow (real server, pg-mem): a request sent from store A to
 * store B lands in B's incoming list (naming A) and A's outgoing
 * list (naming B); B's staff acknowledge it, resolve it, or decline
 * it; the asking store cannot answer its own request, strangers
 * cannot see or answer it, and a bad status is refused.
 *
 * Plan gating: Essentials still gets cross_store_business_only on
 * the create call (the server rule T6 proved), the inbox never
 * appears in the Essentials nav (feature 'crossStore'), the route is
 * PlanGate-wrapped, and the page mirrors the gate in-page.
 * The list endpoint itself is read-only and scoped to the business,
 * so it answers 200 with empty lists on Essentials — the gate lives
 * on create/lookup and on the page, not on reading an empty inbox.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  close,
  req,
  ownerWithBusiness,
  setPlan,
  createLocation,
  createProducts,
  createBusiness,
  receive,
} from './helpers.js';
import {
  listCrossStoreRequests,
  updateCrossStoreRequest,
  crossStoreStatusLabel,
  crossStoreModeLabel,
  canAnswerCrossStoreRequest,
  CROSS_STORE_STATUSES,
} from '../../src/lib/crossStore.js';

after(close);

async function twoStores(email) {
  const owner = await ownerWithBusiness(email);
  await setPlan(owner.business.id, 'business', owner.user.id);
  const locationA = await createLocation(owner.cookie, owner.business.id, { name: 'Main' });
  const storeB = await createBusiness(owner.cookie, 'Second Store');
  await setPlan(storeB.id, 'business', owner.user.id);
  const locationB = await createLocation(owner.cookie, storeB.id, { name: 'Main' });
  const [productA] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Inbox Notebook', sku: 'INBOX-001', price: 12 },
  ]);
  const [productB] = await createProducts(owner.cookie, storeB.id, [
    { name: 'Inbox Notebook', sku: 'INBOX-001', price: 12 },
  ]);
  await receive(owner.cookie, storeB.id, productB.id, locationB.id, 5);
  return { owner, storeB, locationA, locationB, productA, productB };
}

async function ask(owner, storeB, productA, mode = 'ship', message = 'A customer is waiting for this one.') {
  const res = await req(`/api/businesses/${owner.business.id}/cross-store/requests`, {
    method: 'POST',
    body: { target_business_id: storeB.id, product_id: productA.id, mode, message },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 201, res.text);
  return res.json.request;
}

test('the inbox shows incoming and outgoing with the other store named', async () => {
  const { owner, storeB, productA } = await twoStores('inbox-lists@example.com');
  const created = await ask(owner, storeB, productA);

  const atB = await req(`/api/businesses/${storeB.id}/cross-store/requests`, { cookie: owner.cookie });
  assert.equal(atB.status, 200);
  assert.equal(atB.json.incoming.length, 1);
  assert.equal(atB.json.outgoing.length, 0);
  const incoming = atB.json.incoming[0];
  assert.equal(incoming.id, created.id);
  assert.equal(incoming.product_name, 'Inbox Notebook');
  assert.equal(incoming.mode, 'ship');
  assert.equal(incoming.message, 'A customer is waiting for this one.');
  assert.equal(incoming.status, 'open');
  // The inbox names the store that asked — no second lookup needed.
  assert.equal(incoming.business_name, owner.business.name);
  assert.equal(incoming.target_business_name, 'Second Store');

  const atA = await req(`/api/businesses/${owner.business.id}/cross-store/requests`, { cookie: owner.cookie });
  assert.equal(atA.json.incoming.length, 0);
  assert.equal(atA.json.outgoing.length, 1);
  assert.equal(atA.json.outgoing[0].id, created.id);
  assert.equal(atA.json.outgoing[0].target_business_name, 'Second Store');
});

test('the receiving store can acknowledge, resolve and decline; no one else can answer', async () => {
  const { owner, storeB, productA } = await twoStores('inbox-answer@example.com');
  const first = await ask(owner, storeB, productA, 'ship', 'First ask');
  const second = await ask(owner, storeB, productA, 'bring', 'Second ask');

  const patch = (businessId, id, status, cookie = owner.cookie) =>
    req(`/api/businesses/${businessId}/cross-store/requests/${id}`, {
      method: 'PATCH',
      body: { status },
      cookie,
    });

  // Acknowledge, then resolve: the request moves through its states.
  const acknowledged = await patch(storeB.id, first.id, 'acknowledged');
  assert.equal(acknowledged.status, 200);
  assert.equal(acknowledged.json.request.status, 'acknowledged');
  const resolved = await patch(storeB.id, first.id, 'resolved');
  assert.equal(resolved.status, 200);
  assert.equal(resolved.json.request.status, 'resolved');
  assert.ok(resolved.json.request.resolved_at);

  // Decline from open, on the second request.
  const declined = await patch(storeB.id, second.id, 'declined');
  assert.equal(declined.status, 200);
  assert.equal(declined.json.request.status, 'declined');

  // A made-up status is refused, not stored.
  const bad = await patch(storeB.id, first.id, 'shipped');
  assert.equal(bad.status, 400);

  // The asking store cannot answer its own request.
  const selfAnswer = await patch(owner.business.id, first.id, 'resolved');
  assert.equal(selfAnswer.status, 404);

  // A stranger cannot see the inbox or answer anything in it.
  const stranger = await ownerWithBusiness('inbox-stranger@example.com');
  const strangerList = await req(`/api/businesses/${storeB.id}/cross-store/requests`, {
    cookie: stranger.cookie,
  });
  assert.equal(strangerList.status, 403);
  const strangerPatch = await patch(storeB.id, first.id, 'declined', stranger.cookie);
  assert.equal(strangerPatch.status, 403);
});

test('Essentials still gets cross_store_business_only on create; its inbox reads empty', async () => {
  const owner = await ownerWithBusiness('inbox-ess@example.com');
  await setPlan(owner.business.id, 'essentials', owner.user.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Essentials Inbox Book', sku: 'INBOX-ESS-001', price: 10 },
  ]);
  const request = await req(`/api/businesses/${owner.business.id}/cross-store/requests`, {
    method: 'POST',
    body: { target_business_id: owner.business.id, product_id: product.id, mode: 'ship' },
    cookie: owner.cookie,
  });
  assert.equal(request.status, 403);
  assert.equal(request.json.error, 'cross_store_business_only');

  // The list itself is read-only and scoped: an empty inbox, not a
  // refusal — the gate lives on create/lookup and on the page.
  const list = await req(`/api/businesses/${owner.business.id}/cross-store/requests`, {
    cookie: owner.cookie,
  });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.incoming, []);
  assert.deepEqual(list.json.outgoing, []);
});

test('the client lib splits incoming/outgoing and answers through the endpoint', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body });
    if (String(url).endsWith('/api/csrf-token')) {
      return { ok: true, json: async () => ({ csrf_token: 'tok-xyz' }) };
    }
    if (String(url).includes('/cross-store/requests') && (options.method || 'GET') === 'GET') {
      return {
        ok: true,
        json: async () => ({
          incoming: [{ id: 'r1', status: 'open' }],
          outgoing: [{ id: 'r2', status: 'resolved' }],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ request: { id: 'r1', status: 'acknowledged' } }),
    };
  };
  try {
    const data = await listCrossStoreRequests('biz-1');
    assert.deepEqual(data.incoming.map((r) => r.id), ['r1']);
    assert.deepEqual(data.outgoing.map((r) => r.id), ['r2']);
    assert.equal(calls[0].url, '/api/businesses/biz-1/cross-store/requests');
    assert.equal(calls[0].method, 'GET');

    const updated = await updateCrossStoreRequest('biz-1', 'r1', 'acknowledged');
    assert.equal(updated.status, 'acknowledged');
    // The PATCH is a mutating call, so it fetches a fresh CSRF token
    // at send time and carries it as a header.
    assert.equal(calls[1].url, '/api/csrf-token');
    assert.equal(calls[2].method, 'PATCH');
    assert.equal(calls[2].headers['X-CSRF-Token'], 'tok-xyz');
    assert.equal(JSON.parse(calls[2].body).status, 'acknowledged');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the status labels and answer rules read plainly', () => {
  assert.deepEqual(CROSS_STORE_STATUSES, ['open', 'acknowledged', 'resolved', 'declined']);
  assert.equal(crossStoreStatusLabel('open'), 'Waiting for an answer');
  assert.equal(crossStoreStatusLabel('acknowledged'), 'Acknowledged — on its way soon');
  assert.equal(crossStoreStatusLabel('resolved'), 'Done');
  assert.equal(crossStoreStatusLabel('declined'), 'Declined');
  assert.equal(crossStoreModeLabel('ship'), 'Ship it to us');
  assert.equal(crossStoreModeLabel('bring'), 'Bring it over');
  assert.equal(canAnswerCrossStoreRequest({ status: 'open' }), true);
  assert.equal(canAnswerCrossStoreRequest({ status: 'acknowledged' }), true);
  assert.equal(canAnswerCrossStoreRequest({ status: 'resolved' }), false);
  assert.equal(canAnswerCrossStoreRequest({ status: 'declined' }), false);
});

test('the inbox is reachable for Business and hidden/locked for Essentials', () => {
  // Nav: the entry carries the Business-only feature, so Layout hides
  // it on Essentials (same staff/plan filter as Exports, Suppliers…).
  const nav = readFileSync('src/components/layout/navGroups.js', 'utf8');
  assert.match(
    nav,
    /\{ to: '\/cross-store-inbox', label: 'Cross-store inbox', labelKey: 'nav\.crossStoreInbox', icon: Inbox, feature: 'crossStore' \}/,
  );
  // The nav label has an English string (i18n test asserts every key).
  const en = readFileSync('src/lib/locales/en.js', 'utf8');
  assert.match(en, /'nav\.crossStoreInbox': 'Cross-store inbox'/);
  // The PlanGate knows the feature's display name. T6.3 moved the label
  // out of plans.js into a t() key, so check the getter wiring AND the
  // rendered English string, not the old literal.
  const plans = readFileSync('src/lib/plans.js', 'utf8');
  assert.match(plans, /get crossStore\(\) \{ return t\('plansLib\.feature\.crossStore'\); \},/);
  assert.match(en, /'plansLib\.feature\.crossStore': "Cross-store requests"/);
  // The route is PlanGate-wrapped: a typed URL on Essentials lands on
  // the locked screen, never on the page.
  const app = readFileSync('src/App.jsx', 'utf8');
  assert.match(app, /<PlanGate feature="crossStore">/);
  assert.match(app, /path="\/cross-store-inbox"/);
  assert.match(app, /CrossStoreInbox/);
  // The page mirrors the gate in-page (finding 36 pattern) and reads
  // through the cross-store lib, never a bare endpoint string.
  const page = readFileSync('src/pages/CrossStoreInbox.jsx', 'utf8');
  assert.match(page, /import PlanGate from '@\/components\/plan\/PlanGate';/);
  assert.match(page, /import useEntitlements from '@\/hooks\/useEntitlements';/);
  assert.match(page, /if \(!entitlementLoading && !can\('crossStore'\)\) return <PlanGate feature="crossStore" \/>;/);
  assert.match(page, /listCrossStoreRequests/);
  assert.match(page, /updateCrossStoreRequest/);
  assert.doesNotMatch(page, /\/api\/businesses.*cross-store\/requests/);
});
