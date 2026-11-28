/**
 * The food-safety file, completed — HTTP surface (Nov 26,
 * 2026; plan release 370, Gap 6 + the round-2 riders).
 *
 *   GET    /api/businesses/:bid/food-safety/certs            owner / staff.documents tick: every certificate + standings
 *   GET    /api/businesses/:bid/food-safety/certs/mine       the subject's own certificates (read-only)
 *   POST   /api/businesses/:bid/food-safety/certs/:memberId  owner / tick: add a certificate for that member
 *   DELETE /api/businesses/:bid/food-safety/certs/:certId    owner only: remove one certificate
 *   GET    /api/businesses/:bid/food-safety/sds              ANY member: the SDS shelf (staff-readable by law's spirit)
 *   GET    /api/businesses/:bid/food-safety/sds/:id/file     ANY member: one sheet's bytes
 *   POST   /api/businesses/:bid/food-safety/sds              owner / tick: add a sheet (documents machinery rules)
 *   DELETE /api/businesses/:bid/food-safety/sds/:id          owner only: remove one sheet
 *   POST   /api/businesses/:bid/food-safety/mock-inspection  ANY member: start today's mock inspection on the checklist engine
 *
 * Doctrines:
 *  - BUSINESS-ONLY: the whole surface sits behind the
 *    restaurant corner's plan gate — on Essentials it refuses
 *    exactly as the corner's other doors do, and no client
 *    surface links here from an Essentials business.
 *  - CERTIFICATES ride the staff-documents machinery (release
 *    340's pattern): the admin doors answer to the owner or a
 *    MANAGER holding the `staff.documents` tick in effect (the
 *    memberHasDocumentsTick test, reused, not rebuilt); the
 *    clock-family hierarchy holds — a manager's certificates
 *    are the owner's alone; the subject reads their OWN certs
 *    through the /mine door, bound to their own staff row.
 *  - THE SDS SHELF is the mirror image: readable by ANY member
 *    of the business with no tick at all (the sheets must be
 *    accessible to the staff who use the chemicals), while
 *    adding one rides the same documents tick pattern and
 *    removing one is the owner's deliberate act alone. Bytes
 *    follow the documents discipline: base64 in Postgres,
 *    served only here behind the session, the universal 25 MB
 *    cap and the documents file types.
 *  - THE MOCK INSPECTION reuses the checklist engine (plan
 *    369): starting one materialises today's instance of the
 *    business's mock-inspection template (created on first
 *    start from the item labels the caller sends — the
 *    caller's own language, the starter-template pattern), and
 *    ticking it off rides the checklist routes like any list.
 *    Starting a self-check is staff work, so no tick is asked.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';
import { featureAllowed } from './plans.js';
import { memberLevel } from './staffWindow.js';
import { memberHasDocumentsTick } from './staffDocuments.js';
import {
  STAFF_DOCUMENTS_NOT_GRANTED_MESSAGE,
  STAFF_DOCUMENTS_OWNER_ONLY_FOR_MANAGER_MESSAGE,
  STAFF_DOCUMENT_FILE_INVALID_MESSAGE,
  STAFF_DOCUMENT_MAX_BYTES,
  STAFF_DOCUMENT_TYPES,
} from './staffDocumentRoutes.js';
import { ownerPublicName } from './profilePhotos.js';
import { NAME_MESSAGE, createTemplate, dayView, listTemplates } from './checklistsCore.js';
import {
  CERT_MEMBER_MESSAGE,
  createCert,
  deleteCert,
  listCerts,
  listSdsSheets,
  shapePestVisit,
  shapeSdsSheet,
} from './foodSafetyCore.js';

export const FOOD_SAFETY_REMOVE_OWNER_ONLY_MESSAGE =
  'Only the owner can remove this from the food-safety file.';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] food-safety route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

function parseSdsDataUrl(value) {
  const text = String(value || '');
  const match = text.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!STAFF_DOCUMENT_TYPES.includes(mime)) return null;
  let bytes;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > STAFF_DOCUMENT_MAX_BYTES) return null;
  return { mime, bytes, base64: match[2] };
}

const cleanFilename = (value) =>
  String(value || '')
    .split(/[\\/]/)
    .pop()
    .replace(/["\r\n]/g, '')
    .trim()
    .slice(0, 120);

export function createFoodSafetyRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/food-safety';

  /** Standing in the business + the Business (restaurant)
   *  gate — the corner's own refusal, word for word. */
  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    return access;
  }

  /** The documents door: the owner, or a manager holding the
   *  staff.documents tick in effect (release 340's test). */
  async function documentsCtx(req) {
    const access = await ctx(req);
    if (access.isOwner) return access;
    if (await memberHasDocumentsTick(pool(), access.business, access.staffRow)) return access;
    throw err(403, 'staff_documents_not_granted', STAFF_DOCUMENTS_NOT_GRANTED_MESSAGE);
  }

  async function memberOr404(req, access) {
    const { rows } = await pool().query(
      'SELECT * FROM staff_members WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.memberId, req.params.bid],
    );
    const member = rows[0];
    if (!member) throw err(404, 'food_cert_member_not_found', CERT_MEMBER_MESSAGE);
    if (!access.isOwner && memberLevel(member) === 'manager') {
      throw err(403, 'forbidden', STAFF_DOCUMENTS_OWNER_ONLY_FOR_MANAGER_MESSAGE);
    }
    return member;
  }

  const today = () => new Date().toISOString().slice(0, 10);

  /* -------------------------------------------- certificates */

  router.get(`${base}/certs`, asyncHandler(async (req, res) => {
    const access = await documentsCtx(req);
    let certs = await listCerts(pool(), req.params.bid, today());
    if (!access.isOwner) {
      // The hierarchy: a ticked manager's shelf holds
      // staff-level members' certificates only — manager-level
      // members' rows are invisible, not locked (the documents
      // pattern). The member levels ride one roster read.
      const { rows } = await pool().query(
        'SELECT id, role_id, role_name FROM staff_members WHERE business_id = $1',
        [req.params.bid],
      );
      const managerIds = new Set(rows.filter((row) => memberLevel(row) === 'manager').map((row) => row.id));
      certs = certs.filter((cert) => !managerIds.has(cert.staff_member_id));
    }
    return res.json({ certs, canManage: true });
  }));

  // The subject's own door: registered before the /:memberId
  // stem on purpose — 'mine' is a door, never a member id.
  router.get(`${base}/certs/mine`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const me = access.staffRow;
    if (!me) throw err(404, 'food_cert_member_not_found', CERT_MEMBER_MESSAGE);
    const certs = (await listCerts(pool(), req.params.bid, today()))
      .filter((cert) => cert.staff_member_id === me.id);
    return res.json({ member: { id: me.id, full_name: me.full_name }, certs });
  }));

  router.post(`${base}/certs/:memberId`, asyncHandler(async (req, res) => {
    const access = await documentsCtx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const member = await memberOr404(req, access);
    const actorName = access.isOwner
      ? await ownerPublicName(pool(), access.business)
      : access.staffRow?.full_name || '';
    await createCert(pool(), req.params.bid, member, req.body || {}, { userId: req.user.id, actorName });
    return res.status(201).json({ certs: await listCerts(pool(), req.params.bid, today()) });
  }));

  router.delete(`${base}/certs/:certId`, asyncHandler(async (req, res) => {
    const access = await documentsCtx(req);
    if (!access.isOwner) {
      throw err(403, 'food_safety_remove_owner_only', FOOD_SAFETY_REMOVE_OWNER_ONLY_MESSAGE);
    }
    await assertNotInGrace(pool(), req.params.bid);
    await deleteCert(pool(), req.params.bid, req.params.certId);
    return res.json({ certs: await listCerts(pool(), req.params.bid, today()) });
  }));

  /* ------------------------------------------------ SDS shelf */

  router.get(`${base}/sds`, asyncHandler(async (req, res) => {
    await ctx(req);
    return res.json({ sheets: await listSdsSheets(pool(), req.params.bid) });
  }));

  router.get(`${base}/sds/:id/file`, asyncHandler(async (req, res) => {
    await ctx(req);
    const { rows } = await pool().query(
      'SELECT content_type, filename, data_base64 FROM sds_sheets WHERE id = $1 AND business_id = $2',
      [req.params.id, req.params.bid],
    );
    const file = rows[0];
    if (!file) throw err(404, 'not_found', 'Not found.');
    res.setHeader('Content-Type', file.content_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${cleanFilename(file.filename) || 'document'}"`);
    return res.send(Buffer.from(file.data_base64, 'base64'));
  }));

  router.post(`${base}/sds`, asyncHandler(async (req, res) => {
    const access = await documentsCtx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const parsed = parseSdsDataUrl(req.body?.dataUrl);
    if (!parsed) throw err(400, 'staff_document_invalid', STAFF_DOCUMENT_FILE_INVALID_MESSAGE);
    const filename = cleanFilename(req.body?.filename);
    const title = String(req.body?.title ?? '').trim().slice(0, 120) || filename;
    const uploadedByName = access.isOwner
      ? await ownerPublicName(pool(), access.business)
      : access.staffRow?.full_name || '';
    const id = crypto.randomUUID();
    const { rows } = await pool().query(
      `INSERT INTO sds_sheets (id, business_id, title, filename, content_type, size_bytes, data_base64, uploaded_by_id, uploaded_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [id, req.params.bid, title, filename, parsed.mime, parsed.bytes.length, parsed.base64, req.user.id, uploadedByName],
    );
    return res.status(201).json({ sheet: shapeSdsSheet(rows[0]), sheets: await listSdsSheets(pool(), req.params.bid) });
  }));

  router.delete(`${base}/sds/:id`, asyncHandler(async (req, res) => {
    const access = await documentsCtx(req);
    if (!access.isOwner) {
      throw err(403, 'food_safety_remove_owner_only', FOOD_SAFETY_REMOVE_OWNER_ONLY_MESSAGE);
    }
    await assertNotInGrace(pool(), req.params.bid);
    const { rowCount } = await pool().query(
      'DELETE FROM sds_sheets WHERE id = $1 AND business_id = $2',
      [req.params.id, req.params.bid],
    );
    if (!rowCount) throw err(404, 'not_found', 'Not found.');
    return res.json({ sheets: await listSdsSheets(pool(), req.params.bid) });
  }));

  /* ------------------------- pest-control reports (G-B) */

  // The pest company's own report, filed with its visit —
  // the documents machinery pattern the SDS shelf uses
  // (same file types, same 25 MB cap, bytes behind the
  // session). Filing and reading are log work: any member
  // of the business may do either, like reading the SDS
  // shelf; the visit itself rides the PestVisit entity.
  router.get(`${base}/pest/:id/file`, asyncHandler(async (req, res) => {
    await ctx(req);
    const { rows } = await pool().query(
      'SELECT report_content_type, report_filename, report_data_base64 FROM pest_visits WHERE id = $1 AND business_id = $2',
      [req.params.id, req.params.bid],
    );
    const file = rows[0];
    if (!file?.report_data_base64) throw err(404, 'not_found', 'Not found.');
    res.setHeader('Content-Type', file.report_content_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${cleanFilename(file.report_filename) || 'document'}"`);
    return res.send(Buffer.from(file.report_data_base64, 'base64'));
  }));

  router.post(`${base}/pest/:id/report`, asyncHandler(async (req, res) => {
    await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const parsed = parseSdsDataUrl(req.body?.dataUrl);
    if (!parsed) throw err(400, 'staff_document_invalid', STAFF_DOCUMENT_FILE_INVALID_MESSAGE);
    const filename = cleanFilename(req.body?.filename);
    const { rows } = await pool().query(
      `UPDATE pest_visits SET report_filename = $3, report_content_type = $4, report_size_bytes = $5, report_data_base64 = $6, updated_at = NOW()
        WHERE id = $1 AND business_id = $2 RETURNING *`,
      [req.params.id, req.params.bid, filename, parsed.mime, parsed.bytes.length, parsed.base64],
    );
    if (!rows[0]) throw err(404, 'not_found', 'Not found.');
    return res.status(201).json({ visit: shapePestVisit(rows[0]) });
  }));

  /* ------------------------------------------- mock inspection */

  router.post(`${base}/mock-inspection`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const name = String(req.body?.name || '').trim().slice(0, 200);
    if (!name) throw err(400, 'checklist_name', NAME_MESSAGE);
    const labels = (Array.isArray(req.body?.items) ? req.body.items : [])
      .map((label) => String(label || '').trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 50);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || '')) ? String(req.body.date) : today();
    const templates = await listTemplates(pool(), access.business.id);
    let template = templates.find((entry) => entry.name === name);
    if (!template) {
      template = await createTemplate(pool(), access.business.id, {
        name,
        items: labels.map((label, i) => ({ id: `item-${i + 1}`, label, proof: 'none' })),
        assign_type: 'everyone',
        schedule: 'daily',
        start_date: date,
      }, { userId: req.user.id });
    }
    const view = await dayView(pool(), access.business.id, date);
    const instance = view.instances.find((entry) => entry.template_id === template.id) || null;
    return res.status(201).json({ template, instance, date });
  }));

  return router;
}
