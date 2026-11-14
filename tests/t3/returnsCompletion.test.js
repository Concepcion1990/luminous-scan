/**
 * T3 — returns completion (the owner's Nov 14, 2026 ruling).
 *
 * Two stacked blocks let an approved return sit in Approved
 * forever: completeReturn demanded a location before looking at
 * the lines, and then demanded a restock or exchange line — so a
 * pure do-not-restock return (unsellable goods, refund recorded,
 * no exchange) could NEVER complete. Now: a location is required
 * only when something actually moves; a no-restock/no-exchange
 * return completes as a record-only close; a return with no
 * lines at all still cannot complete.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const lib = read('../../src/lib/returns.js');
const complete = lib.slice(lib.indexOf('export async function completeReturn'));

test('the location is demanded only when stock actually moves', () => {
  assert.ok(
    !complete.includes('if (!ret.location_id) throw'),
    'the unconditional location wall is gone',
  );
  assert.match(
    complete,
    /const movesStock = restockLines\.length > 0 \|\| exchangeLines\.length > 0;/,
    'movement is computed from the lines first',
  );
  assert.match(
    complete,
    /if \(movesStock && !ret\.location_id\) \{\s*throw new Error\(t\('returnsLib\.chooseReturnLocation'\)\);/,
    'restock or exchange without a location still blocks with the message',
  );
});

test('a return with no lines at all still cannot complete', () => {
  const emptyGuard = complete.indexOf('if (!hasAnyLine)');
  const locationGuard = complete.indexOf('movesStock && !ret.location_id');
  assert.ok(emptyGuard > -1, 'the empty-return guard exists');
  assert.ok(emptyGuard < locationGuard, 'the empty guard is checked before the location guard');
  assert.match(
    complete.slice(emptyGuard, locationGuard),
    /returnsLib\.setLineOrReplacement/,
    'the empty guard keeps its meaningful message',
  );
});

test('the record-only close reaches the completion write with no movements', () => {
  // The completion write is unconditional once the guards pass,
  // and the linked-order "returned" flip still requires an actual
  // restock, so a record-only close changes no stock anywhere.
  assert.match(complete, /status: 'completed'/, 'completion writes the closed status');
  assert.match(complete, /if \(linkedOrder && restocked\)/, 'the order flip still requires restocked units');
  const restockLoop = complete.indexOf('for (const line of ret.lines || [])');
  assert.match(
    complete.slice(restockLoop, restockLoop + 200),
    /if \(!qty \|\| !line\.restock\) continue;/,
    'do-not-restock lines never write a movement',
  );
});
