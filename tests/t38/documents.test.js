/**
 * T38 — staff documents (the staff documents build, Nov 21,
 * 2026). Per-member paperwork on the Staff side: the owner
 * uploads a person's documents; every upload is its own kept
 * version, never replacing the ones before it. The door is a
 * NEW owner-grant tick, staff.documents — off by default, in
 * no preset, owner by birth, grantable to managers
 * deliberately. The server enforces it on EVERY read and
 * write: 403 for plain staff, for unticked managers, and for
 * the document's own subject. A ticked manager reaches
 * staff-level members' files only; removing a version is the
 * owner's act alone. The tick brings its training (334
 * pattern): the manager lesson is assigned on grant and
 * mirrors away on revoke.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
  setEntitlement,
} from './helpers.js';
import { TRAINING_LESSONS, MODULE_BY_PERMISSION } from '../../server/trainingCatalog.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { LESSON_REQUIREMENTS, scopedLessonIds } from '../../server/trainingScope.js';
import {
  ALL_PERMISSIONS,
  DOCUMENTS_GRANTS,
  isDocumentsGrant,
  isMemberGrant,
  roleById,
} from '../../src/lib/staff.js';

after(close);

const DOCS = (bid) => `/api/businesses/${bid}/staff-documents`;
const WF = (bid) => `/api/businesses/${bid}/workforce`;
const ENT = '/api/entities/StaffMember';
const txt = (text) => `data:text/plain;base64,${Buffer.from(text).toString('base64')}`;

async function setup(prefix) {
  resetRateLimits();
  const owner = await ownerWithBusiness(`${prefix}-owner@example.com`);
  await setEntitlement(owner.business.id, { plan: 'essentials', status: 'active' });
  return owner;
}

/** Add a member the t37 way: the staff row goes in directly
 * (identity links by email), the account registers, and the
 * business becomes its active one. */
async function addMember(owner, email, { manager = false, permissions = [] } = {}) {
  const id = crypto.randomUUID();
  const fullName = email.split('@')[0];
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, $7, 'active', $8)`,
    [
      id,
      owner.business.id,
      fullName,
      email,
      manager ? 'preset-manager' : 'preset-sales',
      manager ? 'Manager' : 'Sales clerk',
      JSON.stringify(permissions),
      owner.user.id,
    ],
  );
  const account = await registerVerifiedUser(email);
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [owner.business.id, account.user.id]);
  // An all-week shift so the member's own sessions pass the
  // sign-in bracket (the t37 harness pattern) — the documents
  // doors are what these tests judge, not the bracket.
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, '00:00', '23:59')
       ON CONFLICT (business_id, staff_member_id, weekday) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
      [crypto.randomUUID(), owner.business.id, id, weekday],
    );
  }
  return { member: { id, full_name: fullName }, cookie: account.cookie, userId: account.user.id };
}

async function storedMember(id) {
  const { rows } = await pool.query('SELECT * FROM staff_members WHERE id = $1', [id]);
  return rows[0];
}

/** Set (or clear) the documents tick the way the member dialog saves it. */
async function setDocumentsTick(owner, memberId, on) {
  const row = await storedMember(memberId);
  const stored = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions;
  const perms = (stored || []).filter((key) => key !== 'staff.documents');
  if (on) perms.push('staff.documents');
  const res = await req(`${ENT}/${memberId}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { permissions: perms },
  });
  assert.equal(res.status, 200, res.text);
  return res.json;
}

// ---- (a) versions are kept ---------------------------------------------------

test('uploads are kept versions: v2 never replaces v1, both stay listed and openable', async () => {
  const owner = await setup('docs-keep');
  const sam = await addMember(owner, 'docs-keep-sam@example.com');
  const bid = owner.business.id;

  const v1 = await req(`${DOCS(bid)}/${sam.member.id}`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { title: 'W-4', filename: 'w4.txt', dataUrl: txt('W4-VERSION-ONE') },
  });
  assert.equal(v1.status, 201, v1.text);
  assert.equal(v1.json.documents.length, 1);
  assert.equal(v1.json.documents[0].title, 'W-4');
  assert.ok(v1.json.documents[0].uploaded_by_name, 'the uploader is named');
  const v1Id = v1.json.documents[0].id;

  const v2 = await req(`${DOCS(bid)}/${sam.member.id}`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'w4-new.txt', dataUrl: txt('W4-VERSION-TWO') },
  });
  assert.equal(v2.status, 201, v2.text);
  assert.equal(v2.json.documents.length, 2, 'the second upload ADDS a version — the first is kept');
  assert.equal(v2.json.documents[0].filename, 'w4-new.txt', 'newest first');
  assert.equal(v2.json.documents[0].title, 'w4-new.txt', 'no title given — the file name is the title');
  assert.equal(v2.json.documents[1].id, v1Id, 'v1 is still listed');
  const v2Id = v2.json.documents[0].id;

  // Both open, each with its own bytes.
  const f1 = await req(`${DOCS(bid)}/${sam.member.id}/${v1Id}/file`, { cookie: owner.cookie });
  assert.equal(f1.status, 200);
  assert.equal(f1.text, 'W4-VERSION-ONE', 'v1 still opens with its own bytes');
  const f2 = await req(`${DOCS(bid)}/${sam.member.id}/${v2Id}/file`, { cookie: owner.cookie });
  assert.equal(f2.status, 200);
  assert.equal(f2.text, 'W4-VERSION-TWO');

  // The member list carries counts, names — and no emails.
  const members = await req(`${DOCS(bid)}/members`, { cookie: owner.cookie });
  assert.equal(members.status, 200);
  const samRow = members.json.members.find((m) => m.id === sam.member.id);
  assert.equal(samRow.doc_count, 2);
  assert.ok(!('email' in samRow), 'names, never emails');
});

// ---- (b) the door: the tick or nothing ----------------------------------------

test('without the tick every door is 403 — unticked manager, plain staff, and the subject', async () => {
  const owner = await setup('docs-door');
  const bid = owner.business.id;
  const sam = await addMember(owner, 'docs-door-sam@example.com');
  const tina = await addMember(owner, 'docs-door-tina@example.com', { manager: true });
  const up = await req(`${DOCS(bid)}/${sam.member.id}`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { title: 'ID copy', filename: 'id.txt', dataUrl: txt('SECRET-ID') },
  });
  const docId = up.json.documents[0].id;

  for (const [who, cookie] of [
    ['unticked manager', tina.cookie],
    ['plain staff', sam.cookie],
    ['the subject themself', sam.cookie],
  ]) {
    const members = await req(`${DOCS(bid)}/members`, { cookie });
    assert.equal(members.status, 403, `${who}: member list`);
    assert.equal(members.json.error, 'staff_documents_not_granted');
    assert.equal(
      members.json.message,
      'Only the owner, or a manager the owner has trusted with staff documents, can do that.',
    );
    const list = await req(`${DOCS(bid)}/${sam.member.id}`, { cookie });
    assert.equal(list.status, 403, `${who}: version list`);
    const upload = await req(`${DOCS(bid)}/${sam.member.id}`, {
      method: 'POST',
      cookie,
      body: { filename: 'x.txt', dataUrl: txt('X') },
    });
    assert.equal(upload.status, 403, `${who}: upload`);
    const file = await req(`${DOCS(bid)}/${sam.member.id}/${docId}/file`, { cookie });
    assert.equal(file.status, 403, `${who}: file bytes`);
    const del = await req(`${DOCS(bid)}/${sam.member.id}/${docId}`, { method: 'DELETE', cookie });
    assert.equal(del.status, 403, `${who}: remove`);
  }

  // Signed out: 401, never a peek.
  const anon = await req(`${DOCS(bid)}/members`, {});
  assert.equal(anon.status, 401);
});

test('the tick on a staff row is inert — the door is manager-level only', async () => {
  const owner = await setup('docs-inert');
  const bid = owner.business.id;
  const sam = await addMember(owner, 'docs-inert-sam@example.com');
  const pat = await addMember(owner, 'docs-inert-pat@example.com', { permissions: ['staff.documents'] });
  const list = await req(`${DOCS(bid)}/${sam.member.id}`, { cookie: pat.cookie });
  assert.equal(list.status, 403, 'a staff member holding the stored tick still has no door');
  const ctx = await req(`${WF(bid)}/context`, { cookie: pat.cookie });
  assert.equal(ctx.json.documents_admin, false);
});

// ---- (c) the ticked manager ----------------------------------------------------

test('a ticked manager works staff files, never manager files, and never removes', async () => {
  const owner = await setup('docs-mgr');
  const bid = owner.business.id;
  const sam = await addMember(owner, 'docs-mgr-sam@example.com');
  const tina = await addMember(owner, 'docs-mgr-tina@example.com', { manager: true });
  const pete = await addMember(owner, 'docs-mgr-pete@example.com', { manager: true });

  const up = await req(`${DOCS(bid)}/${sam.member.id}`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { title: 'W-4', filename: 'w4.txt', dataUrl: txt('SAM-W4') },
  });
  const samDoc = up.json.documents[0].id;
  const mgrUp = await req(`${DOCS(bid)}/${pete.member.id}`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { title: 'Pete W-4', filename: 'pete.txt', dataUrl: txt('PETE-W4') },
  });
  const peteDoc = mgrUp.json.documents[0].id;

  await setDocumentsTick(owner, tina.member.id, true);

  // Her member list holds staff-level members only — Pete (a
  // manager) does not appear at all.
  const members = await req(`${DOCS(bid)}/members`, { cookie: tina.cookie });
  assert.equal(members.status, 200, members.text);
  const ids = members.json.members.map((m) => m.id);
  assert.ok(ids.includes(sam.member.id));
  assert.ok(!ids.includes(pete.member.id), 'manager-level files are the owner’s alone');
  assert.ok(!ids.includes(tina.member.id));

  // She can read, open, and add to a staff member's file…
  const list = await req(`${DOCS(bid)}/${sam.member.id}`, { cookie: tina.cookie });
  assert.equal(list.status, 200);
  assert.equal(list.json.documents.length, 1);
  const add = await req(`${DOCS(bid)}/${sam.member.id}`, {
    method: 'POST',
    cookie: tina.cookie,
    body: { title: 'Application', filename: 'app.txt', dataUrl: txt('SAM-APP') },
  });
  assert.equal(add.status, 201, add.text);
  assert.equal(add.json.documents[0].uploaded_by_name, tina.member.full_name, 'her upload carries her name');

  // …but a manager's file refuses her on every verb, with the
  // owner-only wording…
  for (const attempt of [
    () => req(`${DOCS(bid)}/${pete.member.id}`, { cookie: tina.cookie }),
    () => req(`${DOCS(bid)}/${pete.member.id}`, { method: 'POST', cookie: tina.cookie, body: { filename: 'x.txt', dataUrl: txt('X') } }),
    () => req(`${DOCS(bid)}/${pete.member.id}/${peteDoc}/file`, { cookie: tina.cookie }),
  ]) {
    const res = await attempt();
    assert.equal(res.status, 403);
    assert.equal(res.json.message, "Only the owner can manage a manager's documents.");
  }

  // …and removing is the owner's act alone.
  const del = await req(`${DOCS(bid)}/${sam.member.id}/${samDoc}`, { method: 'DELETE', cookie: tina.cookie });
  assert.equal(del.status, 403);
  assert.equal(del.json.error, 'staff_documents_remove_owner_only');
  assert.equal(del.json.message, 'Only the owner can remove a staff document.');

  // The owner removes one version; the other survives.
  const ownerDel = await req(`${DOCS(bid)}/${sam.member.id}/${samDoc}`, { method: 'DELETE', cookie: owner.cookie });
  assert.equal(ownerDel.status, 200, ownerDel.text);
  assert.equal(ownerDel.json.documents.length, 1);
  assert.equal(ownerDel.json.documents[0].title, 'Application');
  const gone = await req(`${DOCS(bid)}/${sam.member.id}/${samDoc}`, { method: 'DELETE', cookie: owner.cookie });
  assert.equal(gone.status, 404);
  assert.equal(gone.json.message, 'That document is not on file.');

  // Revoking the tick closes every door at once.
  await setDocumentsTick(owner, tina.member.id, false);
  const after = await req(`${DOCS(bid)}/members`, { cookie: tina.cookie });
  assert.equal(after.status, 403, 'revoke is instant');
});

// ---- (d) file rules -------------------------------------------------------------

test('file rules: type and size refusals carry the registered message; titles are honored and trimmed', async () => {
  const owner = await setup('docs-rules');
  const bid = owner.business.id;
  const sam = await addMember(owner, 'docs-rules-sam@example.com');

  const badType = await req(`${DOCS(bid)}/${sam.member.id}`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'evil.exe', dataUrl: `data:application/octet-stream;base64,${Buffer.from('MZ').toString('base64')}` },
  });
  assert.equal(badType.status, 400);
  assert.equal(badType.json.error, 'staff_document_invalid');
  assert.equal(
    badType.json.message,
    'Send a PDF, text, Word, OpenDocument or image file under 25 MB.',
  );

  const oversize = Buffer.alloc(25 * 1024 * 1024 + 1, 65).toString('base64');
  const tooBig = await req(`${DOCS(bid)}/${sam.member.id}`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'big.txt', dataUrl: `data:text/plain;base64,${oversize}` },
  });
  assert.equal(tooBig.status, 400);
  assert.equal(tooBig.json.error, 'staff_document_invalid');

  const longTitle = 'T'.repeat(200);
  const titled = await req(`${DOCS(bid)}/${sam.member.id}`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { title: longTitle, filename: 't.txt', dataUrl: txt('T') },
  });
  assert.equal(titled.status, 201);
  assert.equal(titled.json.documents[0].title.length, 120, 'titles trim to the column');

  const ghost = await req(`${DOCS(bid)}/00000000-0000-0000-0000-000000000000`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'x.txt', dataUrl: txt('X') },
  });
  assert.equal(ghost.status, 404);
  assert.equal(ghost.json.message, 'That team member is not in this business.');
});

// ---- (e) the workforce context boolean -------------------------------------------

test('the workforce context names documents admins and nobody else', async () => {
  const owner = await setup('docs-ctx');
  const bid = owner.business.id;
  const tina = await addMember(owner, 'docs-ctx-tina@example.com', { manager: true });
  const sam = await addMember(owner, 'docs-ctx-sam@example.com');

  assert.equal((await req(`${WF(bid)}/context`, { cookie: owner.cookie })).json.documents_admin, true, 'the owner by birth');
  assert.equal((await req(`${WF(bid)}/context`, { cookie: tina.cookie })).json.documents_admin, false, 'unticked manager');
  assert.equal((await req(`${WF(bid)}/context`, { cookie: sam.cookie })).json.documents_admin, false, 'plain staff');
  await setDocumentsTick(owner, tina.member.id, true);
  assert.equal((await req(`${WF(bid)}/context`, { cookie: tina.cookie })).json.documents_admin, true, 'ticked manager');
});

// ---- (f) the tick brings its training ----------------------------------------------

test('the tick brings its training: catalog, module map, requirements, and live assignment', async () => {
  // Static wiring (the 334 pattern).
  const mgrLesson = TRAINING_LESSONS.find((l) => l.id === 'mgr-staff-documents');
  assert.ok(mgrLesson, 'the manager lesson ships in the server catalog');
  assert.equal(mgrLesson.track, 'manager');
  assert.equal(mgrLesson.module, 'staff');
  const ownerLesson = TRAINING_LESSONS.find((l) => l.id === 'owner-staff-documents');
  assert.ok(ownerLesson, 'the owner lesson ships in the server catalog');
  assert.equal(ownerLesson.track, 'owner');
  assert.equal(TRAINING_LESSONS.length, 117, '117 since the prints build (Nov 25, 2026) added 1 (staff-record-prints, both plans); 116 since the paper-trail batch (release 378) added 1 (staff-log-book); 115 since the eBay storefront batch (release 362) added 1; 114 since restaurant operations added 4; the catalog grew by exactly the two lessons');
  assert.deepEqual(MODULE_BY_PERMISSION['staff.documents'], ['staff']);
  assert.deepEqual(LESSON_REQUIREMENTS['mgr-staff-documents'], ['staff.documents']);
  assert.equal(CLIENT_LESSONS.length, 117, 'the client catalog matches');
  assert.ok(CLIENT_LESSONS.some((l) => l.id === 'mgr-staff-documents'));

  // The grant family shape: its own grant list, a member grant,
  // and NEVER in the shared permission universe or any preset.
  assert.deepEqual(DOCUMENTS_GRANTS.map((g) => g.key), ['staff.documents']);
  assert.ok(isDocumentsGrant('staff.documents'));
  assert.ok(isMemberGrant('staff.documents'));
  assert.ok(!ALL_PERMISSIONS.some((p) => p.key === 'staff.documents'), 'the role picker can never hand it out');
  for (const roleId of ['preset-owner', 'preset-manager', 'preset-stock', 'preset-sales', 'preset-viewer']) {
    assert.ok(!roleById(roleId).permissions.includes('staff.documents'), `not in the ${roleId} preset`);
  }
  // Scope follows the tick alone.
  assert.ok(!scopedLessonIds({ level: 'manager', permissions: [], isBusiness: false }).includes('mgr-staff-documents'));
  assert.ok(scopedLessonIds({ level: 'manager', permissions: ['staff.documents'], isBusiness: false }).includes('mgr-staff-documents'));

  // Live: granting assigns the lesson. Revoking mirrors away
  // FUTURE assignment — the door scope drops the lesson at once
  // (the scopedLessonIds pins above), so it is never assigned
  // again; the assignment the grant already made is history,
  // exactly like every other grant family since 334 (completed
  // history is never ripped out either). The documents DOORS
  // themselves close instantly on revoke — proven in the
  // ticked-manager test above.
  const owner = await setup('docs-train');
  const bid = owner.business.id;
  const tina = await addMember(owner, 'docs-train-tina@example.com', { manager: true });
  const statePath = `/api/businesses/${bid}/training/state`;
  const carrying = (state) =>
    (state.json.assignments || []).filter((a) => (a.lesson_ids || []).includes('mgr-staff-documents'));
  const before = await req(statePath, { cookie: tina.cookie });
  assert.ok(!before.json.my_lesson_ids.includes('mgr-staff-documents'), 'no lesson before the grant');
  assert.equal(carrying(before).length, 0, 'no assignment before the grant');
  await setDocumentsTick(owner, tina.member.id, true);
  const granted = await req(statePath, { cookie: tina.cookie });
  assert.ok(granted.json.my_lesson_ids.includes('mgr-staff-documents'), 'the lesson arrives with the tick');
  assert.equal(carrying(granted).length, 1, 'the grant made exactly one assignment carrying it');
  await setDocumentsTick(owner, tina.member.id, false);
  await setDocumentsTick(owner, tina.member.id, true);
  const regranted = await req(statePath, { cookie: tina.cookie });
  assert.equal(carrying(regranted).length, 1, 'a revoke + re-grant never stacks a second assignment');
});

// ---- (g) the shipped doors stay aligned ----------------------------------------------

test('the Staff page door and the billing wipe know the documents build', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const nav = fs.readFileSync(path.join(here, '../../src/components/layout/navGroups.js'), 'utf8');
  assert.ok(
    nav.includes("anyPerm: ['staff.roster', 'staff.clockBoard', 'staff.callins', 'staff.documents']"),
    'a documents-only manager can reach the Staff page',
  );
  const billing = fs.readFileSync(path.join(here, '../../server/billing.js'), 'utf8');
  assert.ok(
    billing.includes('DELETE FROM staff_documents WHERE business_id = $1'),
    'the end-of-grace wipe clears the documents with the business',
  );
});
