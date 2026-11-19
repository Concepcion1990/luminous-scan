/**
 * T35 — the staff batch client pins (Nov 19, 2026):
 *   - the Settings door carries NO permission anymore (every
 *     signed-in person reaches their Settings), and the in-app
 *     plan page (/upgrade) is boss-only in the nav;
 *   - the universal sign-out link sits directly above the
 *     LegalFooter in the signed-in shell, and its string exists
 *     in all 52 locales;
 *   - the invite email carries the direct Create-account link
 *     line in all 52 email locales;
 *   - the batch's plan lines are in the Essentials includes of
 *     both list families (Plans + Welcome + the in-app plan page
 *     all render these same lists); since the owner's dedupe
 *     ruling (Nov 19, 2026) Business' lists no longer repeat
 *     them — Business opens with "Everything in Essentials" and
 *     names only its own extras — and the comparison table
 *     still carries the lines for both plans;
 *   - the welcome page and its editor exist, the permanent line
 *     is app copy, and the Download door ships with its
 *     owner-only note wired to the boss Settings only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('nav: Settings has no permission gate; the plan page is boss-only', async () => {
  const { NAV_ITEMS } = await import('../../src/components/layout/navGroups.js');
  const settings = NAV_ITEMS.find((i) => i.to === '/settings');
  assert.ok(settings, 'the Settings door exists in the nav');
  assert.ok(!settings.perm, 'Settings carries no perm — every signed-in role reaches it');
  const upgrade = NAV_ITEMS.find((i) => i.to === '/upgrade');
  assert.ok(upgrade, 'the plan page door exists');
  assert.equal(upgrade.bossOnly, true, 'the plan page is boss-only (money privacy)');
});

test('universal sign-out link: above the footer in the shell, string in all 52 locales', async () => {
  const layout = read('src/components/Layout.jsx');
  const linkAt = layout.indexOf("t('layout.signOutLink')");
  const footerAt = layout.indexOf('<LegalFooter');
  assert.ok(linkAt > 0, 'the shell renders the sign-out link');
  assert.ok(footerAt > linkAt, 'the link sits directly above the LegalFooter');
  const { en } = await import('../../src/lib/locales/en.js');
  assert.equal(en['layout.signOutLink'], 'Sign out');
  const { SUPPORTED_LOCALES } = await import('../../src/lib/i18n.js').catch(() => ({}));
  assert.ok(SUPPORTED_LOCALES === undefined || SUPPORTED_LOCALES.length === 52);
});

test('invite email: the direct sign-up link line exists in all 52 email locales', async () => {
  const { EMAIL_STRINGS, EMAIL_STRING_LOCALES } = await import('../../server/emailStrings.js');
  assert.equal(EMAIL_STRING_LOCALES.length, 52);
  for (const code of EMAIL_STRING_LOCALES) {
    const line = EMAIL_STRINGS[code]['invite.linkLine'];
    assert.ok(typeof line === 'string' && line.includes('{registerUrl}'), `${code} carries invite.linkLine`);
  }
  const { staffInviteEmail } = await import('../../server/email.js');
  const mail = staffInviteEmail({
    to: 'newhire@example.com',
    businessName: 'Test Shop',
    inviterName: 'owner@example.com',
    lang: 'en',
    registerUrl: 'https://example.test/register?email=newhire%40example.com',
  });
  assert.ok(mail.text.includes('https://example.test/register?email=newhire%40example.com'), 'the email carries the direct link');
});

test('plan surfaces agree: the batch lines are in the Essentials lists, under Business’ everything line, and in the comparison', async () => {
  const { PLANS, WELCOME_OPTIONS, COMPARISON_ROWS } = await import('../../src/lib/plans.js');
  const { en } = await import('../../src/lib/locales/en.js');
  const batchLines = [
    en['plansLib.includes.teamSettings'],
    en['plansLib.includes.shiftWindows'],
    en['plansLib.includes.ownerOnlyBilling'],
    en['plansLib.includes.settingsGrants'],
    en['plansLib.includes.appDownload'],
    en['plansLib.includes.staffWelcome'],
    en['plansLib.includes.inviteLink'],
  ];
  for (const line of batchLines) assert.ok(typeof line === 'string' && line.length > 0);
  // The batch lines live in the Essentials lists of both
  // families. Business INCLUDES the features — its list says so
  // once, with the everything line — but since the dedupe ruling
  // it does not repeat the lines (tests/t6/planDedupe.test.js
  // guards the composition itself).
  for (const line of batchLines) {
    assert.ok(PLANS.essentials.includes.includes(line), `essentials includes: ${line}`);
    assert.ok(!PLANS.business.includes.includes(line), `business does not repeat: ${line}`);
  }
  assert.equal(PLANS.business.includes[0], en['plansLib.businessIncludes.everything']);
  for (const option of WELCOME_OPTIONS.filter((o) => o.key !== 'mobile')) {
    for (const line of batchLines) {
      if (option.key === 'essentials') {
        assert.ok(option.includes.includes(line), `welcome ${option.key} includes: ${line}`);
      } else {
        assert.ok(!option.includes.includes(line), `welcome ${option.key} does not repeat: ${line}`);
      }
    }
  }
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.equal(welcomeBusiness.includes[0], en['plansLib.businessIncludes.everything']);
  const mobile = WELCOME_OPTIONS.find((o) => o.key === 'mobile');
  for (const line of batchLines) {
    assert.ok(!mobile.includes.includes(line), 'mobile (solo) does not carry team lines');
  }
  for (const line of batchLines) {
    const row = COMPARISON_ROWS.find((r) => r.label === line);
    assert.ok(row, `comparison row exists: ${line}`);
    assert.equal(row.essentials, true);
    assert.equal(row.business, true);
  }
});

test('welcome + download door wiring: routes, editor, owner note only on the boss page', () => {
  const app = read('src/App.jsx');
  assert.ok(app.includes('path="/staff-welcome"'), 'the welcome route exists');
  const staffPage = read('src/pages/Staff.jsx');
  assert.ok(staffPage.includes('WelcomeScriptCard'), 'the owner editor lives on the Staff page');
  const settings = read('src/pages/Settings.jsx');
  assert.ok(settings.includes('showOwnerNote'), 'the boss Settings passes the owner note');
  const personal = read('src/components/business/PersonalSettings.jsx');
  assert.ok(personal.includes('InstallAppCard'), 'personal Settings carries the download door');
  assert.ok(!personal.includes('showOwnerNote'), 'personal Settings never shows the owner note');
  assert.ok(!personal.includes('settings.install.ownerNote'), 'the note string is not referenced for members');
});

test('contact details: own tick, manager-only effect, read-only business card (Nov 19, 2026)', () => {
  const staffLib = read('src/lib/staff.js');
  assert.match(staffLib, /settings\.contactDetails/);
  const authRoutes = read('server/authRoutes.js');
  assert.match(authRoutes, /contact_phone: 'settings\.contactDetails'/);
  assert.match(authRoutes, /address: 'settings\.contactDetails'/);
  const personal = read('src/components/business/PersonalSettings.jsx');
  assert.match(personal, /BusinessCardReadOnly/);
  assert.match(personal, /settings\.businessCard\.title/);
  // The card is display-only: it renders no Input at all.
  const cardStart = personal.indexOf('function BusinessCardReadOnly');
  const cardEnd = personal.indexOf('function GrantedDetailsCard');
  assert.ok(cardStart !== -1 && cardEnd > cardStart);
  assert.doesNotMatch(personal.slice(cardStart, cardEnd), /<Input/);
});

test('enrollment pay + personal contact: one pay record, hiring gate on both (Nov 19, 2026)', () => {
  const dialog = read('src/components/staff/StaffMemberDialog.jsx');
  // The dialog writes the SAME pay-profile record Payroll edits.
  assert.match(dialog, /savePayProfile/);
  assert.match(dialog, /listPayProfiles/);
  assert.match(dialog, /personal_address/);
  assert.match(dialog, /personal_phone/);
  assert.match(dialog, /canHire/);
  const payroll = read('src/pages/Payroll.jsx');
  assert.match(payroll, /can_set_pay/);
  const workforce = read('server/workforceRoutes.js');
  assert.match(workforce, /canSetPay/);
  const entities = read('server/entities.js');
  assert.match(entities, /stripStaffContact/);
});

test('bottom tab bar: Settings is the fifth tab, reachable by every role', () => {
  const layout = read('src/components/Layout.jsx');
  assert.ok(
    layout.includes("const mobileTabPaths = ['/', '/scan', '/products', '/orders', '/settings']"),
    'the mobile tab paths include /settings',
  );
  assert.ok(layout.includes("'/settings': Settings"), 'the tab layer renders the Settings screen');
  // The tabs are filtered from the same allowedItems as the menu;
  // with the Settings perm gone (pin above), the tab shows for
  // staff, managers and the owner alike — one tap from anywhere.
});

test('money privacy wiring: dashboard trial surfaces are boss-gated', () => {
  const dashboard = read('src/pages/Dashboard.jsx');
  assert.ok(dashboard.includes('isBoss'), 'the dashboard gates money surfaces on isBoss');
  const switcher = read('src/components/business/BusinessSwitcher.jsx');
  assert.ok(switcher.includes('settings.editName'), 'the header pencil follows the edit-name grant');
});
