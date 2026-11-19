// T34 (Nov 15, 2026): the product code generator + GS1 mode.
//  - House codes (her six: UPC, SKU, Code 128, Barcode, EAN, QR):
//    the server mints codes unique across the business's WHOLE
//    code identity space (sku/upc/barcode/qr_code/isbn, every
//    form the scanner can meet). UPC = true UPC-A from the
//    reserved in-store ranges with a valid check digit; EAN =
//    true EAN-13 from the internal-use range; both validate
//    under the app's own barcodeSym engine as their true
//    symbology. SKU = the existing auto-SKU slug + ladder.
//  - GS1 mode: with the owner's own licensed prefix on file,
//    GTIN-12/GTIN-13 mint sequentially from the minted_gtins
//    ledger and are NEVER reused — the ledger survives product
//    deletes; a reference whose GTIN already sits in the catalog
//    as a typed code is burned, not handed out. Capacity is
//    arithmetic; the wall answers gs1_exhausted. No prefix =
//    gs1_prefix_missing (the form carries the Settings door).
//  - Both plans; the only gate is products.edit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ownerWithBusiness, registerVerifiedUser, req, pool, createProducts, close,
} from './helpers.js';

after(close);
import {
  CODE_FIELDS, buildGtin, codeForms, gs1Capacity, loadTakenCodes,
  mintAgainstTaken, mintCandidate, validateGs1Prefix,
} from '../../server/codeGenerator.js';
import {
  symbologyFor, isValidUpcA, isValidEan13, barcodeRects,
} from '../../src/lib/barcodeSym.js';
import { code128Rects } from '../../src/lib/code128.js';

const gen = (cookie, bid, body) => req(`/api/businesses/${bid}/products/generate-code`, {
  method: 'POST', body, cookie,
});
const genState = (cookie, bid) => req(`/api/businesses/${bid}/products/generate-code`, { cookie });

/* ------------------------- unit: formats ------------------------- */

test('house UPC: 12 digits, in-store prefix, valid check digit, true UPC-A', () => {
  const prefixes = new Set(['04', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29']);
  for (let i = 0; i < 200; i += 1) {
    const code = mintCandidate('upc');
    assert.match(code, /^\d{12}$/);
    assert.ok(prefixes.has(code.slice(0, 2)), `${code} starts in the reserved ranges`);
    assert.ok(isValidUpcA(code), `${code} passes the app's own UPC-A check`);
    assert.equal(symbologyFor(code), 'UPC-A', 'renders as true UPC-A, never a fallback');
    assert.ok(barcodeRects(code), 'the label engine draws it');
  }
});

test('house EAN: 13 digits, internal-use range, valid check digit, true EAN-13', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = mintCandidate('ean');
    assert.match(code, /^2\d{12}$/);
    assert.ok(isValidEan13(code), `${code} passes the app's own EAN-13 check`);
    assert.equal(symbologyFor(code), 'EAN-13');
    assert.ok(barcodeRects(code));
  }
});

test('SKU: the existing slug style; Code 128 / Barcode / QR flavors', () => {
  assert.equal(mintCandidate('sku', { name: 'Handmade Basket' }), 'HANDMADE-BASKET');
  assert.equal(mintCandidate('sku', { name: '' }), 'ITEM');
  for (let i = 0; i < 100; i += 1) {
    const c128 = mintCandidate('code128');
    assert.match(c128, /^SH-[A-Z0-9]{8}$/);
    assert.match(c128, /[A-Z]/, 'carries a letter');
    assert.match(c128, /\d/, 'carries a digit');
    assert.ok(code128Rects(c128), 'encodes as Code 128');
    assert.match(mintCandidate('barcode'), /^\d{12}$/);
    const qr = mintCandidate('qr');
    assert.match(qr, /^SH-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
    assert.match(qr, /\d/, 'the QR string carries a digit');
  }
});

test('collision retry: a forced first candidate that is taken is never handed out', () => {
  // Zero-RNG mints the UPC 040000000006 first; seed it as taken
  // (under ANY type — the identity space is one), then let the
  // RNG vary. The mint must walk to a different, free code.
  const first = mintCandidate('upc', { rng: () => 0 });
  const taken = new Set(codeForms(first));
  let calls = 0;
  const rng = (max) => {
    calls += 1;
    return calls <= 10 ? 0 : calls % max;
  };
  const code = mintAgainstTaken('upc', taken, { rng });
  assert.notEqual(code, first);
  for (const form of codeForms(code)) assert.ok(!taken.has(form));
});

test('SKU ladder: taken slugs step -2, -3 like the save path', () => {
  const taken = new Set([...codeForms('MUG'), ...codeForms('MUG-2')]);
  assert.equal(mintAgainstTaken('sku', taken, { name: 'Mug' }), 'MUG-3');
});

test('GS1 builders: true GTINs from the prefix, honest capacity, strict prefix rule', () => {
  const g12 = buildGtin('123456', 'gtin12', 0);
  assert.equal(g12.length, 12);
  assert.ok(g12.startsWith('123456'));
  assert.ok(isValidUpcA(g12));
  assert.equal(symbologyFor(g12), 'UPC-A');
  const g13 = buildGtin('123456', 'gtin13', 42);
  assert.equal(g13.length, 13);
  assert.ok(g13.startsWith('123456'));
  assert.ok(g13.slice(6, 12).endsWith('000042'.slice(-6)) || g13.includes('000042'));
  assert.ok(isValidEan13(g13));
  assert.equal(symbologyFor(g13), 'EAN-13');
  assert.equal(gs1Capacity('123456', 'gtin12'), 100000);
  assert.equal(gs1Capacity('123456', 'gtin13'), 1000000);
  assert.equal(gs1Capacity('1234567890', 'gtin12'), 10);
  assert.equal(gs1Capacity('1234567890', 'gtin13'), 100);
  assert.ok(validateGs1Prefix(''));
  assert.ok(validateGs1Prefix('123456'));
  assert.ok(validateGs1Prefix('1234567890'));
  for (const bad of ['12345', '12345678901', '12A456', ' 123456', '1234 56']) {
    assert.ok(!validateGs1Prefix(bad), `${JSON.stringify(bad)} refused`);
  }
});

/* ------------------------- HTTP: house codes ------------------------- */

let essentials;
let business;
before(async () => {
  essentials = await ownerWithBusiness('gen-ess@example.com', 'Gen Essentials', { plan: 'essentials' });
  business = await ownerWithBusiness('gen-biz@example.com', 'Gen Business', { plan: 'business' });
});

test('all six house types mint on Essentials, each naming its field', async () => {
  const expected = {
    upc: 'upc', ean: 'upc', sku: 'sku', code128: 'barcode', barcode: 'barcode', qr: 'qr_code',
  };
  for (const [type, field] of Object.entries(expected)) {
    const res = await gen(essentials.cookie, essentials.business.id, { type, name: 'Handmade Basket' });
    assert.equal(res.status, 200, `${type}: ${res.text}`);
    assert.equal(res.json.type, type);
    assert.equal(res.json.field, field);
    assert.equal(res.json.field, CODE_FIELDS[type]);
    assert.ok(res.json.code, `${type} returns a code`);
    assert.equal(res.json.plan, 'essentials');
  }
  const sku = await gen(essentials.cookie, essentials.business.id, { type: 'sku', name: 'Handmade Basket' });
  assert.equal(sku.json.code, 'HANDMADE-BASKET');
});

test('the same minting works on Business; two mints of a kind differ', async () => {
  const a = await gen(business.cookie, business.business.id, { type: 'upc' });
  const b = await gen(business.cookie, business.business.id, { type: 'upc' });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.json.plan, 'business');
  assert.notEqual(a.json.code, b.json.code);
});

test('an unknown type is refused; staff without products.edit and outsiders are refused', async () => {
  const bad = await gen(essentials.cookie, essentials.business.id, { type: 'isbn' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'invalid_code_type');

  const outsider = await registerVerifiedUser('gen-outsider@example.com');
  const out = await gen(outsider.cookie, essentials.business.id, { type: 'upc' });
  assert.equal(out.status, 403);

  const invite = await req(`/api/businesses/${essentials.business.id}/staff`, {
    method: 'POST',
    body: {
      business_id: essentials.business.id,
      member: {
        full_name: 'View Only', email: 'gen-viewonly@example.com',
        role_id: 'preset-sales', role_name: 'Sales clerk',
        permissions: ['products.view'], status: 'invited',
      },
    },
    cookie: essentials.cookie,
  });
  assert.equal(invite.status, 201, invite.text);
  const staff = await registerVerifiedUser('gen-viewonly@example.com');
  const denied = await gen(staff.cookie, essentials.business.id, { type: 'upc' });
  assert.equal(denied.status, 403, 'products.view alone never mints');
});

test('a minted code saves with its product and the scanner lookup resolves it', async () => {
  const cases = [
    ['upc', 'upc'], ['ean', 'upc'], ['sku', 'sku'],
    ['code128', 'barcode'], ['barcode', 'barcode'], ['qr', 'qr_code'],
  ];
  for (const [type, column] of cases) {
    const minted = await gen(essentials.cookie, essentials.business.id, { type, name: `Gen ${type}` });
    assert.equal(minted.status, 200);
    const code = minted.json.code;
    const [created] = await createProducts(essentials.cookie, essentials.business.id, [
      { name: `Gen ${type} product`, [column]: code, status: 'active' },
    ]);
    assert.ok(created?.id, `${type} product created`);
    // The scanner's own door: the Product query with the $or over
    // every code column, exactly what findProductsByCode runs.
    const found = await req('/api/entities/Product/query', {
      method: 'POST',
      body: {
        filter: {
          business_id: essentials.business.id,
          $or: [
            { sku: code }, { upc: code }, { barcode: code },
            { qr_code: code }, { isbn: code },
          ],
        },
      },
      cookie: essentials.cookie,
    });
    assert.equal(found.status, 200, found.text);
    assert.ok(
      found.json.items.some((p) => p.id === created.id),
      `${type} code ${code} resolves to its product`,
    );
  }
});

test('a code held in ANY column blocks the same value everywhere (identity space)', async () => {
  // Seed a product whose BARCODE is the zero-RNG UPC candidate's
  // twin value space: a 12-digit string. The server-side taken set
  // is type-agnostic, so loadTakenCodes must carry it under the
  // forms the scanner can meet.
  await createProducts(essentials.cookie, essentials.business.id, [
    { name: 'Seeded barcode holder', barcode: '040000000006', status: 'active' },
  ]);
  const taken = await loadTakenCodes(pool, essentials.business.id);
  for (const form of codeForms('040000000006')) assert.ok(taken.has(form));
});

/* ------------------------- HTTP: GS1 mode ------------------------- */

const patchBusiness = (cookie, bid, body) => req(`/api/businesses/${bid}`, {
  method: 'PATCH', body, cookie,
});

test('no prefix: the GS1 mint answers gs1_prefix_missing and the state says so', async () => {
  const owner = await ownerWithBusiness('gs1-none@example.com', 'No Prefix', { plan: 'essentials' });
  const res = await gen(owner.cookie, owner.business.id, { type: 'gs1-upc' });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'gs1_prefix_missing');
  const state = await genState(owner.cookie, owner.business.id);
  assert.equal(state.status, 200);
  assert.equal(state.json.gs1.prefixSet, false);
});

test('the Settings PATCH validates the prefix strictly and stores it as typed', async () => {
  const owner = await ownerWithBusiness('gs1-prefix@example.com', 'Prefix Shop', { plan: 'essentials' });
  for (const bad of ['12345', '12345678901', '12A456', '1234 56', 'abcdef']) {
    const refused = await patchBusiness(owner.cookie, owner.business.id, { gs1_prefix: bad });
    assert.equal(refused.status, 400, `${bad} refused whole`);
  }
  const saved = await patchBusiness(owner.cookie, owner.business.id, { gs1_prefix: '123456' });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.gs1_prefix, '123456');
  const listed = await req('/api/businesses', { cookie: owner.cookie });
  assert.equal(listed.json.items[0].gs1_prefix, '123456');
  const cleared = await patchBusiness(owner.cookie, owner.business.id, { gs1_prefix: '' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.gs1_prefix, '', 'blank unsets the prefix');
});

test('GS1 mints run sequentially, are spent forever, and survive product deletes', async () => {
  const owner = await ownerWithBusiness('gs1-mint@example.com', 'Mint Shop', { plan: 'business' });
  await patchBusiness(owner.cookie, owner.business.id, { gs1_prefix: '123456' });

  const first = await gen(owner.cookie, owner.business.id, { type: 'gs1-upc' });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.code, buildGtin('123456', 'gtin12', 0));
  assert.equal(first.json.field, 'upc');
  assert.equal(first.json.kind, 'gtin12');
  assert.ok(isValidUpcA(first.json.code));

  const second = await gen(owner.cookie, owner.business.id, { type: 'gs1-upc' });
  assert.equal(second.json.code, buildGtin('123456', 'gtin12', 1));

  const ean = await gen(owner.cookie, owner.business.id, { type: 'gs1-ean' });
  assert.equal(ean.json.code, buildGtin('123456', 'gtin13', 0), 'the EAN sequence is its own');
  assert.ok(isValidEan13(ean.json.code));

  const state = await genState(owner.cookie, owner.business.id);
  assert.equal(state.json.gs1.prefixSet, true);
  assert.equal(state.json.gs1.remaining.gtin12, 100000 - 2);
  assert.equal(state.json.gs1.remaining.gtin13, 1000000 - 1);

  // Put the first GTIN on a product, then DELETE the product:
  // the number stays spent — the next mint is reference 2.
  const [product] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'Retail jam', upc: first.json.code, status: 'active' },
  ]);
  await pool.query('DELETE FROM products WHERE id = $1', [product.id]);
  const third = await gen(owner.cookie, owner.business.id, { type: 'gs1-upc' });
  assert.equal(third.json.code, buildGtin('123456', 'gtin12', 2), 'a deleted product’s GTIN is never reissued');

  const ledger = await pool.query(
    'SELECT item_reference FROM minted_gtins WHERE business_id = $1 AND kind = $2 ORDER BY item_reference',
    [owner.business.id, 'gtin12'],
  );
  assert.deepEqual(ledger.rows.map((r) => r.item_reference), [0, 1, 2]);

  // And a spent GTIN is inside the house generators' taken space.
  const taken = await loadTakenCodes(pool, owner.business.id);
  for (const form of codeForms(first.json.code)) assert.ok(taken.has(form));
});

test('a catalog product already holding the next GTIN burns that reference', async () => {
  const owner = await ownerWithBusiness('gs1-burn@example.com', 'Burn Shop', { plan: 'essentials' });
  await patchBusiness(owner.cookie, owner.business.id, { gs1_prefix: '654321' });
  await createProducts(owner.cookie, owner.business.id, [
    { name: 'Typed retail code', upc: buildGtin('654321', 'gtin12', 0), status: 'active' },
  ]);
  const minted = await gen(owner.cookie, owner.business.id, { type: 'gs1-upc' });
  assert.equal(minted.status, 200, minted.text);
  assert.equal(minted.json.code, buildGtin('654321', 'gtin12', 1), 'reference 0 was spent, not handed out');
  const ledger = await pool.query(
    'SELECT item_reference FROM minted_gtins WHERE business_id = $1 ORDER BY item_reference',
    [owner.business.id],
  );
  assert.deepEqual(ledger.rows.map((r) => r.item_reference), [0, 1], 'both references are on the ledger');
});

test('the capacity wall: a 10-digit prefix holds 10 UPCs, then gs1_exhausted', async () => {
  const owner = await ownerWithBusiness('gs1-wall@example.com', 'Wall Shop', { plan: 'essentials' });
  await patchBusiness(owner.cookie, owner.business.id, { gs1_prefix: '1234567890' });
  for (let i = 0; i < 10; i += 1) {
    const res = await gen(owner.cookie, owner.business.id, { type: 'gs1-upc' });
    assert.equal(res.status, 200, `mint ${i}: ${res.text}`);
    assert.equal(res.json.code, buildGtin('1234567890', 'gtin12', i));
  }
  const wall = await gen(owner.cookie, owner.business.id, { type: 'gs1-upc' });
  assert.equal(wall.status, 409);
  assert.equal(wall.json.error, 'gs1_exhausted');
  const state = await genState(owner.cookie, owner.business.id);
  assert.equal(state.json.gs1.remaining.gtin12, 0);
  assert.equal(state.json.gs1.remaining.gtin13, 100, 'the EAN space is counted separately and honestly');
});

/* ------------------------- wiring pins ------------------------- */

test('wiring: the form box, the GS1 door, Settings field, plans, training', () => {
  const form = readFileSync('src/components/products/ProductFormDialog.jsx', 'utf8');
  assert.match(form, /data-tour="product-generate"/);
  for (const value of ['upc', 'sku', 'code128', 'barcode', 'ean', 'qr', 'gs1-upc', 'gs1-ean']) {
    assert.ok(form.includes(`value="${value}"`), `dropdown offers ${value}`);
  }
  assert.match(form, /productForm\.generateUpcNote/);
  assert.match(form, /productForm\.generateOverwrite/, 'overwrite asks first');
  assert.match(form, /window\.confirm/);
  assert.match(form, /productForm\.generateGs1Door/);
  assert.match(form, /to="\/settings"/, 'the no-prefix state carries its Settings door');
  assert.match(form, /productForm\.generateGs1Remaining/);
  assert.match(form, /productForm\.generateGs1Exhausted/);

  const details = readFileSync('src/components/business/DetailsCard.jsx', 'utf8');
  assert.match(details, /id="business-gs1-prefix"/);
  assert.match(details, /settings\.details\.gs1Prefix/);
  assert.match(details, /settings\.details\.gs1PrefixHint/);
  const business = readFileSync('src/lib/business.js', 'utf8');
  assert.match(business, /gs1_prefix: values\.gs1_prefix\?\.trim\(\) \|\| ''/);

  const plans = readFileSync('src/lib/plans.js', 'utf8');
  // Five surfaces carried the generator + GS1 lines (Essentials and
  // Business, in PLANS and on the Welcome, plus the comparison row);
  // the Mobile scope rulings (Nov 15, 2026) made Mobile the sixth —
  // the generator and the GS1 prefix option are Mobile-only scope too.
  // The dedupe ruling (Nov 19, 2026) removed the two Business
  // repeats: Business carries both features under its "Everything
  // in Essentials" line, so four surfaces name the lines now —
  // Essentials in PLANS and on the Welcome, Mobile, and the
  // comparison row.
  assert.equal((plans.match(/plansLib\.includes\.codeGenerator/g) || []).length, 4);
  assert.equal((plans.match(/plansLib\.includes\.gs1Codes/g) || []).length, 4);

  const clientCatalog = readFileSync('src/lib/trainingCatalog.js', 'utf8');
  const serverCatalog = readFileSync('server/trainingCatalog.js', 'utf8');
  for (const catalog of [clientCatalog, serverCatalog]) {
    assert.match(catalog, /id: 'products-find-edit'[^}]*steps: 11/);
  }

  const en = readFileSync('src/lib/locales/en.js', 'utf8');
  assert.ok(en.includes(
    "'productForm.generateUpcNote': 'A generated UPC or EAN is an in-store code for your own shelves, labels and scanner. It is not a registered GS1 barcode for other retailers.'",
  ), 'the honesty line, verbatim');
  assert.match(en, /plansLib\.includes\.gs1Codes/);
  assert.match(en, /training\.lessons\.products-find-edit\.step10/);
  assert.match(en, /settings\.details\.gs1Prefix/);

  const migration = readFileSync('migrations/028_gs1_prefix.sql', 'utf8');
  assert.match(migration, /ADD COLUMN gs1_prefix/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS minted_gtins/);
  assert.match(migration, /UNIQUE \(business_id, prefix, kind, item_reference\)/);
});
