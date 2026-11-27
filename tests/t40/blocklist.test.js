/**
 * T40 — the signup domain blocklist (owner's design, Nov 19, 2026).
 *
 * The operator-only domain list; a blocked-domain PUBLIC signup
 * is refused before anything is created, with a plain neutral
 * message and zero side effects; matching is exact-domain and
 * case-insensitive; removing a domain re-opens signup; existing
 * accounts are untouched. As first shipped, a pending staff
 * invite was exempt; the owner reversed that the same day
 * (Nov 22, 2026 — release 344): the block stops invites too,
 * and the last test here pins the new truth.
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
} from './helpers.js';

after(close);
beforeEach(() => {
  resetRateLimits();
  mailbox.length = 0;
});

const REFUSAL = "An account can't be created with this email address. Please use a different email address.";
const PASSWORD = 'CorrectHorse123';

let operatorAccount = null;
async function operator() {
  // One shared operator account for the whole file (the harness
  // boots one database): register once, log in after that.
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

async function addDomain(cookie, domain, note) {
  return req('/api/operator/blocked-domains', {
    method: 'POST', body: { domain, note }, cookie,
  });
}

test('operator doors refuse everyone but the operator', async () => {
  const owner = await registerVerifiedUser('block-boss@example.com');
  const signedOut = await req('/api/operator/blocked-domains');
  assert.equal(signedOut.status, 401);
  for (const attempt of [
    () => req('/api/operator/blocked-domains', { cookie: owner.cookie }),
    () => req('/api/operator/blocked-domains', { method: 'POST', body: { domain: 'spam.example' }, cookie: owner.cookie }),
    () => req('/api/operator/blocked-domains/some-id', { method: 'DELETE', cookie: owner.cookie }),
  ]) {
    const res = await attempt();
    assert.equal(res.status, 403, res.text);
    assert.equal(res.json.error, 'forbidden');
  }
  // Nothing leaked and nothing was added by the refused attempts.
  const { rows } = await pool.query('SELECT * FROM blocked_email_domains');
  assert.equal(rows.length, 0);
});

test('operator adds, lists, removes; normalization, duplicates, invalid input', async () => {
  const op = await operator();
  const list0 = await req('/api/operator/blocked-domains', { cookie: op.cookie });
  assert.equal(list0.status, 200);
  assert.equal(list0.json.active_count, 0);
  assert.deepEqual(list0.json.entries, []);

  const bad = await addDomain(op.cookie, 'not-a-domain');
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'invalid_domain');
  assert.equal(bad.json.message, 'Enter a valid domain, like example.com.');

  // A full email address is accepted — its domain is what lists.
  const added = await addDomain(op.cookie, 'Someone@Spam.Example.COM.', 'junk sender');
  assert.equal(added.status, 201, added.text);
  assert.equal(added.json.domain, 'spam.example.com');
  assert.equal(added.json.status, 'active');
  assert.equal(added.json.note, 'junk sender');

  const dup = await addDomain(op.cookie, 'spam.example.com');
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error, 'domain_already_listed');
  assert.equal(dup.json.message, 'That domain is already on the list.');

  const list1 = await req('/api/operator/blocked-domains', { cookie: op.cookie });
  assert.equal(list1.json.active_count, 1);
  assert.equal(list1.json.entries.length, 1);

  const removed = await req(`/api/operator/blocked-domains/${added.json.id}`, {
    method: 'DELETE', cookie: op.cookie,
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.status, 'removed');
  assert.ok(removed.json.removed_at);

  const again = await req(`/api/operator/blocked-domains/${added.json.id}`, {
    method: 'DELETE', cookie: op.cookie,
  });
  assert.equal(again.status, 404);
  assert.equal(again.json.error, 'domain_not_listed');
  assert.equal(again.json.message, 'That domain is not on the list.');

  // Re-adding a removed domain revives the same row.
  const revived = await addDomain(op.cookie, '@spam.example.com');
  assert.equal(revived.status, 201, revived.text);
  assert.equal(revived.json.id, added.json.id);
  assert.equal(revived.json.status, 'active');
  const { rows } = await pool.query('SELECT * FROM blocked_email_domains');
  assert.equal(rows.length, 1);
});

test('blocked-domain signup is refused with zero side effects', async () => {
  const op = await operator();
  await addDomain(op.cookie, 'junkmail.test');
  const before = mailbox.length;
  const { rows: otpBefore } = await pool.query('SELECT COUNT(*)::int AS n FROM otp_codes');
  const res = await req('/api/auth/register', {
    method: 'POST', body: { email: 'victim@junkmail.test', password: PASSWORD },
  });
  assert.equal(res.status, 400, res.text);
  assert.equal(res.json.error, 'signup_email_unavailable');
  assert.equal(res.json.message, REFUSAL);
  // Nothing half-created: no user row, no new OTP, no mail.
  assert.equal(await userRow('victim@junkmail.test'), null);
  const { rows: otpAfter } = await pool.query('SELECT COUNT(*)::int AS n FROM otp_codes');
  assert.equal(otpAfter[0].n, otpBefore[0].n);
  assert.equal(mailbox.length, before);
  assert.equal(mailTo('victim@junkmail.test'), undefined);
});

test('matching is exact-domain and case-insensitive; subdomains are separate', async () => {
  const op = await operator();
  await addDomain(op.cookie, 'EXAMPLE.org');
  // Case-insensitive exact match refuses.
  const refused = await req('/api/auth/register', {
    method: 'POST', body: { email: 'Person@Example.ORG', password: PASSWORD },
  });
  assert.equal(refused.status, 400);
  assert.equal(refused.json.error, 'signup_email_unavailable');
  // A subdomain is NOT covered by the parent entry.
  const sub = await req('/api/auth/register', {
    method: 'POST', body: { email: 'person@mail.example.org', password: PASSWORD },
  });
  assert.equal(sub.status, 201, sub.text);
  assert.ok(await userRow('person@mail.example.org'));
  // A different domain that merely ends alike is not covered.
  const alike = await req('/api/auth/register', {
    method: 'POST', body: { email: 'person@notexample.org', password: PASSWORD },
  });
  assert.equal(alike.status, 201, alike.text);
});

test('unblocked signup is completely unchanged; removing the domain re-opens signup', async () => {
  const fresh = await registerVerifiedUser('fresh@ordinary.test');
  assert.ok(fresh.user.id);
  const op = await operator();
  const added = await addDomain(op.cookie, 'reopen.test');
  const refused = await req('/api/auth/register', {
    method: 'POST', body: { email: 'late@reopen.test', password: PASSWORD },
  });
  assert.equal(refused.status, 400);
  await req(`/api/operator/blocked-domains/${added.json.id}`, {
    method: 'DELETE', cookie: op.cookie,
  });
  const nowOk = await registerVerifiedUser('late@reopen.test');
  assert.ok(nowOk.user.id);
});

test('existing accounts are untouched by a later block', async () => {
  const member = await registerVerifiedUser('early@laterblocked.test');
  const biz = await req('/api/businesses', {
    method: 'POST', body: { name: 'Early Shop' }, cookie: member.cookie,
  });
  assert.equal(biz.status, 201);
  const op = await operator();
  await addDomain(op.cookie, 'laterblocked.test');
  // Sign-in still works exactly as before.
  const login = await req('/api/auth/login', {
    method: 'POST', body: { email: 'early@laterblocked.test', password: PASSWORD },
  });
  assert.equal(login.status, 200, login.text);
  // Re-registering still answers "already exists", not the refusal.
  const reReg = await req('/api/auth/register', {
    method: 'POST', body: { email: 'early@laterblocked.test', password: PASSWORD },
  });
  assert.equal(reReg.status, 409);
  assert.equal(reReg.json.error, 'already_registered');
  // A brand-new signup at the now-blocked domain is refused.
  const fresh = await req('/api/auth/register', {
    method: 'POST', body: { email: 'fresh@laterblocked.test', password: PASSWORD },
  });
  assert.equal(fresh.status, 400);
  assert.equal(fresh.json.error, 'signup_email_unavailable');
});

test('an unverified account predating the block still verifies', async () => {
  const reg = await req('/api/auth/register', {
    method: 'POST', body: { email: 'halfway@predated.test', password: PASSWORD },
  });
  assert.equal(reg.status, 201, reg.text);
  const op = await operator();
  await addDomain(op.cookie, 'predated.test');
  // Re-register (the code re-issue door) still works for the
  // existing row, and verification completes.
  const reReg = await req('/api/auth/register', {
    method: 'POST', body: { email: 'halfway@predated.test', password: PASSWORD },
  });
  assert.equal(reReg.status, 201, reReg.text);
  // The LATEST code mail is the live one (the re-issue supersedes).
  const latest = mailbox.filter((m) => m.to === 'halfway@predated.test').at(-1);
  const code = codeFromMail(latest);
  assert.ok(code);
  const verify = await req('/api/auth/verify', {
    method: 'POST', body: { email: 'halfway@predated.test', otpCode: code },
  });
  assert.equal(verify.status, 200, verify.text);
});

test('a pending staff invite is NOT exempt — the block stops invites too (owner reversal, Nov 22, 2026)', async () => {
  const owner = await ownerWithBusiness('invite-boss@shops.test', 'Invite Shop');
  const staffId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, 'Invited Person', 'newhire@invited.test', 'user', 'preset-sales', 'Sales clerk', '[]', 'invited', $3)`,
    [staffId, owner.business.id, owner.user.id],
  );
  const op = await operator();
  await addDomain(op.cookie, 'invited.test');
  // The invited address is refused exactly like a public signup:
  // same neutral wording, nothing created, no code mailed.
  const mailBefore = mailbox.length;
  const hire = await req('/api/auth/register', {
    method: 'POST', body: { email: 'newhire@invited.test', password: PASSWORD },
  });
  assert.equal(hire.status, 400, hire.text);
  assert.equal(hire.json.error, 'signup_email_unavailable');
  assert.equal(hire.json.message, REFUSAL);
  assert.equal(await userRow('newhire@invited.test'), null);
  assert.equal(mailbox.length, mailBefore);
  // The staff row is untouched: still invited, awaiting an
  // address that can register.
  const { rows } = await pool.query('SELECT status FROM staff_members WHERE id = $1', [staffId]);
  assert.equal(rows[0].status, 'invited');
  // And a stranger at the same domain is refused identically.
  const stranger = await req('/api/auth/register', {
    method: 'POST', body: { email: 'stranger@invited.test', password: PASSWORD },
  });
  assert.equal(stranger.status, 400);
  assert.equal(stranger.json.error, 'signup_email_unavailable');
});

test('pins: keyset, registry, and the refusal wording', async () => {
  const { en } = await import('../../src/lib/locales/en.js');
  const { esMX } = await import('../../src/lib/locales/es-MX.js');
  assert.equal(Object.keys(en).length, 6211);
  assert.equal(Object.keys(esMX).length, 6211);
  assert.equal(en['apiErrors.signupEmailUnavailable'], REFUSAL);
  assert.notEqual(esMX['apiErrors.signupEmailUnavailable'], REFUSAL);
  const { API_ERROR_MESSAGE_KEYS } = await import('../../src/lib/apiErrors.js');
  assert.equal(API_ERROR_MESSAGE_KEYS[REFUSAL], 'apiErrors.signupEmailUnavailable');
  assert.equal(API_ERROR_MESSAGE_KEYS['Enter a valid domain, like example.com.'], 'apiErrors.invalidDomain');
  assert.equal(API_ERROR_MESSAGE_KEYS['That domain is already on the list.'], 'apiErrors.domainAlreadyListed');
  assert.equal(API_ERROR_MESSAGE_KEYS['That domain is not on the list.'], 'apiErrors.domainNotListed');
  // The refusal never accuses and never names a list.
  assert.ok(!/block|list|spam|abuse/i.test(REFUSAL));
  // The operator endpoint path lives server-side only: no client
  // source file references it.
  const { readdirSync, readFileSync } = await import('node:fs');
  const srcDir = new URL('../../src/', import.meta.url);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const url = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    return e.isDirectory() ? walk(url) : [url];
  });
  for (const file of walk(srcDir)) {
    if (!/\.(js|jsx)$/.test(file.pathname)) continue;
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('blocked-domains'), `${file.pathname} references the operator path`);
    assert.ok(!text.includes('blocked_email_domains'), `${file.pathname} references the operator table`);
  }
});
