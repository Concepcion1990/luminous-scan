/**
 * Founding-tester comp — operator routes (Nov 21, 2026).
 *
 *   GET    /api/operator/founding-testers          list + cap
 *   POST   /api/operator/founding-testers          add an email
 *   DELETE /api/operator/founding-testers/:id      end an entry
 *   PUT    /api/operator/founding-testers/config   set the cap
 *
 * OPERATOR ONLY. The platform operator (the publisher identity —
 * see server/foundingTester.js) is the only hand that can view,
 * add, or end entries. Every other signed-in account — business
 * owners, managers, staff, anyone — is refused, and nothing in
 * the customer app links here: the list's existence is never
 * advertised in the app or the signup flow.
 *
 * Ending an entry never revokes a workspace that was already
 * granted (the comp ends only on full account deletion); it
 * frees the entry's cap slot and stops FUTURE signups with
 * that email from being comped.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import {
  isOperatorUser,
  normalizeCompEmail,
  compCap,
} from './foundingTester.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] comp route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

function publicEntry(row) {
  return {
    id: row.id,
    email: row.email,
    note: row.note || '',
    status: row.status,
    claimed_at: row.claimed_at ? new Date(row.claimed_at).toISOString() : null,
    ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

export function createCompRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);

  async function requireOperator(req) {
    const pool = getPoolFn();
    if (!(await isOperatorUser(pool, req.user))) {
      throw err(403, 'forbidden', 'You do not have permission to do that here.');
    }
    return pool;
  }

  // ---- List -------------------------------------------------------------
  router.get('/operator/founding-testers', auth, asyncHandler(async (req, res) => {
    const pool = await requireOperator(req);
    const { rows } = await pool.query(
      'SELECT * FROM founding_tester_comp ORDER BY created_at ASC',
    );
    const cap = await compCap(pool);
    const active = rows.filter((row) => row.status === 'active');
    return res.json({
      cap,
      active_count: active.length,
      entries: rows.map(publicEntry),
    });
  }));

  // ---- Add --------------------------------------------------------------
  router.post('/operator/founding-testers', auth, asyncHandler(async (req, res) => {
    const pool = await requireOperator(req);
    const email = normalizeCompEmail(req.body?.email);
    if (!email || !EMAIL_RE.test(email)) {
      throw err(400, 'invalid_email', 'Enter a valid email address.');
    }
    const note = String(req.body?.note || '').trim().slice(0, 500);
    const { rows: existing } = await pool.query(
      `SELECT id FROM founding_tester_comp
        WHERE LOWER(email) = $1 AND status = 'active' LIMIT 1`,
      [email],
    );
    if (existing.length) {
      throw err(409, 'comp_already_listed', 'That email is already on the founding tester list.');
    }
    const cap = await compCap(pool);
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS count FROM founding_tester_comp WHERE status = 'active'`,
    );
    if (Number(countRows[0]?.count ?? 0) >= cap) {
      throw err(409, 'comp_list_full', 'The founding tester list is full.');
    }
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO founding_tester_comp (id, email, note, status, created_by_id, created_by)
       VALUES ($1, $2, $3, 'active', $4, $5) RETURNING *`,
      [id, email, note, req.user.id, req.user.email || ''],
    );
    return res.status(201).json(publicEntry(rows[0]));
  }));

  // ---- End (remove) -------------------------------------------------------
  router.delete('/operator/founding-testers/:id', auth, asyncHandler(async (req, res) => {
    const pool = await requireOperator(req);
    const { rows } = await pool.query(
      `UPDATE founding_tester_comp
          SET status = 'ended', ended_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'active'
        RETURNING *`,
      [req.params.id],
    );
    if (!rows.length) {
      throw err(404, 'comp_not_listed', 'That email is not on the founding tester list.');
    }
    // The entry is ended — future signups with this email are
    // ordinary signups again. A workspace already granted keeps
    // its comp: the promise ends only on account deletion.
    return res.json(publicEntry(rows[0]));
  }));

  // ---- Cap ----------------------------------------------------------------
  router.put('/operator/founding-testers/config', auth, asyncHandler(async (req, res) => {
    const pool = await requireOperator(req);
    const cap = Number(req.body?.cap);
    if (!Number.isInteger(cap) || cap < 1) {
      throw err(400, 'invalid_value', 'The cap must be a whole number of 1 or more.');
    }
    await pool.query(
      `INSERT INTO founding_tester_comp_config (id, cap) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET cap = EXCLUDED.cap`,
      [cap],
    );
    return res.json({ cap });
  }));

  return router;
}
