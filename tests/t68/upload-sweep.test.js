/**
 * T68 — the universal 25 MB upload sweep (owner ruling, Nov 23,
 * 2026: every import/upload door, every page, both plans, no
 * exceptions — one 25 MB ceiling everywhere).
 *
 * Before this build the doors disagreed: staff documents and
 * business policy files capped at 2 MB, the logo / product-photo
 * / profile-photo / shipping-label doors at 2 MB, the workbook
 * reader at 12 MB, the receive/update import doors and the POS
 * CSV door with no plain refusal at all (the POS door's body
 * silently died at the 3 MB JSON parser). Only the spreadsheet
 * import door (release 365) and the supplier invoice file door
 * (release 361) already stood at 25 MB.
 *
 * The sweep raises every lower cap to 25 MB — server AND client,
 * because a door is only 25 MB when both sides agree — widens
 * the JSON parser on each swept door's path (a 25 MB file
 * travels as ~33 MB of base64) so an over-size file reaches the
 * door's own plain refusal in the reader's language, and updates
 * every words-bearing surface that named the old cap (ten locale
 * keys ×52, values only — the keyset does not move).
 *
 * Proven here: the caps agree by import + source pin; the staff
 * documents door and the business policy door accept a file past
 * the old cap and refuse one past 25 MB with the plain message,
 * by execution; the import photo pipeline (release 366) brings
 * in a linked photo past the old cap and names one past 25 MB;
 * the workbook reader refuses past 25 MB, not the old 12.
 *
 * Deliberately NOT swept (named in the build record): voice
 * notes keep their 8 MB recording discipline — a voice note is
 * a spoken message capped by the 3-minute composer, not a file
 * door, and no legitimate recording can reach the cap.
 * Messaging has no photo-attachment upload at all (its photos
 * are approved profile photos, display only).
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pool,
  req,
  close,
  resetRateLimits,
  ownerWithBusiness,
  setEntitlement,
} from './helpers.js';
import { STAFF_DOCUMENT_MAX_BYTES } from '../../server/staffDocumentRoutes.js';
import { POLICY_FILE_MAX_BYTES } from '../../server/businessPolicyRoutes.js';
import { INVOICE_FILE_MAX_BYTES } from '../../server/restaurantFileRoutes.js';
import { fetchPhotoToStorage } from '../../server/photoJobs.js';
import { API_ERROR_MESSAGE_KEYS } from '../../src/lib/apiErrors.js';

beforeEach(() => resetRateLimits());
after(async () => { await close(); });

const MB = 1024 * 1024;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const dataUrl = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`;

test('the caps agree at 25 MB on both sides of the wire', () => {
  // Server constants, by import.
  assert.equal(STAFF_DOCUMENT_MAX_BYTES, 25 * MB);
  assert.equal(POLICY_FILE_MAX_BYTES, 25 * MB);
  assert.equal(INVOICE_FILE_MAX_BYTES, 25 * MB);
  // Server constants that are not exported — by source.
  const t6 = read('server/t6Routes.js');
  assert.match(t6, /LOGO_MAX_BYTES = 25 \* 1024 \* 1024/);
  assert.match(t6, /PHOTO_MAX_BYTES = 25 \* 1024 \* 1024/);
  assert.match(t6, /LABEL_MAX_BYTES = 25 \* 1024 \* 1024/);
  const jobs = read('server/photoJobs.js');
  assert.match(jobs, /PHOTO_MAX_BYTES = 25 \* 1024 \* 1024/);
  assert.ok(jobs.includes('The photo at that link is over 25 MB'));
  const profile = read('server/profilePhotoRoutes.js');
  assert.match(profile, /PROFILE_PHOTO_MAX_BYTES = 25 \* 1024 \* 1024/);
  // The settings field guard for a data-URL logo sits just past
  // 25 MB of base64 (~34.96M characters).
  assert.match(read('server/authRoutes.js'), /text\.length > 35_000_000/);
  // Client caps and guards.
  assert.match(read('src/components/print/CarrierLabelPanel.jsx'), /LABEL_MAX_BYTES = 25 \* 1024 \* 1024/);
  assert.match(read('src/components/business/BusinessPoliciesCard.jsx'), /FILE_MAX_BYTES = 25 \* 1024 \* 1024/);
  assert.match(read('src/lib/invoiceFiles.js'), /INVOICE_FILE_MAX_BYTES = 25 \* 1024 \* 1024/);
  assert.match(read('src/lib/xlsx.js'), /MAX_IMPORT_BYTES = 25 \* 1024 \* 1024/);
  assert.ok(read('src/lib/xlsx.js').includes('larger than 25 MB'));
  assert.ok(read('src/components/staff/StaffDocumentsDialog.jsx').includes('file.size > 25 * 1024 * 1024'));
  assert.ok(read('src/pages/Settings.jsx').includes('prepared.size > 25 * 1024 * 1024'));
  // The doors that had no plain refusal gained the importer's own.
  for (const rel of [
    'src/hooks/useImportSheet.js',
    'src/pages/PosConnections.jsx',
    'src/components/restaurant/RecipeDialog.jsx',
  ]) {
    const src = read(rel);
    assert.ok(src.includes('file.size > 25 * 1024 * 1024'), `${rel} guards at 25 MB`);
    assert.ok(src.includes("t('import.fileTooLarge')"), `${rel} speaks the importer's refusal`);
  }
  // The create door's refusal from release 365 stands untouched.
  assert.ok(read('src/components/import/ImportWorkbench.jsx').includes('file.size > 25 * 1024 * 1024'));
});

test('each swept door\u2019s path carries the widened parser, so the refusal is the door\u2019s own', () => {
  const app = read('server/app.js');
  for (const p of [
    '/api/businesses/:bid/logo',
    '/api/businesses/:bid/product-photos',
    '/api/businesses/:bid/orders/:oid/shipping-label',
    '/api/businesses/:bid/staff-documents/:memberId',
    '/api/businesses/:bid/policies/:kind/file',
    '/api/businesses/:bid/profile-photos/me',
    '/api/businesses/:bid/pos/csv-import',
    '/api/businesses/:bid/restaurant/invoices/:invoiceId/file',
  ]) {
    assert.ok(app.includes(p), `parser mount names ${p}`);
  }
  assert.match(app, /express\.json\(\{ limit: '40mb' \}\)/);
});

test('the refusal wordings moved to 25 MB in the apiErrors registry, old ones gone', () => {
  assert.equal(
    API_ERROR_MESSAGE_KEYS['Send a PNG, JPG or WebP image under 25 MB.'],
    'apiErrors.invalidLogo',
  );
  assert.equal(
    API_ERROR_MESSAGE_KEYS['Send a PDF, PNG or JPG label file under 25 MB.'],
    'apiErrors.invalidLabel',
  );
  assert.equal(
    API_ERROR_MESSAGE_KEYS['Send a PDF, text, Word or OpenDocument file under 25 MB.'],
    'apiErrors.policyFileInvalid',
  );
  assert.equal(
    API_ERROR_MESSAGE_KEYS['Send a PDF, text, Word, OpenDocument or image file under 25 MB.'],
    'apiErrors.documents.fileInvalid',
  );
  for (const old of Object.keys(API_ERROR_MESSAGE_KEYS)) {
    assert.ok(!old.includes('under 2 MB'), `stale wording survives: ${old}`);
  }
});

async function essentialsOwner(label) {
  const owner = await ownerWithBusiness(`${label}@example.com`);
  await setEntitlement(owner.business.id, { plan: 'essentials', status: 'active' });
  return owner;
}

async function addMemberRow(owner, email) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, $3, $4, 'user', 'preset-sales', 'Sales clerk', '[]', 'active', $5)`,
    [id, owner.business.id, email.split('@')[0], email, owner.user.id],
  );
  return id;
}

test('staff documents: a file past the old 2 MB cap is accepted; past 25 MB is refused in plain words', async () => {
  const owner = await essentialsOwner('t68-docs-owner');
  const bid = owner.business.id;
  const memberId = await addMemberRow(owner, 't68-docs-member@example.com');
  const path = `/api/businesses/${bid}/staff-documents/${memberId}`;

  const threeMb = Buffer.alloc(3 * MB, 0x41);
  const accepted = await req(path, {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'big.txt', dataUrl: dataUrl('text/plain', threeMb) },
  });
  assert.equal(accepted.status, 201, accepted.text);
  assert.equal(accepted.json.documents.length, 1);
  assert.equal(accepted.json.documents[0].size_bytes, 3 * MB);

  const over = Buffer.alloc(25 * MB + 1, 0x41);
  const refused = await req(path, {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'huge.txt', dataUrl: dataUrl('text/plain', over) },
  });
  assert.equal(refused.status, 400, refused.text);
  assert.equal(refused.json.error, 'staff_document_invalid');
  assert.equal(
    refused.json.message,
    'Send a PDF, text, Word, OpenDocument or image file under 25 MB.',
  );

  const list = await req(path, { cookie: owner.cookie });
  assert.equal(list.json.documents.length, 1, 'the refused upload stored nothing');
});

test('business policy files: a file past the old 2 MB cap is accepted; past 25 MB is refused in plain words', async () => {
  const owner = await ownerWithBusiness('t68-policy-owner@example.com');
  const bid = owner.business.id;
  const path = `/api/businesses/${bid}/policies/policies/file`;

  const threeMb = Buffer.alloc(3 * MB, 0x42);
  const accepted = await req(path, {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'policies.txt', dataUrl: dataUrl('text/plain', threeMb) },
  });
  assert.equal(accepted.status, 201, accepted.text);
  assert.equal(accepted.json.policies.kind, 'file');
  assert.equal(accepted.json.policies.size_bytes, 3 * MB);

  const over = Buffer.alloc(25 * MB + 1, 0x42);
  const refused = await req(path, {
    method: 'POST',
    cookie: owner.cookie,
    body: { filename: 'huge.txt', dataUrl: dataUrl('text/plain', over) },
  });
  assert.equal(refused.status, 400, refused.text);
  assert.equal(refused.json.error, 'policy_file_invalid');
  assert.equal(
    refused.json.message,
    'Send a PDF, text, Word or OpenDocument file under 25 MB.',
  );
});

test('the import photo pipeline brings in a linked photo past the old cap and names one past 25 MB', async () => {
  const owner = await essentialsOwner('t68-photo-owner');
  const bid = owner.business.id;
  const fetchOf = (bytes) => async () => ({
    ok: true,
    headers: { get: (name) => (name === 'content-type' ? 'image/png' : null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });

  const threeMb = Buffer.alloc(3 * MB, 0x43);
  const brought = await fetchPhotoToStorage(pool, bid, 'https://example.com/cover.png', '', {
    fetchImpl: fetchOf(threeMb),
  });
  assert.ok(brought.url?.startsWith('/api/photos/'), JSON.stringify(brought));

  const over = Buffer.alloc(25 * MB + 1, 0x43);
  const refused = await fetchPhotoToStorage(pool, bid, 'https://example.com/huge.png', '', {
    fetchImpl: fetchOf(over),
  });
  assert.equal(refused.problem, 'The photo at that link is over 25 MB — too large to bring in.');
});

test('the workbook reader refuses past 25 MB — not the old 12', async () => {
  const { readWorkbookFile } = await import('../../src/lib/xlsx.js');
  const thirteenMb = new File([Buffer.alloc(13 * MB, 0x44)], 'big.xlsx');
  await assert.rejects(
    () => readWorkbookFile(thirteenMb),
    (err) => {
      // Past the old 12 MB cap the size refusal no longer fires:
      // the reader tries to open the file and fails as a workbook.
      assert.ok(!/larger than/.test(err.message), err.message);
      return true;
    },
  );
  const over = new File([Buffer.alloc(25 * MB + 1, 0x44)], 'huge.xlsx');
  await assert.rejects(() => readWorkbookFile(over), /larger than 25 MB/);
});
