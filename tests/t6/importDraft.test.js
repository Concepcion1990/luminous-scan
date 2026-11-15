// Staged imports survive leaving (owner ruling, Nov 14, 2026):
// the parsed file, column matches, operation inputs and the
// dry-run verdict persist on the device for all three operations;
// Start over is the only deliberate discard; an oversize file is
// refused at staging time, never lost silently later.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), 'utf8');

// A minimal localStorage stand-in for the lib's device store.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { saveImportDraft, loadImportDraft, clearImportDraft, MAX_DRAFT_CHARS } = await import(
  '../../src/lib/importDraft.js'
);

const snap = {
  sheet: { fileName: 'receipt.csv', sheets: [], sheetName: 'CSV', table: { headers: ['sku'], rows: [['A-1']] }, warnings: [], mapping: ['sku'] },
  locationId: 'loc-1',
  dryRun: { signature: 'receipt.csv|sku|loc-1|', ready: 1 },
};

test('a staged draft round-trips on the device store', () => {
  assert.equal(saveImportDraft('biz-1', 'receive', snap), true);
  const back = loadImportDraft('biz-1', 'receive');
  assert.equal(back.sheet.table.rows[0][0], 'A-1');
  assert.equal(back.locationId, 'loc-1');
  assert.equal(back.dryRun.ready, 1);
  // Drafts are per business and per operation.
  assert.equal(loadImportDraft('biz-2', 'receive'), null);
  assert.equal(loadImportDraft('biz-1', 'create'), null);
});

test('clearing is deliberate and total', () => {
  clearImportDraft('biz-1', 'receive');
  assert.equal(loadImportDraft('biz-1', 'receive'), null);
});

test('an oversize draft is refused at staging time, not lost later', () => {
  const big = { sheet: { table: { headers: ['x'], rows: [['y'.repeat(MAX_DRAFT_CHARS)]] } } };
  assert.equal(saveImportDraft('biz-1', 'create', big), false);
  assert.equal(loadImportDraft('biz-1', 'create'), null);
});

test('a corrupt or shapeless stored value reads as no draft', () => {
  store.set('sh_import_draft:biz-9:update', '{not json');
  assert.equal(loadImportDraft('biz-9', 'update'), null);
  store.set('sh_import_draft:biz-9:update', JSON.stringify({ version: 99 }));
  assert.equal(loadImportDraft('biz-9', 'update'), null);
});

test('all three workbenches persist their staged state', () => {
  const create = read('../../src/components/import/ImportWorkbench.jsx');
  const update = read('../../src/components/import/UpdateWorkbench.jsx');
  const receive = read('../../src/components/import/ReceiveWorkbench.jsx');
  assert.match(create, /useImportDraft\(\{\s*businessId,\s*mode: 'create',/);
  assert.match(update, /useImportDraft\(\{\s*businessId,\s*mode: 'update',/);
  assert.match(receive, /useImportDraft\(\{\s*businessId,\s*mode: 'receive',/);
  // Receive restores its operation inputs and verdict.
  assert.match(receive, /setLocationId\(draft\.locationId/);
  assert.match(receive, /setDryRun\(draft\.dryRun/);
  // The too-large notice renders in the staged view of each.
  for (const wb of [create, update, receive]) assert.match(wb, /import\.draftTooLarge/);
  // The shared sheet hook can be rehydrated from a draft.
  assert.match(read('../../src/hooks/useImportSheet.js'), /const hydrate = \(snap\) =>/);
});
