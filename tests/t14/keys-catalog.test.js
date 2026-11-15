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
  assert.equal(enKeys.length, 4141); // +2 category edit door, +1 count-sheet scanner, +2 archived freeze, +3 import cap-awareness, +1 receive step, +1 draft notice, +3 owner-import lesson, +46 carrier labels + document style (Nov 14, 2026) +13 code generator, +10 GS1 mode (Nov 15, 2026). +1 About bookshop lead-in (Nov 15, 2026). The lesson-visual fix batch (Nov 15, 2026) added 2 more (the wide view’s See it full screen / Back to the lesson labels), for 4125. The carrier-door fix (Nov 15, 2026) added 1 more (the Upload button’s pick-an-order-first guidance), for 4126. The bulk-delete batch (Nov 15, 2026) added 12 more (11 bulk-delete UI keys + the products-find-edit step 11 it teaches), for 4138. The plan-lists batch (Nov 15, 2026) added 3 more (the bulk edit/delete plans line + the Mobile label-printing and Mobile training lines), for 4141.
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
