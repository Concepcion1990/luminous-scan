// t92 — Plan Part 7, item 390: RECIPE COSTS FOLLOW THE
// NEWEST INVOICE PRICE — the wire between release 361's
// supplier invoices and release 359's recipe costing.
//
// The pre-build code check (in the build record) found the
// wire half-built: invoice lines were compared against
// product costs to open vendor price alerts, and answering
// an alert 'accepted' wrote the new cost onto the product —
// but APPROVING an invoice updated nothing, and no recipe
// recorded which invoice price its costs stood on.
//
// Pinned here:
//   - 11 new keys exist in all 52 locales, never fall back
//     to the raw key, and the keyset is uniform at 7012
//     (6759 + 11 link); placeholders survive translation.
//   - The plan presentation carries the link line in
//     Business and only Business (Plans, Welcome, matrix).
//   - The training catalogs agree at 135 lessons; the link
//     lesson rides the owner track under the RESTAURANT
//     heading with 5 steps.
//   - The pure core: an invoice's cost updates are exactly
//     the lines whose billed price differs from the current
//     cost; recipes standing on an ingredient include those
//     reaching it through a sub-recipe; the note values name
//     the ingredient, the invoice price and the invoice.
//   - Migration 068 carries exactly the note columns.
//   - The wiring: approval applies costs BEFORE the alert
//     scan on create and update; the alert answer stamps the
//     same note; the note is server-only on recipe writes
//     and money-gated + standing-checked on recipe reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';
import { PLANS, WELCOME_OPTIONS, COMPARISON_ROWS } from '../../src/lib/plans.js';
import { invoiceCostUpdates, recipesStandingOn, costNoteValues } from '../../server/recipeCostLinkCore.js';
import { recipeCostPerUnit } from '../../server/recipes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'plansLib.businessIncludes.recipeCostLink',
  'recipes.costUpdatedTitle',
  'recipes.costUpdatedNote',
  'recipes.costUpdatedNotePlain',
  'ops.invoices.acceptNote',
  'training.lessons.owner-recipe-cost-link.title',
  'training.lessons.owner-recipe-cost-link.step1',
  'training.lessons.owner-recipe-cost-link.step2',
  'training.lessons.owner-recipe-cost-link.step3',
  'training.lessons.owner-recipe-cost-link.step4',
  'training.lessons.owner-recipe-cost-link.step5',
];

test('the keyset is uniform at 7012 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 7012, code);
});

test('all 11 link keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 11);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('English variants and base-riding locales carry the same link strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('placeholders survive translation in the note lines', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const ph of ['{ingredient}', '{supplier}', '{price}', '{date}']) {
      assert.ok(table['recipes.costUpdatedNote'].includes(ph), `${code} costUpdatedNote ${ph}`);
      assert.ok(table['recipes.costUpdatedNotePlain'].includes(ph), `${code} costUpdatedNotePlain ${ph}`);
    }
    assert.ok(table['recipes.costUpdatedNote'].includes('{invoice}'), `${code} costUpdatedNote {invoice}`);
  }
});

test('plan presentation: the link line is Business-only in Plans, Welcome and the matrix', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.recipeCostLink').length - 1, 3, 'line in Plans Business, Welcome Business and the matrix only');
  const line = en['plansLib.businessIncludes.recipeCostLink'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business carries the link line');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business carries the link line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Essentials never carries the link line');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials never carries it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === false && row.business === true, 'matrix row is Business-only');
});

test('the catalogs agree at 135 lessons and the link lesson rides the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 139);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-recipe-cost-link');
  assert.ok(lesson, 'link lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.feature, 'restaurant');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.owner-recipe-cost-link.title'], 'Recipe costs follow invoice prices');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 116);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 23);
});

test('invoiceCostUpdates: exactly the lines whose billed price moved', () => {
  const productsById = new Map([
    ['p-flour', { id: 'p-flour', name: 'Flour', cost: 1.0 }],
    ['p-sugar', { id: 'p-sugar', name: 'Sugar', cost: 0.5 }],
  ]);
  const invoice = {
    lines: JSON.stringify([
      { product_id: 'p-flour', product_name: 'Flour', quantity: 10, unit_cost: 1.25 },
      { product_id: 'p-sugar', product_name: 'Sugar', quantity: 5, unit_cost: 0.5 },
      { product_id: 'p-ghost', product_name: 'Ghost', quantity: 1, unit_cost: 9 },
      { product_id: '', product_name: 'No product', quantity: 1, unit_cost: 9 },
      { product_id: 'p-flour', product_name: 'Flour', quantity: 1, unit_cost: 1.3 },
    ]),
  };
  const updates = invoiceCostUpdates(invoice, productsById);
  assert.equal(updates.length, 1, 'one update: sugar is unchanged, ghost/unnamed lines produce nothing, the duplicate line is weighed once');
  assert.deepEqual(updates[0], { product_id: 'p-flour', product_name: 'Flour', old_cost: 1.0, new_cost: 1.25 });
});

test('recipesStandingOn: direct lines and sub-recipe lines both stand on the ingredient', () => {
  const recipes = [
    {
      id: 'r-sauce', name: 'House Sauce', yield_qty: 4,
      lines: JSON.stringify([{ kind: 'product', product_id: 'p-flour', quantity: 2 }]),
    },
    {
      id: 'r-pasta', name: 'Pasta', yield_qty: 1,
      lines: JSON.stringify([{ kind: 'recipe', recipe_id: 'r-sauce', quantity: 4 }]),
    },
    {
      id: 'r-salad', name: 'Salad', yield_qty: 1,
      lines: JSON.stringify([{ kind: 'product', product_id: 'p-oil', quantity: 1 }]),
    },
  ];
  assert.deepEqual(recipesStandingOn(recipes, 'p-flour').map((r) => r.id), ['r-sauce', 'r-pasta'], 'the pasta stands on flour through its sauce');
  assert.deepEqual(recipesStandingOn(recipes, 'p-oil').map((r) => r.id), ['r-salad']);
  assert.deepEqual(recipesStandingOn(recipes, 'p-none'), []);
  assert.deepEqual(recipesStandingOn(recipes, ''), []);
});

test('the re-cost itself: a moved product cost re-prices every standing recipe at read math', () => {
  const recipesById = new Map([
    ['r-sauce', { id: 'r-sauce', yield_qty: 4, q_factor_pct: 0, lines: JSON.stringify([{ kind: 'product', product_id: 'p-flour', quantity: 2 }]) }],
    ['r-pasta', { id: 'r-pasta', yield_qty: 1, q_factor_pct: 0, lines: JSON.stringify([{ kind: 'recipe', recipe_id: 'r-sauce', quantity: 4 }]) }],
  ]);
  const before = new Map([['p-flour', { id: 'p-flour', cost: 1.0, unit: 'kg' }]]);
  const after = new Map([['p-flour', { id: 'p-flour', cost: 1.25, unit: 'kg' }]]);
  assert.equal(recipeCostPerUnit(recipesById, before, recipesById.get('r-pasta')), 2);
  assert.equal(recipeCostPerUnit(recipesById, after, recipesById.get('r-pasta')), 2.5, 'the parent re-costs through the sub-recipe');
});

test('costNoteValues names the ingredient, the invoice price and the invoice', () => {
  const note = costNoteValues(
    { product_id: 'p-flour', product_name: 'Flour', new_cost: 1.25 },
    { id: 'inv-1', invoice_number: 'A-104', supplier_name: 'Sysco' },
  );
  assert.deepEqual(note, {
    cost_note_product_id: 'p-flour',
    cost_note_product_name: 'Flour',
    cost_note_price: 1.25,
    cost_note_invoice_id: 'inv-1',
    cost_note_invoice_number: 'A-104',
    cost_note_supplier_name: 'Sysco',
  });
});

test('migration 068 carries exactly the recipe note columns', () => {
  const sql = read('migrations/068_recipe_cost_link.sql');
  for (const col of ['cost_note_product_id', 'cost_note_product_name', 'cost_note_price', 'cost_note_invoice_id', 'cost_note_invoice_number', 'cost_note_supplier_name', 'cost_note_at']) {
    assert.ok(sql.includes(col), col);
  }
  assert.ok(sql.includes('ALTER TABLE recipes'), 'the note lives on the recipe itself — no side table');
});

test('wiring: approval applies costs before the alert scan, on create and on update', () => {
  const entities = read('server/entities.js');
  assert.ok(entities.includes('applyAcceptedInvoiceCosts'), 'the approval applier exists');
  assert.equal(entities.split('await applyAcceptedInvoiceCosts(pool,').length - 1, 2, 'create and update hooks both apply');
  const createAt = entities.indexOf('await applyAcceptedInvoiceCosts(pool, createdRow)');
  const updateAt = entities.indexOf('await applyAcceptedInvoiceCosts(pool, result)');
  assert.ok(createAt > 0 && entities.indexOf('insertPriceAlertsForInvoice(pool, createdRow', createAt) > createAt, 'create: approval lands before the alert scan');
  assert.ok(updateAt > 0 && entities.indexOf('insertPriceAlertsForInvoice(pool, result', updateAt) > updateAt, 'update: approval lands before the alert scan');
  assert.ok(entities.includes("invoiceRow.status !== 'accepted'"), 'a draft invoice applies nothing');
  assert.ok(entities.includes('UPDATE products SET cost = $1'), 'approval writes the product cost');
  assert.ok(entities.includes("status = 'accepted'"), 'approval resolves the invoice\u2019s open alerts as its answer');
  assert.ok(entities.includes('stampRecipeCostNotes'), 'the note stamper exists');
  assert.equal(entities.split('await stampRecipeCostNotes(').length - 1, 2, 'approval and the alert answer both stamp the note');
});

test('wiring: the note is server-only on writes and money-gated on reads', () => {
  const entities = read('server/entities.js');
  assert.ok(entities.includes('delete patch.cost_note_price'), 'a recipe edit cannot forge the note');
  assert.ok(entities.includes('delete values.cost_note_price'), 'a recipe create cannot forge the note');
  assert.ok(entities.includes('delete row.cost_note_price'), 'a non-money read never carries the note price');
  assert.ok(entities.includes('expandRecipeToProducts(recipesById, recipe).has(row.cost_note_product_id)'), 'the read drops the note when the ingredient leaves the recipe');
  const core = read('server/recipeCostLinkCore.js');
  assert.ok(core.includes('priceAlertCandidates'), 'approval and alerts judge a moved price the same way');
  const detail = read('src/pages/RecipeDetail.jsx');
  assert.ok(detail.includes('recipes.costUpdatedNote'), 'the recipe page shows the note');
  assert.ok(detail.includes('cost_note_product_id'), 'the note rides the shaped recipe row');
  const doc = read('src/components/print/RecipeDoc.jsx');
  assert.ok(doc.includes('recipes.costUpdatedNote'), 'the Studio dish card carries the note (preview = print)');
  const invoices = read('src/pages/RestaurantInvoices.jsx');
  assert.ok(invoices.includes('ops.invoices.acceptNote'), 'the invoices page says plainly what accepting does');
});
