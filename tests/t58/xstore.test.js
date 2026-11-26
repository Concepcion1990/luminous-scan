// Cross-store messages (Nov 23, 2026): the owner's second
// messaging door, scoped to the ACCOUNT.
//
// Her rulings pinned here:
//  - The in-store inbox is untouched; this door is separate
//    and shows ALL staff across all the account's businesses
//    (2, 3, up to 5) in one box. Any member (owner, manager,
//    staff) can message any other member of the SAME account.
//  - Business-only: Essentials is refused on every route
//    (plan_gated), and the door's plan lines / nav item /
//    lessons exist only on Business.
//  - A thread can NEVER leak across accounts: both
//    participants are validated against the account directory,
//    and every query is scoped by account_owner_id.
//  - Conversations are private to the two participants — no
//    owner oversight in this door (pinned: the owner cannot
//    read a thread between two of their staff).
//  - Photos: a participant shows a photo only when they hold
//    an APPROVED profile photo in one of the account's
//    businesses; pending bytes are invisible. The account
//    photo route serves a member of one business the photo of
//    a member of another.
//  - Every message carries date + time (created_at), a
//    server-stamped delivered_at, and read_at once the other
//    person opens the conversation — except the Nov 19 law:
//    a non-owner never learns whether the OWNER read theirs.
//  - Voice notes ride the same machinery as the in-store
//    inbox (server/voiceNote.js): converted to MP3 before
//    storage, served only behind the participant check.
//  - The account's second business carries NO entitlement row
//    of its own in these fixtures: every call through it also
//    pins 356 inheritance (the account's Business row governs).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  base,
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
  createBusiness,
} from './helpers.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS, lessonVisibleOnPlan } from '../../server/trainingCatalog.js';
import { PLANS, COMPARISON_ROWS, FEATURES, WELCOME_OPTIONS } from '../../src/lib/plans.js';
import { NAV_GROUPS } from '../../src/components/layout/navGroups.js';
import { en } from '../../src/lib/locales/en.js';

after(close);
beforeEach(() => resetRateLimits());

let seq = 0;
const email = (label) => `${label}${++seq}@example.com`;

const XS = (bid) => `/api/businesses/${bid}/xstore`;

// A 1x1 PNG, planted as an approved profile photo.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function addTeamMember(business, ownerId, memberEmail, { manager = false, name } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, '[]', 'active', $7)`,
    [
      id,
      business.id,
      name || (manager ? 'Manny Manager' : 'Sam Staff'),
      memberEmail,
      manager ? 'preset-manager' : 'preset-sales',
      manager ? 'Manager' : 'Sales clerk',
      ownerId,
    ],
  );
  const account = await registerVerifiedUser(memberEmail);
  return { staffId: id, email: memberEmail, cookie: account.cookie, user: account.user };
}

/** A Business account with TWO businesses: the plan row sits
 *  on the FIRST business only (356 inheritance governs the
 *  second). Ana works in the first, Ben in the second. */
async function twoStoreAccount(label) {
  const owner = await ownerWithBusiness(email(label), 'First Store', { plan: 'business' });
  const biz1 = owner.business;
  const biz2 = await createBusiness(owner.cookie, 'Second Store');
  const ana = await addTeamMember(biz1, owner.user.id, email(`${label}-ana`), { name: 'Ana Apple' });
  const ben = await addTeamMember(biz2, owner.user.id, email(`${label}-ben`), { name: 'Ben Berry' });
  return { owner, biz1, biz2, ana, ben };
}

function toneWavDataUrl(sampleRate = 16000) {
  const frames = sampleRate / 4;
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + frames * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000), 44 + i * 2);
  }
  return `data:audio/wav;base64,${data.toString('base64')}`;
}

test('migration 047: the three cross-store tables exist', async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT table_name FROM information_schema.tables
      WHERE table_name IN ('xstore_threads', 'xstore_messages', 'xstore_voice_notes')
      ORDER BY table_name`,
  );
  assert.deepEqual(rows.map((r) => r.table_name), [
    'xstore_messages',
    'xstore_threads',
    'xstore_voice_notes',
  ]);
});

test('directory: everyone across both businesses, one entry per person, signed-in only', async () => {
  const { owner, biz1, biz2, ana, ben } = await twoStoreAccount('dir');
  // A staff row with no signed-in user behind it: nowhere to
  // send messages, so it never appears.
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, 'Ghost Never-Signed-In', $3, 'user', 'preset-sales', 'Sales clerk', '[]', 'active', $4)`,
    [crypto.randomUUID(), biz1.id, email('dir-ghost'), owner.user.id],
  );
  // A person from a DIFFERENT account must not appear.
  const other = await twoStoreAccount('dir-other');

  const res = await req(`${XS(biz1.id)}/people`, { cookie: ana.cookie });
  assert.equal(res.status, 200);
  const byId = new Map(res.json.people.map((p) => [p.user_id, p]));
  assert.ok(byId.has(owner.user.id), 'the owner is in the directory');
  assert.ok(byId.has(ana.user.id), 'Ana (this business) is in the directory');
  assert.ok(byId.has(ben.user.id), 'Ben (the OTHER business) is in the directory');
  assert.equal(byId.get(ben.user.id).businesses[0].id, biz2.id);
  assert.equal(byId.get(ben.user.id).businesses[0].name, 'Second Store');
  assert.ok(![...byId.values()].some((p) => p.name === 'Ghost Never-Signed-In'));
  assert.ok(!byId.has(other.ana.user.id), 'no cross-account leakage in the directory');
  assert.equal(res.json.me_user_id, ana.user.id);
});

test('cross-business thread: create in one store, answer from the other, delivered then read', async () => {
  const { biz1, biz2, ana, ben } = await twoStoreAccount('flow');

  const created = await req(`${XS(biz1.id)}/threads`, {
    method: 'POST', cookie: ana.cookie, body: { user_id: ben.user.id },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.created, true);
  const threadId = created.json.thread.id;
  assert.equal(created.json.thread.other.user_id, ben.user.id);

  // Get-or-create: the same pair, from the other side, is the
  // same single thread.
  const again = await req(`${XS(biz2.id)}/threads`, {
    method: 'POST', cookie: ben.cookie, body: { user_id: ana.user.id },
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.created, false);
  assert.equal(again.json.thread.id, threadId);

  // Ben sees the thread from HIS business (which has no plan
  // row of its own — 356 inheritance carries the gate).
  const benList = await req(`${XS(biz2.id)}/threads`, { cookie: ben.cookie });
  assert.equal(benList.status, 200);
  assert.equal(benList.json.threads.length, 1);
  assert.equal(benList.json.threads[0].other.user_id, ana.user.id);

  const posted = await req(`${XS(biz1.id)}/threads/${threadId}/messages`, {
    method: 'POST', cookie: ana.cookie, body: { body: 'Two cases of sparkling water just landed at First Store.' },
  });
  assert.equal(posted.status, 201);
  assert.equal(posted.json.message.mine, true);
  assert.ok(posted.json.message.delivered_at, 'delivered is stamped by the server at send');
  assert.equal(posted.json.message.read_at, null, 'not read yet');
  assert.ok(posted.json.message.created_at, 'every message carries its date + time');

  const benUnread = await req(`${XS(biz2.id)}/unread`, { cookie: ben.cookie });
  assert.equal(benUnread.json.unread, 1);

  const benView = await req(`${XS(biz2.id)}/threads/${threadId}`, { cookie: ben.cookie });
  assert.equal(benView.status, 200);
  assert.equal(benView.json.messages.length, 1);
  assert.equal(benView.json.messages[0].mine, false);
  assert.equal(benView.json.messages[0].sender_name, 'Ana Apple');

  const read = await req(`${XS(biz2.id)}/threads/${threadId}/read`, {
    method: 'PATCH', cookie: ben.cookie, body: {},
  });
  assert.equal(read.status, 200);
  assert.equal(read.json.unread, 0);

  // The reader is a fellow member, not the owner: Ana sees the
  // Read mark land.
  const anaView = await req(`${XS(biz1.id)}/threads/${threadId}`, { cookie: ana.cookie });
  assert.ok(anaView.json.messages[0].read_at, 'read_at is visible to the sender once read');
  assert.ok(anaView.json.messages[0].delivered_at);
});

test('owner exception: staff never learn whether the owner read their message', async () => {
  const { owner, biz1, ana } = await twoStoreAccount('ownerx');
  const created = await req(`${XS(biz1.id)}/threads`, {
    method: 'POST', cookie: ana.cookie, body: { user_id: owner.user.id },
  });
  const threadId = created.json.thread.id;
  const posted = await req(`${XS(biz1.id)}/threads/${threadId}/messages`, {
    method: 'POST', cookie: ana.cookie, body: { body: 'The new bookmarks are on the counter.' },
  });
  assert.equal(posted.status, 201);

  await req(`${XS(biz1.id)}/threads/${threadId}/read`, {
    method: 'PATCH', cookie: owner.cookie, body: {},
  });

  const anaView = await req(`${XS(biz1.id)}/threads/${threadId}`, { cookie: ana.cookie });
  assert.equal(anaView.json.messages[0].read_at, null, 'the owner\u2019s read state is hidden from staff');
  assert.ok(anaView.json.messages[0].delivered_at, 'delivered still shows');

  const ownerView = await req(`${XS(biz1.id)}/threads/${threadId}`, { cookie: owner.cookie });
  assert.ok(ownerView.json.messages[0].read_at, 'the owner sees the true read state');
});

test('privacy: no owner oversight — a thread between two staff is theirs alone', async () => {
  const { owner, biz1, ana, ben } = await twoStoreAccount('privacy');
  const created = await req(`${XS(biz1.id)}/threads`, {
    method: 'POST', cookie: ana.cookie, body: { user_id: ben.user.id },
  });
  const threadId = created.json.thread.id;
  const ownerPeek = await req(`${XS(biz1.id)}/threads/${threadId}`, { cookie: owner.cookie });
  assert.equal(ownerPeek.status, 403);
  const ownerList = await req(`${XS(biz1.id)}/threads`, { cookie: owner.cookie });
  assert.equal(ownerList.json.threads.length, 0, 'the thread does not even list for the owner');
});

test('cross-account refusal: no creating, reading or posting across accounts', async () => {
  const a = await twoStoreAccount('leak-a');
  const b = await twoStoreAccount('leak-b');

  const create = await req(`${XS(a.biz1.id)}/threads`, {
    method: 'POST', cookie: a.ana.cookie, body: { user_id: b.ben.user.id },
  });
  assert.equal(create.status, 400);
  assert.equal(create.json.message, 'That person is not part of this account.');

  const created = await req(`${XS(a.biz1.id)}/threads`, {
    method: 'POST', cookie: a.ana.cookie, body: { user_id: a.ben.user.id },
  });
  const threadId = created.json.thread.id;

  // Ben walks through HIS OWN business's door (biz2 — the only
  // one he has access to): the account scope still hides the
  // other account's thread completely.
  const read = await req(`${XS(b.biz2.id)}/threads/${threadId}`, { cookie: b.ben.cookie });
  assert.equal(read.status, 404, 'another account\u2019s thread is simply not there');
  const post = await req(`${XS(b.biz2.id)}/threads/${threadId}/messages`, {
    method: 'POST', cookie: b.ben.cookie, body: { body: 'intruder' },
  });
  assert.equal(post.status, 404);

  const self = await req(`${XS(a.biz1.id)}/threads`, {
    method: 'POST', cookie: a.ana.cookie, body: { user_id: a.ana.user.id },
  });
  assert.equal(self.status, 400);
  assert.equal(self.json.message, 'You cannot message yourself.');
});

test('photos: approved shows, pending never does, and bytes cross businesses', async () => {
  const { biz1, biz2, ana, ben } = await twoStoreAccount('photos');
  // Ben's APPROVED photo lives in the SECOND business.
  await pool.query(
    `INSERT INTO profile_photos (business_id, person_key, user_id, approved_type, approved_data, approved_at, updated_at)
     VALUES ($1, $2, $3, 'image/png', $4, NOW(), NOW())`,
    [biz2.id, ben.staffId, ben.user.id, PNG_B64],
  );
  // Ana has a photo PENDING in the first business — invisible
  // by law, here as everywhere.
  await pool.query(
    `INSERT INTO profile_photos (business_id, person_key, user_id, pending_type, pending_data, pending_at, updated_at)
     VALUES ($1, $2, $3, 'image/png', $4, NOW(), NOW())`,
    [biz1.id, ana.staffId, ana.user.id, PNG_B64],
  );

  const people = await req(`${XS(biz1.id)}/people`, { cookie: ana.cookie });
  const byId = new Map(people.json.people.map((p) => [p.user_id, p]));
  assert.equal(byId.get(ben.user.id).photo, true, 'approved photo in another business shows');
  assert.equal(byId.get(ana.user.id).photo, false, 'a pending photo contributes nothing');

  const fileRes = await fetch(
    `${base}${XS(biz1.id)}/people/${ben.user.id}/photo`,
    { headers: { Cookie: ana.cookie } },
  );
  assert.equal(fileRes.status, 200);
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  assert.equal(bytes.toString('base64'), PNG_B64, 'the exact approved bytes are served');

  const pending = await req(`${XS(biz1.id)}/people/${ana.user.id}/photo`, { cookie: ana.cookie });
  assert.equal(pending.status, 404, 'no route serves a pending photo');

  const outsider = await twoStoreAccount('photos-out');
  const cross = await req(`${XS(outsider.biz1.id)}/people/${ben.user.id}/photo`, {
    cookie: outsider.ana.cookie,
  });
  assert.equal(cross.status, 404, 'another account cannot fetch the photo');
});

test('voice notes cross stores: converted, listed with duration, served to participants only', async () => {
  const { biz1, biz2, ana, ben } = await twoStoreAccount('voice');
  const created = await req(`${XS(biz1.id)}/threads`, {
    method: 'POST', cookie: ana.cookie, body: { user_id: ben.user.id },
  });
  const threadId = created.json.thread.id;

  const posted = await req(`${XS(biz2.id)}/threads/${threadId}/voice`, {
    method: 'POST',
    cookie: ben.cookie,
    body: { dataUrl: toneWavDataUrl(), duration_ms: 250 },
  });
  assert.equal(posted.status, 201);
  assert.equal(posted.json.message.kind, 'voice');
  assert.equal(posted.json.message.voice_duration_ms, 250);
  assert.ok(posted.json.message.delivered_at);
  const messageId = posted.json.message.id;

  const anaView = await req(`${XS(biz1.id)}/threads/${threadId}`, { cookie: ana.cookie });
  assert.equal(anaView.json.messages.length, 1);
  assert.equal(anaView.json.messages[0].kind, 'voice');
  assert.equal(anaView.json.messages[0].voice_duration_ms, 250);

  const fileRes = await fetch(`${base}${XS(biz1.id)}/threads/${threadId}/voice/${messageId}/file`, {
    headers: { Cookie: ana.cookie },
  });
  assert.equal(fileRes.status, 200);
  assert.match(fileRes.headers.get('content-type') || '', /audio\/mpeg/);
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  assert.ok(bytes.length > 0, 'the converted MP3 bytes are served');

  const other = await twoStoreAccount('voice-out');
  const cross = await req(`${XS(other.biz1.id)}/threads/${threadId}/voice/${messageId}/file`, {
    cookie: other.ana.cookie,
  });
  assert.equal(cross.status, 404, 'another account cannot reach the recording');
});

test('Essentials: every route refuses with the plan gate, and nothing leaks', async () => {
  const ess = await ownerWithBusiness(email('ess'), 'Essentials Store', { plan: 'essentials' });
  const staff = await addTeamMember(ess.business, ess.user.id, email('ess-staff'), { name: 'Ess Staff' });

  for (const [method, path, cookie] of [
    ['GET', `${XS(ess.business.id)}/people`, ess.cookie],
    ['GET', `${XS(ess.business.id)}/threads`, ess.cookie],
    ['GET', `${XS(ess.business.id)}/unread`, staff.cookie],
    ['POST', `${XS(ess.business.id)}/threads`, ess.cookie],
  ]) {
    const res = await req(path, {
      method,
      cookie,
      body: method === 'POST' ? { user_id: staff.user.id } : undefined,
    });
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.equal(res.json.error, 'plan_gated');
    assert.equal(res.json.message, 'Cross-store messages are part of the Business plan.');
  }
});

test('presentation: plan lines, comparison row, feature, nav door — Business only', () => {
  const line = en['plansLib.businessIncludes.xstoreMessages'];
  assert.ok(line, 'the plan line exists in English');
  assert.ok(PLANS.business.includes.includes(line), 'PLANS business includes carries the line');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Essentials includes never carries it');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome business card carries the line');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row, 'the comparison table has the row');
  assert.equal(row.business, true);
  assert.equal(row.essentials, false);
  assert.equal(row.mobile, false);
  assert.equal(FEATURES.xstoreMessages, line);
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.to === '/cross-store-messages');
  assert.ok(item, 'the nav door exists');
  assert.equal(item.feature, 'xstoreMessages');
  assert.equal(item.labelKey, 'nav.xstoreMessages');
  assert.equal(en['nav.xstoreMessages'], 'Cross-store messages');
});

test('training: three lessons, catalogs in agreement, Business-visible only', () => {
  assert.equal(SERVER_LESSONS.length, 116, 'catalog 107 -> 110 with cross-store messages; 114 since restaurant operations added 4; 115 since the eBay storefront batch (release 362) added 1; 116 since the paper-trail batch (release 378) added 1 (staff-log-book)');
  assert.equal(CLIENT_LESSONS.length, 116);
  for (const id of ['owner-xstore-messages', 'mgr-xstore-messages', 'staff-xstore-messages']) {
    const server = SERVER_LESSONS.find((l) => l.id === id);
    const client = CLIENT_LESSONS.find((l) => l.id === id);
    assert.ok(server && client, id);
    assert.deepEqual(
      { track: server.track, module: server.module, steps: server.steps, feature: server.feature },
      { track: client.track, module: client.module, steps: client.steps, feature: client.feature },
      `${id} agrees across catalogs`,
    );
    assert.equal(server.module, 'messaging');
    assert.equal(server.feature, 'xstoreMessages');
    assert.equal(lessonVisibleOnPlan(server, true), true, `${id} visible on Business`);
    assert.equal(lessonVisibleOnPlan(server, false), false, `${id} invisible on Essentials`);
    assert.ok(en[`training.lessons.${id}.title`], `${id} has a title`);
    for (let s = 1; s <= server.steps; s += 1) {
      assert.ok(en[`training.lessons.${id}.step${s}`], `${id} step ${s} has words (the quiz derives from steps)`);
    }
  }
});
