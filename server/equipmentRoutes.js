/**
 * Equipment records — HTTP surface (Nov 26, 2026; plan
 * release 372).
 *
 *   GET    /api/businesses/:bid/equipment                          any member: machines (money-shaped), the due list, open count
 *   POST   /api/businesses/:bid/equipment/machines                 owner/manager: add a machine
 *   PATCH  /api/businesses/:bid/equipment/machines/:mid            owner/manager: edit a machine
 *   DELETE /api/businesses/:bid/equipment/machines/:mid            owner/manager: delete a machine + its history
 *   GET    /api/businesses/:bid/equipment/machines/:mid            any member: the machine's page (money-shaped)
 *   POST   /api/businesses/:bid/equipment/machines/:mid/upkeep     owner/manager: add an upkeep task
 *   PATCH  /api/businesses/:bid/equipment/upkeep/:uid              owner/manager: edit an upkeep task
 *   DELETE /api/businesses/:bid/equipment/upkeep/:uid              owner/manager: remove an upkeep task
 *   POST   /api/businesses/:bid/equipment/upkeep/:uid/complete     owner/manager: mark upkeep done (next due rolls)
 *   POST   /api/businesses/:bid/equipment/machines/:mid/breakdowns the breakdown door (owner/manager/equipment.report tick): report, with a photo
 *   POST   /api/businesses/:bid/equipment/machines/:mid/repairs    owner/manager: record a repair, its cost and outcome
 *
 * A GENERAL feature on BOTH plans (the owner's Q3 ruling) —
 * no plan gate anywhere in this surface. Money figures are
 * stripped server-side for anyone outside owner/manager
 * territory. Reports and repairs are stamped server-side
 * with the caller's display name.
 */
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { ownerPublicName } from './profilePhotos.js';
import {
  MANAGE_MESSAGE,
  REPAIR_MESSAGE,
  REPORT_MESSAGE,
  canManageEquipment,
  canReportBreakdown,
  completeUpkeep,
  createMachine,
  createUpkeep,
  deleteMachine,
  deleteUpkeep,
  machineView,
  overview,
  recordRepair,
  reportBreakdown,
  todayDate,
  updateMachine,
  updateUpkeep,
} from './equipmentCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] equipment route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

export function createEquipmentRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/equipment';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    return access;
  }

  async function manageCtx(req) {
    const access = await ctx(req);
    if (!canManageEquipment(access)) throw err(403, 'equipment_manage', MANAGE_MESSAGE);
    return access;
  }

  async function actorName(access) {
    if (access.isOwner) return ownerPublicName(pool(), access.business);
    return access.staffRow?.full_name || '';
  }

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    res.json(await overview(pool(), access.business.id, access, todayDate()));
  }));

  router.post(`${base}/machines`, asyncHandler(async (req, res) => {
    const access = await manageCtx(req);
    const machine = await createMachine(pool(), access.business.id, req.body || {}, { userId: req.user.id });
    res.status(201).json({ machine });
  }));

  router.get(`${base}/machines/:mid`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    res.json(await machineView(pool(), access.business.id, req.params.mid, access, todayDate()));
  }));

  router.patch(`${base}/machines/:mid`, asyncHandler(async (req, res) => {
    const access = await manageCtx(req);
    const machine = await updateMachine(pool(), access.business.id, req.params.mid, req.body || {});
    res.json({ machine });
  }));

  router.delete(`${base}/machines/:mid`, asyncHandler(async (req, res) => {
    const access = await manageCtx(req);
    await deleteMachine(pool(), access.business.id, req.params.mid);
    res.json({ deleted: true });
  }));

  router.post(`${base}/machines/:mid/upkeep`, asyncHandler(async (req, res) => {
    const access = await manageCtx(req);
    const task = await createUpkeep(pool(), access.business.id, req.params.mid, req.body || {}, { userId: req.user.id, today: todayDate() });
    res.status(201).json({ upkeep: task });
  }));

  router.patch(`${base}/upkeep/:uid`, asyncHandler(async (req, res) => {
    const access = await manageCtx(req);
    const task = await updateUpkeep(pool(), access.business.id, req.params.uid, req.body || {}, { today: todayDate() });
    res.json({ upkeep: task });
  }));

  router.delete(`${base}/upkeep/:uid`, asyncHandler(async (req, res) => {
    const access = await manageCtx(req);
    await deleteUpkeep(pool(), access.business.id, req.params.uid);
    res.json({ deleted: true });
  }));

  router.post(`${base}/upkeep/:uid/complete`, asyncHandler(async (req, res) => {
    const access = await manageCtx(req);
    const task = await completeUpkeep(pool(), access.business.id, req.params.uid, req.body?.done_date);
    res.json({ upkeep: task });
  }));

  router.post(`${base}/machines/:mid/breakdowns`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    if (!canReportBreakdown(access)) throw err(403, 'equipment_report', REPORT_MESSAGE);
    const event = await reportBreakdown(pool(), access.business.id, req.params.mid, req.body || {}, {
      userId: req.user.id,
      actorName: await actorName(access),
    });
    res.status(201).json({ event });
  }));

  router.post(`${base}/machines/:mid/repairs`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    if (!canManageEquipment(access)) throw err(403, 'equipment_repair', REPAIR_MESSAGE);
    const event = await recordRepair(pool(), access.business.id, req.params.mid, req.body || {}, {
      userId: req.user.id,
      actorName: await actorName(access),
    });
    res.status(201).json({ event });
  }));

  return router;
}
