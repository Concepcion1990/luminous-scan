/**
 * Staff documents — HTTP surface (Nov 21, 2026).
 *
 *   GET    /api/businesses/:bid/staff-documents/members
 *   GET    /api/businesses/:bid/staff-documents/:memberId
 *   POST   /api/businesses/:bid/staff-documents/:memberId          { title?, filename, dataUrl }
 *   GET    /api/businesses/:bid/staff-documents/:memberId/:docId/file
 *   DELETE /api/businesses/:bid/staff-documents/:memberId/:docId   owner only
 *   GET    /api/businesses/:bid/staff-documents/mine               the subject's own file (read-only)
 *   GET    /api/businesses/:bid/staff-documents/mine/:docId/file  the subject's own bytes (read-only)
 *
 * The owner's rulings (Nov 19 + Nov 20, 2026):
 *   - Each member has a documents file: the paperwork the owner
 *     keeps for that person (W-4, job application, tax forms, ID
 *     copies). Each upload carries a title the owner gives it
 *     (default: the file name). The list runs newest-first with
 *     title, date, and who uploaded it.
 *   - A new upload NEVER deletes the previous version: every
 *     upload is its own kept row (migration 039), listed and
 *     openable forever. The one removal is the owner's own
 *     deliberate per-version Remove (below) — an upload itself
 *     removes nothing.
 *   - Access is ONE owner-grant tick, `staff.documents`: the
 *     owner by birth, or a MANAGER the owner ticked — granted
 *     only through the red-warning confirm in the member dialog.
 *     The server enforces the tick on EVERY read and write on
 *     the admin stem above: plain staff get 403, an unticked
 *     manager gets 403, and the document's own subject gets 403
 *     there too.
 *   - THE SUBJECT'S OWN DOOR (the owner's ruling, Nov 23, 2026,
 *     ~4:50 PM; built Nov 24, 2026): the person a file is ABOUT
 *     can open their OWN file read-only — view, download, print,
 *     never edit — through the /mine stem below. It is separate
 *     from the tick: it needs no grant, it is bound to the
 *     caller's own staff row (there is no member id in the path
 *     to aim at anyone else), and it has NO write routes at all.
 *     A document id that belongs to a colleague is simply not
 *     found under the caller's own row — the same 404 as a
 *     document that does not exist.
 *   - The hierarchy follows the clock family: a ticked manager
 *     reaches STAFF-level members' files only. A manager-level
 *     member's documents are the owner's alone, and manager-level
 *     members do not appear in a ticked manager's member list at
 *     all — invisibility, not a locked row.
 *   - Bytes follow the app's private-file discipline (carrier
 *     labels, business policy files): base64 in Postgres, served
 *     ONLY here behind the session + tick check, never through a
 *     public URL. 2 MB cap, document types plus images (an ID
 *     copy arrives as a photo).
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';
import { memberLevel } from './staffWindow.js';
import { memberHasDocumentsTick, STAFF_DOCUMENTS_TICK } from './staffDocuments.js';
import { ownerPublicName } from './profilePhotos.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] staff document route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export const STAFF_DOCUMENTS_NOT_GRANTED_MESSAGE =
  'Only the owner, or a manager the owner has trusted with staff documents, can do that.';
export const STAFF_DOCUMENTS_OWNER_ONLY_FOR_MANAGER_MESSAGE =
  "Only the owner can manage a manager's documents.";
export const STAFF_DOCUMENTS_REMOVE_OWNER_ONLY_MESSAGE =
  'Only the owner can remove a staff document.';
export const STAFF_DOCUMENT_FILE_INVALID_MESSAGE =
  'Send a PDF, text, Word, OpenDocument or image file under 2 MB.';
export const STAFF_DOCUMENT_NOT_FOUND_MESSAGE = 'That document is not on file.';
export const STAFF_DOCUMENT_MEMBER_NOT_FOUND_MESSAGE =
  'That team member is not in this business.';

/** The file rules: the business-policy discipline (2 MB, which
 *  also keeps the base64 body inside the app's 3 MB JSON limit),
 *  document types — plus PNG/JPEG/WebP, because an ID copy
 *  arrives as a photo. */
export const STAFF_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
export const STAFF_DOCUMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
  'image/png',
  'image/jpeg',
  'image/webp',
];

export const STAFF_DOCUMENT_TITLE_MAX = 120;

function parseStaffDocumentDataUrl(value) {
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

export function createStaffDocumentRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/staff-documents';

  /** The door itself: the owner, or a manager holding the tick
   *  in effect. Everyone else — plain staff, unticked managers,
   *  the document's own subject, another business's people —
   *  gets the one refusal, on every route in this file. */
  async function documentsAdminOr403(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (access.isOwner) return access;
    if (await memberHasDocumentsTick(pool(), access.business, access.staffRow)) return access;
    throw err(403, 'staff_documents_not_granted', STAFF_DOCUMENTS_NOT_GRANTED_MESSAGE);
  }

  /** The target member, with the clock-family hierarchy: a
   *  manager's documents are the owner's alone. */
  async function memberOr404(req, access) {
    const { rows } = await pool().query(
      'SELECT * FROM staff_members WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.memberId, req.params.bid],
    );
    const member = rows[0];
    if (!member) throw err(404, 'staff_document_member_not_found', STAFF_DOCUMENT_MEMBER_NOT_FOUND_MESSAGE);
    if (!access.isOwner && memberLevel(member) === 'manager') {
      throw err(403, 'forbidden', STAFF_DOCUMENTS_OWNER_ONLY_FOR_MANAGER_MESSAGE);
    }
    return member;
  }

  /** One version as the clients render it: metadata only — the
   *  bytes ride the file route. uploaded_by_name is a NAME,
   *  never an email (the Nov 21, 2026 rule). */
  function shapeDocument(row) {
    return {
      id: row.id,
      staff_member_id: row.staff_member_id,
      title: row.title || '',
      filename: row.filename || '',
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      uploaded_by_name: row.uploaded_by_name || '',
      uploaded_at: row.created_at,
    };
  }

  async function listDocuments(bid, memberId) {
    const { rows } = await pool().query(
      `SELECT id, staff_member_id, title, filename, content_type, size_bytes, uploaded_by_name, created_at
         FROM staff_documents
        WHERE business_id = $1 AND staff_member_id = $2
        ORDER BY created_at DESC, id DESC`,
      [bid, memberId],
    );
    return rows.map(shapeDocument);
  }

  /** Serve one version's bytes — shared by the admin file
   *  route and the subject's own door. The query binds the
   *  document to the member id the CALLER was authorized for,
   *  so a document that belongs to anyone else is a plain 404,
   *  indistinguishable from one that does not exist. */
  async function serveDocumentFile(res, bid, memberId, docId) {
    const { rows } = await pool().query(
      'SELECT content_type, filename, data_base64 FROM staff_documents WHERE id = $1 AND business_id = $2 AND staff_member_id = $3',
      [docId, bid, memberId],
    );
    const file = rows[0];
    if (!file) throw err(404, 'staff_document_not_found', STAFF_DOCUMENT_NOT_FOUND_MESSAGE);
    res.setHeader('Content-Type', file.content_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${cleanFilename(file.filename) || 'document'}"`,
    );
    return res.send(Buffer.from(file.data_base64, 'base64'));
  }

  /** The subject's own door: the caller must hold a staff row
   *  in THIS business; the file they reach is that row's, and
   *  no one else's — there is no member id in the /mine path to
   *  point anywhere else. A caller with no row here (the owner
   *  without a member row, say) has no own file: the admin stem
   *  is their door, and this one answers the member-not-found
   *  refusal. */
  async function ownFileOr404(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    const me = access.staffRow;
    if (!me) throw err(404, 'staff_document_member_not_found', STAFF_DOCUMENT_MEMBER_NOT_FOUND_MESSAGE);
    return { access, me };
  }

  // The member list for the documents area: names + counts only.
  // No emails, no contact fields, no pay — this list exists to
  // pick a person's file, and it carries nothing else. A ticked
  // manager's list holds staff-level members only (see the
  // hierarchy note above); the owner's holds everyone.
  router.get(`${base}/members`, asyncHandler(async (req, res) => {
    const access = await documentsAdminOr403(req);
    // Members and counts ride separate plain queries (no
    // GROUP BY over the member row — the counts merge here).
    const { rows } = await pool().query(
      `SELECT id, full_name, role_id, role_name, status
         FROM staff_members
        WHERE business_id = $1
        ORDER BY full_name ASC`,
      [req.params.bid],
    );
    const { rows: countRows } = await pool().query(
      `SELECT staff_member_id, COUNT(*)::int AS doc_count
         FROM staff_documents
        WHERE business_id = $1
        GROUP BY staff_member_id`,
      [req.params.bid],
    );
    const counts = new Map(countRows.map((row) => [row.staff_member_id, row.doc_count]));
    const visible = access.isOwner
      ? rows
      : rows.filter((row) => memberLevel(row) !== 'manager');
    return res.json({
      members: visible.map((row) => ({
        id: row.id,
        full_name: row.full_name,
        role_name: row.role_name,
        status: row.status,
        doc_count: counts.get(row.id) ?? 0,
      })),
    });
  }));

  // The subject's own file (Nov 24, 2026): every kept version
  // of the CALLER's paperwork, newest first — read-only. These
  // routes are registered before the /:memberId stem on
  // purpose: 'mine' is a door, never a member id.
  router.get(`${base}/mine`, asyncHandler(async (req, res) => {
    const { me } = await ownFileOr404(req);
    return res.json({
      member: { id: me.id, full_name: me.full_name },
      documents: await listDocuments(req.params.bid, me.id),
    });
  }));

  // The subject's own bytes: view / download / print ride this
  // one route, exactly as on the admin stem.
  router.get(`${base}/mine/:docId/file`, asyncHandler(async (req, res) => {
    const { me } = await ownFileOr404(req);
    return serveDocumentFile(res, req.params.bid, me.id, req.params.docId);
  }));

  // One person's file: every kept version, newest first.
  router.get(`${base}/:memberId`, asyncHandler(async (req, res) => {
    const access = await documentsAdminOr403(req);
    const member = await memberOr404(req, access);
    return res.json({
      member: { id: member.id, full_name: member.full_name },
      documents: await listDocuments(req.params.bid, member.id),
    });
  }));

  // Add a version. An upload NEVER touches the existing rows —
  // it only ever inserts its own.
  router.post(`${base}/:memberId`, asyncHandler(async (req, res) => {
    const access = await documentsAdminOr403(req);
    await assertNotInGrace(pool(), req.params.bid);
    const member = await memberOr404(req, access);
    const parsed = parseStaffDocumentDataUrl(req.body?.dataUrl);
    if (!parsed) {
      throw err(400, 'staff_document_invalid', STAFF_DOCUMENT_FILE_INVALID_MESSAGE);
    }
    const filename = cleanFilename(req.body?.filename);
    const title = String(req.body?.title ?? '').trim().slice(0, STAFF_DOCUMENT_TITLE_MAX) || filename;
    const uploadedByName = access.isOwner
      ? await ownerPublicName(pool(), access.business)
      : access.staffRow?.full_name || '';
    const id = crypto.randomUUID();
    await pool().query(
      `INSERT INTO staff_documents
         (id, business_id, staff_member_id, title, filename, content_type, size_bytes, data_base64,
          uploaded_by_id, uploaded_by_staff_id, uploaded_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        req.params.bid,
        member.id,
        title,
        filename,
        parsed.mime,
        parsed.bytes.length,
        parsed.base64,
        req.user.id,
        access.isOwner ? null : access.staffRow?.id || null,
        uploadedByName,
      ],
    );
    return res.status(201).json({
      member: { id: member.id, full_name: member.full_name },
      documents: await listDocuments(req.params.bid, member.id),
    });
  }));

  // The bytes of one version — served ONLY here, behind the
  // same door as every other route in this file.
  router.get(`${base}/:memberId/:docId/file`, asyncHandler(async (req, res) => {
    const access = await documentsAdminOr403(req);
    const member = await memberOr404(req, access);
    return serveDocumentFile(res, req.params.bid, member.id, req.params.docId);
  }));

  // Remove ONE version — the owner's deliberate act, behind the
  // confirm dialog in the client. A ticked manager cannot
  // remove: the tick opens the file, it does not empty it.
  router.delete(`${base}/:memberId/:docId`, asyncHandler(async (req, res) => {
    const access = await documentsAdminOr403(req);
    if (!access.isOwner) {
      throw err(403, 'staff_documents_remove_owner_only', STAFF_DOCUMENTS_REMOVE_OWNER_ONLY_MESSAGE);
    }
    await assertNotInGrace(pool(), req.params.bid);
    const member = await memberOr404(req, access);
    const { rowCount } = await pool().query(
      'DELETE FROM staff_documents WHERE id = $1 AND business_id = $2 AND staff_member_id = $3',
      [req.params.docId, req.params.bid, member.id],
    );
    if (!rowCount) throw err(404, 'staff_document_not_found', STAFF_DOCUMENT_NOT_FOUND_MESSAGE);
    return res.json({
      member: { id: member.id, full_name: member.full_name },
      documents: await listDocuments(req.params.bid, member.id),
    });
  }));

  return router;
}

export { STAFF_DOCUMENTS_TICK };
