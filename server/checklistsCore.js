/**
 * Checklists — the engine core (Nov 26, 2026; plan release
 * 369, Gap 2; the owner's Q1 ruling, Nov 24, 2026: a GENERAL
 * feature for every business on BOTH plans).
 *
 * Templates → scheduled/assigned instances → item completions
 * with proof. The shape is deliberately feature-thin so the
 * later food-safety build (plan 370's mock-inspection
 * self-check) can run its guided walk on this same engine:
 * a template is a named list of items, an instance is one
 * template materialised for one day with its items snapshot,
 * and a completion is one ticked item with who/when/proof.
 *
 * Doctrines:
 *  - Ticking off is plain staff work — NO tick (permission)
 *    is needed to do a checklist. Template management
 *    (creating/editing templates and assignments) rides the
 *    owner-grant tick `checklists.manage`, off by default;
 *    the owner always manages. The routes enforce that; this
 *    core carries the tick's name and the canManage test.
 *  - Key items can require PROOF before they can be ticked:
 *    a photo (a data-URL image the completer attached), a
 *    scan (the code they scanned or typed), or a typed
 *    temperature (a number). A completion without the proof
 *    its item requires is refused — the tick cannot land.
 *  - Every completion records WHO (the server-stamped display
 *    name — never an email, never anonymous) and WHEN.
 *  - Per-business private: every read and write is scoped to
 *    one business; an instance or template of another business
 *    is simply not found.
 */
import crypto from 'node:crypto';

export const CHECKLISTS_MANAGE_TICK = 'checklists.manage';
export const PROOF_TYPES = ['none', 'photo', 'scan', 'temperature'];
export const ASSIGN_TYPES = ['everyone', 'role', 'shift'];
export const SCHEDULES = ['daily', 'weekly', 'once'];
export const MAX_PROOF_PHOTO_CHARS = 400000;

export const MANAGE_MESSAGE = 'Only the owner, or a person the owner gave the checklist templates tick, can change checklist templates.';
export const PROOF_MESSAGE = 'This item needs its proof before it can be ticked.';
export const NAME_MESSAGE = 'Give the checklist a name.';
export const ITEMS_MESSAGE = 'Add at least one item to the checklist.';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/** Can this access manage templates? The owner, or a member
 *  holding the owner-grant tick. Doing checklists never asks
 *  this question — only template writes do. */
export function canManageChecklists(access) {
  if (!access) return false;
  if (access.isOwner) return true;
  return Array.isArray(access.permissions) && access.permissions.includes(CHECKLISTS_MANAGE_TICK);
}

/** A manager-level member (the roster/clock ticks' own test):
 *  preset-manager role, or a role named "manager". */
export function isManagerAccess(access) {
  if (!access || access.isOwner) return Boolean(access?.isOwner);
  const row = access.staffRow;
  if (!row) return false;
  return row.role_id === 'preset-manager' || String(row.role_name || '').trim().toLowerCase() === 'manager';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A run date as YYYY-MM-DD (the business's local day, sent by
 *  the client), or null when the value is not a real date. */
export function cleanRunDate(value, fallback = null) {
  const raw = String(value || '').trim();
  if (DATE_RE.test(raw)) {
    const parsed = new Date(`${raw}T12:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw) return raw;
  }
  return fallback;
}

/** Today as YYYY-MM-DD in UTC — the server's fallback when the
 *  client sent no date. */
export function todayRunDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** The weekday (0 = Sunday, JS order) of a YYYY-MM-DD date. */
export function weekdayOf(runDate) {
  return new Date(`${runDate}T12:00:00Z`).getUTCDay();
}

function cleanProof(value) {
  return PROOF_TYPES.includes(value) ? value : 'none';
}

/** One template item, cleaned: a stable id, its words, and the
 *  proof it requires before it can be ticked. */
export function cleanItem(raw, index) {
  const label = String(raw?.label || '').trim().slice(0, 300);
  if (!label) return null;
  const id = String(raw?.id || '').trim().slice(0, 80) || `item-${index + 1}`;
  return { id, label, proof: cleanProof(raw?.proof) };
}

/**
 * A template write, cleaned and validated. Throws the
 * registered wordings: a template needs a name and at least
 * one item. Assignment follows the app's own shapes: a role
 * (role id + name ride in assign_value as "id" with the label
 * kept by the client) or a shift (a free shift name) — the
 * core stores the pair (assign_type, assign_value) untouched
 * beyond trimming.
 */
export function cleanTemplate(input) {
  const name = String(input?.name || '').trim().slice(0, 200);
  if (!name) throw err(400, 'checklist_name', NAME_MESSAGE);
  const rawItems = Array.isArray(input?.items) ? input.items : [];
  const items = rawItems.map((item, i) => cleanItem(item, i)).filter(Boolean).slice(0, 100);
  if (!items.length) throw err(400, 'checklist_items', ITEMS_MESSAGE);
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) item.id = `${item.id}-${seen.size + 1}`;
    seen.add(item.id);
  }
  const assignType = ASSIGN_TYPES.includes(input?.assign_type) ? input.assign_type : 'everyone';
  const schedule = SCHEDULES.includes(input?.schedule) ? input.schedule : 'daily';
  const startDate = cleanRunDate(input?.start_date);
  const weekdayRaw = Number(input?.weekday);
  return {
    name,
    items,
    assign_type: assignType,
    assign_value: assignType === 'everyone' ? '' : String(input?.assign_value || '').trim().slice(0, 200),
    schedule,
    weekday: Number.isInteger(weekdayRaw) && weekdayRaw >= 0 && weekdayRaw <= 6 ? weekdayRaw : null,
    start_date: startDate,
    active: input?.active !== false,
  };
}

/** Does this template run on this date? Daily runs every day;
 *  weekly runs on its weekday (the weekday of its start date,
 *  or the weekday it was created with); once runs only on its
 *  start date. A template never runs before its start date
 *  when it carries one. */
export function templateRunsOn(template, runDate) {
  if (!template || template.active === false) return false;
  if (template.start_date && runDate < template.start_date) return false;
  if (template.schedule === 'weekly') {
    const weekday = Number.isInteger(template.weekday) ? template.weekday : (template.start_date ? weekdayOf(template.start_date) : null);
    return weekday !== null && weekdayOf(runDate) === weekday;
  }
  if (template.schedule === 'once') {
    return template.start_date ? runDate === template.start_date : runDate === String(template.created_at || '').slice(0, 10);
  }
  return true; // daily
}

/**
 * The proof a completion must carry, validated. Returns the
 * { proof_type, proof_value } to store, or throws the
 * registered proof wording. An item requiring no proof stores
 * none, whatever the client sent.
 */
export function cleanProofFor(item, proofValue) {
  const proof = cleanProof(item?.proof);
  if (proof === 'none') return { proof_type: 'none', proof_value: null };
  const value = proofValue === null || proofValue === undefined ? '' : String(proofValue);
  if (proof === 'temperature') {
    const n = Number(String(value).trim());
    if (String(value).trim() === '' || !Number.isFinite(n) || n < -100 || n > 300) {
      throw err(400, 'checklist_proof', PROOF_MESSAGE);
    }
    return { proof_type: 'temperature', proof_value: String(n) };
  }
  if (proof === 'scan') {
    const code = value.trim().slice(0, 200);
    if (!code) throw err(400, 'checklist_proof', PROOF_MESSAGE);
    return { proof_type: 'scan', proof_value: code };
  }
  // photo: a real attached image, carried as a data URL.
  const photo = value.trim();
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(photo) || photo.length > MAX_PROOF_PHOTO_CHARS) {
    throw err(400, 'checklist_proof', PROOF_MESSAGE);
  }
  return { proof_type: 'photo', proof_value: photo };
}

/** An instance with its completions folded in: every item
 *  carries its completion (or null), plus the done/total
 *  progress a manager reads at a glance. Pure — the shape the
 *  Today page, the Dashboard card and the Restaurant Today
 *  card all read. */
export function shapeInstance(instance, completions = []) {
  const byItem = new Map((completions || []).map((row) => [row.item_id, row]));
  const items = (instance.items || []).map((item) => {
    const completion = byItem.get(item.id) || null;
    return {
      ...item,
      completion: completion
        ? {
            by_name: completion.completed_by_name || '',
            at: completion.completed_at || null,
            proof_type: completion.proof_type || 'none',
            proof_value: completion.proof_value ?? null,
          }
        : null,
    };
  });
  const done = items.filter((item) => item.completion).length;
  return { ...instance, items, done, total: items.length, complete: items.length > 0 && done === items.length };
}

/** Progress across a day's instances: { done, total, lists }. */
export function summarizeInstances(instances = []) {
  return {
    done: instances.reduce((sum, i) => sum + (i.done || 0), 0),
    total: instances.reduce((sum, i) => sum + (i.total || 0), 0),
    lists: instances.length,
  };
}

function parseItems(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function publicTemplate(row) {
  return { ...row, items: parseItems(row.items), active: row.active !== false };
}

function publicInstance(row) {
  return { ...row, items: parseItems(row.items) };
}

/* --------------------------------------------------- DB doors */

export async function listTemplates(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM checklist_templates WHERE business_id = $1 ORDER BY created_at ASC',
    [businessId],
  );
  return rows.map(publicTemplate);
}

export async function createTemplate(pool, businessId, input, { userId = null } = {}) {
  const clean = cleanTemplate(input);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO checklist_templates (id, business_id, name, items, assign_type, assign_value, schedule, weekday, start_date, active, created_by_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [id, businessId, clean.name, JSON.stringify(clean.items), clean.assign_type, clean.assign_value, clean.schedule, clean.weekday, clean.start_date, clean.active, userId],
  );
  return publicTemplate(rows[0]);
}

export async function updateTemplate(pool, businessId, templateId, input) {
  const existing = (await pool.query(
    'SELECT * FROM checklist_templates WHERE id = $1 AND business_id = $2 LIMIT 1',
    [templateId, businessId],
  )).rows[0];
  if (!existing) throw err(404, 'not_found', 'Not found.');
  const clean = cleanTemplate({ ...publicTemplate(existing), ...input });
  const { rows } = await pool.query(
    `UPDATE checklist_templates SET name = $1, items = $2, assign_type = $3, assign_value = $4, schedule = $5, weekday = $6, start_date = $7, active = $8, updated_at = NOW()
     WHERE id = $9 AND business_id = $10 RETURNING *`,
    [clean.name, JSON.stringify(clean.items), clean.assign_type, clean.assign_value, clean.schedule, clean.weekday, clean.start_date, clean.active, templateId, businessId],
  );
  return publicTemplate(rows[0]);
}

export async function deleteTemplate(pool, businessId, templateId) {
  const { rowCount } = await pool.query(
    'DELETE FROM checklist_templates WHERE id = $1 AND business_id = $2',
    [templateId, businessId],
  );
  if (!rowCount) throw err(404, 'not_found', 'Not found.');
}

/**
 * Materialise one day's instances for a business: every active
 * template that runs on the date gets its instance, items
 * snapshot from the template as it stands now. Idempotent —
 * the (template, run_date) unique index means a day is
 * materialised exactly once, however many people open it.
 */
export async function ensureInstances(pool, businessId, runDate) {
  const templates = await listTemplates(pool, businessId);
  for (const template of templates) {
    if (!templateRunsOn(template, runDate)) continue;
    await pool.query(
      `INSERT INTO checklist_instances (id, business_id, template_id, title, items, assign_type, assign_value, run_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (template_id, run_date) DO NOTHING`,
      [crypto.randomUUID(), businessId, template.id, template.name, JSON.stringify(template.items), template.assign_type, template.assign_value, runDate],
    );
  }
  return listInstances(pool, businessId, runDate);
}

export async function listInstances(pool, businessId, runDate) {
  const { rows } = await pool.query(
    'SELECT * FROM checklist_instances WHERE business_id = $1 AND run_date = $2 ORDER BY created_at ASC',
    [businessId, runDate],
  );
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const completions = (await pool.query(
    'SELECT * FROM checklist_completions WHERE business_id = $1 AND instance_id = ANY($2)',
    [businessId, ids],
  )).rows;
  return rows.map((row) => shapeInstance(publicInstance(row), completions.filter((c) => c.instance_id === row.id)));
}

/** A day's instances plus its progress summary. */
export async function dayView(pool, businessId, runDate, { ensure = true } = {}) {
  const instances = ensure
    ? await ensureInstances(pool, businessId, runDate)
    : await listInstances(pool, businessId, runDate);
  return { date: runDate, instances, summary: summarizeInstances(instances) };
}

/** Completion history a manager checks from home: the last
 *  `days` days (today included), newest first, each day its
 *  instances with who did what and what is missing. Days are
 *  materialised on read so a day nobody opened still shows
 *  what was due — its items simply stand unticked. */
export async function historyView(pool, businessId, endDate, days = 14) {
  const out = [];
  const end = new Date(`${endDate}T12:00:00Z`);
  for (let i = 0; i < days; i += 1) {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - i);
    const runDate = day.toISOString().slice(0, 10);
    out.push(await dayView(pool, businessId, runDate));
  }
  return out;
}

/**
 * Tick one item off. Any member of the business may tick —
 * doing a checklist is plain staff work. The completion is
 * stamped with the actor's display name by the ROUTE (the
 * server's name for the caller, never a client-sent name).
 */
export async function completeItem(pool, businessId, instanceId, itemId, { userId = null, actorName = '', proofValue = null } = {}) {
  const instance = (await pool.query(
    'SELECT * FROM checklist_instances WHERE id = $1 AND business_id = $2 LIMIT 1',
    [instanceId, businessId],
  )).rows[0];
  if (!instance) throw err(404, 'not_found', 'Not found.');
  const items = parseItems(instance.items);
  const item = items.find((entry) => entry.id === itemId);
  if (!item) throw err(404, 'not_found', 'Not found.');
  const proof = cleanProofFor(item, proofValue);
  await pool.query(
    `INSERT INTO checklist_completions (id, business_id, instance_id, item_id, completed_by_id, completed_by_name, proof_type, proof_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (instance_id, item_id) DO UPDATE SET completed_by_id = EXCLUDED.completed_by_id, completed_by_name = EXCLUDED.completed_by_name, completed_at = NOW(), proof_type = EXCLUDED.proof_type, proof_value = EXCLUDED.proof_value`,
    [crypto.randomUUID(), businessId, instanceId, itemId, userId, actorName, proof.proof_type, proof.proof_value],
  );
  const views = await listInstances(pool, businessId, instance.run_date);
  return views.find((view) => view.id === instanceId) || null;
}

/** Untick one item: the person who ticked it, the owner, a
 *  manager, or a template manager may undo a tick; anyone else
 *  is refused (a completion is a record with a name on it). */
export async function uncompleteItem(pool, businessId, instanceId, itemId, access, { userId = null } = {}) {
  const completion = (await pool.query(
    'SELECT * FROM checklist_completions WHERE instance_id = $1 AND item_id = $2 AND business_id = $3 LIMIT 1',
    [instanceId, itemId, businessId],
  )).rows[0];
  if (!completion) throw err(404, 'not_found', 'Not found.');
  const allowed = access.isOwner || canManageChecklists(access) || isManagerAccess(access) || (userId && completion.completed_by_id === userId);
  if (!allowed) throw err(403, 'checklist_untick', 'Only the person who ticked this item, a manager, or the owner can untick it.');
  await pool.query(
    'DELETE FROM checklist_completions WHERE instance_id = $1 AND item_id = $2 AND business_id = $3',
    [instanceId, itemId, businessId],
  );
}
