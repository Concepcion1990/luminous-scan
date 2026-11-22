/**
 * Signup domain blocklist — operator routes (Nov 22, 2026).
 *
 *   GET    /api/operator/blocked-domains          list
 *   POST   /api/operator/blocked-domains          add a domain
 *   DELETE /api/operator/blocked-domains/:id      remove a domain
 *
 * OPERATOR ONLY, mirroring the founding-tester comp list
 * (server/compRoutes.js): the platform operator (the publisher
 * identity — see server/foundingTester.js) is the only hand
 * that can view, add, or remove entries. Every other signed-in
 * account is refused, and nothing in the customer app links
 * here: the list's existence is never advertised in the app or
 * the signup flow, and this path appears nowhere in the served
 * client bundle.
 *
 * Removing a domain is a status flip ('removed'), never a row
 * delete: the history stays auditable, and re-adding a removed
 * domain revives its row. Adding a domain never touches
 * accounts that already exist with it — the list is read only
 * at the moment a NEW account would be created (see
 * server/domainBlocklist.js).
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { isOperatorUser } from './foundingTester.js';
import { normalizeDomain, isValidDomain } from './domainBlocklist.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] blocklist route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

function publicEntry(row) {
  return {
    id: row.id,
    domain: row.domain,
    note: row.note || '',
    status: row.status,
    removed_at: row.removed_at ? new Date(row.removed_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

export function createBlocklistRouter({ getPool: getPoolFn }) {
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
  router.get('/operator/blocked-domains', auth, asyncHandler(async (req, res) => {
    const pool = await requireOperator(req);
    const { rows } = await pool.query(
      'SELECT * FROM blocked_email_domains ORDER BY created_at ASC',
    );
    const active = rows.filter((row) => row.status === 'active');
    return res.json({
      active_count: active.length,
      entries: rows.map(publicEntry),
    });
  }));

  // ---- Add --------------------------------------------------------------
  router.post('/operator/blocked-domains', auth, asyncHandler(async (req, res) => {
    const pool = await requireOperator(req);
    const domain = normalizeDomain(req.body?.domain ?? req.body?.email);
    if (!isValidDomain(domain)) {
      throw err(400, 'invalid_domain', 'Enter a valid domain, like example.com.');
    }
    const note = String(req.body?.note || '').trim().slice(0, 500);
    const { rows: existing } = await pool.query(
      `SELECT * FROM blocked_email_domains
        WHERE LOWER(domain) = $1 ORDER BY created_at ASC`,
      [domain],
    );
    const activeRow = existing.find((row) => row.status === 'active');
    if (activeRow) {
      throw err(409, 'domain_already_listed', 'That domain is already on the list.');
    }
    if (existing.length) {
      // Re-adding a removed domain revives its row.
      const revived = await pool.query(
        `UPDATE blocked_email_domains
            SET status = 'active', removed_at = NULL, note = $2, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [existing[0].id, note || existing[0].note || ''],
      );
      return res.status(201).json(publicEntry(revived.rows[0]));
    }
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO blocked_email_domains (id, domain, note, status, created_by_id, created_by)
       VALUES ($1, $2, $3, 'active', $4, $5) RETURNING *`,
      [id, domain, note, req.user.id, req.user.email || ''],
    );
    return res.status(201).json(publicEntry(rows[0]));
  }));

  // ---- Remove -------------------------------------------------------------
  router.delete('/operator/blocked-domains/:id', auth, asyncHandler(async (req, res) => {
    const pool = await requireOperator(req);
    const { rows } = await pool.query(
      `UPDATE blocked_email_domains
          SET status = 'removed', removed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'active'
        RETURNING *`,
      [req.params.id],
    );
    if (!rows.length) {
      throw err(404, 'domain_not_listed', 'That domain is not on the list.');
    }
    // The domain is off the list — signups with it are ordinary
    // signups again. Accounts that already exist were never
    // touched either way.
    return res.json(publicEntry(rows[0]));
  }));

  return router;
}
