/**
 * T4 unit tests — Stripe client (mode, live guard, idempotency,
 * error mapping, key hygiene, webhook signature). No HTTP, no DB.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { close } from './helpers.js';

after(close);
import {
  stripeMode,
  stripeLiveEnabled,
  keyFingerprint,
  idempotencyKey,
  toFormBody,
  verifyWebhookSignature,
  stripeRequest,
} from '../../server/stripeClient.js';
import { signWebhookEvent } from './mockStripe.js';

const SECRET = 'whsec_test_mock_t4_secret';

test('mode derives from the key prefix; missing/unknown refuses', () => {
  assert.equal(stripeMode('sk_test_abc'), 'test');
  assert.equal(stripeMode('sk_live_abc'), 'live');
  assert.equal(stripeMode(''), null);
  assert.equal(stripeMode('rk_test_abc'), null);
  assert.equal(stripeMode(null), null);
});

test('live guard is off unless STRIPE_LIVE_ENABLED is exactly true', () => {
  const before = process.env.STRIPE_LIVE_ENABLED;
  delete process.env.STRIPE_LIVE_ENABLED;
  assert.equal(stripeLiveEnabled(), false);
  process.env.STRIPE_LIVE_ENABLED = 'True';
  assert.equal(stripeLiveEnabled(), false);
  process.env.STRIPE_LIVE_ENABLED = 'true';
  assert.equal(stripeLiveEnabled(), true);
  if (before === undefined) delete process.env.STRIPE_LIVE_ENABLED;
  else process.env.STRIPE_LIVE_ENABLED = before;
});

test('live-mode calls are refused while the guard is off', async () => {
  const before = process.env.STRIPE_SECRET_KEY;
  const liveBefore = process.env.STRIPE_LIVE_ENABLED;
  process.env.STRIPE_SECRET_KEY = 'sk_live_mock_0000';
  delete process.env.STRIPE_LIVE_ENABLED;
  await assert.rejects(
    () => stripeRequest('/customers', { method: 'GET' }),
    (error) => error.code === 'stripe_live_not_enabled' && error.status === 503,
  );
  process.env.STRIPE_SECRET_KEY = before;
  if (liveBefore !== undefined) process.env.STRIPE_LIVE_ENABLED = liveBefore;
});

test('missing key refuses with stripe_not_configured', async () => {
  const before = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  await assert.rejects(
    () => stripeRequest('/customers', { method: 'GET' }),
    (error) => error.code === 'stripe_not_configured' && error.status === 503,
  );
  process.env.STRIPE_SECRET_KEY = before;
});

test('idempotency keys derive from the app ids', () => {
  assert.equal(
    idempotencyKey('biz-1', 'pur-2', 'checkout'),
    'stockhaven:biz-1:pur-2:checkout',
  );
  assert.notEqual(
    idempotencyKey('biz-1', 'pur-2', 'checkout'),
    idempotencyKey('biz-1', 'pur-2', 'cancel'),
  );
});

test('key fingerprint never contains the key itself', () => {
  const key = 'sk_test_abcdefghijklmnop1234';
  const fingerprint = keyFingerprint(key);
  assert.ok(!fingerprint.includes('abcdefghijklmnop'));
  assert.ok(fingerprint.startsWith('sk_test_'));
  assert.ok(fingerprint.endsWith('1234'));
  assert.equal(keyFingerprint(''), 'not_configured');
});

test('form body flattens nested params the Stripe way', () => {
  const body = toFormBody({
    mode: 'subscription',
    'line_items': [{ price: 'price_x', quantity: 1 }],
    metadata: { business_id: 'b1', plan: 'essentials' },
    trial_period_days: 7,
  });
  const text = body.toString();
  assert.ok(text.includes('line_items%5B0%5D%5Bprice%5D=price_x'));
  assert.ok(text.includes('metadata%5Bbusiness_id%5D=b1'));
  assert.ok(text.includes('trial_period_days=7'));
});

test('webhook signature: valid passes, wrong secret fails, stale fails, missing fails', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
  const { rawBody, header } = signWebhookEvent(payload, SECRET);
  assert.deepEqual(verifyWebhookSignature(rawBody, header, SECRET), { ok: true, reason: null });
  assert.equal(verifyWebhookSignature(rawBody, header, 'whsec_wrong').ok, false);
  assert.equal(verifyWebhookSignature(rawBody, header, SECRET).ok, true);
  assert.equal(verifyWebhookSignature(rawBody, '', SECRET).ok, false);
  assert.equal(verifyWebhookSignature(rawBody, header, '').ok, false);
  // Stale timestamp (> 5 minutes old).
  const staleTs = Math.floor(Date.now() / 1000) - 6 * 60;
  const staleSig = crypto.createHmac('sha256', SECRET).update(`${staleTs}.${rawBody}`, 'utf8').digest('hex');
  assert.deepEqual(verifyWebhookSignature(rawBody, `t=${staleTs},v1=${staleSig}`, SECRET), { ok: false, reason: 'stale_timestamp' });
});

import crypto from 'node:crypto';
