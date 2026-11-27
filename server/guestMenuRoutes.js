/**
 * Guest menu — HTTP surface (plan release 371, Nov 26, 2026).
 *
 *   GET /api/businesses/:bid/guest-menu   any member: the owner's publication state
 *   PUT /api/businesses/:bid/guest-menu   owner or restaurant.build tick: save the choice
 *   GET /api/public/menu/:slug            NO session: the guest menu, shaped guest-safe
 *
 * Doctrines:
 *  - BUSINESS-ONLY: the authenticated doors sit behind the
 *    restaurant corner's plan gate, word for word.
 *  - THE GUEST DOOR SHOWS ONLY WHAT THE OWNER PUBLISHED: the
 *    public read finds the publication by its unguessable
 *    slug, refuses when it is not enabled, and shapes its
 *    answer from the published recipe ids alone (server/
 *    guestMenuCore.js) — no cost, stock or staff fact can
 *    ride it, and a guest needs no account. The business's
 *    plan is re-checked at read time, so a business that
 *    leaves the Business plan stops publishing.
 *  - ORDERING IS NOT HERE: this page is the foundation plan
 *    399's ordering will stand on (same items, same shaping);
 *    no basket, no payment, no order route exists in 371.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { featureAllowed, planFor } from './plans.js';
import { buildGuestMenu, cleanPublishedIds, newMenuSlug, shapePublication } from './guestMenuCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
function handleError(res, error) {
  if (error?.status) return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  console.error('[twin] guest-menu route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

const parseLines = (row) => {
  if (Array.isArray(row?.lines)) return row;
  try { return { ...row, lines: JSON.parse(row?.lines || '[]') }; } catch { return { ...row, lines: [] }; }
};

export function createGuestMenuRouter({ getPool: getPoolFn }) {
  const router = Router();
  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };

  // The guest door — registered BEFORE the auth wall.
  router.get('/public/menu/:slug', asyncHandler(async (req, res) => {
    const { rows } = await pool().query('SELECT * FROM menu_publications WHERE slug = $1 LIMIT 1', [req.params.slug]);
    const publication = rows[0];
    if (!publication || publication.enabled !== true) {
      return res.status(404).json({ error: 'menu_not_found', message: 'This menu is not available.' });
    }
    const planKey = await planFor(pool(), publication.business_id);
    if (!featureAllowed(planKey, 'restaurant')) {
      return res.status(404).json({ error: 'menu_not_found', message: 'This menu is not available.' });
    }
    const [biz, recipeRows, productRows] = await Promise.all([
      pool().query('SELECT name, currency, doc_style, brand_color, logo_url FROM businesses WHERE id = $1 LIMIT 1', [publication.business_id]),
      pool().query('SELECT * FROM recipes WHERE business_id = $1', [publication.business_id]),
      pool().query('SELECT id, name, price, allergens FROM products WHERE business_id = $1', [publication.business_id]),
    ]);
    const business = biz.rows[0];
    if (!business) return res.status(404).json({ error: 'menu_not_found', message: 'This menu is not available.' });
    const menu = buildGuestMenu({
      business,
      publication: { recipe_ids: publication.recipe_ids },
      recipes: recipeRows.rows.map(parseLines),
      products: productRows.rows,
    });
    return res.json({ ...menu, docStyle: business.doc_style ?? null, brandColor: business.brand_color ?? null, logoUrl: business.logo_url ?? '' });
  }));

  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (!featureAllowed(access.planKey, 'restaurant')) {
      throw err(403, 'plan_gated', 'The restaurant corner is part of the Business plan.');
    }
    return access;
  }

  router.get('/businesses/:bid/guest-menu', asyncHandler(async (req, res) => {
    await ctx(req);
    const { rows } = await pool().query('SELECT * FROM menu_publications WHERE business_id = $1 LIMIT 1', [req.params.bid]);
    return res.json(shapePublication(rows[0]));
  }));

  router.put('/businesses/:bid/guest-menu', asyncHandler(async (req, res) => {
    const access = await ctx(req);
    if (!access.isOwner && !access.can('restaurant.build')) {
      throw err(403, 'forbidden', 'You do not have access to this workspace.');
    }
    const recipeIds = cleanPublishedIds(req.body?.recipeIds);
    // Only this business's own recipes can be published.
    const { rows: own } = await pool().query('SELECT id FROM recipes WHERE business_id = $1', [req.params.bid]);
    const ownIds = new Set(own.map((r) => r.id));
    const kept = recipeIds.filter((id) => ownIds.has(id));
    const enabled = kept.length > 0;
    const { rows: existing } = await pool().query('SELECT * FROM menu_publications WHERE business_id = $1 LIMIT 1', [req.params.bid]);
    let row = existing[0];
    if (row) {
      const { rows } = await pool().query(
        'UPDATE menu_publications SET recipe_ids = $2, enabled = $3, updated_at = NOW() WHERE business_id = $1 RETURNING *',
        [req.params.bid, JSON.stringify(kept), enabled],
      );
      row = rows[0];
    } else {
      const { rows } = await pool().query(
        'INSERT INTO menu_publications (id, business_id, slug, enabled, recipe_ids) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [crypto.randomUUID(), req.params.bid, newMenuSlug(), enabled, JSON.stringify(kept)],
      );
      row = rows[0];
    }
    return res.json(shapePublication(row));
  }));

  return router;
}
