/**
 * Leftovers sweep, item 2 — email templates (Nov 15, 2026): every
 * email renders in the reader's language (41 strings x52, per-key
 * fallback exact -> base -> English); the English output is
 * byte-identical to the pre-sweep templates, and the purchase-order
 * email stays white-label in every language.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_STRINGS, EMAIL_STRING_KEYS, emailStringsFor } from '../../server/emailStrings.js';
import {
  verificationEmail, passwordResetEmail, staffInviteEmail, purchaseOrderEmail,
  trialReminderDay4Email, backupEmailCodeEmail,
} from '../../server/email.js';

test('item 2: email strings exist for all 52 locales, placeholders intact', () => {
  // 41 through release 287; the staff batch (Nov 19, 2026) added
  // invite.linkLine — the direct Create-account link in the
  // invitation email — for 42.
  assert.equal(EMAIL_STRING_KEYS.length, 42);
  assert.equal(Object.keys(EMAIL_STRINGS).length, 52);
  for (const [locale, row] of Object.entries(EMAIL_STRINGS)) {
    assert.deepEqual(Object.keys(row).sort(), [...EMAIL_STRING_KEYS].sort(), locale);
    for (const key of EMAIL_STRING_KEYS) {
      const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      assert.equal(ph(row[key]), ph(EMAIL_STRINGS.en[key]), `${locale} ${key} placeholders`);
      assert.ok(row[key].includes('Luminous StockHaven') || !EMAIL_STRINGS.en[key].includes('Luminous StockHaven'), `${locale} ${key} lost the app name`);
    }
  }
});

test('item 2: English email output is byte-identical to the pre-sweep templates', () => {
  const v = verificationEmail({ to: 'a@b.c', code: '123456' });
  assert.equal(v.subject, 'Your Luminous StockHaven verification code');
  assert.equal(v.text, 'Your Luminous StockHaven verification code is 123456.\n\nEnter it on the verification screen to finish creating your account. The code expires in 10 minutes and can only be used once.\n\nIf you did not create an account, you can ignore this email.');
  const r = passwordResetEmail({ to: 'a@b.c', resetUrl: 'https://x/reset?token=<redacted>', code: '123456' });
  assert.equal(r.subject, 'Reset your Luminous StockHaven password');
  assert.ok(r.text.includes('Reset it here: https://x/reset?token=') && r.text.includes('Your reset code is 123456'));
  const b = backupEmailCodeEmail({ to: 'a@b.c', code: '123456' });
  assert.ok(b.text.startsWith('Hello,\n\nYour Luminous StockHaven backup email code is 123456. It expires in 10 minutes.'));
  const invite = staffInviteEmail({ to: 'a@b.c', businessName: 'Tienda Sol', inviterName: 'owner@x.com' });
  assert.equal(invite.subject, 'You have been invited to Tienda Sol');
  assert.ok(invite.text.startsWith('You have been invited to help manage Tienda Sol on Luminous StockHaven by owner@x.com.'));
  const day4 = trialReminderDay4Email({ to: 'a@b.c', plan: 'essentials', trialEndsAt: '2026-11-21T18:30:00Z', cancelAtPeriodEnd: false });
  assert.equal(day4.subject, 'Day 4 of your Luminous StockHaven trial');
  assert.ok(day4.text.includes('You are on day 4 of your 7-day free trial of Luminous StockHaven Essentials.'));
  assert.ok(day4.text.includes('Your trial ends on Saturday, November 21, 2026.'));
});

test('item 2: emails render in the reader language; the PO stays white-label', () => {
  const es = emailStringsFor('es-MX');
  const v = verificationEmail({ to: 'a@b.c', code: '123456', lang: 'es-MX' });
  assert.equal(v.subject, es['verify.subject']);
  assert.ok(v.text.includes('123456'));
  const invite = staffInviteEmail({ to: 'a@b.c', businessName: 'Tienda Sol', inviterName: 'owner@x.com', lang: 'es-MX' });
  assert.equal(invite.subject, 'Te han invitado a Tienda Sol');
  const po = purchaseOrderEmail({
    to: 's@b.c', businessName: 'Tienda Sol', currency: 'USD', lang: 'es-MX',
    order: { number: 'PO-1', supplier_name: 'Proveedor', order_date: '2026-11-15', total: 1234.5 },
  });
  assert.equal(po.subject, 'Orden de compra PO-1 de Tienda Sol');
  assert.ok(!po.subject.includes('StockHaven') && !po.text.includes('StockHaven'), 'white-label: app name nowhere');
  assert.ok(/Total: USD\s1,234\.50/.test(po.text), 'es-MX money grouping');
  const poDe = purchaseOrderEmail({
    to: 's@b.c', businessName: 'Buchladen', currency: 'EUR', lang: 'de',
    order: { number: 'PO-1', total: 1234.5 },
  });
  assert.ok(poDe.text.includes('Gesamt: 1.234,50'), 'de money grouping in the PO email');
});

