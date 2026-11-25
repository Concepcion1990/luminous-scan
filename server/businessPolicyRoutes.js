/**
 * The owner's own store policies + terms — HTTP surface
 * (Nov 19, 2026).
 *
 *   GET    /api/businesses/:bid/policies              both documents' state
 *   PUT    /api/businesses/:bid/policies/:kind/text   owner: save typed text
 *   DELETE /api/businesses/:bid/policies/:kind/text   owner: clear typed text
 *   POST   /api/businesses/:bid/policies/:kind/file   owner: upload a file
 *   DELETE /api/businesses/:bid/policies/:kind/file   owner: remove the file
 *   GET    /api/businesses/:bid/policies/:kind/file   member: the file itself
 *
 * :kind is 'policies' (Store Policies) or 'terms' (Terms &
 * Conditions).
 *
 * The owner's rulings (Nov 19, 2026, ~16:34–16:38):
 *   - In Settings the OWNER writes two per-business documents:
 *     Store Policies — the house rules for how the app and the
 *     store are used in THEIR business; an owner may put their
 *     entire store policy in — and Terms & Conditions. EACH
 *     accepts typed text OR an uploaded file: both options
 *     offered, either or.
 *   - Per-business only. Nothing an owner writes ever appears
 *     in another business; nothing here is platform-wide.
 *     Luminous StockHaven's own policies and terms stay with
 *     the app (the legal pages) — this router never touches
 *     them.
 *   - The team READS: every member of the business (owner,
 *     manager, staff) can read both documents — they are shown
 *     once in the first-start welcome and live read-only in
 *     every member's Settings. Reading is membership; there is
 *     no permission tick for this feature. WRITING is the
 *     owner's alone, inherently — no tick hands it out.
 *
 * Storage (migration 032): typed text on the business row
 * (store_policies_text / store_terms_text — the welcome-script
 * precedent: owner-written words stored as written, never
 * translated); an uploaded file in business_policy_files,
 * following the app's private-file pattern (carrier labels,
 * migration 025): bytes in Postgres as base64, served ONLY
 * here, behind the session and the business-membership check —
 * never through the public /api/photos/:id route. A document
 * is in exactly one of three states — empty, text, or file:
 * saving text deletes the file row, uploading a file clears
 * the text, removing returns the document to empty.
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] business policy route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

/** The two documents, by URL kind: the business-row text column
 *  each one's typed text lives in. */
export const POLICY_DOC_KINDS = {
  policies: { textColumn: 'store_policies_text' },
  terms: { textColumn: 'store_terms_text' },
};

/** Typed text cap: an owner's ENTIRE store policy must fit —
 *  100,000 characters is a small book — while one field still
 *  cannot become a document store. The refusal names the file
 *  door, so the limit is never a dead end. */
export const POLICY_TEXT_MAX = 100_000;

export const POLICY_OWNER_ONLY_MESSAGE =
  "Only the owner can change this store's policies and terms.";
export const POLICY_FILE_INVALID_MESSAGE =
  'Send a PDF, text, Word or OpenDocument file under 25 MB.';
export const POLICY_TEXT_TOO_LONG_MESSAGE =
  'That document is too long to type here. You can upload it as a file instead.';

/** The file rules, matching the app's private-file discipline:
 *  the universal upload ceiling (25 MB — owner ruling, Nov 23,
 *  2026; this door's path carries a widened JSON parser in
 *  server/app.js so an over-size file reaches this cap and its
 *  plain refusal), and document types only — PDF, plain text,
 *  Word (.doc/.docx), RTF and OpenDocument text. */
export const POLICY_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const POLICY_FILE_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
];

function parsePolicyFileDataUrl(value) {
  const text = String(value || '');
  const match = text.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!POLICY_FILE_TYPES.includes(mime)) return null;
  let bytes;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > POLICY_FILE_MAX_BYTES) return null;
  return { mime, bytes, base64: match[2] };
}

const cleanPolicyFilename = (value) =>
  String(value || '')
    .split(/[\\/]/)
    .pop()
    .replace(/["\r\n]/g, '')
    .trim()
    .slice(0, 120);

export function createBusinessPolicyRouter({ getPool: getPoolFn }) {
  const router = Router();
  const pool = () => getPoolFn();
  const auth = (req, res, next) => requireAuth(pool())(req, res, next);
  router.use(auth);

  /** Any member may read; a non-member gets the one closed door. */
  async function memberOr403(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    return access;
  }

  /** Writing is the owner's alone — no role and no tick carries
   *  it. The refusal is facts-only and renders in the reader's
   *  language through the apiErrors registry. */
  async function ownerOr403(req) {
    const access = await memberOr403(req);
    if (!access.isOwner) {
      throw err(403, 'business_policies_owner_only', POLICY_OWNER_ONLY_MESSAGE);
    }
    return access;
  }

  function kindOr404(req) {
    const spec = POLICY_DOC_KINDS[req.params.kind];
    if (!spec) throw err(404, 'policy_doc_not_found', 'That document is not one of the two.');
    return spec;
  }

  /** One document's public state: empty, text (the owner's words
   *  exactly as written), or file (metadata only — the bytes ride
   *  the file route). */
  function docState(business, fileRow, textColumn) {
    if (fileRow) {
      return {
        kind: 'file',
        filename: fileRow.filename || '',
        content_type: fileRow.content_type,
        size_bytes: fileRow.size_bytes,
        updated_at: fileRow.updated_at,
      };
    }
    const text = String(business[textColumn] || '');
    if (text.trim()) return { kind: 'text', text };
    return { kind: 'empty' };
  }

  async function loadState(bid, business) {
    const { rows } = await pool().query(
      'SELECT doc_kind, content_type, filename, size_bytes, updated_at FROM business_policy_files WHERE business_id = $1',
      [bid],
    );
    const byKind = Object.fromEntries(rows.map((row) => [row.doc_kind, row]));
    return {
      policies: docState(business, byKind.policies, POLICY_DOC_KINDS.policies.textColumn),
      terms: docState(business, byKind.terms, POLICY_DOC_KINDS.terms.textColumn),
    };
  }

  router.get('/businesses/:bid/policies', asyncHandler(async (req, res) => {
    const access = await memberOr403(req);
    return res.json(await loadState(req.params.bid, access.business));
  }));

  router.put('/businesses/:bid/policies/:kind/text', asyncHandler(async (req, res) => {
    const spec = kindOr404(req);
    await ownerOr403(req);
    await assertNotInGrace(pool(), req.params.bid);
    const raw = typeof req.body?.text === 'string' ? req.body.text : '';
    if (raw.length > POLICY_TEXT_MAX) {
      throw err(400, 'policy_text_too_long', POLICY_TEXT_TOO_LONG_MESSAGE);
    }
    // Owner-written words are stored as written (the welcome-
    // script precedent) — never trimmed into different words.
    // Whitespace alone is not a document: it reads as empty.
    const text = raw.trim() ? raw : '';
    await pool().query(
      `UPDATE businesses SET ${spec.textColumn} = $1, updated_at = NOW() WHERE id = $2`,
      [text, req.params.bid],
    );
    if (text) {
      // Either or: saving text replaces the uploaded file.
      await pool().query(
        'DELETE FROM business_policy_files WHERE business_id = $1 AND doc_kind = $2',
        [req.params.bid, req.params.kind],
      );
    }
    const access = await memberOr403(req);
    return res.json(await loadState(req.params.bid, access.business));
  }));

  router.delete('/businesses/:bid/policies/:kind/text', asyncHandler(async (req, res) => {
    const spec = kindOr404(req);
    await ownerOr403(req);
    await assertNotInGrace(pool(), req.params.bid);
    await pool().query(
      `UPDATE businesses SET ${spec.textColumn} = '', updated_at = NOW() WHERE id = $1`,
      [req.params.bid],
    );
    const access = await memberOr403(req);
    return res.json(await loadState(req.params.bid, access.business));
  }));

  router.post('/businesses/:bid/policies/:kind/file', asyncHandler(async (req, res) => {
    const spec = kindOr404(req);
    await ownerOr403(req);
    await assertNotInGrace(pool(), req.params.bid);
    const parsed = parsePolicyFileDataUrl(req.body?.dataUrl);
    if (!parsed) {
      throw err(400, 'policy_file_invalid', POLICY_FILE_INVALID_MESSAGE);
    }
    await pool().query(
      `INSERT INTO business_policy_files (business_id, doc_kind, content_type, filename, size_bytes, data_base64)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (business_id, doc_kind) DO UPDATE SET
         content_type = EXCLUDED.content_type,
         filename = EXCLUDED.filename,
         size_bytes = EXCLUDED.size_bytes,
         data_base64 = EXCLUDED.data_base64,
         updated_at = NOW()`,
      [
        req.params.bid,
        req.params.kind,
        parsed.mime,
        cleanPolicyFilename(req.body?.filename),
        parsed.bytes.length,
        parsed.base64,
      ],
    );
    // Either or: uploading a file replaces the typed text.
    await pool().query(
      `UPDATE businesses SET ${spec.textColumn} = '', updated_at = NOW() WHERE id = $1`,
      [req.params.bid],
    );
    const access = await memberOr403(req);
    return res.status(201).json(await loadState(req.params.bid, access.business));
  }));

  router.delete('/businesses/:bid/policies/:kind/file', asyncHandler(async (req, res) => {
    kindOr404(req);
    await ownerOr403(req);
    await assertNotInGrace(pool(), req.params.bid);
    await pool().query(
      'DELETE FROM business_policy_files WHERE business_id = $1 AND doc_kind = $2',
      [req.params.bid, req.params.kind],
    );
    const access = await memberOr403(req);
    return res.json(await loadState(req.params.bid, access.business));
  }));

  router.get('/businesses/:bid/policies/:kind/file', asyncHandler(async (req, res) => {
    kindOr404(req);
    await memberOr403(req);
    const { rows } = await pool().query(
      'SELECT content_type, filename, data_base64 FROM business_policy_files WHERE business_id = $1 AND doc_kind = $2',
      [req.params.bid, req.params.kind],
    );
    const file = rows[0];
    if (!file) throw err(404, 'policy_file_not_found', 'No file is saved for that document.');
    res.setHeader('Content-Type', file.content_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${cleanPolicyFilename(file.filename) || 'document'}"`,
    );
    return res.send(Buffer.from(file.data_base64, 'base64'));
  }));

  return router;
}
