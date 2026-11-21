/**
 * T14 — send-PO surface invariants: the new i18n keys exist in every
 * locale (3595 at send-PO; 3597 after the delete warning; 3664 after rewards;
 * 3749 after POS, 3754 after the POS gate, 3768 after plans parity, 3804 after in-app problem reporting, 3811 after the front-door fixes, 3830 after the transfer door, 3857 after clearance + rollback pricing, 3875 after shipping labels, 3954 after the POS provider expansion + deletion-request batch, 3968 after the account-security batch (change password + owner-sent staff reset), 3994 after the white-label reset-clarification step and the locations/orders train (+13), 3996 after the edit-quantity batch, 3998 after the photo-chooser batch, 4000 after the in-form scan batch, 4004 after the category-combobox batch, 4007 after the product-delete batch), and the
 * training catalogs (client + server) carry the feature's lessons in
 * agreement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, SUPPORTED_LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';

test('keyset parity holds across all 52 locale files at the send-PO total', () => {
  const enKeys = Object.keys(en).sort();
  assert.equal(enKeys.length, 4918); // The order-form label-upload batch (Nov 18, 2026) added 3 more (orders.shippingLabel, orders.uploadLabel, orders.labelStagedNote), for 4633. The GS1 learn-more batch (Nov 18, 2026) added 3 more (settings.details.gs1LearnMore, settings.details.gs1LearnMoreUs, settings.details.gs1GlobalSite), for 4636. // +2 category edit door, +1 count-sheet scanner, +2 archived freeze, +3 import cap-awareness, +1 receive step, +1 draft notice, +3 owner-import lesson, +46 carrier labels + document style (Nov 14, 2026) +13 code generator, +10 GS1 mode (Nov 15, 2026). +1 About bookshop lead-in (Nov 15, 2026). The lesson-visual fix batch (Nov 15, 2026) added 2 more (the wide view’s See it full screen / Back to the lesson labels), for 4125. The carrier-door fix (Nov 15, 2026) added 1 more (the Upload button’s pick-an-order-first guidance), for 4126. The bulk-delete batch (Nov 15, 2026) added 12 more (11 bulk-delete UI keys + the products-find-edit step 11 it teaches), for 4138. The plan-lists batch (Nov 15, 2026) added 3 more (the bulk edit/delete plans line + the Mobile label-printing and Mobile training lines), for 4141. The full-app translation sweep batch (Nov 15, 2026) added 64 more (the About page, the notice block, legal-page chrome, the 404 page and the sweep stragglers, all ×52), for 4205. The leftovers sweep (Nov 15, 2026) added 419 more (the apiErrors.* API-error banner strings, x52), for 4624. The scan-to-tally batch (Nov 16, 2026) added 5 more (the scanTally.* strings), for 4629. The tracking-scan batch (Nov 18, 2026) added 1 more (orders.scanTracking), for 4630. The staff-settings batch (Nov 19, 2026) added 57 more (personal Settings + enrollment grants + shift windows + welcome + install door + neutral stop + universal sign-out link + owner note), for 4693. The plan-presentation extension (Nov 19, 2026) added 7 more (the plansLib.includes lines for this batch, on Plans + Welcome + the in-app plan page alike), for 4700. The money-surfaces audit additions (Nov 19, 2026) added 3 more (the Subscribe member card + the plan-neutral limit refusal), for 4703. The owner confidentiality lesson (Nov 19, 2026) added 5 more (title + 4 steps, owner track only), for 4708. The contact-details ruling (Nov 19, 2026) added 6 more (the address & phone tick + hint + the read-only business card), for 4714. The enrollment pay/contact batch (Nov 19, 2026) added 2 more (the member's home address + phone labels in the staff dialog), for 4716. The returns-approval gate (Nov 19, 2026) added 6 more (the returns.complete enrollment tick + its area heading + hint, the two waiting-for-approval notes and the API refusal wording), for 4740. The no-dangling-doors batch (Nov 19, 2026) added 3 more (the products.create enrollment tick + its area heading + hint), for 4743. The field-scanners batch (Nov 19, 2026) added 5 more (the ISBN digits reader: its title, hint, Read number button, reading line and plain refusal), for 4748. The add-location tick batch (Nov 19, 2026) added 4 more (the locations.create enrollment tick + its area heading + hint, and the add-a-location refusal wording), for 4752. The business-policies batch (Nov 19, 2026) added 34 more (the owner's own store policies + terms in Settings, the platform-policies card, the welcome showing, the plans line, the three policy API wordings, the owner store-policies lesson and the welcome-basics step, plus the two policy 404 wordings), for 4786. The staff-roster tick batch (Nov 19, 2026) added 3 more (the staff.roster enrollment tick + its area heading + hint), for 4789. The schedule-doors batch (Nov 20, 2026) added 3 more (the schedule card Clear button + the message composer character counter and limit note) and removed 1 (the inbox markRead label — the button is gone), for 4791. The low-stock ticks batch (Nov 20, 2026) added 6 more (the two Business low-stock enrollment ticks — alerts.view and products.reorder — with their area heading and hint, and the reorder-change and alerts-view refusal wordings), for 4797. The training builds batch (Nov 20, 2026) added 98 more (the per-lesson quizzes and comments, the owner's policy quizzes with their Settings editor and staff ticks, five new lessons, the welcome sign-out step, and the confidentiality map steps), for 4895. The training builds batch (Nov 20, 2026) added 23 more (the API error wordings for the owner's policy quizzes, the lesson-quiz gate, lesson comments and team records), for 4918.
  assert.equal(SUPPORTED_LOCALES.length, 52);
  for (const code of SUPPORTED_LOCALES) {
    const keys = Object.keys(LOCALES[code]).sort();
    assert.deepEqual(keys, enKeys, `${code} keyset differs from en`);
    assert.ok(keys.includes('purchasing.sendOrder'), `${code} missing purchasing.sendOrder`);
    assert.ok(keys.includes('purchasing.sendAgain'), `${code} missing purchasing.sendAgain`);
    assert.ok(keys.includes('purchasing.sentTo'), `${code} missing purchasing.sentTo`);
    assert.ok(
      keys.includes('training.lessons.mgr-send-supplier-order.title'),
      `${code} missing the manager send-order training lesson`,
    );
    assert.ok(
      keys.includes('training.lessons.owner-send-supplier-order.title'),
      `${code} missing the owner send-order training lesson`,
    );
  }
});

test('training catalogs carry the send-PO lessons, client and server in agreement', () => {
  const expected = {
    'mgr-send-supplier-order': 'manager',
    'owner-send-supplier-order': 'owner',
  };
  for (const [id, track] of Object.entries(expected)) {
    const client = CLIENT_LESSONS.find((lesson) => lesson.id === id);
    const server = SERVER_LESSONS.find((lesson) => lesson.id === id);
    assert.ok(client, `client catalog missing ${id}`);
    assert.ok(server, `server catalog missing ${id}`);
    assert.equal(client.track, track);
    assert.equal(server.track, track);
    assert.equal(client.module, 'purchasing');
    assert.equal(client.steps, 4);
  }
  assert.deepEqual(
    CLIENT_LESSONS.map((lesson) => lesson.id),
    SERVER_LESSONS.map((lesson) => lesson.id),
    'client and server catalogs list the same lessons in the same order',
  );
});
