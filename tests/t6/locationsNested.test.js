/**
 * T6 — Location addresses are plan-scoped + the nesting facts
 * (owner rulings, Nov 14, 2026):
 *
 *  - The Address field in the New/Edit location form is
 *    Business-only. Her settled rule: "for Business I would leave
 *    it there, just in case they want to input the address for
 *    whichever business they own" — and on Essentials it "shouldn't
 *    be optional, shouldn't be on there at all" (nested or
 *    top-level; the field does not render). An earlier
 *    nesting-based scoping was discarded on her correction.
 *  - The structural facts she probed live stand, plan-independent:
 *    a nested location never counts toward the site cap (her SITES
 *    stayed 1 of 1 with a shelf inside the store), and its stock
 *    rolls up into the parent site's totals (her store still read
 *    63 units with the shelf inside it).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { descendantIds } from '../../src/lib/locations.js';

const form = readFileSync(
  new URL('../../src/components/locations/LocationFormDialog.jsx', import.meta.url),
  'utf8',
);
const entitlements = readFileSync(new URL('../../src/lib/entitlements.js', import.meta.url), 'utf8');
const card = readFileSync(
  new URL('../../src/components/locations/LocationTreeCard.jsx', import.meta.url),
  'utf8',
);

test('form: the Address field renders on Business only — Essentials never sees it', () => {
  assert.ok(form.includes('const showAddress = !isEssentials;'), 'the gate is the plan, not the nesting');
  assert.ok(form.includes('{showAddress && ('), 'the Address block renders behind the plan gate');
  const gateAt = form.indexOf('{showAddress && (');
  const fieldAt = form.indexOf('id="loc-address"');
  assert.ok(gateAt !== -1 && fieldAt > gateAt, 'the address input sits inside the gate');
  assert.ok(!form.includes('{!form.parent_id && ('), 'the discarded nesting gate is gone');
  // Business behavior is byte-for-byte the old behavior: same
  // label, same optional placeholder, same payload field.
  assert.ok(form.includes("t('locations.addressLabel')"), 'the address label string is unchanged');
  assert.ok(form.includes("t('locations.optionalPlaceholder')"), 'the optional placeholder is unchanged');
  assert.ok(form.includes('address: form.address,'), 'the save payload still carries the address as before');
});

// isOperatingSite lives in entitlements.js, which imports the app
// client through the '@' alias node cannot resolve — so the
// predicate is mirrored here line for line, and the source pins
// below prove the mirror matches the shipped implementation.
const OPERATING_SITE_KINDS = ['store', 'warehouse', 'other'];
const isOperatingSite = (location) =>
  Boolean(location) && !location.parent_id && OPERATING_SITE_KINDS.includes(location.kind || 'store');

test('cap predicate: the mirror matches the shipped implementation', () => {
  assert.ok(
    entitlements.includes("const OPERATING_SITE_KINDS = ['store', 'warehouse', 'other'];"),
    'the site kinds match',
  );
  assert.ok(
    entitlements.includes("return !location.parent_id && OPERATING_SITE_KINDS.includes(location.kind || 'store');"),
    'the predicate matches: no parent + an operating kind',
  );
});

test('cap: a nested location never counts as a site', () => {
  const store = { id: 'store', kind: 'store', parent_id: '' };
  const shelf = { id: 'shelf', kind: 'shelf', parent_id: 'store' };
  const bin = { id: 'bin', kind: 'bin', parent_id: 'shelf' };
  const secondStore = { id: 'store2', kind: 'store', parent_id: '' };
  assert.equal(isOperatingSite(store), true, 'the store itself is a site');
  assert.equal(isOperatingSite(shelf), false, 'a shelf inside it is not a site');
  assert.equal(isOperatingSite(bin), false, 'a bin inside the shelf is not a site');
  assert.equal(
    [store, shelf, bin].filter(isOperatingSite).length,
    1,
    'her probe: SITES stays 1 of 1 with the shelf inside',
  );
  assert.equal([store, shelf, bin, secondStore].filter(isOperatingSite).length, 2, 'a second real store does count');
});

test('rollup: a nested location’s stock rolls up into the parent site’s totals', () => {
  const locations = [
    { id: 'store', kind: 'store', parent_id: '' },
    { id: 'shelf', kind: 'shelf', parent_id: 'store' },
    { id: 'bin', kind: 'bin', parent_id: 'shelf' },
    { id: 'other', kind: 'store', parent_id: '' },
  ];
  const levels = [
    { location_id: 'store', quantity: 40 },
    { location_id: 'shelf', quantity: 20 },
    { location_id: 'bin', quantity: 3 },
    { location_id: 'other', quantity: 9 },
  ];
  // LocationTreeCard's own math: levels over the subtree id set.
  const ids = new Set(descendantIds(locations, 'store'));
  const units = levels
    .filter((level) => ids.has(level.location_id))
    .reduce((sum, level) => sum + level.quantity, 0);
  assert.equal(units, 63, 'her probe: the store reads 63 units with the shelf (and its bin) inside');
  assert.ok(card.includes('descendantIds(locations, location.id)'), 'the card totals over the whole subtree');
});
