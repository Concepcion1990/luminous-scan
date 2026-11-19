/**
 * T13 — recovery-kit surface invariants: the new i18n keys exist in
 * every locale (3575 at the recovery kit; send-PO later brought the
 * total to 3595, the delete warning to 3597 and rewards to 3664), and the training
 * catalogs (client + server) carry the kit's lessons in agreement.
 * The account-security batch (Nov 14, 2026: change password +
 * owner-sent staff reset) extended two of the kit's lessons to five
 * steps — spare-keys-setup (changing your password) and
 * owner-staff-email-fix (sending a staff password reset).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, SUPPORTED_LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';

test('keyset parity holds across all 52 locale files at the recovery-kit total', () => {
  const enKeys = Object.keys(en).sort();
  // 3575 at the recovery kit; send-PO added 15 keys (5 UI + 10
  // training) for 3595; the delete warning added 2 more for 3597;
  // rewards added 67 more (46 UI + 21 training) for 3664;
  // POS added 85 more (54 UI + 31 training) for 3749; the POS gate added 5 more, for 3754; plans parity added 14 more, for 3768; in-app problem reporting added 36 more (21 UI + 15 training), for 3804; the front-door fixes added 7 more (2 subscribe chooser + 5 reset code entry), for 3811; the cross-store transfer door added 19 more (14 UI + 5 training), for 3830; clearance + rollback pricing added 27 more (17 UI/plans + 10 training), for 3857; shipping labels added 18 more (8 UI/plans + 10 training), for 3875; the POS provider expansion + deletion-request batch added 79 more (44 UI + 35 training), for 3954; the account-security batch (change password + owner-sent staff reset) added 14 more (12 UI + 2 training), for 3968; the white-label reset-clarification training step added 1 more, for 3981; the locations/orders train added 13 more (2 location keys, 7 ship-to keys, 4 lifecycle/address-book keys), for 3994. The edit-quantity batch (Nov 14, 2026) added 2 more (the Edit form's quantity hint + the products-find-edit step 7 it teaches), for 3996. The photo-chooser batch (Nov 14, 2026) added 2 more (Take a photo / Choose from gallery), for 3998. The in-form scan batch (Nov 14, 2026) added 2 more (Scan code + the code-belongs-to-another-product notice), for 4000. The category-combobox batch (Nov 14, 2026) added 4 more (Add new category/subcategory + the typed-but-unmatched validation messages), for 4004. The product-delete batch (Nov 14, 2026) added 3 more (the menu's Delete label + the two plain-words confirmations), for 4007. The category-edit-door batch (Nov 14, 2026) added 2 more (Set category / Change category), for 4009. The count-sheet scanner batch (Nov 14, 2026) added 1 more (the scanned product is not on this sheet notice), for 4010. The archived-freeze batch (Nov 14, 2026) added 2 more (the frozen-stock message + the products-find-edit step 8 it teaches), for 4012. The import cap-awareness batch (Nov 14, 2026) added 3 more (dry-run room line, would-not-fit count, not-imported note), for 4015. The receive-step batch (Nov 14, 2026) added 1 more (import-basics step 2, the Stock arrives at step), for 4016. The staged-import draft batch (Nov 14, 2026) added 1 more (the too-large-to-keep notice), for 4017. The training-invisibility batch (Nov 14, 2026) added 3 more (the owner-import lesson: title + 2 steps), for 4020. The carrier-label + document-style batch (Nov 14, 2026) added 46 more (18 carrier-label + 24 document-style UI keys, 1 plans line, 3 training steps), for 4099. The code-generator batch (Nov 15, 2026) added 13 more (11 productForm generate keys, 1 plans line, 1 training step), for 4112. The GS1-mode batch (Nov 15, 2026) added 10 more (6 productForm GS1 keys, 2 Settings prefix keys, 1 plans line, 1 training step), for 4122. The About bookshop-link addition (Nov 15, 2026) added 1 more (the About page’s bookstore lead-in), for 4123. The lesson-visual fix batch (Nov 15, 2026) added 2 more (the wide view’s See it full screen / Back to the lesson labels), for 4125. The carrier-door fix (Nov 15, 2026) added 1 more (the Upload button’s pick-an-order-first guidance), for 4126. The bulk-delete batch (Nov 15, 2026) added 12 more (11 bulk-delete UI keys + the products-find-edit step 11 it teaches), for 4138. The plan-lists batch (Nov 15, 2026) added 3 more (the bulk edit/delete plans line + the Mobile label-printing and Mobile training lines), for 4141. The full-app translation sweep batch (Nov 15, 2026) added 64 more (the About page, the notice block, legal-page chrome, the 404 page and the sweep stragglers, all ×52), for 4205. The leftovers sweep (Nov 15, 2026) added 419 more (the apiErrors.* API-error banner strings, x52), for 4624. The scan-to-tally batch (Nov 16, 2026) added 5 more (the scanTally.* strings shared by the count sheet, Scan Receive and the Add stock sheet), for 4629. The tracking-scan batch (Nov 18, 2026) added 1 more (orders.scanTracking — the scan button beside Tracking reference), for 4630.
  assert.equal(enKeys.length, 4740); // The order-form label-upload batch (Nov 18, 2026) added 3 more (orders.shippingLabel, orders.uploadLabel, orders.labelStagedNote), for 4633. The GS1 learn-more batch (Nov 18, 2026) added 3 more (settings.details.gs1LearnMore, settings.details.gs1LearnMoreUs, settings.details.gs1GlobalSite), for 4636. The staff-settings batch (Nov 19, 2026) added 57 more (personal Settings + enrollment grants + shift windows + welcome + install door + neutral stop + universal sign-out link + owner note), for 4693. The plan-presentation extension (Nov 19, 2026) added 7 more (the plansLib.includes lines for this batch, on Plans + Welcome + the in-app plan page alike), for 4700. The money-surfaces audit additions (Nov 19, 2026) added 3 more (the Subscribe member card + the plan-neutral limit refusal), for 4703. The owner confidentiality lesson (Nov 19, 2026) added 5 more (title + 4 steps, owner track only), for 4708. The contact-details ruling (Nov 19, 2026) added 6 more (the address & phone tick + hint + the read-only business card), for 4714. The enrollment pay/contact batch (Nov 19, 2026) added 2 more (the member's home address + phone labels in the staff dialog), for 4716. The returns-approval gate (Nov 19, 2026) added 6 more (the returns.complete enrollment tick + its area heading + hint, the two waiting-for-approval notes and the API refusal wording), for 4740.
  assert.equal(SUPPORTED_LOCALES.length, 52);
  for (const code of SUPPORTED_LOCALES) {
    const keys = Object.keys(LOCALES[code]).sort();
    assert.deepEqual(keys, enKeys, `${code} keyset differs from en`);
    assert.ok(keys.includes('recovery.title'), `${code} missing recovery.title`);
    assert.ok(keys.includes('settings.security.title'), `${code} missing settings.security.title`);
    assert.ok(keys.includes('login.cantAccessEmail'), `${code} missing login.cantAccessEmail`);
    assert.ok(
      keys.includes('training.lessons.spare-keys-setup.title'),
      `${code} missing the spare-keys training lesson`,
    );
    assert.ok(
      keys.includes('training.lessons.owner-staff-email-fix.title'),
      `${code} missing the owner staff-email-fix training lesson`,
    );
  }
});

test('training catalogs carry the recovery-kit lessons, client and server in agreement', () => {
  const expected = {
    'spare-keys-setup': ['staff', 5],
    'lost-email-recovery': ['staff', 4],
    'owner-staff-email-fix': ['owner', 5],
  };
  for (const [id, [track, steps]] of Object.entries(expected)) {
    const client = CLIENT_LESSONS.find((lesson) => lesson.id === id);
    const server = SERVER_LESSONS.find((lesson) => lesson.id === id);
    assert.ok(client, `client catalog missing ${id}`);
    assert.ok(server, `server catalog missing ${id}`);
    assert.equal(client.track, track);
    assert.equal(server.track, track);
    assert.equal(client.steps, steps);
    assert.equal(server.steps, steps);
  }
  assert.deepEqual(
    CLIENT_LESSONS.map((lesson) => lesson.id),
    SERVER_LESSONS.map((lesson) => lesson.id),
    'client and server catalogs list the same lessons in the same order',
  );
});
