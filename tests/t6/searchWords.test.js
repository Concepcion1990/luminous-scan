/**
 * T6 — Word-by-word product search pins (Nov 14, 2026, owner catch):
 * she typed "Cool Ranch chips" for Cool Ranch Doritos (category
 * Chips) and got "No products found" — the old search used the whole
 * phrase as one pattern against single fields. The rule now: EVERY
 * word must appear somewhere in the product's combined searchable
 * text (name, SKU, codes, author, brand, tags, category...). Her
 * exact queries, against a catalog shaped like hers, pin it. The
 * Products page queries through listProducts (one $or clause per
 * word, ANDed); My inventory filters client-side with the same
 * helper — both surfaces share src/lib/searchMatch.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { productMatchesSearch, searchWords } from '../../src/lib/searchMatch.js';

const doritos = {
  name: 'Cool Ranch Doritos',
  sku: 'DOR-1',
  upc: '028400091510',
  category: 'Chips',
  tags: [],
};
const redBull = {
  name: '16oz Redbull Energy Drink',
  sku: 'RB-1',
  upc: '611269546019',
  category: 'Drinks',
  tags: [],
};
const catalog = [doritos, redBull];
const run = (query) => catalog.filter((p) => productMatchesSearch(p, searchWords(query)));

test('"Cool Ranch chips" finds exactly the Doritos (words split across name + category)', () => {
  assert.deepEqual(run('Cool Ranch chips'), [doritos]);
});

test('"chips" finds the Doritos through its category', () => {
  assert.deepEqual(run('chips'), [doritos]);
});

test('"red" finds the Red Bull rows (single-word behavior unchanged)', () => {
  assert.deepEqual(run('red'), [redBull]);
});

test('every word must match the SAME product', () => {
  assert.deepEqual(run('cool ranch drinks'), []);
  assert.deepEqual(run('doritos drinks'), []);
});

test('codes and SKUs are searchable text too', () => {
  assert.deepEqual(run('028400091510'), [doritos]);
  assert.deepEqual(run('rb-1'), [redBull]);
});

test('an empty query matches everything', () => {
  assert.deepEqual(run(''), catalog);
  assert.deepEqual(run('   '), catalog);
});

test('Products server query: one escaped $or clause per word', () => {
  const inventory = readFileSync(new URL('../../src/lib/inventory.js', import.meta.url), 'utf8');
  assert.ok(inventory.includes('for (const word of searchWords(search))'), 'listProducts iterates the words');
  assert.ok(inventory.includes('escapeRegex(word)'), 'each word is regex-escaped before querying');
  assert.ok(
    inventory.includes('SEARCHABLE_FIELDS.map((field)'),
    'each word is ORed across the shared searchable fields',
  );
});

test('My inventory: the same word-by-word helper drives its search box', () => {
  const page = readFileSync(new URL('../../src/pages/Inventory.jsx', import.meta.url), 'utf8');
  assert.ok(page.includes('productMatchesSearch(product, words)'), 'rows filter through the shared helper');
  assert.ok(page.includes('searchWords(search)'), 'the query is split with the shared splitter');
});
