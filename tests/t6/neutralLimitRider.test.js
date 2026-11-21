/**
 * T6 — Neutral plan-limit wording rider (owner's ruling,
 * Nov 20, 2026, folded into release 332): when a NON-owner
 * hits a plan limit, the refusal must never show that a limit
 * was reached. The earlier draft's clause "this workspace has
 * reached a limit" is removed; the final sentence is exactly:
 * "That can't be added right now — please ask the owner of
 * the business." The server constant and the client's
 * apiErrors.planLimitNeutral agree, in English and in every
 * locale's own faithful rendering. Owner-facing limit
 * messages are untouched by the ruling.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const FINAL = "That can't be added right now — please ask the owner of the business.";

const plans = readFileSync(
  new URL('../../server/plans.js', import.meta.url),
  'utf8',
);

test('the server neutral limit message is exactly the owner-approved sentence', () => {
  assert.match(
    plans,
    new RegExp(`NEUTRAL_LIMIT_MESSAGE =\\s*\\n?\\s*"${FINAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
  );
  assert.ok(
    !plans.includes('this workspace has reached a limit'),
    'the removed clause must not survive anywhere in server/plans.js',
  );
});

test('the English apiErrors value matches the server constant word for word', async () => {
  const { en } = await import('../../src/lib/locales/en.js');
  assert.equal(en['apiErrors.planLimitNeutral'], FINAL);
});

test('every locale carries the key, and none keeps the removed English clause', async () => {
  const dir = new URL('../../src/lib/locales/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js') && !f.includes('test'));
  assert.equal(files.length, 52);
  for (const file of files) {
    const src = readFileSync(new URL(file, dir), 'utf8');
    const m = src.match(/"apiErrors\.planLimitNeutral": "([^"]*)"/);
    assert.ok(m, `${file} must carry apiErrors.planLimitNeutral`);
    assert.ok(m[1].length > 0, `${file} value must be non-empty`);
    assert.ok(
      !m[1].includes('reached a limit'),
      `${file} must not keep the removed clause`,
    );
  }
});

test('the client message-to-key map keys on the new sentence, never the old', () => {
  // apiErrors.js maps the server's exact English message back to
  // the locale key; if the map kept the old sentence, a localized
  // refusal would silently fall back to raw English.
  const map = readFileSync(
    new URL('../../src/lib/apiErrors.js', import.meta.url),
    'utf8',
  );
  assert.ok(
    map.includes(`"${FINAL}": "apiErrors.planLimitNeutral"`),
    'the map must key planLimitNeutral on the new sentence',
  );
  assert.ok(
    !map.includes('this workspace has reached a limit'),
    'the map must not keep the removed clause',
  );
});

test('the owner-facing limit wording is untouched', () => {
  // productLimitMessage still tells the OWNER the real numbers.
  assert.match(plans, /productLimitMessage\(limit, used/);
  assert.match(plans, /This plan includes \$\{limit\} products and \$\{used\} are already in the catalog/);
});
