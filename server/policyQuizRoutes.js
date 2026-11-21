/**
 * The owner's quiz — questions on the owner's own Store Policies
 * and Terms & Conditions (owner ruling, Nov 20, 2026).
 *
 * In Settings, beside each release-321 document, the owner keeps
 * a "Questions for your team" area — hers alone to write, with NO
 * limit on how many questions. Two kinds:
 *
 *   - multiple choice: the question, the choices beside A/B/C/D,
 *     and the correct one marked;
 *   - open: the question, and the expected answer she supplies.
 *
 * The policies training and the terms training are TWO SEPARATE
 * trainings, one per document, assigned per person by two owner
 * ticks (training.policiesQuiz / training.termsQuiz in the staff
 * grant family — off by default, in no preset). READING the
 * documents stays core for everyone; the ticks govern only these
 * quiz trainings. No questions written = no quiz: the training
 * is the reading itself.
 *
 * Taking it: a wrong multiple-choice pick is flagged on the spot
 * and retried (POST /training/:kind/check). A typed answer that
 * matches the expected answer nearly word for word counts as
 * CORRECT on the spot; a non-matching typed answer does NOT trap
 * the person — the training may still close as complete, the
 * answer files to the owner flagged for review, and the owner
 * can accept it or SEND THE TRAINING BACK. The owner sets the
 * passing line per document; the score counts multiple-choice
 * answers only; under the line = NOT DONE, retake.
 *
 * Every attempt — chosen + typed answers, score, review state —
 * files into policy_quiz_attempts, read back through the person's
 * staff record (the Training page's Team section), where the
 * owner AND a manager can read it. Review actions are the
 * owner's alone.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';
import { maybeRingAllTrainingDone, ringBell, userForStaffRow } from './trainingCore.js';
import { ownerPublicName } from './profilePhotos.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] policy quiz route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

const DOC_KINDS = ['policies', 'terms'];
const TICK_BY_KIND = { policies: 'training.policiesQuiz', terms: 'training.termsQuiz' };
const DOC_LABEL = { policies: 'Store Policies', terms: 'Terms & Conditions' };

function kindOr400(raw) {
  const kind = String(raw || '');
  if (!DOC_KINDS.includes(kind)) throw err(400, 'invalid_value', 'That document does not exist.');
  return kind;
}

// ---- Typed-answer matching -------------------------------------------------

export function normalizeAnswer(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** "Nearly word for word": exact after plain normalization, one
 *  containing the other, or a very high overlap. */
export function answerMatches(given, expected) {
  const g = normalizeAnswer(given);
  const e = normalizeAnswer(expected);
  if (!g || !e) return false;
  if (g === e) return true;
  if (g.includes(e) || e.includes(g)) return true;
  const gWords = new Set(g.split(' '));
  const eWords = new Set(e.split(' '));
  const shared = [...gWords].filter((w) => eWords.has(w)).length;
  const union = new Set([...gWords, ...eWords]).size;
  if (union && shared / union >= 0.8) return true;
  const longest = Math.max(g.length, e.length);
  return longest > 0 && 1 - levenshtein(g, e) / longest >= 0.85;
}

// ---- Shapes ------------------------------------------------------------------

function publicQuestion(row, { owner = false } = {}) {
  const base = {
    id: row.id,
    doc_kind: row.doc_kind,
    kind: row.kind,
    question: row.question,
    position: row.position,
  };
  if (row.kind === 'mc') {
    base.choices = Array.isArray(row.choices) ? row.choices : [];
    if (owner) base.correct_index = row.correct_index;
  }
  if (row.kind === 'open' && owner) base.expected_answer = row.expected_answer;
  return base;
}

async function questionsFor(pool, businessId, docKind) {
  const { rows } = await pool.query(
    `SELECT * FROM policy_questions WHERE business_id = $1 AND doc_kind = $2
      ORDER BY position ASC, created_at ASC`,
    [businessId, docKind],
  );
  return rows;
}

async function passPercentFor(pool, businessId, docKind) {
  const { rows } = await pool.query(
    'SELECT pass_percent FROM policy_quiz_settings WHERE business_id = $1 AND doc_kind = $2',
    [businessId, docKind],
  );
  return rows[0]?.pass_percent ?? 80;
}

async function latestAttempt(pool, businessId, personKey, docKind) {
  const { rows } = await pool.query(
    `SELECT * FROM policy_quiz_attempts WHERE business_id = $1 AND person_key = $2 AND doc_kind = $3
      ORDER BY created_at DESC LIMIT 1`,
    [businessId, personKey, docKind],
  );
  return rows[0] ?? null;
}

function publicAttempt(row) {
  if (!row) return null;
  return {
    id: row.id,
    doc_kind: row.doc_kind,
    status: row.status,
    score_percent: row.score_percent,
    mc_total: row.mc_total,
    mc_correct: row.mc_correct,
    needs_review: row.needs_review,
    review_note: row.review_note,
    created_at: row.created_at,
  };
}

export function createPolicyQuizRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/policy-quiz';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    return access;
  }

  function requireTick(access, docKind) {
    if (access.isOwner) return;
    if (!(access.permissions || []).includes(TICK_BY_KIND[docKind])) {
      throw err(403, 'forbidden', 'This training is not assigned to you.');
    }
  }

  // ---- The owner's question writing ------------------------------------------

  router.get(`${base}/questions/:kind`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the owner writes the questions.');
    const docKind = kindOr400(req.params.kind);
    const questions = await questionsFor(pool(), access.business.id, docKind);
    return res.json({
      questions: questions.map((q) => publicQuestion(q, { owner: true })),
      pass_percent: await passPercentFor(pool(), access.business.id, docKind),
    });
  }));

  router.put(`${base}/questions/:kind`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the owner writes the questions.');
    const docKind = kindOr400(req.params.kind);
    const body = req.body || {};
    const incoming = Array.isArray(body.questions) ? body.questions : null;
    if (!incoming) throw err(400, 'invalid_value', 'Send the questions list.');
    if (incoming.length > 1000) throw err(400, 'invalid_value', 'That is more questions than the training can hold.');
    const passPercent = Number(body.pass_percent ?? 80);
    if (!Number.isInteger(passPercent) || passPercent < 1 || passPercent > 100) {
      throw err(400, 'invalid_value', 'The passing line is a whole percent between 1 and 100.');
    }
    const cleaned = incoming.map((q, i) => {
      const kind = String(q?.kind || '');
      const question = String(q?.question || '').trim().slice(0, 500);
      if (!question) throw err(400, 'invalid_value', 'Every question needs its words.');
      if (kind === 'mc') {
        const choices = (Array.isArray(q.choices) ? q.choices : [])
          .map((c) => String(c || '').trim().slice(0, 200))
          .filter(Boolean);
        if (choices.length < 2 || choices.length > 4) {
          throw err(400, 'invalid_value', 'A multiple-choice question needs two to four choices.');
        }
        const correct = Number(q.correct_index);
        if (!Number.isInteger(correct) || correct < 0 || correct >= choices.length) {
          throw err(400, 'invalid_value', 'Mark the correct choice for every multiple-choice question.');
        }
        return { kind, question, choices, correct_index: correct, expected_answer: '', position: i };
      }
      if (kind === 'open') {
        const expected = String(q.expected_answer || '').trim().slice(0, 500);
        if (!expected) throw err(400, 'invalid_value', 'An open question needs the expected answer.');
        return { kind, question, choices: [], correct_index: null, expected_answer: expected, position: i };
      }
      throw err(400, 'invalid_value', 'A question is multiple choice or open.');
    });
    const client = await pool().connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM policy_questions WHERE business_id = $1 AND doc_kind = $2', [access.business.id, docKind]);
      for (const q of cleaned) {
        await client.query(
          `INSERT INTO policy_questions (id, business_id, doc_kind, kind, question, choices, correct_index, expected_answer, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [crypto.randomUUID(), access.business.id, docKind, q.kind, q.question, JSON.stringify(q.choices), q.correct_index, q.expected_answer, q.position],
        );
      }
      await client.query(
        `INSERT INTO policy_quiz_settings (business_id, doc_kind, pass_percent)
         VALUES ($1, $2, $3)
         ON CONFLICT (business_id, doc_kind) DO UPDATE SET pass_percent = EXCLUDED.pass_percent, updated_at = NOW()`,
        [access.business.id, docKind, passPercent],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const questions = await questionsFor(pool(), access.business.id, docKind);
    return res.json({
      questions: questions.map((q) => publicQuestion(q, { owner: true })),
      pass_percent: passPercent,
    });
  }));

  // ---- Taking the training -----------------------------------------------------

  router.get(`${base}/training/:kind`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const docKind = kindOr400(req.params.kind);
    requireTick(access, docKind);
    const questions = await questionsFor(pool(), access.business.id, docKind);
    const personKey = access.isOwner ? 'owner' : access.staffRow.id;
    return res.json({
      doc_kind: docKind,
      questions: questions.map((q) => publicQuestion(q)),
      pass_percent: await passPercentFor(pool(), access.business.id, docKind),
      latest_attempt: publicAttempt(await latestAttempt(pool(), access.business.id, personKey, docKind)),
    });
  }));

  /** Instant multiple-choice check: a wrong pick is flagged on
   *  the spot and retried — it never waits for the submit. */
  router.post(`${base}/training/:kind/check`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const docKind = kindOr400(req.params.kind);
    requireTick(access, docKind);
    const { rows } = await pool().query(
      'SELECT * FROM policy_questions WHERE id = $1 AND business_id = $2 AND doc_kind = $3 LIMIT 1',
      [String(req.body?.question_id || ''), access.business.id, docKind],
    );
    const question = rows[0];
    if (!question || question.kind !== 'mc') throw err(404, 'not_found', 'That question is not here.');
    return res.json({ correct: Number(req.body?.choice_index) === question.correct_index });
  }));

  router.post(`${base}/training/:kind/submit`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const docKind = kindOr400(req.params.kind);
    requireTick(access, docKind);
    if (access.isOwner) throw err(400, 'owner_exempt', 'The owner does not take their own quiz.');
    const questions = await questionsFor(pool(), access.business.id, docKind);
    const passPercent = await passPercentFor(pool(), access.business.id, docKind);
    const given = new Map(
      (Array.isArray(req.body?.answers) ? req.body.answers : []).map((a) => [String(a?.question_id || ''), a]),
    );
    const personKey = access.staffRow.id;
    const personName = access.staffRow?.full_name || '';
    // No questions written = no quiz; the training is the reading.
    if (!questions.length) {
      const id = crypto.randomUUID();
      await pool().query(
        `INSERT INTO policy_quiz_attempts (id, business_id, doc_kind, person_key, person_name, answers, mc_total, mc_correct, score_percent, status, needs_review)
         VALUES ($1, $2, $3, $4, $5, '[]', 0, 0, NULL, 'passed', FALSE)`,
        [id, access.business.id, docKind, personKey, personName],
      );
      await maybeRingAllTrainingDone(pool(), access.business, access.staffRow, access.planKey);
      return res.json({ status: 'passed', reading_only: true, score_percent: null, needs_review: false });
    }
    let mcTotal = 0;
    let mcCorrect = 0;
    let needsReview = false;
    const filed = [];
    for (const q of questions) {
      const answer = given.get(q.id) || {};
      if (q.kind === 'mc') {
        mcTotal += 1;
        const chosen = Number.isInteger(answer.choice_index) ? answer.choice_index : null;
        const right = chosen === q.correct_index;
        if (right) mcCorrect += 1;
        filed.push({ question_id: q.id, kind: 'mc', question: q.question, choices: q.choices, choice_index: chosen, correct: right });
      } else {
        const text = String(answer.text || '').trim().slice(0, 1000);
        const matched = answerMatches(text, q.expected_answer);
        if (!matched) needsReview = true;
        filed.push({ question_id: q.id, kind: 'open', question: q.question, text, expected_answer: q.expected_answer, matched });
      }
    }
    const scorePercent = mcTotal ? Math.round((100 * mcCorrect) / mcTotal) : null;
    if (mcTotal && scorePercent < passPercent) {
      const id = crypto.randomUUID();
      await pool().query(
        `INSERT INTO policy_quiz_attempts (id, business_id, doc_kind, person_key, person_name, answers, mc_total, mc_correct, score_percent, status, needs_review)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'below_line', FALSE)`,
        [id, access.business.id, docKind, personKey, personName, JSON.stringify(filed), mcTotal, mcCorrect, scorePercent],
      );
      return res.json({ status: 'below_line', score_percent: scorePercent, pass_percent: passPercent, needs_review: false });
    }
    const id = crypto.randomUUID();
    await pool().query(
      `INSERT INTO policy_quiz_attempts (id, business_id, doc_kind, person_key, person_name, answers, mc_total, mc_correct, score_percent, status, needs_review)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'passed', $10)`,
      [id, access.business.id, docKind, personKey, personName, JSON.stringify(filed), mcTotal, mcCorrect, scorePercent, needsReview],
    );
    await maybeRingAllTrainingDone(pool(), access.business, access.staffRow, access.planKey);
    return res.json({ status: 'passed', score_percent: scorePercent, pass_percent: passPercent, needs_review: needsReview });
  }));

  // ---- The owner's review --------------------------------------------------------

  router.post(`${base}/attempts/:id/review`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the owner reviews these answers.');
    const { rows } = await pool().query(
      'SELECT * FROM policy_quiz_attempts WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.id, access.business.id],
    );
    const attempt = rows[0];
    if (!attempt) throw err(404, 'not_found', 'That attempt is not here.');
    const action = String(req.body?.action || '');
    const note = String(req.body?.note || '').trim().slice(0, 500);
    if (action === 'accept') {
      await pool().query(
        'UPDATE policy_quiz_attempts SET needs_review = FALSE, review_note = $2, updated_at = NOW() WHERE id = $1',
        [attempt.id, note],
      );
      return res.json({ ok: true, status: attempt.status, needs_review: false });
    }
    if (action === 'send_back') {
      await pool().query(
        "UPDATE policy_quiz_attempts SET status = 'sent_back', needs_review = FALSE, review_note = $2, updated_at = NOW() WHERE id = $1",
        [attempt.id, note],
      );
      // The person hears it: the training is theirs to retake.
      const { rows: memberRows } = await pool().query(
        'SELECT * FROM staff_members WHERE id = $1 AND business_id = $2 LIMIT 1',
        [attempt.person_key, access.business.id],
      );
      const member = memberRows[0];
      const memberUser = member ? await userForStaffRow(pool(), member) : null;
      if (memberUser) {
        await ringBell(pool(), access.business, {
          recipientUserId: memberUser.id,
          recipientStaffId: member.id,
          recipientRole: 'staff',
          actorStaffId: null,
          actorName: await ownerPublicName(pool(), access.business),
          event: 'training_sent_back',
          detail: `Your ${DOC_LABEL[attempt.doc_kind]} training was sent back — please take it again.${note ? ` Note from the owner: ${note}` : ''}`,
          refId: attempt.id,
        });
      }
      return res.json({ ok: true, status: 'sent_back', needs_review: false });
    }
    throw err(400, 'invalid_value', 'Say accept or send_back.');
  }));

  return router;
}
