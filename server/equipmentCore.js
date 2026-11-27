/**
 * Equipment records — the engine core (Nov 26, 2026; plan
 * release 372, Gap 7; the owner's Q3 ruling, Nov 25, 2026:
 * a GENERAL feature for every business that has machines,
 * on BOTH plans — "do the same thing for every business").
 *
 * A page per machine (bought when, warranty end, who
 * services it, the identifying details the owner wants
 * kept), upkeep schedules with due reminders (owner-named
 * tasks on owner-set cycles), and a breakdown flow: staff
 * report against the machine with a photo; repair, cost
 * and outcome join the machine's history.
 *
 * Doctrines:
 *  - Machine pages, upkeep schedules and repairs are
 *    owner/manager territory. Reporting a breakdown is a
 *    DOOR: it rides the owner-grant tick `equipment.report`,
 *    off by default; the owner and managers always hold
 *    the door.
 *  - MONEY is owner/manager territory (her owner-only
 *    money doctrine, manager tier included): a machine's
 *    purchase price and every repair cost are stripped
 *    server-side from anything a non-money member reads —
 *    never merely hidden by the page.
 *  - Every report and repair records WHO (the server-
 *    stamped display name — never an email, never
 *    anonymous) and WHEN.
 *  - Per-business private: every read and write is scoped
 *    to one business; a machine of another business is
 *    simply not found.
 */
import crypto from 'node:crypto';

export const EQUIPMENT_REPORT_TICK = 'equipment.report';
export const MAX_PHOTO_CHARS = 400000;
export const DUE_SOON_DAYS = 7;

export const MANAGE_MESSAGE = 'Only the owner or a manager can change equipment records.';
export const REPORT_MESSAGE = 'Only the owner, a manager, or a person the owner gave the breakdown reporting tick, can report a breakdown.';
export const NAME_MESSAGE = 'Give the machine a name.';
export const REPAIR_MESSAGE = 'Only the owner or a manager can record a repair and its cost.';
export const UPKEEP_NAME_MESSAGE = 'Give the upkeep task a name.';
export const BREAKDOWN_WHAT_MESSAGE = 'Say what broke.';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/** A manager-level member (the checklists core's own test):
 *  preset-manager role, or a role named "manager". */
export function isManagerAccess(access) {
  if (!access) return false;
  if (access.isOwner) return true;
  const row = access.staffRow;
  if (!row) return false;
  return row.role_id === 'preset-manager' || String(row.role_name || '').trim().toLowerCase() === 'manager';
}

/** Owner/manager territory: machine writes, upkeep writes,
 *  repairs — and every money figure. */
export function canManageEquipment(access) {
  return Boolean(access?.isOwner) || isManagerAccess(access);
}
export const canSeeMoney = canManageEquipment;

/** The breakdown door: the owner, a manager, or a member
 *  holding the owner-grant tick `equipment.report`. */
export function canReportBreakdown(access) {
  if (!access) return false;
  if (canManageEquipment(access)) return true;
  return Array.isArray(access.permissions) && access.permissions.includes(EQUIPMENT_REPORT_TICK);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanDate(value) {
  const raw = String(value || '').trim();
  if (!DATE_RE.test(raw)) return null;
  const parsed = new Date(`${raw}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

export function todayDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function cleanText(value, max = 300) {
  return String(value || '').trim().slice(0, max);
}

function cleanMoney(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** A machine write, cleaned and validated. */
export function cleanMachine(input) {
  const name = cleanText(input?.name, 200);
  if (!name) throw err(400, 'equipment_name', NAME_MESSAGE);
  return {
    name,
    kind: cleanText(input?.kind, 200),
    make_model: cleanText(input?.make_model, 300),
    serial_number: cleanText(input?.serial_number, 200),
    location_name: cleanText(input?.location_name, 200),
    purchased_date: cleanDate(input?.purchased_date),
    purchase_price: cleanMoney(input?.purchase_price),
    warranty_end: cleanDate(input?.warranty_end),
    service_name: cleanText(input?.service_name, 200),
    service_phone: cleanText(input?.service_phone, 100),
    notes: cleanText(input?.notes, 2000),
  };
}

/** An upkeep task write, cleaned: owner-named task on an
 *  owner-set cycle (1..3650 days). The next due date is the
 *  last-done date plus the cycle; a task never done is due
 *  on its start (the date it is created, sent by the route
 *  as `today`, or an owner-sent first due date). */
export function cleanUpkeep(input, today = todayDate()) {
  const title = cleanText(input?.title, 200);
  if (!title) throw err(400, 'equipment_upkeep_name', UPKEEP_NAME_MESSAGE);
  const cycleRaw = Number(input?.cycle_days);
  const cycle_days = Number.isInteger(cycleRaw) && cycleRaw >= 1 && cycleRaw <= 3650 ? cycleRaw : 30;
  const last_done_date = cleanDate(input?.last_done_date);
  const explicitDue = cleanDate(input?.next_due_date);
  const next_due_date = explicitDue || (last_done_date ? addDays(last_done_date, cycle_days) : today);
  return { title, cycle_days, last_done_date, next_due_date, notes: cleanText(input?.notes, 1000) };
}

/** Where an upkeep task stands against a date: overdue
 *  (past its due date), due-soon (due within DUE_SOON_DAYS,
 *  today included), or ok. Pure — the page, the due list
 *  and the tests all read this one rule. */
export function upkeepDueState(upkeep, today = todayDate()) {
  const due = upkeep?.next_due_date;
  if (!due) return 'ok';
  if (due < today) return 'overdue';
  if (due <= addDays(today, DUE_SOON_DAYS)) return 'due-soon';
  return 'ok';
}

/** Marking an upkeep task done: last done becomes the done
 *  date and the next due rolls one full cycle past it. */
export function completeUpkeepDates(upkeep, doneDate) {
  const cycle = Number.isInteger(upkeep?.cycle_days) && upkeep.cycle_days >= 1 ? upkeep.cycle_days : 30;
  return { last_done_date: doneDate, next_due_date: addDays(doneDate, cycle) };
}

/** A breakdown report, cleaned: what broke is required;
 *  the photo is optional and, when present, must be a real
 *  attached image carried as a data URL (the checklist
 *  proof rule). */
export function cleanBreakdown(input) {
  const description = cleanText(input?.description, 2000);
  if (!description) throw err(400, 'equipment_breakdown_what', BREAKDOWN_WHAT_MESSAGE);
  let photo = null;
  const rawPhoto = String(input?.photo || '').trim();
  if (rawPhoto) {
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(rawPhoto) || rawPhoto.length > MAX_PHOTO_CHARS) {
      throw err(400, 'equipment_breakdown_what', BREAKDOWN_WHAT_MESSAGE);
    }
    photo = rawPhoto;
  }
  return { description, photo };
}

/** A repair record, cleaned: what was done is required;
 *  cost is money (null when none is recorded — never an
 *  invented figure); outcome is the owner's words. */
export function cleanRepair(input) {
  const description = cleanText(input?.description, 2000);
  if (!description) throw err(400, 'equipment_breakdown_what', BREAKDOWN_WHAT_MESSAGE);
  return {
    description,
    cost: cleanMoney(input?.cost),
    outcome: cleanText(input?.outcome, 1000),
    breakdown_id: cleanText(input?.breakdown_id, 80) || null,
  };
}

/** Shape a machine row for a reader: money stripped unless
 *  the reader is owner/manager territory. */
export function shapeMachine(row, { money = false } = {}) {
  if (!row) return null;
  const out = { ...row };
  if (!money) out.purchase_price = null;
  out.money_visible = money;
  return out;
}

/** Shape a history event for a reader: a repair's cost is
 *  money and is stripped the same way. */
export function shapeEvent(row, { money = false } = {}) {
  if (!row) return null;
  const out = { ...row };
  if (!money) out.cost = null;
  return out;
}

/** The due list across machines: every upkeep task that is
 *  overdue or due soon, worst first, each carrying its
 *  machine's name. Pure over shaped rows. */
export function summarizeDue(machines = [], upkeep = [], today = todayDate()) {
  const byId = new Map((machines || []).map((m) => [m.id, m]));
  return (upkeep || [])
    .map((task) => ({ ...task, machine_name: byId.get(task.machine_id)?.name || '', due_state: upkeepDueState(task, today) }))
    .filter((task) => task.due_state !== 'ok')
    .sort((a, b) => String(a.next_due_date).localeCompare(String(b.next_due_date)));
}

/* --------------------------------------------------- DB doors */

export async function listMachines(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM equipment_machines WHERE business_id = $1 ORDER BY created_at ASC',
    [businessId],
  );
  return rows;
}

export async function getMachine(pool, businessId, machineId) {
  const row = (await pool.query(
    'SELECT * FROM equipment_machines WHERE id = $1 AND business_id = $2 LIMIT 1',
    [machineId, businessId],
  )).rows[0];
  if (!row) throw err(404, 'not_found', 'Not found.');
  return row;
}

export async function createMachine(pool, businessId, input, { userId = null } = {}) {
  const clean = cleanMachine(input);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO equipment_machines (id, business_id, name, kind, make_model, serial_number, location_name, purchased_date, purchase_price, warranty_end, service_name, service_phone, notes, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [id, businessId, clean.name, clean.kind, clean.make_model, clean.serial_number, clean.location_name, clean.purchased_date, clean.purchase_price, clean.warranty_end, clean.service_name, clean.service_phone, clean.notes, userId],
  );
  return rows[0];
}

export async function updateMachine(pool, businessId, machineId, input) {
  const existing = await getMachine(pool, businessId, machineId);
  const clean = cleanMachine({ ...existing, ...input });
  const { rows } = await pool.query(
    `UPDATE equipment_machines SET name=$1, kind=$2, make_model=$3, serial_number=$4, location_name=$5, purchased_date=$6, purchase_price=$7, warranty_end=$8, service_name=$9, service_phone=$10, notes=$11, updated_at=NOW()
     WHERE id=$12 AND business_id=$13 RETURNING *`,
    [clean.name, clean.kind, clean.make_model, clean.serial_number, clean.location_name, clean.purchased_date, clean.purchase_price, clean.warranty_end, clean.service_name, clean.service_phone, clean.notes, machineId, businessId],
  );
  return rows[0];
}

export async function deleteMachine(pool, businessId, machineId) {
  await getMachine(pool, businessId, machineId);
  await pool.query('DELETE FROM equipment_events WHERE business_id = $1 AND machine_id = $2', [businessId, machineId]);
  await pool.query('DELETE FROM equipment_upkeep WHERE business_id = $1 AND machine_id = $2', [businessId, machineId]);
  const { rowCount } = await pool.query('DELETE FROM equipment_machines WHERE id = $1 AND business_id = $2', [machineId, businessId]);
  if (!rowCount) throw err(404, 'not_found', 'Not found.');
}

export async function listUpkeep(pool, businessId, machineId = null) {
  const { rows } = machineId
    ? await pool.query('SELECT * FROM equipment_upkeep WHERE business_id = $1 AND machine_id = $2 ORDER BY next_due_date ASC', [businessId, machineId])
    : await pool.query('SELECT * FROM equipment_upkeep WHERE business_id = $1 ORDER BY next_due_date ASC', [businessId]);
  return rows;
}

export async function createUpkeep(pool, businessId, machineId, input, { userId = null, today = todayDate() } = {}) {
  await getMachine(pool, businessId, machineId);
  const clean = cleanUpkeep(input, today);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO equipment_upkeep (id, business_id, machine_id, title, cycle_days, last_done_date, next_due_date, notes, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, businessId, machineId, clean.title, clean.cycle_days, clean.last_done_date, clean.next_due_date, clean.notes, userId],
  );
  return rows[0];
}

export async function updateUpkeep(pool, businessId, upkeepId, input, { today = todayDate() } = {}) {
  const existing = (await pool.query(
    'SELECT * FROM equipment_upkeep WHERE id = $1 AND business_id = $2 LIMIT 1',
    [upkeepId, businessId],
  )).rows[0];
  if (!existing) throw err(404, 'not_found', 'Not found.');
  const clean = cleanUpkeep({ ...existing, ...input }, today);
  const { rows } = await pool.query(
    `UPDATE equipment_upkeep SET title=$1, cycle_days=$2, last_done_date=$3, next_due_date=$4, notes=$5, updated_at=NOW()
     WHERE id=$6 AND business_id=$7 RETURNING *`,
    [clean.title, clean.cycle_days, clean.last_done_date, clean.next_due_date, clean.notes, upkeepId, businessId],
  );
  return rows[0];
}

export async function deleteUpkeep(pool, businessId, upkeepId) {
  const { rowCount } = await pool.query('DELETE FROM equipment_upkeep WHERE id = $1 AND business_id = $2', [upkeepId, businessId]);
  if (!rowCount) throw err(404, 'not_found', 'Not found.');
}

export async function completeUpkeep(pool, businessId, upkeepId, doneDate) {
  const existing = (await pool.query(
    'SELECT * FROM equipment_upkeep WHERE id = $1 AND business_id = $2 LIMIT 1',
    [upkeepId, businessId],
  )).rows[0];
  if (!existing) throw err(404, 'not_found', 'Not found.');
  const dates = completeUpkeepDates(existing, cleanDate(doneDate) || todayDate());
  const { rows } = await pool.query(
    `UPDATE equipment_upkeep SET last_done_date=$1, next_due_date=$2, updated_at=NOW()
     WHERE id=$3 AND business_id=$4 RETURNING *`,
    [dates.last_done_date, dates.next_due_date, upkeepId, businessId],
  );
  return rows[0];
}

export async function listEvents(pool, businessId, machineId) {
  const { rows } = await pool.query(
    'SELECT * FROM equipment_events WHERE business_id = $1 AND machine_id = $2 ORDER BY created_at DESC',
    [businessId, machineId],
  );
  return rows;
}

export async function reportBreakdown(pool, businessId, machineId, input, { userId = null, actorName = '' } = {}) {
  await getMachine(pool, businessId, machineId);
  const clean = cleanBreakdown(input);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO equipment_events (id, business_id, machine_id, kind, description, photo, status, reported_by_id, reported_by_name)
     VALUES ($1,$2,$3,'breakdown',$4,$5,'open',$6,$7) RETURNING *`,
    [id, businessId, machineId, clean.description, clean.photo, userId, actorName],
  );
  return rows[0];
}

/** Record a repair: joins the machine's history with its
 *  cost and outcome, and closes the breakdown it answers
 *  (status 'fixed') when one is named. */
export async function recordRepair(pool, businessId, machineId, input, { userId = null, actorName = '' } = {}) {
  await getMachine(pool, businessId, machineId);
  const clean = cleanRepair(input);
  let breakdownId = null;
  if (clean.breakdown_id) {
    const breakdown = (await pool.query(
      "SELECT * FROM equipment_events WHERE id = $1 AND business_id = $2 AND machine_id = $3 AND kind = 'breakdown' LIMIT 1",
      [clean.breakdown_id, businessId, machineId],
    )).rows[0];
    if (breakdown) breakdownId = breakdown.id;
  }
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO equipment_events (id, business_id, machine_id, kind, description, cost, outcome, status, breakdown_id, reported_by_id, reported_by_name)
     VALUES ($1,$2,$3,'repair',$4,$5,$6,'fixed',$7,$8,$9) RETURNING *`,
    [id, businessId, machineId, clean.description, clean.cost, clean.outcome, breakdownId, userId, actorName],
  );
  if (breakdownId) {
    await pool.query(
      "UPDATE equipment_events SET status = 'fixed' WHERE id = $1 AND business_id = $2",
      [breakdownId, businessId],
    );
  }
  return rows[0];
}

/** One machine's full page: the machine, its upkeep with
 *  due states, and its history — money shaped for the
 *  reader. Plus the business-wide due list. */
export async function machineView(pool, businessId, machineId, access, today = todayDate()) {
  const money = canSeeMoney(access);
  const machine = shapeMachine(await getMachine(pool, businessId, machineId), { money });
  const upkeep = (await listUpkeep(pool, businessId, machineId))
    .map((task) => ({ ...task, due_state: upkeepDueState(task, today) }));
  const events = (await listEvents(pool, businessId, machineId)).map((row) => shapeEvent(row, { money }));
  return { machine, upkeep, events, canManage: canManageEquipment(access), canReport: canReportBreakdown(access), canSeeMoney: money };
}

export async function overview(pool, businessId, access, today = todayDate()) {
  const money = canSeeMoney(access);
  const machines = (await listMachines(pool, businessId)).map((row) => shapeMachine(row, { money }));
  const upkeep = await listUpkeep(pool, businessId);
  const due = summarizeDue(machines, upkeep, today);
  const open = (await pool.query(
    "SELECT COUNT(*)::int AS n FROM equipment_events WHERE business_id = $1 AND kind = 'breakdown' AND status = 'open'",
    [businessId],
  )).rows[0]?.n || 0;
  return { machines, due, openBreakdowns: open, canManage: canManageEquipment(access), canReport: canReportBreakdown(access), canSeeMoney: money };
}
