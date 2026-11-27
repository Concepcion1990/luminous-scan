/**
 * T23 — In-app issue reporting ("Report a problem", Nov 13, 2026).
 *
 * The owner's design: any signed-in user — owner, manager or staff,
 * on any plan or none — can report a problem from Settings. The
 * endpoint is ACCOUNT-level (POST /api/support/report), never under
 * /api/businesses/:bid/*, so the paid-access lock cannot lock out a
 * person hit by a bug. A restricted recovery session must NOT be
 * able to report. The app attaches only fixing context (page, plan
 * when an entitled workspace is selected, business name/id + role
 * ONLY when the user legitimately has that business selected, app
 * locale, user-agent) — never inventory data. Every report is saved
 * (migration 017 support_reports) AND emailed to the support inbox
 * through the Resend mailer; a mailer failure never loses the
 * report and never fails the request. Abuse guards: category enum,
 * message 3–2000 chars trimmed, max 5 per user per rolling 24h.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  close,
  cookieFrom,
  mailbox,
  ownerWithBusiness,
  pool,
  registerVerifiedUser,
  req,
} from './helpers.js';
import { __setMailSink } from '../../server/email.js';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { TRAINING_LESSONS as trainingCatalog } from '../../server/trainingCatalog.js';

after(close);

const SUPPORT_INBOX = 'theluminousbookshop@outlook.com';
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function reportRows(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM support_reports WHERE user_id = $1 ORDER BY created_at ASC',
    [userId],
  );
  return rows;
}

test('unauthenticated report is refused with 401 and saves nothing', async () => {
  const res = await req('/api/support/report', {
    method: 'POST',
    body: { category: 'broken', message: 'The till screen is blank.' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.json.error, 'not_signed_in');
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM support_reports');
  assert.equal(rows[0].n, 0);
});

test('happy path: owner report saves snapshots and emails the support inbox', async () => {
  const { cookie, user, business } = await ownerWithBusiness(
    'support-owner@example.com',
    'Corner Books',
    { plan: 'business' },
  );
  const switched = await req(`/api/businesses/${business.id}/switch`, {
    method: 'POST',
    cookie,
    body: {},
  });
  assert.equal(switched.status, 200, switched.text);
  const message = 'The scanner button does nothing when I tap it.';
  const res = await req('/api/support/report', {
    method: 'POST',
    cookie,
    headers: { 'User-Agent': 'Mozilla/5.0 (TestPhone; Android 15)' },
    body: { category: 'broken', message, page: '/inventory', locale: 'en' },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.ok, true);
  assert.ok(res.json.id);

  const rows = await reportRows(user.id);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.id, res.json.id);
  assert.equal(row.reporter_email, 'support-owner@example.com');
  assert.equal(row.business_id, business.id);
  assert.equal(row.business_name, 'Corner Books');
  assert.equal(row.role, 'owner');
  assert.equal(row.category, 'broken');
  assert.equal(row.message, message);
  assert.equal(row.status, 'new');
  const context = JSON.parse(row.context);
  assert.equal(context.page, '/inventory');
  assert.equal(context.plan, 'business');
  assert.equal(context.locale, 'en');
  assert.equal(context.user_agent, 'Mozilla/5.0 (TestPhone; Android 15)');

  const mail = mailbox.find(
    (m) => m.to === SUPPORT_INBOX && m.subject.includes('Problem report'),
  );
  assert.ok(mail, 'support notification email captured');
  assert.ok(mail.subject.includes('Something is broken'));
  assert.ok(mail.text.includes(message), 'message verbatim in the email');
  assert.ok(mail.text.includes('support-owner@example.com'), 'reporter address in the email');
  assert.ok(mail.text.includes('Corner Books'), 'business name in the email');
  assert.ok(mail.text.includes('/inventory'), 'page in the email');
  assert.ok(mail.text.includes('Plan: Business'), 'plan in the email');
});

test('user with no business selected can still report; no business or plan attached', async () => {
  const { cookie, user } = await registerVerifiedUser('support-nobiz@example.com');
  const res = await req('/api/support/report', {
    method: 'POST',
    cookie,
    body: { category: 'idea', message: 'A dark mode would help at night.' },
  });
  assert.equal(res.status, 201, res.text);
  const rows = await reportRows(user.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].business_id, null);
  assert.ok(!rows[0].business_name, 'business name omitted');
  assert.ok(!rows[0].role, 'role omitted');
  const context = JSON.parse(rows[0].context);
  assert.equal(context.plan, null);
});

test('an active business the user has no access to is omitted, never stored, never an error', async () => {
  const other = await ownerWithBusiness('support-other@example.com', 'Not Yours Books');
  const { cookie, user } = await registerVerifiedUser('support-outsider@example.com');
  // Point the user's selected business at a store they do not belong
  // to (stale or tampered state) and also spoof it in the body.
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [
    other.business.id,
    user.id,
  ]);
  const res = await req('/api/support/report', {
    method: 'POST',
    cookie,
    body: {
      category: 'looks_wrong',
      message: 'The totals look off on my screen.',
      businessId: other.business.id,
      business_id: other.business.id,
    },
  });
  assert.equal(res.status, 201, res.text);
  const rows = await reportRows(user.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].business_id, null);
  assert.ok(!rows[0].business_name, 'business name omitted');
  assert.ok(!rows[0].role, 'role omitted');
  assert.equal(JSON.parse(rows[0].context).plan, null);
});

test('validation: category enum and message length rules', async () => {
  const { cookie, user } = await registerVerifiedUser('support-validate@example.com');
  const post = (body) => req('/api/support/report', { method: 'POST', cookie, body });

  const badCategory = await post({ category: 'angry', message: 'Everything is bad.' });
  assert.equal(badCategory.status, 400);
  assert.equal(badCategory.json.error, 'support_invalid_category');

  const missing = await post({ category: 'broken' });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.error, 'support_message_required');

  const tooShort = await post({ category: 'broken', message: 'ab' });
  assert.equal(tooShort.status, 400);
  assert.equal(tooShort.json.error, 'support_message_too_short');

  const tooLong = await post({ category: 'broken', message: 'x'.repeat(2001) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.json.error, 'support_message_too_long');

  const minOk = await post({ category: 'other', message: 'abc' });
  assert.equal(minOk.status, 201, minOk.text);
  const maxOk = await post({ category: 'other', message: 'y'.repeat(2000) });
  assert.equal(maxOk.status, 201, maxOk.text);

  // Only the two valid reports were saved — failures never consume quota.
  const rows = await reportRows(user.id);
  assert.equal(rows.length, 2);
  // Messages are stored trimmed.
  const padded = await post({ category: 'other', message: '   padded message   ' });
  assert.equal(padded.status, 201);
  const after3 = await reportRows(user.id);
  assert.equal(after3[2].message, 'padded message');
});

test('rate limit: five reports per rolling 24 hours, the sixth is a 429', async () => {
  const { cookie, user } = await registerVerifiedUser('support-ratelimit@example.com');
  const post = () =>
    req('/api/support/report', {
      method: 'POST',
      cookie,
      body: { category: 'broken', message: 'It broke again just now.' },
    });
  for (let i = 0; i < 5; i += 1) {
    const res = await post();
    assert.equal(res.status, 201, `report ${i + 1}: ${res.text}`);
  }
  const sixth = await post();
  assert.equal(sixth.status, 429);
  assert.equal(sixth.json.error, 'support_rate_limited');
  assert.equal((await reportRows(user.id)).length, 5);

  // Once the oldest report is more than 24 hours old, it stops
  // counting and a new report is allowed again.
  await pool.query(
    `UPDATE support_reports SET created_at = NOW() - INTERVAL '25 hours'
     WHERE id = (SELECT id FROM support_reports WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1)`,
    [user.id],
  );
  const afterWindow = await post();
  assert.equal(afterWindow.status, 201, afterWindow.text);
  assert.equal((await reportRows(user.id)).length, 6);
});

test('mailer failure: the report is still saved and the user still sees success', async () => {
  const { cookie, user } = await registerVerifiedUser('support-mailfail@example.com');
  __setMailSink(async () => {
    throw new Error('simulated Resend outage');
  });
  try {
    const res = await req('/api/support/report', {
      method: 'POST',
      cookie,
      body: { category: 'broken', message: 'Checkout froze on the last step.' },
    });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.ok, true);
  } finally {
    __setMailSink(async (message) => {
      mailbox.push(message);
    });
  }
  const rows = await reportRows(user.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].message, 'Checkout froze on the last step.');
});

test('CSRF: a report POST without a token is refused like every other POST', async () => {
  const { cookie, user } = await registerVerifiedUser('support-csrf@example.com');
  const res = await req('/api/support/report', {
    method: 'POST',
    cookie,
    csrf: false,
    body: { category: 'broken', message: 'No token on this one.' },
  });
  assert.equal(res.status, 403);
  assert.match(res.json.error, /csrf/);
  assert.equal((await reportRows(user.id)).length, 0);
});

test('restricted recovery session cannot report a problem', async () => {
  const email = 'support-recovery@example.com';
  const { cookie, password, user } = await registerVerifiedUser(email);
  const gen = await req('/api/account/backup-codes', {
    method: 'POST',
    cookie,
    body: { password },
  });
  assert.equal(gen.status, 200, gen.text);
  const code = gen.json.codes[0];
  const recovered = await req('/api/auth/recover', {
    method: 'POST',
    csrf: false,
    body: { email, backup_code: code },
  });
  assert.equal(recovered.status, 200, recovered.text);
  assert.equal(recovered.json.recovery, true);
  const recoveryCookie = cookieFrom(recovered.setCookie);
  assert.ok(recoveryCookie);
  const res = await req('/api/support/report', {
    method: 'POST',
    cookie: recoveryCookie,
    body: { category: 'broken', message: 'Trying from a recovery session.' },
  });
  assert.equal(res.status, 403, res.text);
  assert.equal((await reportRows(user.id)).length, 0);
});

test('plans parity: both plans and the comparison table carry in-app problem reporting', () => {
  const plansSrc = fs.readFileSync(path.join(repoRoot, 'src/lib/plans.js'), 'utf8');
  const includesCount = plansSrc.split("t('plansLib.includes.support')").length - 1;
  // Exactly 3 since the dedupe ruling (Nov 19, 2026): the line
  // is named in the Essentials lists of both families (PLANS +
  // WELCOME) and in the comparison table. Business has the
  // feature, but its lists carry it under "Everything in
  // Essentials" instead of repeating the line.
  assert.equal(
    includesCount,
    3,
    `support include expected in Essentials PLANS + WELCOME + comparison row, found ${includesCount}`,
  );
  assert.ok(
    plansSrc.includes("get label() { return t('plansLib.includes.support'); }"),
    'comparison-table row present',
  );
  assert.equal(en['plansLib.includes.support'], 'In-app problem reporting');

  const settingsSrc = fs.readFileSync(path.join(repoRoot, 'src/pages/Settings.jsx'), 'utf8');
  assert.ok(settingsSrc.includes('<SupportCard'), 'Settings mounts the report card');
  const cardSrc = fs.readFileSync(
    path.join(repoRoot, 'src/components/business/SupportCard.jsx'),
    'utf8',
  );
  assert.ok(cardSrc.includes('support.contextNote'), 'card shows the transparency line');
  const libSrc = fs.readFileSync(path.join(repoRoot, 'src/lib/support.js'), 'utf8');
  assert.ok(libSrc.includes("'/api/support/report'"), 'client posts to the account-level endpoint');
});

const NEW_KEYS = [
  'plansLib.includes.support',
  'support.title',
  'support.description',
  'support.categoryLabel',
  'support.category.broken',
  'support.category.looksWrong',
  'support.category.idea',
  'support.category.other',
  'support.messageLabel',
  'support.messagePlaceholder',
  'support.contextNote',
  'support.urgentNote',
  'support.submit',
  'support.sending',
  'support.sentTitle',
  'support.sentBody',
  'support.sendAnother',
  'support.errorGeneric',
  'support.errorTooShort',
  'support.errorTooLong',
  'support.errorRateLimit',
  ...['report-problem', 'mgr-report-problem', 'owner-report-problem'].flatMap((id) => [
    `training.lessons.${id}.title`,
    `training.lessons.${id}.step1`,
    `training.lessons.${id}.step2`,
    `training.lessons.${id}.step3`,
    `training.lessons.${id}.step4`,
  ]),
];

test('locale parity: all 52 locales carry the 36 new keys; tranche-1 locales are translated', async () => {
  assert.equal(NEW_KEYS.length, 36);
  const enKeys = Object.keys(en).sort();
  assert.equal(enKeys.length, 6256); // The eBay storefront batch (release 362, Nov 23, 2026) added 46 more (the Storefront connections door and its wordings, the eBay plan line carried on both plans, the connect-your-eBay lesson, and the five storefront API wordings), for 5780. The invoice-file batch (Nov 23, 2026) added 11 more (the supplier invoice paper copy: its attach door and hint, the attached label, the view and remove doors, the over-25-MB refusal, and the five API wordings for the file door and the restaurant plan gate), for 5734. The restaurant operations batch (Nov 23, 2026) added 390 more (the twelve restaurant operations doors and their dialogs, the supplier-invoice three-way match and vendor price alerts, the waste log, expiry and allergen wordings, temperature logs, the 86 board, staff meals, batch runs, the two restaurant plan lines, the four restaurant-operations lessons and the three new API wordings), for 5723. The cross-store messages batch (Nov 23, 2026) added 25 more (the account-wide messaging door: its nav label, its plan line, the door's own wordings, the two API refusal wordings, and the three cross-store lessons), for 5333. The restaurant corner batch (Nov 23, 2026) added 172 more (the corner's two pages and their dialogs, the order guide, the dish card, the three restaurant enrollment ticks, the five restaurant lessons and the nine recipe/par API wordings), for 5308. The time trails batch (Nov 23, 2026) added 6 more (the trail heading, Created, Saved, Logged, Sent for review, and the former-team-member fallback), for 5136. The document frames batch (Nov 23, 2026) added 4 more (the printed-at stamp + the Studio's picture width/length labels and size hint), for 5130. The returns build batch (Nov 22, 2026) added 9 more (the tax on a return + its four source notes, and scan-to-pick on the Returned items — its button, window title, hint and added note), for 5126. The list-prices batch (Nov 22, 2026) added 1 more (the plans line for each product's price beside its count), for 5117. The tax-automatic batch (Nov 22, 2026) added 10 more (the tax mode switch + its two options and hint, the three order-form automatic-tax hints, the plans line, and the new steps of the two tax lessons), for 5117. The invite hardening batch (Nov 22, 2026) added 5 more (the spent-invite-link refusal, the signed-in connected panel and its door, and the fifth steps of the two invite lessons), for 5106. The signup domain blocklist batch (Nov 22, 2026) added 4 more (the neutral signup refusal + the three operator domain-list wordings), for 5101. The failed-payment road batch (Nov 21, 2026) added 2 more (the past-due fix-by line + the owner-billing lesson's fifth step), for 5097. The order-form label-upload batch (Nov 18, 2026) added 3 more (orders.shippingLabel, orders.uploadLabel, orders.labelStagedNote), for 4633. The GS1 learn-more batch (Nov 18, 2026) added 3 more (settings.details.gs1LearnMore, settings.details.gs1LearnMoreUs, settings.details.gs1GlobalSite), for 4636. // +1 tracking scan (Nov 18, 2026); +5 scan-to-tally (Nov 16, 2026); 3954 at the POS + deletion batch; +14 account-security (change password + staff reset); +1 white-label reset step; +13 locations/orders train; +2 edit-quantity; +2 photo chooser; +2 in-form scan; +4 category combobox; +3 product delete; +2 category edit door; +1 count-sheet scanner; +2 archived freeze; +3 import cap-awareness; +1 receive step; +1 draft notice; +3 owner-import lesson; +46 carrier labels + document style; +13 code generator; +10 GS1 mode +1 About bookshop lead-in (Nov 15, 2026). The lesson-visual fix batch (Nov 15, 2026) added 2 more (the wide view’s See it full screen / Back to the lesson labels), for 4125. The carrier-door fix (Nov 15, 2026) added 1 more (the Upload button’s pick-an-order-first guidance), for 4126. The bulk-delete batch (Nov 15, 2026) added 12 more (11 bulk-delete UI keys + the products-find-edit step 11 it teaches), for 4138. The plan-lists batch (Nov 15, 2026) added 3 more (the bulk edit/delete plans line + the Mobile label-printing and Mobile training lines), for 4141. The full-app translation sweep batch (Nov 15, 2026) added 64 more (the About page, the notice block, legal-page chrome, the 404 page and the sweep stragglers, all ×52), for 4205. The leftovers sweep (Nov 15, 2026) added 419 more (the apiErrors.* API-error banner strings, x52), for 4624. The staff-settings batch (Nov 19, 2026) added 57 more (personal Settings + enrollment grants + shift windows + welcome + install door + neutral stop + universal sign-out link + owner note), for 4693. The plan-presentation extension (Nov 19, 2026) added 7 more (the plansLib.includes lines for this batch, on Plans + Welcome + the in-app plan page alike), for 4700. The money-surfaces audit additions (Nov 19, 2026) added 3 more (the Subscribe member card + the plan-neutral limit refusal), for 4703. The owner confidentiality lesson (Nov 19, 2026) added 5 more (title + 4 steps, owner track only), for 4708. The contact-details ruling (Nov 19, 2026) added 6 more (the address & phone tick + hint + the read-only business card), for 4714. The enrollment pay/contact batch (Nov 19, 2026) added 2 more (the member's home address + phone labels in the staff dialog), for 4716. The returns-approval gate (Nov 19, 2026) added 6 more (the returns.complete enrollment tick + its area heading + hint, the two waiting-for-approval notes and the API refusal wording), for 4740. The no-dangling-doors batch (Nov 19, 2026) added 3 more (the products.create enrollment tick + its area heading + hint), for 4743. The field-scanners batch (Nov 19, 2026) added 5 more (the ISBN digits reader: its title, hint, Read number button, reading line and plain refusal), for 4748. The add-location tick batch (Nov 19, 2026) added 4 more (the locations.create enrollment tick + its area heading + hint, and the add-a-location refusal wording), for 4752. The business-policies batch (Nov 19, 2026) added 34 more (the owner's own store policies + terms in Settings, the platform-policies card, the welcome showing, the plans line, the three policy API wordings, the owner store-policies lesson and the welcome-basics step, plus the two policy 404 wordings), for 4786. The staff-roster tick batch (Nov 19, 2026) added 3 more (the staff.roster enrollment tick + its area heading + hint), for 4789. The schedule-doors batch (Nov 20, 2026) added 3 more (the schedule card Clear button + the message composer character counter and limit note) and removed 1 (the inbox markRead label — the button is gone), for 4791. The low-stock ticks batch (Nov 20, 2026) added 6 more (the two Business low-stock enrollment ticks — alerts.view and products.reorder — with their area heading and hint, and the reorder-change and alerts-view refusal wordings), for 4797. The training builds batch (Nov 20, 2026) added 98 more (the per-lesson quizzes and comments, the owner's policy quizzes with their Settings editor and staff ticks, five new lessons, the welcome sign-out step, and the confidentiality map steps), for 4895. The training builds batch (Nov 20, 2026) added 23 more (the API error wordings for the owner's policy quizzes, the lesson-quiz gate, lesson comments and team records), for 4918. The profile photos batch (Nov 21, 2026) added 43 more (the profile photo card and the owner's approval card, the owner's display name, the plans line, five API error wordings, and the two profile-photo lessons), for 4961. The direct-deposit batch (Nov 21, 2026) added 31 more (the signature step + sealed form, both correction doors, the member's details-on-file card, the pay-stub print door, three API error wordings, and the owner lesson's fifth step), for 4992. The rider batch (Nov 21, 2026) added 6 more (the owner’s own details-on-file card with its edit door, the viewer’s own Payroll view, and two API error wordings), for 4998. The founding-tester comp batch (Nov 21, 2026) added 9 more (the founding-tester plan status + no-charge note, the Subscribe card, the Upgrade intro + note, and the four operator-list API wordings), for 5007. The clock build (Nov 21, 2026) added 44 more (the staff.clock tick + area + hint, the call-in gate and window, the missed clock-out flag, the Staff call-ins card and fix-times dialog, seven API error wordings, and the call-ins and clock corrections lesson), for 5051. The staff documents build (Nov 21, 2026) added 44 more (the staff.documents tick + area + hint, the red warning, the documents card and dialog, the plans line, five API error wordings, and the owner + manager staff-documents lessons), for 5095. The import robustness batch (release 365, Nov 23, 2026) added 8 more (the photo import field and its problems heading, the quantity-marriage guard, the no-location units warning, the 25 MB import refusal, the selling-price label, and the import lesson's two new steps), for 5788. The photo door fix (release 366, Nov 24, 2026) added 8 more (the photos-on-their-way import line, the Products photo progress line and its still-on-their-way count, the Bring in missing photos door and its two answers, the on-product photo problem note, and the import lesson’s fifth step), for 5796. The print family batch (Nov 24, 2026) added 5 more (the blank-forms door and its hint, the blank-form hand-fill subtitle, and the product-name and time column heads), for 5801. The product form batch (Nov 24, 2026) added 6 more (the product Format field: its form label, the Paperback and Hardcover options, the details-row label, and the create + update import field labels), for 5807. The owner's pick-list correction later the same day added 1 more (the Format pick-list's "Add a format…" door), for 5808. The photo capture batch (Nov 24, 2026) added 4 more (the product photo camera door: its Take the photo shutter, the Retake and Use this photo doors, and the camera-could-not-be-used line), for 5812. The clock tick split + documents self-door batch (Nov 24, 2026) added 8 more (the two clock tick labels, the two split clock-admin refusal wordings, and the four staff-documents self-door keys) and removed 2 (the old combined tick label and its refusal), for 5818. The restaurant IA batch (release 377, Nov 25, 2026) added 27 more (the six shelf names + the Locations shelf name, the Today page's title, subtitle and four attention lines, the shelves heading, the shelf back link, the Locations page's three lines, the Recipes door line, and the six shelf plan lines that regroup the corner's features on Plans + Welcome + the comparison table), for 5845. The paper-trail batch (release 378, Nov 25, 2026) added 63 more (the manager log book page and its training lesson, the supplier credit memo section and dialog with the invoice standing lines, the count-sanity warning, the two shelf cross-link lines, the log book plan line, and the three credit-memo API wordings), for 5908. The smalls bundle (Nov 25, 2026) added 5 more (the inherited-plan note, the date-format picker’s Automatic option + its hint, and the credit-memo paper’s title + record note), for 5913. The prints build (Nov 25, 2026) added 18 more (the record papers' five titles, the policies file note, the week/period/hours/lesson/score labels, the record-prints plan line, and the staff-record-prints lesson's title + five steps), for 5931. The age check build (Nov 25, 2026) added 27 more (the age check panel and its verdict words, the category labels and line note, the Settings age-lines card, the age-check plan line, and the scanner-age-check lesson’s title + five steps), for 6256.
  for (const key of NEW_KEYS) assert.ok(key in en, `en missing ${key}`);
  assert.equal(Object.keys(LOCALES).length, 52);
  for (const code of Object.keys(LOCALES)) {
    const table = LOCALES[code];
    assert.deepEqual(Object.keys(table).sort(), enKeys, `${code} key set differs from en`);
    for (const key of NEW_KEYS) assert.ok(key in table, `${code} missing ${key}`);
  }
  for (const code of ['am', 'ar', 'bn', 'bho']) {
    const table = LOCALES[code];
    for (const key of NEW_KEYS) {
      assert.notEqual(table[key], en[key], `${code} still carries English for ${key}`);
    }
  }
});

test('training: three report-a-problem lessons, one per role, catalog at 92 (count long since grown; the pin below carries the chain)', () => {
  // 78 when this test was written; the POS provider expansion
  // added 6 owner lessons and the deletion-request flow 1 more;
  // the training-invisibility split (Nov 14, 2026) added 1 more
  // (owner-import, the Essentials-only importing lesson); the
  // set-once tax rate (Nov 15, 2026) added owner-tax-rate; the
  // staff batch (Nov 19, 2026) added 4: the three shift-window
  // lessons (one per role) and the owner confidentiality lesson.
  // The training builds batch (Nov 20, 2026) added 5 more
  // (download-the-app, staff-reports, staff-cross-store,
  // staff-builds, mgr-tax-rate), for 97.
  assert.equal(trainingCatalog.length, 123); // 123 since the kitchen-menu build (plan release 371, Nov 26, 2026) added 1 (staff-kitchen-menu, Business-only, restaurant heading); 122 since the food-safety build (plan release 370, Nov 26, 2026) added 1 (staff-food-safety, Business-only, restaurant heading); 121 since the checklists build (Nov 26, 2026) added 1 (staff-checklists, both plans, general heading); 120 since the barcode-pool build (Nov 25, 2026) added 1 (owner-barcode-pool, both plans, general heading); 119 since the training build (Nov 25, 2026) added 1 (owner-own-training, both plans, general heading); 118 since the age check build (Nov 25, 2026) added 1 (scanner-age-check, both plans); 117 since the prints build (Nov 25, 2026) added 1 (staff-record-prints, both plans); 116 since the paper-trail batch (release 378, Nov 25, 2026) added 1 (staff-log-book, both plans); 115 since the eBay storefront batch (release 362, Nov 23, 2026) added 1 (owner-ebay-connect, both plans); 114 since the restaurant operations batch (Nov 23, 2026) added 4 (owner-restaurant-ops, staff-restaurant-daily, mgr-restaurant-invoices, mgr-restaurant-reports); 110 through cross-store messages; 97 through the training builds batch (Nov 20, 2026); the profile photos batch (Nov 21, 2026) added 2 (your-profile-photo, owner-profile-photos), for 99; the clock build (Nov 21, 2026) added 1 (mgr-clock-callin), for 100. The staff documents build (Nov 21, 2026) added 2 (owner-staff-documents, mgr-staff-documents), for 102. The restaurant corner build (Nov 23, 2026) added 5 more (owner-restaurant, staff-restaurant-view, mgr-restaurant-build, mgr-restaurant-pars, mgr-restaurant-money), for 107. The cross-store messages build (Nov 23, 2026) added 3 (owner-xstore-messages, mgr-xstore-messages, staff-xstore-messages), for 110.
  const byId = new Map(trainingCatalog.map((lesson) => [lesson.id, lesson]));
  assert.equal(byId.get('report-problem')?.track, 'staff');
  assert.equal(byId.get('mgr-report-problem')?.track, 'manager');
  assert.equal(byId.get('owner-report-problem')?.track, 'owner');
  for (const id of ['report-problem', 'mgr-report-problem', 'owner-report-problem']) {
    assert.equal(byId.get(id)?.module, 'settings', `${id} lives in the settings module`);
    assert.equal(byId.get(id)?.steps, 4, `${id} has four steps`);
  }
});
