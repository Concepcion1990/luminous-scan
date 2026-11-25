/**
 * T3 — The owner's business policies + terms (owner rulings,
 * Nov 19, 2026, ~16:34–16:38).
 *
 * In Settings the OWNER writes two per-business documents —
 * Store Policies and Terms & Conditions — each as typed text
 * OR an uploaded file, either or. The team reads them (shown
 * once in the first-start welcome; living read-only in every
 * member's Settings). Writing is the owner's alone, inherently:
 * no role and no tick carries it. Nothing an owner writes ever
 * appears in another business.
 *
 * These tests pin the API contract: member read, owner write,
 * non-owner write refused with the facts-only sentence, the
 * either/or replacement, the file rules, and — above all —
 * business isolation for both typed text and uploaded files.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  pool,
  req,
  reqRaw,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

const OWNER_ONLY_MESSAGE = "Only the owner can change this store's policies and terms.";
const FILE_INVALID_MESSAGE = 'Send a PDF, text, Word or OpenDocument file under 25 MB.';
const TEXT_TOO_LONG_MESSAGE =
  'That document is too long to type here. You can upload it as a file instead.';

/** The session header for a test account, in the helpers' shape. */
const as = (who) => ({ cookie: who.cookie });

/** Invite a member with a preset role, activate their account,
 * and give them a full-week schedule so the shift window lets
 * their session work (the release-314 window brackets sign-in). */
async function actor(owner, { email, roleId, roleName }) {
  const invite = await req('/api/entities/StaffMember', {
    method: 'POST',
    ...as(owner),
    body: {
      business_id: owner.business.id,
      full_name: roleName,
      email,
      role_id: roleId,
      role_name: roleName,
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

const pdfDataUrl = (text) =>
  `data:application/pdf;base64,${Buffer.from(text).toString('base64')}`;

test('an empty business returns both documents empty, to owner and member alike', async () => {
  const owner = await ownerWithBusiness('pol-empty-owner@example.com');
  const member = await actor(owner, {
    email: 'pol-empty-member@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });
  for (const who of [owner, member]) {
    const res = await req(`/api/businesses/${owner.business.id}/policies`, { ...as(who) });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json, {
      policies: { kind: 'empty' },
      terms: { kind: 'empty' },
    });
  }
});

test('owner types both documents; a member reads them exactly as written', async () => {
  const owner = await ownerWithBusiness('pol-type-owner@example.com');
  const member = await actor(owner, {
    email: 'pol-type-member@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  const policiesText = 'No phones on the floor.\nReturns need a receipt.';
  const put = await req(`/api/businesses/${owner.business.id}/policies/policies/text`, {
    method: 'PUT',
    ...as(owner),
    body: { text: policiesText },
  });
  assert.equal(put.status, 200, put.text);
  assert.deepEqual(put.json.policies, { kind: 'text', text: policiesText });
  const putTerms = await req(`/api/businesses/${owner.business.id}/policies/terms/text`, {
    method: 'PUT',
    ...as(owner),
    body: { text: 'All sales final after 30 days.' },
  });
  assert.equal(putTerms.status, 200, putTerms.text);

  const read = await req(`/api/businesses/${owner.business.id}/policies`, { ...as(member) });
  assert.equal(read.status, 200, read.text);
  assert.deepEqual(read.json.policies, { kind: 'text', text: policiesText });
  assert.deepEqual(read.json.terms, { kind: 'text', text: 'All sales final after 30 days.' });

  // The owner's later edit is what the member sees next.
  await req(`/api/businesses/${owner.business.id}/policies/policies/text`, {
    method: 'PUT',
    ...as(owner),
    body: { text: 'Updated house rules.' },
  });
  const reread = await req(`/api/businesses/${owner.business.id}/policies`, { ...as(member) });
  assert.deepEqual(reread.json.policies, { kind: 'text', text: 'Updated house rules.' });

  // Removing the text returns the document to empty.
  const cleared = await req(`/api/businesses/${owner.business.id}/policies/policies/text`, {
    method: 'DELETE',
    ...as(owner),
  });
  assert.equal(cleared.status, 200, cleared.text);
  assert.deepEqual(cleared.json.policies, { kind: 'empty' });
});

test('non-owner writes are refused with the facts-only sentence; reads still work', async () => {
  const owner = await ownerWithBusiness('pol-gate-owner@example.com');
  const member = await actor(owner, {
    email: 'pol-gate-member@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  const attempts = [
    ['PUT', `/api/businesses/${owner.business.id}/policies/policies/text`, { text: 'sneaky' }],
    ['DELETE', `/api/businesses/${owner.business.id}/policies/policies/text`, undefined],
    ['POST', `/api/businesses/${owner.business.id}/policies/terms/file`, { dataUrl: pdfDataUrl('%PDF-fake'), filename: 'terms.pdf' }],
    ['DELETE', `/api/businesses/${owner.business.id}/policies/terms/file`, undefined],
  ];
  for (const [method, path, body] of attempts) {
    const res = await req(path, { method, ...as(member), body });
    assert.equal(res.status, 403, `${method} ${path}: ${res.text}`);
    assert.equal(res.json.error, 'business_policies_owner_only');
    assert.equal(res.json.message, OWNER_ONLY_MESSAGE);
  }
  const read = await req(`/api/businesses/${owner.business.id}/policies`, { ...as(member) });
  assert.equal(read.status, 200, read.text);
  assert.deepEqual(read.json.policies, { kind: 'empty' });
});

test('a non-member cannot read the documents or the file at all', async () => {
  const owner = await ownerWithBusiness('pol-outsider-owner@example.com');
  await req(`/api/businesses/${owner.business.id}/policies/policies/text`, {
    method: 'PUT',
    ...as(owner),
    body: { text: 'Members only.' },
  });
  const outsider = await registerVerifiedUser('pol-outsider@example.com');
  const read = await req(`/api/businesses/${owner.business.id}/policies`, { ...as(outsider) });
  assert.equal(read.status, 403, read.text);
  const file = await reqRaw(`/api/businesses/${owner.business.id}/policies/policies/file`, {
    ...as(outsider),
  });
  assert.equal(file.status, 403);
});

test('file upload: state, member download bytes, replace, remove', async () => {
  const owner = await ownerWithBusiness('pol-file-owner@example.com');
  const member = await actor(owner, {
    email: 'pol-file-member@example.com',
    roleId: 'preset-stock',
    roleName: 'Stock clerk',
  });
  const body = '%PDF-1.4 fake terms document bytes';
  const up = await req(`/api/businesses/${owner.business.id}/policies/terms/file`, {
    method: 'POST',
    ...as(owner),
    body: { dataUrl: pdfDataUrl(body), filename: 'my-terms.pdf' },
  });
  assert.equal(up.status, 201, up.text);
  assert.equal(up.json.terms.kind, 'file');
  assert.equal(up.json.terms.filename, 'my-terms.pdf');
  assert.equal(up.json.terms.content_type, 'application/pdf');
  assert.equal(up.json.terms.size_bytes, Buffer.byteLength(body));

  const download = await reqRaw(`/api/businesses/${owner.business.id}/policies/terms/file`, {
    ...as(member),
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.equal(download.text, body);

  // Replacing the file replaces the document.
  const body2 = '%PDF-1.4 second version';
  const up2 = await req(`/api/businesses/${owner.business.id}/policies/terms/file`, {
    method: 'POST',
    ...as(owner),
    body: { dataUrl: pdfDataUrl(body2), filename: 'terms-v2.pdf' },
  });
  assert.equal(up2.status, 201, up2.text);
  assert.equal(up2.json.terms.filename, 'terms-v2.pdf');
  const download2 = await reqRaw(`/api/businesses/${owner.business.id}/policies/terms/file`, {
    ...as(owner),
  });
  assert.equal(download2.text, body2);

  // Removing returns the document to empty, and the file door 404s.
  const removed = await req(`/api/businesses/${owner.business.id}/policies/terms/file`, {
    method: 'DELETE',
    ...as(owner),
  });
  assert.equal(removed.status, 200, removed.text);
  assert.deepEqual(removed.json.terms, { kind: 'empty' });
  const gone = await reqRaw(`/api/businesses/${owner.business.id}/policies/terms/file`, {
    ...as(owner),
  });
  assert.equal(gone.status, 404);
});

test('either or: saving text replaces the file; uploading a file replaces the text', async () => {
  const owner = await ownerWithBusiness('pol-either-owner@example.com');
  await req(`/api/businesses/${owner.business.id}/policies/policies/file`, {
    method: 'POST',
    ...as(owner),
    body: { dataUrl: pdfDataUrl('%PDF-first'), filename: 'first.pdf' },
  });
  const toText = await req(`/api/businesses/${owner.business.id}/policies/policies/text`, {
    method: 'PUT',
    ...as(owner),
    body: { text: 'Now typed instead.' },
  });
  assert.deepEqual(toText.json.policies, { kind: 'text', text: 'Now typed instead.' });
  const fileGone = await reqRaw(`/api/businesses/${owner.business.id}/policies/policies/file`, {
    ...as(owner),
  });
  assert.equal(fileGone.status, 404);

  const toFile = await req(`/api/businesses/${owner.business.id}/policies/policies/file`, {
    method: 'POST',
    ...as(owner),
    body: { dataUrl: pdfDataUrl('%PDF-second'), filename: 'second.pdf' },
  });
  assert.equal(toFile.json.policies.kind, 'file');
  const row = (
    await pool.query('SELECT store_policies_text FROM businesses WHERE id = $1', [
      owner.business.id,
    ])
  ).rows[0];
  assert.equal(row.store_policies_text, '');
});

test('file rules: wrong type and oversize are refused with the plain sentence', async () => {
  const owner = await ownerWithBusiness('pol-rules-owner@example.com');
  const exe = await req(`/api/businesses/${owner.business.id}/policies/policies/file`, {
    method: 'POST',
    ...as(owner),
    body: {
      dataUrl: `data:application/x-msdownload;base64,${Buffer.from('MZ').toString('base64')}`,
      filename: 'evil.exe',
    },
  });
  assert.equal(exe.status, 400, exe.text);
  assert.equal(exe.json.error, 'policy_file_invalid');
  assert.equal(exe.json.message, FILE_INVALID_MESSAGE);

  const big = Buffer.alloc(25 * 1024 * 1024 + 1, 0x41);
  const oversize = await req(`/api/businesses/${owner.business.id}/policies/policies/file`, {
    method: 'POST',
    ...as(owner),
    body: {
      dataUrl: `data:text/plain;base64,${big.toString('base64')}`,
      filename: 'big.txt',
    },
  });
  assert.equal(oversize.status, 400, oversize.text);
  assert.equal(oversize.json.error, 'policy_file_invalid');

  const notDataUrl = await req(`/api/businesses/${owner.business.id}/policies/policies/file`, {
    method: 'POST',
    ...as(owner),
    body: { dataUrl: 'https://example.com/terms.pdf', filename: 'terms.pdf' },
  });
  assert.equal(notDataUrl.status, 400, notDataUrl.text);
  assert.equal(notDataUrl.json.error, 'policy_file_invalid');
});

test('typed text over the cap is refused, naming the file door', async () => {
  const owner = await ownerWithBusiness('pol-long-owner@example.com');
  const res = await req(`/api/businesses/${owner.business.id}/policies/policies/text`, {
    method: 'PUT',
    ...as(owner),
    body: { text: 'x'.repeat(100_001) },
  });
  assert.equal(res.status, 400, res.text);
  assert.equal(res.json.error, 'policy_text_too_long');
  assert.equal(res.json.message, TEXT_TOO_LONG_MESSAGE);
  // Exactly at the cap is a document.
  const ok = await req(`/api/businesses/${owner.business.id}/policies/policies/text`, {
    method: 'PUT',
    ...as(owner),
    body: { text: 'x'.repeat(100_000) },
  });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.policies.kind, 'text');
});

test('ISOLATION: business A documents never appear in business B — text or file', async () => {
  const a = await ownerWithBusiness('pol-iso-a@example.com', 'Shop A');
  const b = await ownerWithBusiness('pol-iso-b@example.com', 'Shop B');
  await req(`/api/businesses/${a.business.id}/policies/policies/text`, {
    method: 'PUT',
    ...as(a),
    body: { text: 'Shop A secret house rules.' },
  });
  await req(`/api/businesses/${a.business.id}/policies/terms/file`, {
    method: 'POST',
    ...as(a),
    body: { dataUrl: pdfDataUrl('%PDF-shop-a-terms'), filename: 'a-terms.pdf' },
  });

  const bRead = await req(`/api/businesses/${b.business.id}/policies`, { ...as(b) });
  assert.equal(bRead.status, 200, bRead.text);
  assert.deepEqual(bRead.json, {
    policies: { kind: 'empty' },
    terms: { kind: 'empty' },
  });
  // B's owner asking under A's id is a non-member: closed door.
  const cross = await req(`/api/businesses/${a.business.id}/policies`, { ...as(b) });
  assert.equal(cross.status, 403, cross.text);
  const crossFile = await reqRaw(`/api/businesses/${a.business.id}/policies/terms/file`, {
    ...as(b),
  });
  assert.equal(crossFile.status, 403);

  // A member of A reading under B's id is likewise a non-member.
  const memberA = await actor(a, {
    email: 'pol-iso-member@example.com',
    roleId: 'preset-viewer',
    roleName: 'Viewer',
  });
  const memberCross = await req(`/api/businesses/${b.business.id}/policies`, { ...as(memberA) });
  assert.equal(memberCross.status, 403, memberCross.text);
  const memberRead = await req(`/api/businesses/${a.business.id}/policies`, { ...as(memberA) });
  assert.equal(memberRead.status, 200, memberRead.text);
  assert.deepEqual(memberRead.json.policies, {
    kind: 'text',
    text: 'Shop A secret house rules.',
  });
  assert.equal(memberRead.json.terms.kind, 'file');
});

test('an unknown document kind is a 404, never a fifth document', async () => {
  const owner = await ownerWithBusiness('pol-kind-owner@example.com');
  const res = await req(`/api/businesses/${owner.business.id}/policies/handbook/text`, {
    method: 'PUT',
    ...as(owner),
    body: { text: 'nope' },
  });
  assert.equal(res.status, 404, res.text);
});

test('source pins: migration, routes, wipe, plans line, settings + welcome wiring, training', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

  const migration = read('../../migrations/032_business_policies.sql');
  assert.match(migration, /store_policies_text/);
  assert.match(migration, /store_terms_text/);
  assert.match(migration, /business_policy_files/);

  const routes = read('../../server/businessPolicyRoutes.js');
  assert.match(routes, /business_policies_owner_only/);
  assert.match(routes, /POLICY_OWNER_ONLY_MESSAGE/);

  const app = read('../../server/app.js');
  assert.match(app, /createBusinessPolicyRouter/);

  const billing = read('../../server/billing.js');
  assert.match(billing, /DELETE FROM business_policy_files WHERE business_id = \$1/);

  const plans = read('../../src/lib/plans.js');
  const lineCount = (plans.match(/plansLib\.includes\.storePolicies/g) || []).length;
  assert.equal(lineCount, 3, 'plans line: Essentials list + Welcome list + comparison row');

  const bossSettings = read('../../src/pages/Settings.jsx');
  assert.match(bossSettings, /BusinessPoliciesCard/);
  const personal = read('../../src/components/business/PersonalSettings.jsx');
  assert.match(personal, /BusinessPoliciesCard/);
  assert.match(personal, /PlatformPoliciesCard/);

  const welcome = read('../../src/pages/StaffWelcome.jsx');
  assert.match(welcome, /PolicyDocumentView/);

  const serverCatalog = read('../../server/trainingCatalog.js');
  const clientCatalog = read('../../src/lib/trainingCatalog.js');
  for (const catalog of [serverCatalog, clientCatalog]) {
    assert.match(catalog, /owner-store-policies/);
  }
});
