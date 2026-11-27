/**
 * T79 — the BARCODE POOL BUILD (Nov 25, 2026), the owner's spec
 * (print-code-pool/spec.md): inside the Print section, a door
 * that generates barcodes with NO product attached — print
 * them, stick them on merchandise that has no barcode of its
 * own, and scan the item into a product later.
 *
 *  (1) THE DOOR (Print section, BOTH plans): "Generate
 *      barcodes" — the owner enters how many codes they need
 *      and the app mints that many unique house codes into
 *      that business's pool. NO LIMIT on the quantity.
 *  (2) PRINT-OR-SAVE, RIGHT THERE: the moment codes are
 *      generated, print them now as labels through the
 *      existing label machinery, or save them as a PDF. The
 *      codes are in the pool either way; a saved PDF matches
 *      the pool exactly.
 *  (3) THE POOL: per-business. A minted code is never handed
 *      out twice, never belongs to another business, creates
 *      NO inventory, and unused codes wait indefinitely. The
 *      format is the app's own — SHP-XXXXXXXX — distinguishable
 *      from the per-product generator's SH- codes and from
 *      every all-digit retail code, drawn as Code 128.
 *  (4) SCAN RECOGNITION: an unclaimed pool code offers the
 *      add-product road with the code carried into the form;
 *      a code from ANOTHER business's pool is refused (the
 *      honest no-match stands); once claimed, the code behaves
 *      as a normal product code. NOT rebuilt: the per-product
 *      generator, the label machinery, the add-product flow.
 *
 *  TEST + RETEST — her direct order: mint → print → scan →
 *  add, run and re-run by name below; the cross-business
 *  refusal; the claimed code behaving as a normal product
 *  code thereafter.
 *
 *  Keyset: 6006 + 21 = 6027 ×52, uniform (6256 since the
 *  checklists build, Nov 26, 2026). Training catalog:
 *  119 + 1 = 120 (owner track, printing module, GENERAL
 *  heading, 5 steps; 123 since the kitchen-menu build (plan release 371, Nov 26, 2026) added 1 (staff-kitchen-menu, Business-only, restaurant heading); 122 since the food-safety build).
 *  Migration 057 (barcode_pool_codes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { PLANS, WELCOME_OPTIONS } from '../../src/lib/plans.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';
import { API_ERROR_MESSAGE_KEYS } from '../../src/lib/apiErrors.js';
import {
  POOL_CODE_RE,
  checkPoolCode,
  cleanPoolCount,
  isPoolCodeShape,
  mintPoolBatch,
  mintPoolCandidate,
  mintPoolCodes,
  poolCodeClaimed,
  poolSummary,
} from '../../server/barcodePoolCore.js';
import { codeForms, isTaken, loadTakenCodes } from '../../server/codeGenerator.js';
import { poolCodeLabel } from '../../src/lib/barcodePool.js';
import { toLabel } from '../../src/lib/labelPayload.js';
import { buildLabelsPdfBytes } from '../../src/lib/labelsPdf.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'print.pool.title', 'print.pool.intro', 'print.pool.countLabel',
  'print.pool.generate', 'print.pool.generating', 'print.pool.minted',
  'print.pool.waiting', 'print.pool.printNow', 'print.pool.savePdf',
  'print.pool.failed',
  'scan.pool.title', 'scan.pool.body',
  'plansLib.includes.barcodePool',
  'training.lessons.owner-barcode-pool.title',
  'training.lessons.owner-barcode-pool.step1',
  'training.lessons.owner-barcode-pool.step2',
  'training.lessons.owner-barcode-pool.step3',
  'training.lessons.owner-barcode-pool.step4',
  'training.lessons.owner-barcode-pool.step5',
  'apiErrors.poolOwnerMints', 'apiErrors.poolCount',
];

/* ------------------------------------------------ i18n gate */

test('keyset stands at 6256 in all 52 locales, uniform', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  const enKeys = Object.keys(LOCALES.en).sort();
  assert.equal(enKeys.length, 6256);
  for (const code of codes) {
    assert.equal(Object.keys(LOCALES[code]).length, 6256, `${code} keyset`);
    assert.deepEqual(Object.keys(LOCALES[code]).sort(), enKeys, `${code} keyset differs from en`);
  }
});

test('the 21 new keys exist in all 52 locales and are not the key itself', () => {
  assert.equal(NEW_KEYS.length, 21);
  for (const [code, strings] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof strings[key] === 'string' && strings[key].length >= 1, `${code} missing ${key}`);
      assert.notEqual(strings[key], key, `${code} ${key} renders as its own key`);
    }
  }
});

test('the five Englishes carry the new keys byte-identical to base en; es/fr variants and prs ride their base', () => {
  for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) {
    for (const key of NEW_KEYS) assert.equal(LOCALES[code][key], en[key], `${code} ${key}`);
  }
  for (const code of ['es-ES', 'es-US', 'es-CU', 'es-PR', 'es-VE']) {
    for (const key of NEW_KEYS) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
  }
  for (const key of NEW_KEYS) assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
  for (const key of NEW_KEYS) assert.equal(LOCALES['prs'][key], LOCALES['fa'][key], `prs ${key}`);
});

test('the two new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(API_ERROR_MESSAGE_KEYS['Only the owner makes barcodes for the pool.'], 'apiErrors.poolOwnerMints');
  assert.equal(
    API_ERROR_MESSAGE_KEYS['Say how many barcodes you need — a whole number of one or more.'],
    'apiErrors.poolCount',
  );
  assert.equal(en['apiErrors.poolOwnerMints'], 'Only the owner makes barcodes for the pool.');
  assert.equal(en['apiErrors.poolCount'], 'Say how many barcodes you need — a whole number of one or more.');
});

/* ------------------------------------------- plan presentation */

test('plan presentation: the barcode-pool line rides Essentials on Plans + Welcome + the matrix, and Business does not repeat it', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.includes.barcodePool').length - 1, 3, 'the line is referenced exactly three times: Plans list, Welcome list, comparison matrix');
  assert.ok(plans.includes("{ get label() { return t('plansLib.includes.barcodePool'); }"), 'the comparison matrix row exists');
  const line = en['plansLib.includes.barcodePool'];
  assert.ok(PLANS.essentials.includes.includes(line), 'Plans Essentials list carries the line');
  const welcomeEssentials = WELCOME_OPTIONS.find((option) => option.key === 'essentials');
  assert.ok(welcomeEssentials.includes.includes(line), 'Welcome Essentials list carries the line');
  assert.ok(!PLANS.business.includes.includes(line), 'Business list does not repeat an Essentials line (the Nov 19 dedupe ruling)');
});

/* ------------------------------------------------- the lesson */

test('catalogs stood at 120 at this build (123 since the kitchen-menu build (plan release 371, Nov 26, 2026) added 1 (staff-kitchen-menu, Business-only, restaurant heading); 122 since the food-safety build), client and server JSON-identical', () => {
  assert.equal(CLIENT_LESSONS.length, 123);
  assert.equal(SERVER_LESSONS.length, 123);
  assert.equal(JSON.stringify(CLIENT_LESSONS), JSON.stringify(SERVER_LESSONS), 'the two catalogs agree exactly');
});

test('the new lesson: owner-barcode-pool, owner track, printing module, GENERAL heading, 5 steps', () => {
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-barcode-pool');
  assert.ok(lesson, 'the lesson exists');
  assert.deepEqual(
    { track: lesson.track, module: lesson.module, heading: lesson.heading, steps: lesson.steps },
    { track: 'owner', module: 'printing', heading: 'general', steps: 5 },
  );
});

/* ---------------------------------------------- the code format */

test('the pool format: SHP- plus eight Code 128 characters, a letter and a digit, never a retail shape', () => {
  let seed = 7;
  const rng = (max) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };
  for (let i = 0; i < 500; i += 1) {
    const code = mintPoolCandidate({ rng });
    assert.match(code, POOL_CODE_RE, code);
    assert.ok(/[A-Z]/.test(code.slice(4)) && /\d/.test(code.slice(4)), `${code} carries a letter and a digit`);
    assert.ok(!/^\d+$/.test(code), `${code} can never be mistaken for a UPC/EAN/ISBN`);
    assert.ok(!code.startsWith('SH-') || code.startsWith('SHP-'), `${code} is the pool's SHP- mark, not the product generator's SH-`);
  }
  assert.ok(isPoolCodeShape('SHP-AB12CD34'));
  assert.ok(isPoolCodeShape('shp-ab12cd34'), 'the scanner reads case loosely');
  assert.ok(isPoolCodeShape('SHPAB12CD34'), 'and with the separator dropped');
  assert.ok(!isPoolCodeShape('SH-AB12CD34'), 'a per-product SH- code is not a pool code');
  assert.ok(!isPoolCodeShape('012345678905'), 'a UPC is not a pool code');
  assert.ok(!isPoolCodeShape('SHP-AB12CD3'), 'seven characters is not a pool code');
  assert.ok(!isPoolCodeShape(''));
});

test('cleanPoolCount: any whole number of one or more — NO LIMIT — and nothing else', () => {
  assert.equal(cleanPoolCount(1), 1);
  assert.equal(cleanPoolCount(100), 100);
  assert.equal(cleanPoolCount(1000), 1000);
  assert.equal(cleanPoolCount('25'), 25);
  for (const bad of [0, -3, 2.5, 'abc', '', null, undefined, NaN]) {
    assert.throws(
      () => cleanPoolCount(bad),
      (error) => error.code === 'pool_count' && error.message === en['apiErrors.poolCount'],
      `refuses ${String(bad)} with the registered wording`,
    );
  }
});

/* ------------------------------------- a fake pool (no live DB) */

function fakePool() {
  const state = { products: [], gtins: [], pool: [] };
  const runQuery = (sql, params = []) => {
    if (/FROM products/i.test(sql)) {
      return { rows: state.products.filter((p) => p.business_id === params[0]) };
    }
    if (/FROM minted_gtins/i.test(sql)) {
      return { rows: state.gtins.filter((g) => g.business_id === params[0]).map((g) => ({ gtin: g.gtin })) };
    }
    if (/FROM barcode_pool_codes/i.test(sql)) {
      return { rows: state.pool.filter((r) => r.business_id === params[0]).map((r) => ({ code: r.code })) };
    }
    if (/INSERT INTO barcode_pool_codes/i.test(sql)) {
      for (let i = 0; i < params.length; i += 4) {
        const [, businessId, code] = params.slice(i, i + 4);
        if (state.pool.some((r) => r.code === code)) {
          throw Object.assign(new Error('duplicate key'), { code: '23505' });
        }
        state.pool.push({ business_id: businessId, code });
      }
      return { rows: [] };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    throw new Error(`fake pool cannot run: ${sql}`);
  };
  return {
    state,
    query: async (sql, params) => runQuery(sql, params),
    connect: async () => ({
      query: async (sql, params) => runQuery(sql, params),
      release: () => {},
    }),
  };
}

function seededRng(start) {
  let seed = start;
  return (max) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };
}

/* --------------------------- TEST + RETEST: mint → print → scan → add */

test('TEST: mint → print → scan → add — three codes minted, printed exactly, recognised, then claimed', async () => {
  const pool = fakePool();
  const bizA = 'biz-a';
  pool.state.products.push({ business_id: bizA, sku: 'BOOK-BAG-1', upc: '', barcode: '', qr_code: '', isbn: '' });

  // MINT — three codes, unique, pool-shaped, and NO inventory:
  // the products table is exactly as it was.
  const codes = await mintPoolCodes(pool, bizA, 3, { userId: 'owner-1', rng: seededRng(42) });
  assert.equal(codes.length, 3);
  assert.equal(new Set(codes).size, 3, 'never handed out twice, even within one batch');
  for (const code of codes) assert.match(code, POOL_CODE_RE);
  assert.equal(pool.state.products.length, 1, 'minting created NO product');
  assert.deepEqual(await poolSummary(pool, bizA), { total: 3, waiting: 3 });

  // PRINT — the batch rides the existing label machinery as
  // generic labels; the printed set is the pool set, exactly.
  const labels = codes.map((code) => toLabel(poolCodeLabel(code, 'Test Store')));
  assert.deepEqual(labels.map((l) => l.code), codes, 'the printed labels match the pool exactly');
  for (const label of labels) assert.equal(label.codeType, 'CODE128', 'pool codes draw as Code 128');
  const pdf = buildLabelsPdfBytes(labels, { businessName: 'Test Store' });
  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), '%PDF-', 'the save-as-PDF road builds a real PDF from the batch');

  // SCAN — the app recognises its own printed code, unclaimed.
  const scanned = codes[0];
  assert.deepEqual(await checkPoolCode(pool, bizA, scanned), { pool: true, claimed: false, code: scanned });
  assert.deepEqual(
    await checkPoolCode(pool, bizA, scanned.toLowerCase()),
    { pool: true, claimed: false, code: scanned },
    'recognition survives the scanner loose reading',
  );

  // ADD — the product saves carrying the code (the add-product
  // form's road): from that moment the code is claimed.
  pool.state.products.push({ business_id: bizA, sku: 'BOOK-BAG-2', upc: scanned, barcode: scanned, qr_code: '', isbn: '' });
  assert.deepEqual(await checkPoolCode(pool, bizA, scanned), { pool: true, claimed: true, code: scanned });
  assert.deepEqual(await poolSummary(pool, bizA), { total: 3, waiting: 2 }, 'the claimed code leaves the waiting count');
});

test('RETEST: a claimed code behaves as a normal product code thereafter', async () => {
  const pool = fakePool();
  const bizA = 'biz-a';
  const [code] = await mintPoolCodes(pool, bizA, 1, { rng: seededRng(99) });
  // The claim: a product of the same business holds the code.
  pool.state.products.push({ business_id: bizA, sku: '', upc: '', barcode: code, qr_code: '', isbn: '' });

  const productForms = new Set();
  for (const value of [code]) for (const form of codeForms(value)) productForms.add(form);
  assert.ok(poolCodeClaimed(code, productForms), 'the claim test reads the code as a product code');

  // The scanner's product lookup discipline finds it as a code
  // of the product (the same forms findProductsByCode walks),
  // and the pool check reports it claimed — the Scan page's
  // product-first order means the product answers, as for any
  // normal product code.
  assert.deepEqual(await checkPoolCode(pool, bizA, code), { pool: true, claimed: true, code });

  // And the per-product generator can never mint it again:
  // the pool's codes ride the taken set.
  const taken = await loadTakenCodes(pool, bizA);
  assert.ok(isTaken(taken, code), 'a pool code is taken for the product generator');
  const batch = mintPoolBatch(new Set(taken), 50, { rng: seededRng(5) });
  assert.ok(!batch.includes(code), 'a fresh batch never re-hands the claimed code');
});

test('cross-business: a code from ANOTHER business\'s pool is NOT claimable', async () => {
  const pool = fakePool();
  const codesA = await mintPoolCodes(pool, 'biz-a', 2, { rng: seededRng(1234) });
  // Business B scans business A's printed code: not its pool,
  // not claimable — the honest no-match stands.
  assert.deepEqual(await checkPoolCode(pool, 'biz-b', codesA[0]), { pool: false, claimed: false });
  assert.deepEqual(await poolSummary(pool, 'biz-b'), { total: 0, waiting: 0 }, 'nothing of A\'s pool leaks into B\'s');
  // A code in NO pool at all answers the same honest no.
  assert.deepEqual(await checkPoolCode(pool, 'biz-a', 'SHP-ZZZZZZZ9'), { pool: false, claimed: false });
  assert.deepEqual(await checkPoolCode(pool, 'biz-a', '012345678905'), { pool: false, claimed: false });
});

test('minting never collides with the business\'s own products or its earlier pool', async () => {
  const pool = fakePool();
  const bizA = 'biz-a';
  const first = await mintPoolCodes(pool, bizA, 5, { rng: seededRng(7) });
  pool.state.products.push({ business_id: bizA, sku: first[0], upc: '', barcode: '', qr_code: '', isbn: '' });
  const second = await mintPoolCodes(pool, bizA, 5, { rng: seededRng(7) });
  assert.equal(new Set([...first, ...second]).size, 10, 'ten codes, ten distinct values');
  assert.deepEqual(await poolSummary(pool, bizA), { total: 10, waiting: 9 });
});

/* ------------------------------------------------ wiring pins */

test('migration 057: the pool table, the table-wide unique code, and no foreign key', () => {
  const migration = read('migrations/057_barcode_pool.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS barcode_pool_codes/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS barcode_pool_codes_code_key\s+ON barcode_pool_codes \(code\)/, 'a code sits in exactly one business\'s pool, ever');
  const ddl = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.ok(!/REFERENCES\s/i.test(ddl) && !/FOREIGN KEY/i.test(ddl), 'business_id carries no foreign key (the migration-017 lesson)');
});

test('the doors are wired: router mounted, wipe sweep, owner-gated mint, both-plans surface', () => {
  const app = read('server/app.js');
  assert.ok(app.includes("import { createBarcodePoolRouter } from './barcodePoolRoutes.js';"));
  assert.ok(app.includes("app.use('/api', createBarcodePoolRouter({ getPool }));"));
  const billing = read('server/billing.js');
  assert.ok(billing.includes("DELETE FROM barcode_pool_codes WHERE business_id = $1"), 'the wipe sweep deletes the pool with the business');
  const routes = read('server/barcodePoolRoutes.js');
  assert.ok(routes.includes("'/businesses/:bid/barcode-pool'") || routes.includes('const base = \'/businesses/:bid/barcode-pool\''));
  assert.ok(routes.includes('Only the owner makes barcodes for the pool.'), 'the mint is the owner\'s door');
  assert.ok(!routes.includes('planKey') && !routes.includes('isEssentials') && !routes.includes('requirePlan'), 'no plan gate anywhere in the pool surface — both plans');
});

test('the Print door and the Scan recognition are wired to the pool', () => {
  const print = read('src/pages/PrintCenter.jsx');
  assert.ok(print.includes('<BarcodePoolCard'), 'the Generate barcodes door renders in the Print section');
  assert.ok(print.includes('isBoss(user, profile) && ('), 'the door is the boss\'s, like the Style Studio');
  assert.ok(print.includes('poolCodeLabel(code, profile.name)'), 'the minted batch previews through the label machinery');
  assert.ok(print.includes('label={poolCodeLabel(code, profile.name)}'), 'pool labels render through LabelCard\'s generic-label road');
  const card = read('src/components/print/BarcodePoolCard.jsx');
  assert.ok(card.includes('mintPoolCodes(businessId, Number(count))'), 'the card mints through the pool door');
  assert.ok(card.includes('downloadLabelsPdf(labels'), 'the save-as-PDF road rides the existing labels PDF');
  assert.ok(card.includes("t('print.pool.printNow')") && card.includes("t('print.pool.savePdf')"), 'both roads are offered the moment codes are minted');
  const scan = read('src/pages/Scan.jsx');
  assert.ok(scan.includes('checkPoolCode(activeId'), 'the scanner asks the pool before the no-match');
  assert.ok(scan.includes("t('scan.pool.title')") && scan.includes("t('scan.pool.body')"), 'the recognition panel speaks the owner\'s words');
  assert.ok(scan.includes('defaultCode={notFound || poolCode}'), 'the code is carried into the add-product form');
  assert.ok(scan.includes('setNotFound(code);'), 'an unknown code keeps today\'s honest no-match, untouched');
});
