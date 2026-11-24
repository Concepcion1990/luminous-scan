/**
 * Supplier invoice files — HTTP surface (release 361,
 * Nov 23, 2026).
 *
 *   GET    /api/businesses/:bid/restaurant/invoices/:invoiceId/file
 *          → the attachment's metadata (or an empty shape)
 *   GET    /api/businesses/:bid/restaurant/invoices/:invoiceId/file/bytes
 *          → the file itself
 *   POST   /api/businesses/:bid/restaurant/invoices/:invoiceId/file
 *          { filename, dataUrl } — upload or replace
 *   DELETE /api/businesses/:bid/restaurant/invoices/:invoiceId/file
 *
 * Her ruling (Nov 23, 2026, universal): anywhere in the app
 * there's an import or a file upload, on any page, the limit
 * is 25 MB, both plans. This door is BORN at that cap —
 * INVOICE_FILE_MAX_BYTES — enforced on the decoded bytes
 * here and pre-checked in the dialog; the path also carries
 * its own wider body parser in server/app.js so a 25 MB
 * file (33 MB as base64) reaches this clear refusal instead
 * of the parser's 413.
 *
 * The paper copy follows the app's private-file discipline
 * (staff documents, carrier labels): base64 in Postgres,
 * served ONLY here behind the session, never a public URL.
 * The door is the restaurant corner's: the business must be
 * Business (featureAllowed), reads are open to any trusted
 * member of the business (the corner's free view base), and
 * putting a file on or taking it off rides the same
 * restaurant.build tick as the invoice itself. One file per
 * invoice — uploading again replaces the paper copy.
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed } from './plans.js';
import { assertNotInGrace } from './billing.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] invoice file route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export const INVOICE_FILE_INVALID_MESSAGE =
  'Send a PDF or image file under 25 MB.';
export const INVOICE_FILE_NOT_FOUND_MESSAGE = 'That invoice file is not on file.';
export const INVOICE_NOT_FOUND_MESSAGE = 'That invoice is not in this business.';
export const INVOICE_FILE_NOT_GRANTED_MESSAGE =
  'Only the owner, or a team member trusted with building recipes and invoices, can change the invoice file.';

/** The universal cap (her ruling, Nov 23, 2026): 25 MB on
 *  every import and file upload in the app, both plans. */
export const INVOICE_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const INVOICE_FILE_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];

function parseInvoiceFileDataUrl(value) {
  const text = String(value || '');
  const match = text.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!INVOICE_FILE_TYPES.includes(mime)) return null;
  let bytes;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > INVOICE_FILE_MAX_BYTES) return null;
  return { mime, bytes, base64: match[2] };
}

const cleanFilename = (value) =>
  String(value || '')
    .split(/[\\/]/)
    .pop()
    .replace(/["\r\n]/g, '')
    .trim()
    .slice(0, 120);

export function createRestaurantFileRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/restaurant/invoices/:invoiceId/file';

  /** Standing in the business + the Business gate, then the
   *  invoice itself (another business's invoice is a 404,
   *  never a leak). */
  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    const { rows } = await pool().query(
      'SELECT id FROM supplier_invoices WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.invoiceId, req.params.bid],
    );
    if (!rows[0]) throw err(404, 'invoice_not_found', INVOICE_NOT_FOUND_MESSAGE);
    return access;
  }

  async function writeCtx(req) {
    const access = await ctx(req);
    if (!access.can('restaurant.build')) {
      throw err(403, 'invoice_file_not_granted', INVOICE_FILE_NOT_GRANTED_MESSAGE);
    }
    await assertNotInGrace(pool(), req.params.bid);
    return access;
  }

  async function fileRow(bid, invoiceId) {
    const { rows } = await pool().query(
      `SELECT invoice_id, filename, content_type, size_bytes, created_at
         FROM supplier_invoice_files
        WHERE invoice_id = $1 AND business_id = $2 LIMIT 1`,
      [invoiceId, bid],
    );
    return rows[0] || null;
  }

  const shape = (row) =>
    row
      ? {
          invoice_id: row.invoice_id,
          filename: row.filename || '',
          content_type: row.content_type,
          size_bytes: row.size_bytes,
          uploaded_at: row.created_at,
        }
      : null;

  // Metadata — the dialog shows the paper copy's name + size.
  router.get(base, asyncHandler(async (req, res) => {
    await ctx(req);
    return res.json({ file: shape(await fileRow(req.params.bid, req.params.invoiceId)) });
  }));

  // The bytes — served ONLY here, behind the same door.
  router.get(`${base}/bytes`, asyncHandler(async (req, res) => {
    await ctx(req);
    const { rows } = await pool().query(
      'SELECT content_type, filename, data_base64 FROM supplier_invoice_files WHERE invoice_id = $1 AND business_id = $2 LIMIT 1',
      [req.params.invoiceId, req.params.bid],
    );
    const file = rows[0];
    if (!file) throw err(404, 'invoice_file_not_found', INVOICE_FILE_NOT_FOUND_MESSAGE);
    res.setHeader('Content-Type', file.content_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${cleanFilename(file.filename) || 'invoice'}"`,
    );
    return res.send(Buffer.from(file.data_base64, 'base64'));
  }));

  // Upload or replace the one paper copy.
  router.post(base, asyncHandler(async (req, res) => {
    const access = await writeCtx(req);
    const parsed = parseInvoiceFileDataUrl(req.body?.dataUrl);
    if (!parsed) {
      throw err(400, 'invoice_file_invalid', INVOICE_FILE_INVALID_MESSAGE);
    }
    await pool().query(
      `INSERT INTO supplier_invoice_files
         (invoice_id, business_id, filename, content_type, size_bytes, data_base64, uploaded_by_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (invoice_id) DO UPDATE SET
         business_id = EXCLUDED.business_id,
         filename = EXCLUDED.filename,
         content_type = EXCLUDED.content_type,
         size_bytes = EXCLUDED.size_bytes,
         data_base64 = EXCLUDED.data_base64,
         uploaded_by_id = EXCLUDED.uploaded_by_id,
         created_at = NOW()`,
      [
        req.params.invoiceId,
        req.params.bid,
        cleanFilename(req.body?.filename),
        parsed.mime,
        parsed.bytes.length,
        parsed.base64,
        access.isOwner ? req.user.id : access.staffRow?.user_id || req.user.id,
      ],
    );
    return res.status(201).json({ file: shape(await fileRow(req.params.bid, req.params.invoiceId)) });
  }));

  // Take the paper copy off — a deliberate act behind the
  // dialog's own remove door.
  router.delete(base, asyncHandler(async (req, res) => {
    await writeCtx(req);
    const { rowCount } = await pool().query(
      'DELETE FROM supplier_invoice_files WHERE invoice_id = $1 AND business_id = $2',
      [req.params.invoiceId, req.params.bid],
    );
    if (!rowCount) throw err(404, 'invoice_file_not_found', INVOICE_FILE_NOT_FOUND_MESSAGE);
    return res.json({ file: null });
  }));

  return router;
}
