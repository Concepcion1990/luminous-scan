/**
 * Checklists — HTTP surface (Nov 26, 2026; plan release 369).
 *
 *   GET    /api/businesses/:bid/checklists/today?date=YYYY-MM-DD   any member: the day's instances, materialised
 *   GET    /api/businesses/:bid/checklists/history?date=&days=     any member: recent days, who did what, what's missing
 *   GET    /api/businesses/:bid/checklists/templates               any member: the templates + whether the caller manages them
 *   POST   /api/businesses/:bid/checklists/templates               owner / checklists.manage tick: create a template
 *   PATCH  /api/businesses/:bid/checklists/templates/:tid          owner / tick: edit a template or its assignment
 *   DELETE /api/businesses/:bid/checklists/templates/:tid          owner / tick: delete a template
 *   POST   /api/businesses/:bid/checklists/instances/:iid/items/:itemId/complete    any member: tick off (proof enforced)
 *   POST   /api/businesses/:bid/checklists/instances/:iid/items/:itemId/uncomplete  the ticker, a manager, or the owner: untick
 *
 * A GENERAL feature on BOTH plans (the owner's Q1 ruling) —
 * no plan gate anywhere in this surface. Doing a checklist is
 * plain staff work and needs no tick; template management
 * rides the owner-grant tick `checklists.manage`, off by
 * default. Completions are stamped server-side with the
 * caller's display name (the CountSession / log-book rule:
 * a name, never an email, never anonymous).
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { ownerPublicName } from './profilePhotos.js';
import {
  MANAGE_MESSAGE,
  canManageChecklists,
  cleanRunDate,
  completeItem,
  createTemplate,
  dayView,
  deleteTemplate,
  historyView,
  listTemplates,
  todayRunDate,
  uncompleteItem,
  updateTemplate,
} from './checklistsCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] checklists route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createChecklistsRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/checklists';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    return access;
  }

  async function manageCtx(req) {
    const access = await ctx(req);
    if (!canManageChecklists(access)) throw err(403, 'checklists_manage', MANAGE_MESSAGE);
    return access;
  }

  async function actorName(access) {
    if (access.isOwner) return ownerPublicName(pool(), access.business);
    return access.staffRow?.full_name || '';
  }

  router.get(`${base}/today`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const date = cleanRunDate(req.query.date, todayRunDate());
    const view = await dayView(pool(), access.business.id, date);
    res.json({ ...view, canManage: canManageChecklists(access) });
  }));

  router.get(`${base}/history`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const date = cleanRunDate(req.query.date, todayRunDate());
    const daysRaw = Number(req.query.days);
    const days = Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= 31 ? daysRaw : 14;
    const history = await historyView(pool(), access.business.id, date, days);
    res.json({ history, canManage: canManageChecklists(access) });
  }));

  router.get(`${base}/templates`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    res.json({ templates: await listTemplates(pool(), access.business.id), canManage: canManageChecklists(access) });
  }));

  router.post(`${base}/templates`, asyncHandler(async (req, res) => {
    const access = await manageCtx(req);
    const template = await createTemplate(pool(), access.business.id, req.body || {}, { userId: req.user.id });
    res.status(201).json({ template });
  }));

  router.patch(`${base}/templates/:tid`, asyncHandler(async (req, res) => {
    const access = await manageCtx(req);
    const template = await updateTemplate(pool(), access.business.id, req.params.tid, req.body || {});
    res.json({ template });
  }));

  router.delete(`${base}/templates/:tid`, asyncHandler(async (req, res) => {
    const access = await manageCtx(req);
    await deleteTemplate(pool(), access.business.id, req.params.tid);
    res.json({ deleted: true });
  }));

  router.post(`${base}/instances/:iid/items/:itemId/complete`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const instance = await completeItem(pool(), access.business.id, req.params.iid, req.params.itemId, {
      userId: req.user.id,
      actorName: await actorName(access),
      proofValue: req.body?.proof_value ?? null,
    });
    res.json({ instance });
  }));

  router.post(`${base}/instances/:iid/items/:itemId/uncomplete`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    await uncompleteItem(pool(), access.business.id, req.params.iid, req.params.itemId, access, { userId: req.user.id });
    res.json({ unticked: true });
  }));

  return router;
}
