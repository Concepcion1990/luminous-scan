/**
 * T2 business tests — create / list / switch, Essentials 1-business
 * cap enforced server-side. Runs against the real Express app +
 * pg-mem Postgres. No live Postgres, no real email.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pool,
  req,
  cookieFrom,
  registerVerifiedUser,
  resetRateLimits,
  close,
} from './helpers.js';

after(close);

// Rate limits are per-IP and the whole suite shares 127.0.0.1: reset
// them between tests so each test proves its own limiter behaviour.
beforeEach(() => resetRateLimits());

test('businesses: empty list, create, owner membership with provenance', async () => {
  const { cookie, user } = await registerVerifiedUser('biz-owner@example.com');

  const empty = await req('/api/businesses', { cookie });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.items, []);

  const created = await req('/api/businesses', {
    method: 'POST',
    cookie,
    body: { name: 'The Luminous Book Shop, LLC', tagline: 'A Quiet Place For Book Lovers', currency: 'USD' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.name, 'The Luminous Book Shop, LLC');
  assert.equal(created.json.owner_id, user.id);
  assert.equal(created.json.created_by_id, user.id);

  const membership = (
    await pool.query('SELECT * FROM business_memberships WHERE business_id = $1 AND user_id = $2', [
      created.json.id,
      user.id,
    ])
  ).rows[0];
  assert.ok(membership, 'owner membership row exists');
  assert.equal(membership.role, 'owner');
  assert.equal(membership.created_by_id, user.id);

  const list = await req('/api/businesses', { cookie });
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.items[0].id, created.json.id);
});

test('businesses: Essentials 1-business cap is enforced server-side', async () => {
  const { cookie } = await registerVerifiedUser('biz-cap@example.com');
  const first = await req('/api/businesses', {
    method: 'POST',
    cookie,
    body: { name: 'First Business' },
  });
  assert.equal(first.status, 201);

  const second = await req('/api/businesses', {
    method: 'POST',
    cookie,
    body: { name: 'Second Business' },
  });
  assert.equal(second.status, 403);
  assert.equal(second.json.error, 'business_limit_reached');

  const list = await req('/api/businesses', { cookie });
  assert.equal(list.json.items.length, 1);
});

test('businesses: create validation rejects an empty name', async () => {
  const { cookie } = await registerVerifiedUser('biz-validation@example.com');
  const res = await req('/api/businesses', { method: 'POST', cookie, body: { name: '   ' } });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'invalid_name');
});

test('businesses: switch via PATCH /me and via POST /businesses/:id/switch', async () => {
  const { cookie } = await registerVerifiedUser('biz-switch@example.com');
  const created = await req('/api/businesses', {
    method: 'POST',
    cookie,
    body: { name: 'Switchable Business' },
  });
  const businessId = created.json.id;

  const patched = await req('/api/auth/me', {
    method: 'PATCH',
    cookie,
    body: { active_business_id: businessId },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.active_business_id, businessId);

  const me = await req('/api/auth/me', { cookie });
  assert.equal(me.json.active_business_id, businessId);

  // Switching to a business the caller is not a member of is refused.
  const stranger = await req('/api/auth/me', {
    method: 'PATCH',
    cookie,
    body: { active_business_id: '00000000-0000-0000-0000-000000000000' },
  });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.json.error, 'not_a_member');

  const switched = await req(`/api/businesses/${businessId}/switch`, { method: 'POST', cookie });
  assert.equal(switched.status, 200);
  assert.equal(switched.json.active_business_id, businessId);

  const strangerSwitch = await req('/api/businesses/00000000-0000-0000-0000-000000000000/switch', {
    method: 'POST',
    cookie,
  });
  assert.equal(strangerSwitch.status, 403);
});

test('businesses: unauthenticated calls are 401; users only see their own businesses', async () => {
  const noAuthList = await req('/api/businesses');
  assert.equal(noAuthList.status, 401);
  const noAuthCreate = await req('/api/businesses', { method: 'POST', body: { name: 'Nope' } });
  assert.equal(noAuthCreate.status, 401);

  const a = await registerVerifiedUser('biz-user-a@example.com');
  const b = await registerVerifiedUser('biz-user-b@example.com');
  await req('/api/businesses', { method: 'POST', cookie: a.cookie, body: { name: "A's Business" } });

  const bList = await req('/api/businesses', { cookie: b.cookie });
  assert.equal(bList.status, 200);
  assert.deepEqual(bList.json.items, []);
});
