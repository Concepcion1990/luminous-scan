import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isPublisherOwner,
  PUBLISHER_OWNER_EMAIL,
  PUBLISHER_BUSINESS_ID,
} from './publisherAccess.js';

const read = (file) => fs.readFileSync(file, 'utf8');

const ownerUser = { id: 'owner-user-id', email: 'cperezcarrillo.1990@gmail.com' };
const publisherBusiness = {
  id: '6aeaec9b141cfe26e5a411be',
  created_by_id: 'owner-user-id',
};

test('the publisher login is recognised as the publisher, whatever the business', () => {
  assert.equal(isPublisherOwner(ownerUser, null), true);
  assert.equal(
    isPublisherOwner(ownerUser, { id: 'some-other-business', created_by_id: 'owner-user-id' }),
    true,
  );
  // Email matching is case-insensitive.
  assert.equal(
    isPublisherOwner({ id: 'owner-user-id', email: 'CPerezCarrillo.1990@Gmail.com' }, null),
    true,
  );
});

test('the publisher business viewed by its creator is recognised, even without an email', () => {
  assert.equal(
    isPublisherOwner({ id: 'owner-user-id' }, publisherBusiness),
    true,
  );
});

test('a customer is never the publisher, even as owner of their own workspace', () => {
  const customer = { id: 'customer-user-id', email: 'cperezcarrillo25@gmail.com' };
  const customerBusiness = { id: 'customer-business-id', created_by_id: 'customer-user-id' };
  assert.equal(isPublisherOwner(customer, customerBusiness), false);
  // A customer viewing a different business they did not create.
  assert.equal(
    isPublisherOwner(customer, { id: 'another-business', created_by_id: 'someone-else' }),
    false,
  );
  // The publisher business id alone is not enough: a non-creator viewing
  // it is still not the publisher.
  assert.equal(isPublisherOwner(customer, publisherBusiness), false);
});

test('missing user or business fails closed', () => {
  assert.equal(isPublisherOwner(null, publisherBusiness), false);
  assert.equal(isPublisherOwner(undefined, publisherBusiness), false);
  assert.equal(isPublisherOwner(ownerUser, undefined), true);
  assert.equal(isPublisherOwner({ id: 'someone' }, null), false);
  assert.equal(isPublisherOwner({}, {}), false);
});

test('the publisher constants name the owner account and the real business', () => {
  assert.equal(PUBLISHER_OWNER_EMAIL, 'cperezcarrillo.1990@gmail.com');
  assert.equal(PUBLISHER_BUSINESS_ID, '6aeaec9b141cfe26e5a411be');
});

test('the Billing status card renders only for the publisher', () => {
  const settings = read('src/pages/Settings.jsx');
  const upgrade = read('src/pages/Upgrade.jsx');

  // The card exists in exactly one place: Settings, as one rendered heading.
  assert.equal(
    (settings.match(/<h3 className="font-semibold">Billing status<\/h3>/g) || []).length,
    1,
  );
  assert.doesNotMatch(upgrade, /Billing status/);

  // It is gated on publisher identity, not on workspace ownership alone.
  assert.match(settings, /import \{ isPublisherOwner \} from '@\/lib\/publisherAccess'/);
  assert.match(
    settings,
    /canShowBillingStatus = isOwner && isPublisherOwner\(user, record\)/,
  );
  assert.match(
    settings,
    /\{canShowBillingStatus && \(\s*<div className="rounded-lg border border-border bg-muted\/30 px-3 py-3" role="status" aria-live="polite">/,
  );

  // The other private billing diagnostics keep their existing
  // Builder-Preview gate; this change does not loosen them.
  assert.match(
    settings,
    /canShowPrivateBillingDiagnostics = Boolean\(\s*user\?\.id && record\?\.created_by_id === user\.id && isBase44BuilderPreview/,
  );
});
