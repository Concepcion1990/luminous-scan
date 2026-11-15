/**
 * T6 — Overview load integrity (owner catch, Nov 14, 2026): the
 * Overview sat empty ~15s, then painted the numbers from BEFORE a
 * product was created. The load was Promise.all with no catch and
 * no timeout: one stalled or failed query held the paint hostage,
 * and when it finally gave up, the finally block cleared the
 * loading state over the previous snapshot — stale numbers shown
 * as if current. The rules now: a load paints only if it is still
 * the freshest (the freshness version has not moved since it
 * started), a failed load retries instead of painting stale, and
 * entity reads time out so a retry can proceed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const dashboard = read('src/pages/Dashboard.jsx');
const client = read('src/api/client.js');

test('a superseded load never paints: the freshness version is checked at paint time', () => {
  assert.ok(
    dashboard.includes("const startVersion = dataVersion('inventory');"),
    'each load records the freshness version it answers for',
  );
  const paintAt = dashboard.indexOf('setData(inventory)');
  const guardAt = dashboard.indexOf("if (dataVersion('inventory') !== startVersion) return;");
  assert.ok(guardAt > -1 && guardAt < paintAt, 'a version-moved load drops its snapshot before any paint');
});

test('a failed load retries with backoff instead of painting the old snapshot', () => {
  assert.ok(dashboard.includes('.catch(() => {'), 'the load has a failure path');
  assert.ok(dashboard.includes('retryTimer = setTimeout(load,'), 'failures retry the load itself');
  assert.ok(dashboard.includes('Math.min(800 * attempt, 5000)'), 'retries back off');
  const effect = dashboard.slice(dashboard.indexOf('const startVersion'), dashboard.indexOf('}, [activeId, showPurchasing, reload]);'));
  assert.ok(!effect.includes('.finally('), 'no finally clears the loading state over stale data anymore');
});

test('entity reads time out; writes do not', () => {
  assert.ok(client.includes('const READ_TIMEOUT_MS = 15_000;'), 'reads carry a 15s ceiling');
  assert.ok(client.includes('new AbortController()'), 'the timeout is a real abort');
  assert.ok(client.includes('timeoutMs: READ_TIMEOUT_MS'), 'entity reads pass the timeout');
  const createLine = client.slice(client.indexOf('create: (values)'), client.indexOf('update: (id, patch)'));
  assert.ok(!createLine.includes('timeoutMs'), 'a write is never cut off mid-send by the client');
});
