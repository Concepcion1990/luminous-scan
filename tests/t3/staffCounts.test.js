/**
 * T3 — Stock counts for all staff (owner ruling, Nov 19, 2026,
 * ~12:23–12:25 PM MST; release 333).
 *
 * The Stock counts page is one SHARED BOARD: every staff member
 * of a business sees it, so nobody double-counts the same count.
 * Staff powers are EXACTLY three — count the stock on the floor,
 * save, and send for review. Creating counts, approving,
 * applying, reopening and cancelling stay with counts.run
 * exactly as before (owner, Manager preset, Stock clerk preset).
 *
 * The split is enforced on the server, in guardUpdate: a member
 * without counts.run may patch a CountSession ONLY with a floor
 * patch — the counted lines alone (while the session is open),
 * or the lines plus the single step open → review. Every other
 * patch, every create and every delete keeps the counts.run
 * door. The client doors follow the same line (nav item carries
 * no perm; Start/Cancel/Delete/Apply render only for runners).
 *
 * Riders pinned here: R2 — CopyGroupPanel's Add copy button
 * follows the effective create right (products.edit or the
 * products.create tick), the door release 318 missed; R3 — the
 * GS1 prefix range is 6–11 digits in the Settings refusal, the
 * apiErrors map key and all 52 locale values (the generator's
 * own validator is pinned in tests/t34/code-generator.test.js).
 * R1 (manifest short_name) is pinned in tests/t6/pwa.test.js.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
  seededLocation,
  createProducts,
} from './helpers.js';
import { PRESET_ROLES } from '../../server/authz.js';

after(close);
beforeEach(() => resetRateLimits());

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const presetPermissions = (roleId) =>
  PRESET_ROLES.find((role) => role.id === roleId)?.permissions || [];

/** Invite a member exactly as the member dialog saves them (the
 * full role permission set), activate their account, and give
 * them a full-week schedule so the shift window lets their
 * session work (owner ruling, Nov 19, 2026). */
async function actor(owner, { email, roleId, roleName }) {
  const invite = await req('/api/entities/StaffMember', {
    method: 'POST',
    cookie: owner['cookie'],
    body: {
      business_id: owner.business.id,
      full_name: roleName,
      email,
      role_id: roleId,
      role_name: roleName,
      permissions: [...presetPermissions(roleId)],
    },
  });
  assert.equal(invite.status, 201, invite.text);
  const account = await registerVerifiedUser(email);
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [
    owner.business.id,
    account.user.id,
  ]);
  const row = (
    await pool.query('SELECT id FROM staff_members WHERE business_id = $1 AND email = $2', [
      owner.business.id,
      email,
    ])
  ).rows[0];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, '00:00', '23:59')`,
      [crypto.randomUUID(), owner.business.id, row.id, weekday],
    );
  }
  return { ...account, memberId: row.id };
}

const patchCount = (cookie, id, body) =>
  req(`/api/entities/CountSession/${id}`, { method: 'PATCH', cookie, body });
const deleteCount = (cookie, id) =>
  req(`/api/entities/CountSession/${id}`, { method: 'DELETE', cookie });
const createCount = (cookie, businessId, body = {}) =>
  req('/api/entities/CountSession', {
    method: 'POST',
    cookie,
    body: { business_id: businessId, number: 'CNT-TEST-1', status: 'open', lines: [], ...body },
  });

let boardSeq = 0;
async function board() {
  boardSeq += 1;
  const tag = `b${boardSeq}`;
  const owner = await ownerWithBusiness(`counts-board-${tag}@example.com`, 'Counts Board', { plan: 'essentials' });
  const location = await seededLocation(owner['cookie'], owner.business.id);
  const [product] = await createProducts(owner['cookie'], owner.business.id, [
    { name: 'Board Widget', sku: 'BW-1', price: 3 },
  ]);
  const clerk = await actor(owner, {
    email: `counts-clerk-${tag}@example.com`, roleId: 'preset-sales', roleName: 'Sales clerk',
  });
  const viewer = await actor(owner, {
    email: `counts-viewer-${tag}@example.com`, roleId: 'preset-viewer', roleName: 'Viewer',
  });
  const runner = await actor(owner, {
    email: `counts-runner-${tag}@example.com`, roleId: 'preset-stock', roleName: 'Stock clerk',
  });
  const created = await createCount(owner['cookie'], owner.business.id, {
    location_id: location.id,
    location_name: location.name,
    lines: [{ product_id: product.id, product_name: 'Board Widget', sku: 'BW-1', expected: 5, counted: null }],
  });
  assert.equal(created.status, 201, created.text);
  return { owner, location, product, clerk, viewer, runner, session: created.json };
}

test('the board is shared: a clerk and a viewer can read the count list', async () => {
  const { owner, clerk, viewer, session } = await board();
  for (const who of [clerk, viewer]) {
    const listed = await req('/api/entities/CountSession/query', {
      method: 'POST',
      cookie: who['cookie'],
      body: { filter: { business_id: owner.business.id } },
    });
    assert.equal(listed.status, 200, listed.text);
    assert.ok(
      (listed.json.items || []).some((row) => row.id === session.id),
      'the shared board shows the count to every staff member',
    );
  }
});

test('floor powers: any staff member can count, save and send for review', async () => {
  const { product, clerk, viewer, session } = await board();
  const counted = [{ product_id: product.id, product_name: 'Board Widget', sku: 'BW-1', expected: 5, counted: 4 }];
  // Save (lines only, session open) — the clerk.
  const saved = await patchCount(clerk['cookie'], session.id, { lines: counted });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.lines[0].counted, 4);
  assert.equal(saved.json.status, 'open');
  // Count + save — the viewer too: EVERY staff member holds the floor powers.
  const savedByViewer = await patchCount(viewer['cookie'], session.id, { lines: counted });
  assert.equal(savedByViewer.status, 200, savedByViewer.text);
  // Send for review (lines + the one step open → review).
  const sent = await patchCount(clerk['cookie'], session.id, { lines: counted, status: 'review' });
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.json.status, 'review');
});

test('the line holds: a non-runner cannot create, apply, reopen, cancel, edit fields or delete', async () => {
  const { owner, product, clerk, session } = await board();
  const counted = [{ product_id: product.id, product_name: 'Board Widget', sku: 'BW-1', expected: 5, counted: 5 }];

  // Create stays with counts.run.
  const created = await createCount(clerk['cookie'], owner.business.id);
  assert.equal(created.status, 403, created.text);

  // Saving against a session that already sits in review is not a floor act.
  const sent = await patchCount(owner['cookie'], session.id, { lines: counted, status: 'review' });
  assert.equal(sent.status, 200, sent.text);
  const lateSave = await patchCount(clerk['cookie'], session.id, { lines: counted });
  assert.equal(lateSave.status, 403, lateSave.text);

  // Reopen (review → open) is a runner's act.
  const reopened = await patchCount(clerk['cookie'], session.id, { lines: counted, status: 'open' });
  assert.equal(reopened.status, 403, reopened.text);

  // Apply — directly, or smuggled in one patch with the lines.
  const applied = await patchCount(clerk['cookie'], session.id, {
    status: 'applied', applied_at: new Date().toISOString(), applied_by: 'Sneaky',
  });
  assert.equal(applied.status, 403, applied.text);
  const smuggled = await patchCount(clerk['cookie'], session.id, { lines: counted, status: 'applied' });
  assert.equal(smuggled.status, 403, smuggled.text);

  // Cancel, and any non-floor field (notes), and a non-array lines value.
  const cancelled = await patchCount(clerk['cookie'], session.id, { status: 'cancelled' });
  assert.equal(cancelled.status, 403, cancelled.text);
  const noted = await patchCount(clerk['cookie'], session.id, { notes: 'mine now' });
  assert.equal(noted.status, 403, noted.text);
  const badLines = await patchCount(clerk['cookie'], session.id, { lines: 'four' });
  assert.equal(badLines.status, 403, badLines.text);

  // Delete stays with counts.run.
  const deleted = await deleteCount(clerk['cookie'], session.id);
  assert.equal(deleted.status, 403, deleted.text);

  // And the session itself is untouched by all of it: still in review.
  const after = await req(`/api/entities/CountSession/${session.id}`, { cookie: owner['cookie'] });
  assert.equal(after.json.status, 'review');
});

test('counts.run holders keep the whole lifecycle, exactly as before', async () => {
  const { owner, runner, session } = await board();
  // The stock clerk (counts.run by preset) creates, applies, cancels, deletes.
  const own = await createCount(runner['cookie'], owner.business.id, { number: 'CNT-TEST-2' });
  assert.equal(own.status, 201, own.text);
  const toReview = await patchCount(runner['cookie'], own.json.id, { lines: [], status: 'review' });
  assert.equal(toReview.status, 200, toReview.text);
  const applied = await patchCount(runner['cookie'], own.json.id, {
    lines: [], status: 'applied', applied_at: new Date().toISOString(), applied_by: 'Stock clerk',
  });
  assert.equal(applied.status, 200, applied.text);
  assert.equal(applied.json.status, 'applied');
  const cancelled = await patchCount(runner['cookie'], session.id, { status: 'cancelled' });
  assert.equal(cancelled.status, 200, cancelled.text);
  const deleted = await deleteCount(runner['cookie'], own.json.id);
  assert.equal(deleted.status, 200, deleted.text);
  // The owner's own flow is unchanged.
  const ownerMade = await createCount(owner['cookie'], owner.business.id, { number: 'CNT-TEST-3' });
  assert.equal(ownerMade.status, 201, ownerMade.text);
});

/* ------------------------- client wiring pins ------------------------- */

test('wiring: the counts door and buttons follow the split', () => {
  const nav = read('src/components/layout/navGroups.js');
  const countsLine = nav.split('\n').find((line) => line.includes("to: '/counts'"));
  assert.ok(countsLine, 'the Stock counts nav item exists');
  assert.ok(!countsLine.includes('perm:'), 'the nav door carries no perm — every staff member sees the board');

  const page = read('src/pages/Counts.jsx');
  assert.match(page, /can\('counts\.run'\)/, 'the page reads the counts.run right');
  assert.match(page, /canRunCounts && \([\s\S]{0,120}data-tour="count-start"/, 'Start a count renders only for runners');
  assert.match(page, /canManage=\{canRunCounts\}/, 'the card receives the manage split');
  assert.match(page, /canRun=\{canRunCounts\}/, 'the sheet receives the run split');

  const card = read('src/components/counts/CountCard.jsx');
  assert.match(card, /canManage && \['open', 'review'\]/, 'Cancel renders only for runners');
  assert.match(card, /canManage && session\.status !== 'applied'/, 'Delete renders only for runners');

  const sheet = read('src/components/counts/CountSheet.jsx');
  assert.match(sheet, /floorLocked = locked \|\| \(!canRun && session\.status !== 'open'\)/, 'a non-runner works only an open count');
  assert.match(sheet, /session\.status === 'review' && canRun/, 'Apply / Keep counting render only for runners');
});

test('wiring R2: Add copy follows the effective create right', () => {
  const panel = read('src/components/products/CopyGroupPanel.jsx');
  assert.match(panel, /canAddCopy && \([\s\S]{0,160}products\.addCopy/, 'the Add copy button renders only with the create right');
  const products = read('src/pages/Products.jsx');
  assert.match(products, /canAddCopy=\{canCreateProducts\}/, 'the panel receives the same create right as Duplicate');
});

test('R3: the GS1 range reads 6 to 11 in the refusal, the map and all 52 locales', () => {
  const sentence = 'Enter your GS1 company prefix — 6 to 11 digits, exactly as GS1 issued it — or leave it blank.';
  assert.ok(read('server/authRoutes.js').includes(sentence), 'the Settings refusal carries the new range');
  assert.ok(
    read('src/lib/apiErrors.js').includes(`"${sentence}": "apiErrors.invalidValue.enterGS1CompanyPrefix"`),
    'the apiErrors map keys the new sentence to its locale key',
  );
  const localeFiles = readdirSync(new URL('../../src/lib/locales/', import.meta.url))
    .filter((name) => name.endsWith('.js'));
  assert.equal(localeFiles.length, 52, 'all 52 locale files are present');
  for (const name of localeFiles) {
    const src = read(`src/lib/locales/${name}`);
    const at = src.indexOf('apiErrors.invalidValue.enterGS1CompanyPrefix');
    assert.ok(at >= 0, `${name} carries the GS1 refusal key`);
    const value = src.slice(at, at + 240);
    assert.ok(/6\D{0,16}11(?!\d)/.test(value), `${name} states the 6–11 range`);
    assert.ok(!/6\D{0,16}10(?!\d)/.test(value), `${name} no longer states the 6–10 range`);
  }
  // The English value is the sentence itself, word for word.
  assert.ok(
    read('src/lib/locales/en.js').includes(`"apiErrors.invalidValue.enterGS1CompanyPrefix": "${sentence}"`),
    'the English value equals the server sentence',
  );
});
