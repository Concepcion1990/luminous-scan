/**
 * Release 336 — the direct-deposit build: the e-signature step, the
 * sealed signed-form record, the owner's full-numbers form read, the
 * arrival bells, and BOTH correction doors (owner send-back and the
 * member's own fix-and-resubmit). A correction always writes a NEW
 * sealed submission and supersedes the old one — the sealed record is
 * never silently edited, and the superseded form stays readable to
 * the owner MASKED in the history. Also covers the payroll finishing
 * pieces: GET /payroll/context carries the caller's OWN name + home
 * address (me_profile) and never anyone else's, and staff removal
 * purges sealed submissions with the bank details.
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
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

const WF = (bid) => `/api/businesses/${bid}/workforce`;

async function addTeamMember(business, ownerId, email, { manager = false, name, address } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id, personal_address)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, '[]', 'active', $7, $8)`,
    [
      id,
      business.id,
      name || (manager ? 'Manny Manager' : 'Sam Staff'),
      email,
      manager ? 'preset-manager' : 'preset-sales',
      manager ? 'Manager' : 'Sales clerk',
      ownerId,
      address || '',
    ],
  );
  const account = await registerVerifiedUser(email);
  return { staffId: id, email, cookie: account.cookie, user: account.user };
}

async function setupDd(email) {
  const ctx = await ownerWithBusiness(email);
  await req(`${WF(ctx.business.id)}/settings`, {
    method: 'PATCH',
    body: { dd_enabled: true },
    cookie: ctx.cookie,
  });
  return ctx;
}

const FORM = {
  bank_name: 'First Test Bank',
  account_type: 'checking',
  routing_number: '123456789',
  account_number: '987654321',
  signature_name: 'Sam Staff',
  signature_style: 'script',
};

test('dd signature: unsigned or badly-styled submits are refused; nothing is stored', async () => {
  const { cookie: ownerCookie, business, user: owner } = await setupDd('dd336-nosig@example.com');
  const staff = await addTeamMember(business, owner.id, 'dd336-nosig-staff@example.com');
  await req(`${WF(business.id)}/dd/invite`, { method: 'POST', body: { staff_member_id: staff.staffId }, cookie: ownerCookie });

  const noSig = await req(`${WF(business.id)}/dd/submit`, {
    method: 'POST',
    body: { bank_name: 'First Test Bank', account_type: 'checking', routing_number: '123456789', account_number: '987654321' },
    cookie: staff.cookie,
  });
  assert.equal(noSig.status, 400);

  const badStyle = await req(`${WF(business.id)}/dd/submit`, {
    method: 'POST',
    body: { ...FORM, signature_style: 'fancy' },
    cookie: staff.cookie,
  });
  assert.equal(badStyle.status, 400);

  const mine = await req(`${WF(business.id)}/dd`, { cookie: staff.cookie });
  assert.equal(mine.json.mine.status, 'invited', 'a refused submit must not advance the status');
  const subs = await pool.query('SELECT COUNT(*)::int AS n FROM direct_deposit_submissions WHERE staff_member_id = $1', [staff.staffId]);
  assert.equal(subs.rows[0].n, 0, 'a refused submit seals nothing');
});

test('dd sealed form: signed submit seals a submission, rings the owner, owner reads full form', async () => {
  const { cookie: ownerCookie, business, user: owner } = await setupDd('dd336-seal@example.com');
  const staff = await addTeamMember(business, owner.id, 'dd336-seal-staff@example.com');
  const manager = await addTeamMember(business, owner.id, 'dd336-seal-mgr@example.com', { manager: true });

  await req(`${WF(business.id)}/dd/invite`, { method: 'POST', body: { staff_member_id: staff.staffId }, cookie: ownerCookie });

  // The invite rings the member's bell.
  const staffInbox = await req(`${WF(business.id)}/notifications`, { cookie: staff.cookie });
  assert.ok(staffInbox.json.notifications.some((n) => n.event === 'dd_invited'), 'invite rings the member');

  const submit = await req(`${WF(business.id)}/dd/submit`, { method: 'POST', body: FORM, cookie: staff.cookie });
  assert.equal(submit.status, 200);
  assert.equal(submit.json.corrected, false);
  assert.ok(!JSON.stringify(submit.json).includes('987654321'));

  // Sealed row exists and mirrors the details row's signature.
  const subs = await pool.query('SELECT * FROM direct_deposit_submissions WHERE staff_member_id = $1', [staff.staffId]);
  assert.equal(subs.rows.length, 1);
  assert.equal(subs.rows[0].signature_name, 'Sam Staff');
  assert.equal(subs.rows[0].signature_style, 'script');
  assert.equal(subs.rows[0].account_number, '987654321');
  assert.equal(subs.rows[0].superseded_at, null);

  // The owner's bell rang with the arrival.
  const ownerInbox = await req(`${WF(business.id)}/notifications`, { cookie: ownerCookie });
  assert.ok(ownerInbox.json.notifications.some((n) => n.event === 'dd_submitted'), 'owner notified on submit');

  // Owner's full form read: full numbers + sealed form + member name.
  const full = await req(`${WF(business.id)}/dd/details/${staff.staffId}`, { cookie: ownerCookie });
  assert.equal(full.status, 200);
  assert.equal(full.json.details.account_number, '987654321');
  assert.equal(full.json.member_name, 'Sam Staff');
  assert.equal(full.json.form.account_number, '987654321');
  assert.equal(full.json.form.signature_name, 'Sam Staff');
  assert.deepEqual(full.json.history, []);

  // Nobody else can read it — manager and the member themself included.
  for (const who of [manager, staff]) {
    const denied = await req(`${WF(business.id)}/dd/details/${staff.staffId}`, { cookie: who.cookie });
    assert.equal(denied.status, 403);
    assert.ok(!JSON.stringify(denied.json).includes('987654321'));
  }

  // The owner's team list carries the signed state but stays masked.
  const team = await req(`${WF(business.id)}/dd`, { cookie: ownerCookie });
  const row = team.json.team.find((r) => r.staff_member_id === staff.staffId);
  assert.equal(row.submission_count, 1);
  assert.ok(row.signed_at);
  assert.ok(!JSON.stringify(team.json).includes('987654321'));
});

test('dd correction: owner send-back reopens the form; resubmit supersedes and history stays masked', async () => {
  const { cookie: ownerCookie, business, user: owner } = await setupDd('dd336-fix@example.com');
  const staff = await addTeamMember(business, owner.id, 'dd336-fix-staff@example.com');
  await req(`${WF(business.id)}/dd/invite`, { method: 'POST', body: { staff_member_id: staff.staffId }, cookie: ownerCookie });
  await req(`${WF(business.id)}/dd/submit`, { method: 'POST', body: FORM, cookie: staff.cookie });

  // Send-back on a member who has not submitted is refused.
  const other = await addTeamMember(business, owner.id, 'dd336-fix-other@example.com');
  const tooEarly = await req(`${WF(business.id)}/dd/send-back`, { method: 'POST', body: { staff_member_id: other.staffId }, cookie: ownerCookie });
  assert.equal(tooEarly.status, 400);

  // Only the owner sends back.
  const staffSendBack = await req(`${WF(business.id)}/dd/send-back`, { method: 'POST', body: { staff_member_id: staff.staffId }, cookie: staff.cookie });
  assert.equal(staffSendBack.status, 403);

  const back = await req(`${WF(business.id)}/dd/send-back`, { method: 'POST', body: { staff_member_id: staff.staffId }, cookie: ownerCookie });
  assert.equal(back.status, 200);
  const mine = await req(`${WF(business.id)}/dd`, { cookie: staff.cookie });
  assert.equal(mine.json.mine.status, 'correction_requested');
  const staffInbox = await req(`${WF(business.id)}/notifications`, { cookie: staff.cookie });
  assert.ok(staffInbox.json.notifications.some((n) => n.event === 'dd_correction_requested'), 'send-back rings the member');

  // The member corrects one digit and re-signs with a different style.
  const fixed = await req(`${WF(business.id)}/dd/submit`, {
    method: 'POST',
    body: { ...FORM, account_number: '987654322', signature_style: 'italic' },
    cookie: staff.cookie,
  });
  assert.equal(fixed.status, 200);
  assert.equal(fixed.json.corrected, true);

  // Two sealed rows: the first superseded, the second current; details mirror the new one.
  const subs = await pool.query(
    'SELECT * FROM direct_deposit_submissions WHERE staff_member_id = $1 ORDER BY submitted_at ASC',
    [staff.staffId],
  );
  assert.equal(subs.rows.length, 2);
  assert.ok(subs.rows[0].superseded_at, 'the first form is stamped superseded, never edited');
  assert.equal(subs.rows[0].account_number, '987654321', 'the superseded form keeps its original numbers');
  assert.equal(subs.rows[1].account_number, '987654322');
  assert.equal(subs.rows[1].superseded_at, null);

  const full = await req(`${WF(business.id)}/dd/details/${staff.staffId}`, { cookie: ownerCookie });
  assert.equal(full.json.form.account_number, '987654322');
  assert.equal(full.json.details.account_number, '987654322');
  assert.equal(full.json.history.length, 1);
  assert.equal(full.json.history[0].account_masked, '****4321');
  assert.ok(!JSON.stringify(full.json.history).includes('987654321'), 'history never carries full numbers');
  assert.ok(full.json.history[0].superseded_at);

  const ownerInbox = await req(`${WF(business.id)}/notifications`, { cookie: ownerCookie });
  assert.ok(ownerInbox.json.notifications.some((n) => n.event === 'dd_corrected'), 'owner notified of the correction');
});

test('dd correction: a member can fix their own typo without waiting for a send-back', async () => {
  const { cookie: ownerCookie, business, user: owner } = await setupDd('dd336-self@example.com');
  const staff = await addTeamMember(business, owner.id, 'dd336-self-staff@example.com');
  await req(`${WF(business.id)}/dd/invite`, { method: 'POST', body: { staff_member_id: staff.staffId }, cookie: ownerCookie });
  await req(`${WF(business.id)}/dd/submit`, { method: 'POST', body: FORM, cookie: staff.cookie });

  const again = await req(`${WF(business.id)}/dd/submit`, {
    method: 'POST',
    body: { ...FORM, routing_number: '123456788' },
    cookie: staff.cookie,
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.corrected, true);
  const subs = await pool.query('SELECT COUNT(*)::int AS n FROM direct_deposit_submissions WHERE staff_member_id = $1', [staff.staffId]);
  assert.equal(subs.rows[0].n, 2);
});

test('payroll context: me_profile is the caller\'s own name + address, never another member\'s', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('dd336-profile@example.com');
  const staff = await addTeamMember(business, owner.id, 'dd336-profile-staff@example.com', { address: '12 Desert Lane, Santa Fe, NM' });
  const other = await addTeamMember(business, owner.id, 'dd336-profile-other@example.com', { name: 'Ollie Other', address: '99 Other Road' });

  const mine = await req(`${WF(business.id)}/payroll/context`, { cookie: staff.cookie });
  assert.equal(mine.json.me_profile.full_name, 'Sam Staff');
  assert.equal(mine.json.me_profile.personal_address, '12 Desert Lane, Santa Fe, NM');
  assert.ok(!JSON.stringify(mine.json.me_profile).includes('Other Road'));

  const theirs = await req(`${WF(business.id)}/payroll/context`, { cookie: other.cookie });
  assert.equal(theirs.json.me_profile.personal_address, '99 Other Road');

  // The owner has no staff row of their own here, so no profile card data.
  const ownerCtx = await req(`${WF(business.id)}/payroll/context`, { cookie: ownerCookie });
  assert.equal(ownerCtx.json.me_profile, null);
});

test('offboarding purges sealed submissions with the bank details', async () => {
  const { cookie: ownerCookie, business, user: owner } = await setupDd('dd336-purge@example.com');
  const staff = await addTeamMember(business, owner.id, 'dd336-purge-staff@example.com');
  await req(`${WF(business.id)}/dd/invite`, { method: 'POST', body: { staff_member_id: staff.staffId }, cookie: ownerCookie });
  await req(`${WF(business.id)}/dd/submit`, { method: 'POST', body: FORM, cookie: staff.cookie });

  const removed = await req(`/api/businesses/${business.id}/staff/${staff.staffId}`, { method: 'DELETE', cookie: ownerCookie });
  assert.equal(removed.status, 200);
  const subs = await pool.query('SELECT COUNT(*)::int AS n FROM direct_deposit_submissions WHERE staff_member_id = $1', [staff.staffId]);
  assert.equal(subs.rows[0].n, 0, 'sealed submissions are purged on removal');
  const det = await pool.query('SELECT COUNT(*)::int AS n FROM direct_deposit_details WHERE staff_member_id = $1', [staff.staffId]);
  assert.equal(det.rows[0].n, 0);
});
