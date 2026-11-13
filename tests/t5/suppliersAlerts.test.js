/**
 * T5 — suppliers full CRUD and low-stock alert management
 * (plan §2.11, audit Finding 36: errors shown, not silent).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  close,
  req,
  ownerWithBusiness,
  setPlan,
  createLocation,
  createProducts,
  createSupplier,
} from './helpers.js';

after(close);

test('suppliers: full CRUD on Business, refused on Essentials', async () => {
  const owner = await ownerWithBusiness('sup-crud@example.com');
  await setPlan(owner.business.id, 'business', owner.user.id);
  const created = await createSupplier(owner.cookie, owner.business.id, {
    contact_name: 'Ana',
    email: 'ana@example.com',
    lead_time_days: 5,
  });
  assert.equal(created.name, 'Test Supplier');
  assert.equal(created.contact_name, 'Ana');
  const listed = await req('/api/entities/Supplier/query', {
    method: 'POST',
    body: { filter: { business_id: owner.business.id } },
    cookie: owner.cookie,
  });
  assert.equal(listed.json.total, 1);
  const updated = await req(`/api/entities/Supplier/${created.id}`, {
    method: 'PATCH',
    body: { lead_time_days: 9, active: false },
    cookie: owner.cookie,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.lead_time_days, 9);
  assert.equal(updated.json.active, false);
  const removed = await req(`/api/entities/Supplier/${created.id}`, {
    method: 'DELETE',
    cookie: owner.cookie,
  });
  assert.equal(removed.status, 200);
  const gone = await req(`/api/entities/Supplier/${created.id}`, { cookie: owner.cookie });
  assert.equal(gone.status, 404);
  // Validation errors are real errors, not silent.
  const bad = await req('/api/entities/Supplier', {
    method: 'POST',
    body: { business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(bad.status, 400);
});

test('supplier writes refuse on Essentials with the plan error', async () => {
  const owner = await ownerWithBusiness('sup-ess@example.com');
  const res = await req('/api/entities/Supplier', {
    method: 'POST',
    body: { business_id: owner.business.id, name: 'Nope' },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'supplier_business_only');
});

test('low-stock alert rules: create, toggle, delete — errors shown, not silent', async () => {
  const owner = await ownerWithBusiness('alerts-manage@example.com');
  await setPlan(owner.business.id, 'business', owner.user.id);
  const location = await createLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Cat Bookmark', sku: 'BM-001', cost: 4, price: 10 },
  ]);
  const rule = await req('/api/entities/AlertRule', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      name: 'Cat Bookmark low',
      kind: 'low_stock',
      location_id: location.id,
      location_name: location.name,
      threshold: 5,
      active: true,
    },
    cookie: owner.cookie,
  });
  assert.equal(rule.status, 201, `alert rule create failed: ${rule.text}`);
  const toggled = await req(`/api/entities/AlertRule/${rule.json.id}`, {
    method: 'PATCH',
    body: { active: false },
    cookie: owner.cookie,
  });
  assert.equal(toggled.status, 200);
  assert.equal(toggled.json.active, false);
  const toggledBack = await req(`/api/entities/AlertRule/${rule.json.id}`, {
    method: 'PATCH',
    body: { active: true },
    cookie: owner.cookie,
  });
  assert.equal(toggledBack.json.active, true);
  const removed = await req(`/api/entities/AlertRule/${rule.json.id}`, {
    method: 'DELETE',
    cookie: owner.cookie,
  });
  assert.equal(removed.status, 200);
  // Deleting a rule that is already gone is a real 404, not silence.
  const again = await req(`/api/entities/AlertRule/${rule.json.id}`, {
    method: 'DELETE',
    cookie: owner.cookie,
  });
  assert.equal(again.status, 404);
  // Alert rules are Business-only.
  const ess = await ownerWithBusiness('alerts-ess@example.com');
  const essCreate = await req('/api/entities/AlertRule', {
    method: 'POST',
    body: {
      business_id: ess.business.id,
      name: 'Cat Bookmark low',
      kind: 'low_stock',
      threshold: 5,
      active: true,
    },
    cookie: ess.cookie,
  });
  assert.equal(essCreate.status, 403);
  assert.equal(essCreate.json.error, 'plan_gated');
});
