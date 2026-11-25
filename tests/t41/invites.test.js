/**
 * T41 — invite hardening (owner's rulings, Nov 22, 2026).
 *
 * Part A: the signup domain blocklist stops INVITES too (the
 * release-342 exemption, reversed). Part B: invite links are
 * SINGLE-USE — the first open claims the link for that browser
 * session; finishing the signup in that visit consumes it;
 * leaving spends it for everyone else; the owner's existing
 * Resend invite door issues a fresh link and kills the old
 * one. Part C: the two invite-teaching lessons carry a fifth
 * step, and the quiz machinery picks it up.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
  mailbox,
  mailTo,
  codeFromMail,
  cookieFrom,
  OPERATOR_EMAIL,
  blockedDomainRow,
  userRow,
  setEntitlement,
  staffRow,
  inviteMail,
  tokenFromMail,
} from './helpers.js';

after(close);
beforeEach(() => {
  resetRateLimits();
  mailbox.length = 0;
});

const PASSWORD = 'CorrectHorse123';
const KIND = 'This invite link has already been used. Ask the owner of the business to send you a new invite.';

let operatorAccount = null;
async function operator() {
  if (!operatorAccount) {
    operatorAccount = await registerVerifiedUser(OPERATOR_EMAIL);
    return operatorAccount;
  }
  const login = await req('/api/auth/login', {
    method: 'POST', body: { email: OPERATOR_EMAIL, password: PASSWORD },
  });
  assert.equal(login.status, 200, login.text);
  return { ...operatorAccount, cookie: cookieFrom(login.setCookie) };
}

/** An owner + business with an active entitlement, so the
 * staff doors open (the t4 fixture pattern). */
async function boss(email, name) {
  const owner = await ownerWithBusiness(email, name);
  await setEntitlement(owner.business.id, { plan: 'essentials', status: 'active' });
  return owner;
}

/** Create the staff row through the real door, then send the
 * invite email through the real door; returns the token the
 * email carried. */
async function invitePerson(owner, email, name = 'New Hire') {
  const created = await req(`/api/businesses/${owner.business.id}/staff`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { full_name: name, email, app_role: 'user', role_name: 'Sales clerk', permissions: [] },
  });
  assert.equal(created.status, 201, created.text);
  return resendInvite(owner, email);
}

async function resendInvite(owner, email) {
  const sent = await req(`/api/businesses/${owner.business.id}/staff/invite`, {
    method: 'POST',
    cookie: owner.cookie,
    body: { email },
  });
  assert.equal(sent.status, 200, sent.text);
  const mail = inviteMail(email);
  assert.ok(mail, `no invite mail for ${email}`);
  const token = tokenFromMail(mail);
  assert.ok(token, 'invite mail carries no token');
  return token;
}

async function openLink(token, { claim, cookie } = {}) {
  return req('/api/auth/invite/open', {
    method: 'POST',
    body: { token, claim },
    cookie,
  });
}

async function registerWithInvite(email, token, claim) {
  const reg = await req('/api/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, inviteToken: token, inviteClaim: claim },
  });
  assert.equal(reg.status, 201, reg.text);
  const code = codeFromMail(mailTo(email, 'verification code'));
  assert.ok(code, `no verification code mailed to ${email}`);
  const verify = await req('/api/auth/verify', { method: 'POST', body: { email, otpCode: code } });
  assert.equal(verify.status, 200, verify.text);
  return verify;
}

test('Part A: an invited signup at a blocked domain is refused — and the refusal does not consume the link', async () => {
  const op = await operator();
  const added = await req('/api/operator/blocked-domains', {
    method: 'POST', body: { domain: 'blocked-hire.test' }, cookie: op.cookie,
  });
  assert.equal(added.status, 201, added.text);

  const owner = await boss('parta-boss@shops.test', 'Part A Shop');
  const token = await invitePerson(owner, 'hire@blocked-hire.test');
  // The link itself opens fine — the blocklist guards account
  // CREATION, not the reading of the page.
  const opened = await openLink(token);
  assert.equal(opened.status, 200, opened.text);
  const claim = opened.json.claim;
  assert.ok(claim);

  const refused = await req('/api/auth/register', {
    method: 'POST',
    body: { email: 'hire@blocked-hire.test', password: PASSWORD, inviteToken: token, inviteClaim: claim },
  });
  assert.equal(refused.status, 400, refused.text);
  assert.equal(refused.json.error, 'signup_email_unavailable');
  assert.equal(await userRow('hire@blocked-hire.test'), null);
  // The link was NOT consumed by the refused signup, and the
  // staff row is untouched.
  let row = await staffRow(owner.business.id, 'hire@blocked-hire.test');
  assert.equal(row.status, 'invited');
  assert.equal(row.invite_link_state, 'opened');

  // The operator takes the domain back off — the very same
  // link and claim now carry the hire all the way in.
  const rowId = (await blockedDomainRow('blocked-hire.test')).id;
  const removed = await req(`/api/operator/blocked-domains/${rowId}`, {
    method: 'DELETE', cookie: op.cookie,
  });
  assert.equal(removed.status, 200, removed.text);
  await registerWithInvite('hire@blocked-hire.test', token, claim);
  row = await staffRow(owner.business.id, 'hire@blocked-hire.test');
  assert.equal(row.status, 'active');
  assert.equal(row.invite_link_state, 'used');
});

test('Part B: a clean-domain invite works end to end — open, register, verify, active', async () => {
  const owner = await boss('clean-boss@shops.test', 'Clean Shop');
  const token = await invitePerson(owner, 'clerk@clean.test');
  let row = await staffRow(owner.business.id, 'clerk@clean.test');
  assert.equal(row.invite_link_state, 'fresh');

  const opened = await openLink(token);
  assert.equal(opened.status, 200, opened.text);
  assert.equal(opened.json.email, 'clerk@clean.test');
  const claim = opened.json.claim;
  assert.ok(claim);
  row = await staffRow(owner.business.id, 'clerk@clean.test');
  assert.equal(row.invite_link_state, 'opened');

  // The same session re-opening (reload, back button) is the
  // same visit: still fine, same claim.
  const reopened = await openLink(token, { claim });
  assert.equal(reopened.status, 200, reopened.text);

  const verify = await registerWithInvite('clerk@clean.test', token, claim);
  row = await staffRow(owner.business.id, 'clerk@clean.test');
  assert.equal(row.status, 'active');
  assert.equal(row.invite_link_state, 'used');
  // The workspace membership materialized with the flip.
  const { rows: memberships } = await pool.query(
    "SELECT * FROM business_memberships WHERE business_id = $1 AND user_id = $2 AND role = 'member'",
    [owner.business.id, verify.json.user.id],
  );
  assert.equal(memberships.length, 1);
});

test('Part B: a completed link cannot be used again', async () => {
  const owner = await boss('once-boss@shops.test', 'Once Shop');
  const token = await invitePerson(owner, 'once@clean.test');
  const opened = await openLink(token);
  await registerWithInvite('once@clean.test', token, opened.json.claim);

  const again = await openLink(token);
  assert.equal(again.status, 410, again.text);
  assert.equal(again.json.error, 'invite_link_used');
  assert.equal(again.json.message, KIND);
  // Even the original claim cannot revive it.
  const withClaim = await openLink(token, { claim: opened.json.claim });
  assert.equal(withClaim.status, 410);
});

test('Part B: open, abandon, reopen — a later session is refused, a wrong claim spends the link', async () => {
  const owner = await boss('abandon-boss@shops.test', 'Abandon Shop');
  const token = await invitePerson(owner, 'ghost@clean.test');
  const first = await openLink(token);
  assert.equal(first.status, 200, first.text);
  const claim = first.json.claim;

  // A later open from a different session (no claim): refused
  // with the kind message; the link is not spent by this alone.
  const stranger = await openLink(token);
  assert.equal(stranger.status, 410, stranger.text);
  assert.equal(stranger.json.error, 'invite_link_used');
  assert.equal(stranger.json.message, KIND);
  let row = await staffRow(owner.business.id, 'ghost@clean.test');
  assert.equal(row.invite_link_state, 'opened');

  // A WRONG claim presented: the link is spent outright.
  const wrong = await openLink(token, { claim: 'not-the-claim' });
  assert.equal(wrong.status, 410);
  row = await staffRow(owner.business.id, 'ghost@clean.test');
  assert.equal(row.invite_link_state, 'spent');

  // And now even the original session cannot register with it:
  // refused before anything is created.
  const reg = await req('/api/auth/register', {
    method: 'POST',
    body: { email: 'ghost@clean.test', password: PASSWORD, inviteToken: token, inviteClaim: claim },
  });
  assert.equal(reg.status, 410, reg.text);
  assert.equal(reg.json.error, 'invite_link_used');
  assert.equal(reg.json.message, KIND);
  assert.equal(await userRow('ghost@clean.test'), null);
  row = await staffRow(owner.business.id, 'ghost@clean.test');
  assert.equal(row.status, 'invited');
});

test('Part B: two simultaneous opens — exactly one session wins the claim', async () => {
  const owner = await boss('race-boss@shops.test', 'Race Shop');
  const token = await invitePerson(owner, 'racer@clean.test');
  const [a, b] = await Promise.all([openLink(token), openLink(token)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 410]);
  const winner = a.status === 200 ? a : b;
  // The winner's session continues unharmed.
  const again = await openLink(token, { claim: winner.json.claim });
  assert.equal(again.status, 200, again.text);
  await registerWithInvite('racer@clean.test', token, winner.json.claim);
  const row = await staffRow(owner.business.id, 'racer@clean.test');
  assert.equal(row.status, 'active');
});

test('Part B: resend issues a working fresh link and the old link stays dead', async () => {
  const owner = await boss('resend-boss@shops.test', 'Resend Shop');
  const token1 = await invitePerson(owner, 'twice@clean.test');
  const token2 = await resendInvite(owner, 'twice@clean.test');
  assert.notEqual(token1, token2);

  const dead = await openLink(token1);
  assert.equal(dead.status, 410);
  assert.equal(dead.json.message, KIND);

  const opened = await openLink(token2);
  assert.equal(opened.status, 200, opened.text);
  await registerWithInvite('twice@clean.test', token2, opened.json.claim);
  const row = await staffRow(owner.business.id, 'twice@clean.test');
  assert.equal(row.status, 'active');
});

test('Part B: resend after an open supersedes the claimed link — a bare signup no longer flips the row', async () => {
  const owner = await boss('supersede-boss@shops.test', 'Supersede Shop');
  const token1 = await invitePerson(owner, 'flip@clean.test');
  const opened = await openLink(token1);
  assert.equal(opened.status, 200);
  // The owner resends before the hire finishes: token1's claim
  // is wiped and a fresh token governs the row now.
  const token2 = await resendInvite(owner, 'flip@clean.test');
  assert.notEqual(token1, token2);
  let row = await staffRow(owner.business.id, 'flip@clean.test');
  assert.equal(row.invite_link_state, 'fresh');

  // The hire gives up on links and signs up bare with the same
  // email. The account is created — but the token-governed row
  // does NOT flip on a bare email match any more.
  await registerVerifiedUser('flip@clean.test');
  row = await staffRow(owner.business.id, 'flip@clean.test');
  assert.equal(row.status, 'invited');

  // Recovery: signed in as that email, opening the fresh link
  // completes it on the spot.
  const login = await req('/api/auth/login', {
    method: 'POST', body: { email: 'flip@clean.test', password: PASSWORD },
  });
  assert.equal(login.status, 200, login.text);
  const done = await openLink(token2, { cookie: cookieFrom(login.setCookie) });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.json.completed, true);
  row = await staffRow(owner.business.id, 'flip@clean.test');
  assert.equal(row.status, 'active');
  assert.equal(row.invite_link_state, 'used');
});

test('Part B: the prefetch rescue — a scanner pre-open does not strand a hire who already has an account', async () => {
  // The hire already has an account (they work elsewhere too).
  const hire = await registerVerifiedUser('vet@clean.test');
  const owner = await boss('vet-boss@shops.test', 'Vet Shop');
  const token = await invitePerson(owner, 'vet@clean.test');
  // A mail scanner pre-opens the link: it claims the link
  // under a claim the person never sees.
  const scanned = await openLink(token);
  assert.equal(scanned.status, 200, scanned.text);
  // The person's own anonymous tap is refused…
  const tap = await openLink(token);
  assert.equal(tap.status, 410);
  // …but signed in as the invited address, the same link
  // completes. This is the flagged trade-off's built-in road
  // back (see the publish record).
  const done = await openLink(token, { cookie: hire.cookie });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.json.completed, true);
  const row = await staffRow(owner.business.id, 'vet@clean.test');
  assert.equal(row.status, 'active');
});

test('Part B: legacy invites (no token) still connect by email, exactly as before', async () => {
  const owner = await boss('legacy-boss@shops.test', 'Legacy Shop');
  const staffId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, 'Legacy Hire', 'legacy@clean.test', 'user', 'preset-sales', 'Sales clerk', '[]', 'invited', $3)`,
    [staffId, owner.business.id, owner.user.id],
  );
  await registerVerifiedUser('legacy@clean.test');
  const { rows } = await pool.query('SELECT status, invite_token_hash FROM staff_members WHERE id = $1', [staffId]);
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].invite_token_hash, null);
});

test('Part C: the invite lessons carry the single-use step, and the quiz machinery picks it up', async () => {
  const { TRAINING_LESSONS: clientLessons } = await import('../../src/lib/trainingCatalog.js');
  const { TRAINING_LESSONS: serverLessons } = await import('../../server/trainingCatalog.js');
  assert.equal(clientLessons.length, 115); // 115 since the eBay storefront batch (release 362, Nov 23, 2026) added 1 (owner-ebay-connect); 114 since restaurant operations (Nov 23, 2026) added 4; 110 through cross-store messages
  assert.equal(serverLessons.length, 115);
  for (const lessons of [clientLessons, serverLessons]) {
    assert.equal(lessons.find((l) => l.id === 'owner-staff-roles').steps, 5);
    assert.equal(lessons.find((l) => l.id === 'mgr-staff-permissions').steps, 5);
  }
  const { en } = await import('../../src/lib/locales/en.js');
  const { esMX } = await import('../../src/lib/locales/es-MX.js');
  assert.equal(
    en['training.lessons.owner-staff-roles.step5'],
    "The link in the invite email works only once. If the person clicks it and doesn't finish creating their account, the link is spent — open their card on the Staff page and choose Resend invite to send them a fresh one.",
  );
  assert.ok(en['training.lessons.mgr-staff-permissions.step5'].includes('Resend invite'));
  // The Spanish rendering names the buttons as the Spanish app
  // itself shows them.
  assert.ok(esMX['training.lessons.owner-staff-roles.step5'].includes('Reenviar invitación'));
  assert.notEqual(esMX['training.lessons.owner-staff-roles.step5'], en['training.lessons.owner-staff-roles.step5']);
  // The quiz is derived from the lesson's steps: with step 5
  // visible, the new step enters the question pool.
  const { buildQuiz } = await import('../../server/trainingScope.js');
  const lesson = serverLessons.find((l) => l.id === 'owner-staff-roles');
  let sawStep5 = false;
  for (const personKey of ['a', 'b', 'c', 'd', 'e']) {
    const quiz = buildQuiz(lesson, [1, 2, 3, 4, 5], { personKey });
    for (const q of quiz.questions) {
      for (const opt of q.options) {
        if (opt.lesson_id === 'owner-staff-roles' && opt.step === 5) sawStep5 = true;
      }
    }
  }
  assert.ok(sawStep5, 'the quiz never drew the new step');
});

test('pins: keyset, registry, and the kind message', async () => {
  const { en } = await import('../../src/lib/locales/en.js');
  const { esMX } = await import('../../src/lib/locales/es-MX.js');
  assert.equal(Object.keys(en).length, 5818);
  assert.equal(Object.keys(esMX).length, 5818);
  assert.equal(en['apiErrors.inviteLinkUsed'], KIND);
  assert.notEqual(esMX['apiErrors.inviteLinkUsed'], KIND);
  assert.equal(en['register.inviteConnected'], "You're connected — your account is now linked to the business that invited you.");
  assert.equal(en['register.inviteOpenApp'], 'Open the app');
  const { API_ERROR_MESSAGE_KEYS } = await import('../../src/lib/apiErrors.js');
  assert.equal(API_ERROR_MESSAGE_KEYS[KIND], 'apiErrors.inviteLinkUsed');
  // The kind message carries its door and never accuses.
  assert.ok(KIND.includes('send you a new invite'));
  assert.ok(!/block|spam|abuse|fraud/i.test(KIND));
});
