/**
 * Training scope — "nobody trains on what they don't have"
 * (owner ruling, Nov 20, 2026).
 *
 * A person's training follows their REAL doors:
 *
 *   - CORE lessons are for everyone, always: their own Settings,
 *     reading their own store's policies (the welcome lesson
 *     carries the reading), the Overview, and the universal
 *     self-service pages (time clock, own schedule, own tasks,
 *     own inbox, messages, own pay stub, own direct deposit —
 *     and, since release 333 opened the counts page to every
 *     member, the counts lesson).
 *   - MANAGER CORE adds the manager self-service lessons (their
 *     level IS the door — schedules, time-off decisions, tasks,
 *     clock oversight, payroll preview, team training).
 *   - Everything else follows the permissions/grants the person's
 *     role actually carries (LESSON_REQUIREMENTS, any-of). The
 *     owner's per-member ticks bring their lessons because a tick
 *     IS a permission in the member's stored list (settings.gs1
 *     opens the products module, returns.complete the returns
 *     module, and so on through MODULE_BY_PERMISSION).
 *   - Some surfaces hang on no permission at all (Rewards, the
 *     till sales list, the cross-store inbox): those lessons are
 *     ungated here and follow plan visibility alone.
 *
 * Steps are scoped too (STEP_GATES): inside a lesson a person
 * sees only the steps they can perform — the GS1 step of
 * products-find-edit only with the GS1 tick, its bulk-delete
 * step only for the owner.
 *
 * The OWNER is exempt from scoping (and from quizzes): every
 * door is theirs by birth.
 */
import { TRAINING_LESSONS, lessonById, lessonVisibleOnPlan, visibleTracksForLevel } from './trainingCatalog.js';

export const CORE_LESSON_IDS = new Set([
  'welcome-basics',
  'your-language',
  'download-app',
  'spare-keys-setup',
  'lost-email-recovery',
  'report-problem',
  'your-profile-photo',
  'clock-basics',
  'staff-shift-windows',
  'schedule-yours',
  'timeoff-request',
  'tasks-yours',
  'inbox-notifications',
  'messages-private',
  'stub-yours',
  'dd-submit',
  'counts-run',
]);

export const CORE_MANAGER_LESSON_IDS = new Set([
  'manager-shift-windows',
  'mgr-schedules',
  'mgr-timeoff-decide',
  'mgr-tasks-assign',
  'mgr-clock-oversight',
  'mgr-payroll-preview',
  'mgr-stub-push',
  'mgr-cash-up',
  'mgr-team-training',
  'mgr-report-problem',
]);

/** Lesson -> any-of permissions that open its door. No entry =
 *  ungated (the surface itself hangs on no permission). */
export const LESSON_REQUIREMENTS = {
  'scanner-lookup': ['scan.use'],
  'scanner-website-qr': ['scan.use'],
  'scanner-shelf-counts': ['scan.use'],
  'scanner-receiving': ['scan.use'],
  'scanner-move-stock': ['scan.use'],
  'scanner-name-lookup': ['scan.use'],
  'scanner-damaged': ['scan.use'],
  'movements-what': ['scan.use'],
  'products-find-edit': ['products.view'],
  'mgr-pricing': ['products.edit'],
  'categories-basics': ['categories.manage'],
  'locations-basics': ['locations.manage'],
  'orders-basics': ['orders.manage'],
  'returns-basics': ['returns.manage'],
  'listings-basics': ['listings.manage'],
  'import-basics': ['exports.use'],
  'print-shelf-tag': ['print.use'],
  'print-shipping-label': ['print.use'],
  'staff-reports': ['reports.view'],
  'mgr-reports-alerts': ['reports.view'],
  'staff-builds': ['builds.manage'],
  'mgr-staff-permissions': ['staff.manage', 'staff.roster'],
  // The clock tick's lesson (Nov 21, 2026): the tick IS the
  // door — granting staff.clock assigns it, unticking mirrors
  // it out of future scope; completed history is never removed.
  'mgr-clock-callin': ['staff.clock'],
  // The documents tick's lesson (Nov 21, 2026): same law —
  // granting staff.documents assigns it, unticking mirrors it
  // out of future scope; completed history is never removed.
  'mgr-staff-documents': ['staff.documents'],
  // The restaurant ticks' lessons (Nov 23, 2026): same law —
  // granting the tick assigns the lesson, unticking mirrors
  // it out of future scope; completed history is never removed.
  'mgr-restaurant-build': ['restaurant.build'],
  'mgr-restaurant-pars': ['restaurant.pars'],
  'mgr-restaurant-money': ['restaurant.money'],
  'mgr-suppliers-orders': ['suppliers.manage'],
  'mgr-send-supplier-order': ['purchasing.manage'],
  'mgr-tax-rate': ['settings.taxRate', 'settings.manage'],
};

/** Lesson -> { stepNumber: permission | 'owner' } — a gated step
 *  shows only to a person carrying that door. */
export const STEP_GATES = {
  'products-find-edit': { 10: 'settings.gs1', 11: 'owner' },
};

export function isCoreLesson(lesson, level) {
  if (!lesson) return false;
  if (CORE_LESSON_IDS.has(lesson.id)) return true;
  if ((level === 'manager' || level === 'owner') && CORE_MANAGER_LESSON_IDS.has(lesson.id)) return true;
  return false;
}

export function lessonInScope(lesson, { level = 'staff', permissions = [], isOwner = false } = {}) {
  if (!lesson) return false;
  if (isOwner) return true;
  if (isCoreLesson(lesson, level)) return true;
  const required = LESSON_REQUIREMENTS[lesson.id];
  if (!required) return true;
  return required.some((perm) => permissions.includes(perm));
}

/** The person's door-scoped lesson ids: visible tracks, plan
 *  visibility, and the scope rule above. */
export function scopedLessonIds({ level = 'staff', permissions = [], isOwner = false, isBusiness = false } = {}) {
  const tracks = visibleTracksForLevel(level);
  return TRAINING_LESSONS
    .filter((lesson) => tracks.includes(lesson.track))
    .filter((lesson) => lessonVisibleOnPlan(lesson, isBusiness))
    .filter((lesson) => lessonInScope(lesson, { level, permissions, isOwner }))
    .map((lesson) => lesson.id);
}

/** The step numbers of a lesson this person may see (1-based). */
export function visibleStepNumbers(lesson, { permissions = [], isOwner = false } = {}) {
  const gates = STEP_GATES[lesson?.id] || {};
  const out = [];
  for (let n = 1; n <= (lesson?.steps || 0); n += 1) {
    const gate = gates[n];
    if (!gate) { out.push(n); continue; }
    if (gate === 'owner') { if (isOwner) out.push(n); continue; }
    if (isOwner || permissions.includes(gate)) out.push(n);
  }
  return out;
}

// ---- The per-lesson quiz -------------------------------------------------
//
// The quiz is DERIVED from the lesson's own steps (owner ruling,
// Nov 20, 2026: 5–8 questions scaled to lesson length; a lesson
// counts complete only when its quiz is answered correctly).
// Questions quote step texts by reference ({ lesson_id, step }) —
// the client renders the words from its own locale, so the quiz
// speaks every language the app does with no new lesson text to
// translate. The structure is deterministic per person + lesson:
// the server rebuilds it at submit time and scores against the
// rebuild, so no answer key ever travels to the client.

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, rand) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build the quiz for one person + lesson over the steps THEY can
 * see. Returns { questions: [{ type, options: [{lesson_id, step}],
 * answer_index }] } — answer_index is server-only.
 */
export function buildQuiz(lesson, visibleSteps, { personKey = '', isBusiness = false } = {}) {
  const rand = mulberry32(hashSeed(`${personKey}:${lesson.id}`));
  const own = (visibleSteps && visibleSteps.length ? visibleSteps : [1]).map((step) => ({ lesson_id: lesson.id, step }));
  const foreignPool = [];
  const sameModule = TRAINING_LESSONS.filter(
    (l) => l.id !== lesson.id && l.module === lesson.module && lessonVisibleOnPlan(l, isBusiness),
  );
  const otherModule = TRAINING_LESSONS.filter(
    (l) => l.id !== lesson.id && l.module !== lesson.module && lessonVisibleOnPlan(l, isBusiness),
  );
  for (const pool of [sameModule, otherModule]) {
    for (const l of pool) {
      for (let s = 1; s <= l.steps; s += 1) foreignPool.push({ lesson_id: l.id, step: s });
    }
  }
  const foreign = shuffled(foreignPool, rand);
  let foreignAt = 0;
  const takeForeign = (n) => {
    const out = [];
    while (out.length < n && foreignAt < foreign.length) { out.push(foreign[foreignAt]); foreignAt += 1; }
    return out;
  };
  const target = Math.min(8, Math.max(5, own.length + 1));
  const questions = [];
  const ownCycle = shuffled(own, rand);
  let ownAt = 0;
  const takeOwn = () => {
    const item = ownCycle[ownAt % ownCycle.length];
    ownAt += 1;
    return item;
  };
  const kinds = ['belongs', 'notBelongs', 'belongs', 'order', 'belongs', 'notBelongs', 'belongs', 'order'];
  for (let i = 0; i < target; i += 1) {
    let kind = kinds[i % kinds.length];
    if (kind === 'order' && own.length < 4) kind = 'belongs';
    if (kind === 'belongs') {
      const correct = takeOwn();
      const options = shuffled([correct, ...takeForeign(3)], rand);
      questions.push({ type: 'belongs', options, answer_index: options.indexOf(correct) });
    } else if (kind === 'notBelongs') {
      const picks = [takeOwn(), takeOwn(), takeOwn()];
      const odd = takeForeign(1)[0];
      if (!odd) continue;
      const options = shuffled([...picks, odd], rand);
      questions.push({ type: 'notBelongs', options, answer_index: options.indexOf(odd) });
    } else {
      const picks = shuffled(own, rand).slice(0, 4);
      const first = picks.reduce((a, b) => (a.step < b.step ? a : b));
      const options = shuffled(picks, rand);
      questions.push({ type: 'order', options, answer_index: options.indexOf(first) });
    }
  }
  return { questions };
}

/** The public shape: everything except the answer key. */
export function publicQuiz(quiz) {
  return {
    questions: quiz.questions.map((q) => ({ type: q.type, options: q.options })),
  };
}

export { lessonById };
