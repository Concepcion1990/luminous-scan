/**
 * T15 — trial-reminder surface invariants: the keyset total moved to
 * 3595 in every locale (3597 after the delete warning; 3664 after rewards;
 * 3749 after POS, 3754 after the POS gate, 3768 after plans parity, 3804 after in-app problem reporting, 3811 after the front-door fixes, 3830 after the transfer door, 3857 after clearance + rollback pricing, 3875 after shipping labels, 3954 after the POS provider expansion + deletion-request batch, 3968 after the account-security batch (change password + owner-sent staff reset), 3994 after the white-label reset-clarification step and the locations/orders train (+13), 3996 after the edit-quantity batch, 3998 after the photo-chooser batch, 4000 after the in-form scan batch, 4004 after the category-combobox batch, 4007 after the product-delete batch), her three
 * notice strings stand verbatim in English, and the training
 * catalogs carry the owner trial-reminders lesson in agreement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, SUPPORTED_LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';

test('keyset parity holds across all 52 locale files at the trial-reminders total', () => {
  const enKeys = Object.keys(en).sort();
  assert.equal(enKeys.length, 4791); // The order-form label-upload batch (Nov 18, 2026) added 3 more (orders.shippingLabel, orders.uploadLabel, orders.labelStagedNote), for 4633. The GS1 learn-more batch (Nov 18, 2026) added 3 more (settings.details.gs1LearnMore, settings.details.gs1LearnMoreUs, settings.details.gs1GlobalSite), for 4636. // +2 category edit door, +1 count-sheet scanner, +2 archived freeze, +3 import cap-awareness, +1 receive step, +1 draft notice, +3 owner-import lesson, +46 carrier labels + document style (Nov 14, 2026) +13 code generator, +10 GS1 mode (Nov 15, 2026). +1 About bookshop lead-in (Nov 15, 2026). The lesson-visual fix batch (Nov 15, 2026) added 2 more (the wide view’s See it full screen / Back to the lesson labels), for 4125. The carrier-door fix (Nov 15, 2026) added 1 more (the Upload button’s pick-an-order-first guidance), for 4126. The bulk-delete batch (Nov 15, 2026) added 12 more (11 bulk-delete UI keys + the products-find-edit step 11 it teaches), for 4138. The plan-lists batch (Nov 15, 2026) added 3 more (the bulk edit/delete plans line + the Mobile label-printing and Mobile training lines), for 4141. The full-app translation sweep batch (Nov 15, 2026) added 64 more (the About page, the notice block, legal-page chrome, the 404 page and the sweep stragglers, all ×52), for 4205. The leftovers sweep (Nov 15, 2026) added 419 more (the apiErrors.* API-error banner strings, x52), for 4624. The scan-to-tally batch (Nov 16, 2026) added 5 more (the scanTally.* strings), for 4629. The tracking-scan batch (Nov 18, 2026) added 1 more (orders.scanTracking), for 4630. The staff-settings batch (Nov 19, 2026) added 57 more (personal Settings + enrollment grants + shift windows + welcome + install door + neutral stop + universal sign-out link + owner note), for 4693. The plan-presentation extension (Nov 19, 2026) added 7 more (the plansLib.includes lines for this batch, on Plans + Welcome + the in-app plan page alike), for 4700. The money-surfaces audit additions (Nov 19, 2026) added 3 more (the Subscribe member card + the plan-neutral limit refusal), for 4703. The owner confidentiality lesson (Nov 19, 2026) added 5 more (title + 4 steps, owner track only), for 4708. The contact-details ruling (Nov 19, 2026) added 6 more (the address & phone tick + hint + the read-only business card), for 4714. The enrollment pay/contact batch (Nov 19, 2026) added 2 more (the member's home address + phone labels in the staff dialog), for 4716. The returns-approval gate (Nov 19, 2026) added 6 more (the returns.complete enrollment tick + its area heading + hint, the two waiting-for-approval notes and the API refusal wording), for 4740. The no-dangling-doors batch (Nov 19, 2026) added 3 more (the products.create enrollment tick + its area heading + hint), for 4743. The field-scanners batch (Nov 19, 2026) added 5 more (the ISBN digits reader: its title, hint, Read number button, reading line and plain refusal), for 4748. The add-location tick batch (Nov 19, 2026) added 4 more (the locations.create enrollment tick + its area heading + hint, and the add-a-location refusal wording), for 4752. The business-policies batch (Nov 19, 2026) added 34 more (the owner's own store policies + terms in Settings, the platform-policies card, the welcome showing, the plans line, the three policy API wordings, the owner store-policies lesson and the welcome-basics step, plus the two policy 404 wordings), for 4786. The staff-roster tick batch (Nov 19, 2026) added 3 more (the staff.roster enrollment tick + its area heading + hint), for 4789. The schedule-doors batch (Nov 20, 2026) added 3 more (the schedule card Clear button + the message composer character counter and limit note) and removed 1 (the inbox markRead label — the button is gone), for 4791.
  assert.equal(SUPPORTED_LOCALES.length, 52);
  for (const code of SUPPORTED_LOCALES) {
    const keys = Object.keys(LOCALES[code]).sort();
    assert.deepEqual(keys, enKeys, `${code} keyset differs from en`);
    assert.ok(
      keys.includes('training.lessons.owner-trial-reminders.title'),
      `${code} missing the owner trial-reminders training lesson`,
    );
  }
});

test("the three in-app notices stand in her exact words in English", () => {
  assert.equal(en['plans.trialNoticeFiveDay'], 'You have 5 more days left on your trial.');
  assert.equal(en['plans.trialNoticeThreeDay'], 'You have 3 more days left on your trial.');
  assert.equal(en['plans.trialNoticeOneDay'], '24 hours until your trial ends.');
});

test('training catalogs carry the trial-reminders lesson, client and server in agreement', () => {
  const client = CLIENT_LESSONS.find((lesson) => lesson.id === 'owner-trial-reminders');
  const server = SERVER_LESSONS.find((lesson) => lesson.id === 'owner-trial-reminders');
  assert.ok(client, 'client catalog missing owner-trial-reminders');
  assert.ok(server, 'server catalog missing owner-trial-reminders');
  assert.equal(client.track, 'owner');
  assert.equal(server.track, 'owner');
  assert.equal(client.module, 'billing');
  assert.equal(client.steps, 4);
  assert.equal(CLIENT_LESSONS.length, 92); // 64 through rewards; POS added 6 (5 owner + 1 staff); problem reporting added 3 (one per role); the transfer door added 1 (owner); pricing added 2 (owner + manager); shipping labels added 2 (staff + owner); the POS provider expansion added 6 (owner, one per new provider) and the deletion-request flow added 1 (owner); the training-invisibility split added 1 (owner-import, Essentials-only); the set-once tax rate added 1 (owner-tax-rate); the staff batch (Nov 19, 2026) added 4: the three shift-window lessons (one per role) and the owner confidentiality lesson The business-policies batch (Nov 19, 2026) added 1 more: the owner store-policies lesson, for 92.
  assert.deepEqual(
    CLIENT_LESSONS.map((lesson) => lesson.id),
    SERVER_LESSONS.map((lesson) => lesson.id),
    'client and server catalogs list the same lessons in the same order',
  );
});
