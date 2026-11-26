/**
 * "Add your own training" — HTTP surface (Nov 25, 2026).
 *
 *   GET    /api/businesses/:bid/own-training                 owner: every training, full; member: the ones ticked for them
 *   POST   /api/businesses/:bid/own-training                 owner: a new blank training
 *   PUT    /api/businesses/:bid/own-training/:id             owner: save title/material/settings/questions/ticks
 *   DELETE /api/businesses/:bid/own-training/:id             owner: delete it and everything filed under it
 *   POST   /api/businesses/:bid/own-training/:id/file        owner: upload the material as a file
 *   DELETE /api/businesses/:bid/own-training/:id/file        owner: remove the file
 *   GET    /api/businesses/:bid/own-training/:id/file        owner or a ticked member: the file itself
 *   POST   /api/businesses/:bid/own-training/:id/check       ticked member: instant multiple-choice check
 *   POST   /api/businesses/:bid/own-training/:id/submit      ticked member: file a run (scored on the server)
 *   POST   /api/businesses/:bid/own-training/attempts/:id/review  owner: accept / send back
 *
 * The owner's design (Nov 25, 2026), mirroring the release-321
 * Settings policies/terms machinery and the owner's quiz
 * (migrations 032/033) in its new home at the end of the
 * Training page:
 *   - The owner writes their own training (title + material:
 *     typed in OR uploaded as a file — both doors offered,
 *     either or), then builds its quiz: unlimited questions,
 *     multiple-choice and written-answer mixed freely.
 *   - The owner sets the passing score per training. Written
 *     answers are judged the owner's choice, per training:
 *     'auto' — near-exact against the owner's answer key, on
 *     the spot; 'review' — sent to the owner, who marks the
 *     training passed or sends it back.
 *   - Assignment is by tick: only the staff members the owner
 *     ticks see a training and owe its quiz. The owner sees
 *     each ticked person's result and reviews from the box.
 *   - Multiple trainings from the one box — no limit. BOTH
 *     plans; per-business private: nothing an owner writes
 *     ever appears in another business.
 *   - Completion is server-checked (release 334 pattern): the
 *     score is computed here, from the stored questions, and a
 *     training counts done only when a passed attempt stands.
 *     The OWNER is quiz-exempt — they never take their own quiz.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';
import { ringBell, userForStaffRow } from './trainingCore.js';
import { ownerPublicName } from './profilePhotos.js';
import {
  POLICY_FILE_INVALID_MESSAGE,
  cleanPolicyFilename,
  parsePolicyFileDataUrl,
} from './businessPolicyRoutes.js';
import {
  CUSTOM_MATERIAL_MAX,
  cleanCustomQuestions,
  cleanPassPercent,
  cleanWrittenMode,
  scoreCustomAttempt,
} from './customTrainingCore.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] custom training route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

function publicQuestion(row, { owner = false } = {}) {
  const base = { id: row.id, kind: row.kind, question: row.question, position: row.position };
  if (row.kind === 'mc') {
    base.choices = Array.isArray(row.choices) ? row.choices : [];
    if (owner) base.correct_index = row.correct_index;
  }
  if (row.kind === 'open' && owner) base.expected_answer = row.expected_answer;
  return base;
}

function publicAttempt(row) {
  if (!row) return null;
  return {
    id: row.id,
    training_id: row.training_id,
    person_key: row.person_key,
    person_name: row.person_name,
    status: row.status,
    score_percent: row.score_percent,
    total: row.total,
    correct: row.correct,
    needs_review: row.needs_review,
    review_note: row.review_note,
    answers: Array.isArray(row.answers) ? row.answers : [],
    created_at: row.created_at,
  };
}

function materialState(training, fileRow) {
  if (fileRow) {
    return {
      kind: 'file',
      filename: fileRow.filename || '',
      content_type: fileRow.content_type,
      size_bytes: fileRow.size_bytes,
      updated_at: fileRow.updated_at,
    };
  }
  const text = String(training.material_text || '');
  if (text.trim()) return { kind: 'text', text };
  return { kind: 'empty' };
}

export function createCustomTrainingRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/own-training';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    return access;
  }

  async function ownerCtx(req) {
    const access = await ctx(req);
    if (!access.isOwner) throw err(403, 'forbidden', 'Only the owner writes these trainings.');
    return access;
  }

  async function trainingOr404(businessId, trainingId) {
    const { rows } = await pool().query(
      'SELECT * FROM custom_trainings WHERE id = $1 AND business_id = $2 LIMIT 1',
      [String(trainingId || ''), businessId],
    );
    if (!rows[0]) throw err(404, 'not_found', 'That training is not here.');
    return rows[0];
  }

  async function questionsFor(businessId, trainingId) {
    const { rows } = await pool().query(
      `SELECT * FROM custom_training_questions WHERE business_id = $1 AND training_id = $2
        ORDER BY position ASC, created_at ASC`,
      [businessId, trainingId],
    );
    return rows;
  }

  async function fileFor(businessId, trainingId) {
    const { rows } = await pool().query(
      'SELECT training_id, content_type, filename, size_bytes, updated_at FROM custom_training_files WHERE business_id = $1 AND training_id = $2 LIMIT 1',
      [businessId, trainingId],
    );
    return rows[0] ?? null;
  }

  async function assigneesFor(businessId, trainingId) {
    const { rows } = await pool().query(
      `SELECT person_key, person_name FROM custom_training_assignments
        WHERE business_id = $1 AND training_id = $2 ORDER BY person_name ASC`,
      [businessId, trainingId],
    );
    return rows;
  }

  async function latestAttempt(businessId, personKey, trainingId) {
    const { rows } = await pool().query(
      `SELECT * FROM custom_training_attempts WHERE business_id = $1 AND person_key = $2 AND training_id = $3
        ORDER BY created_at DESC LIMIT 1`,
      [businessId, personKey, trainingId],
    );
    return rows[0] ?? null;
  }

  async function hasPassed(businessId, personKey, trainingId) {
    const { rows } = await pool().query(
      `SELECT 1 FROM custom_training_attempts
        WHERE business_id = $1 AND person_key = $2 AND training_id = $3 AND status = 'passed' LIMIT 1`,
      [businessId, personKey, trainingId],
    );
    return rows.length > 0;
  }

  /** The assignment tick is the only door in for the team. */
  async function requireAssigned(access, trainingId) {
    if (access.isOwner) return;
    const personKey = access.staffRow?.id;
    if (!personKey) throw err(403, 'forbidden', 'This training is not assigned to you.');
    const { rows } = await pool().query(
      'SELECT 1 FROM custom_training_assignments WHERE business_id = $1 AND training_id = $2 AND person_key = $3 LIMIT 1',
      [access.business.id, trainingId, personKey],
    );
    if (!rows.length) throw err(403, 'forbidden', 'This training is not assigned to you.');
  }

  async function ownerShape(training) {
    const businessId = training.business_id;
    const [questions, file, assignees] = await Promise.all([
      questionsFor(businessId, training.id),
      fileFor(businessId, training.id),
      assigneesFor(businessId, training.id),
    ]);
    const results = [];
    for (const assignee of assignees) {
      const attempt = await latestAttempt(businessId, assignee.person_key, training.id);
      results.push({
        person_key: assignee.person_key,
        person_name: assignee.person_name,
        completed: await hasPassed(businessId, assignee.person_key, training.id),
        latest_attempt: publicAttempt(attempt),
      });
    }
    return {
      id: training.id,
      title: training.title,
      material: materialState(training, file),
      pass_percent: training.pass_percent,
      written_mode: training.written_mode,
      questions: questions.map((q) => publicQuestion(q, { owner: true })),
      assignees,
      results,
      created_at: training.created_at,
      updated_at: training.updated_at,
    };
  }

  async function memberShape(access, training) {
    const businessId = training.business_id;
    const personKey = access.staffRow.id;
    const questions = await questionsFor(businessId, training.id);
    const file = await fileFor(businessId, training.id);
    const attempt = await latestAttempt(businessId, personKey, training.id);
    return {
      id: training.id,
      title: training.title,
      material: materialState(training, file),
      pass_percent: training.pass_percent,
      written_mode: training.written_mode,
      questions: questions.map((q) => publicQuestion(q)),
      latest_attempt: publicAttempt(attempt),
      completed: await hasPassed(businessId, personKey, training.id),
    };
  }

  // ---- The list ----------------------------------------------------------------

  router.get(base, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    if (access.isOwner) {
      const { rows } = await pool().query(
        'SELECT * FROM custom_trainings WHERE business_id = $1 ORDER BY created_at ASC',
        [access.business.id],
      );
      const trainings = [];
      for (const row of rows) trainings.push(await ownerShape(row));
      return res.json({ is_owner: true, trainings });
    }
    const personKey = access.staffRow?.id;
    if (!personKey) return res.json({ is_owner: false, trainings: [] });
    const { rows } = await pool().query(
      `SELECT t.* FROM custom_trainings t
         JOIN custom_training_assignments a ON a.training_id = t.id AND a.business_id = t.business_id
        WHERE t.business_id = $1 AND a.person_key = $2
        ORDER BY t.created_at ASC`,
      [access.business.id, personKey],
    );
    const trainings = [];
    for (const row of rows) trainings.push(await memberShape(access, row));
    return res.json({ is_owner: false, trainings });
  }));

  // ---- The owner's writing -------------------------------------------------------

  router.post(base, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const id = crypto.randomUUID();
    const { rows } = await pool().query(
      `INSERT INTO custom_trainings (id, business_id, created_by_user_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [id, access.business.id, req.user.id],
    );
    return res.status(201).json(await ownerShape(rows[0]));
  }));

  router.put(`${base}/:id`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const training = await trainingOr404(access.business.id, req.params.id);
    const body = req.body || {};
    const title = String(body.title ?? training.title).trim().slice(0, 200);
    const passPercent = cleanPassPercent(body.pass_percent ?? training.pass_percent);
    const writtenMode = cleanWrittenMode(body.written_mode ?? training.written_mode);
    const questions = body.questions === undefined
      ? null
      : cleanCustomQuestions(body.questions);
    // Material: a string saves typed text (and replaces any
    // file, the policies either-or rule); absent leaves it be.
    let materialText = null;
    if (typeof body.material_text === 'string') {
      if (body.material_text.length > CUSTOM_MATERIAL_MAX) {
        throw err(400, 'policy_text_too_long', 'That training is too long to type here. You can upload it as a file instead.');
      }
      materialText = body.material_text.trim() ? body.material_text : '';
    }
    // The ticks: only real members of THIS business can be ticked.
    let assigneeIds = null;
    if (body.assignee_ids !== undefined) {
      if (!Array.isArray(body.assignee_ids)) throw err(400, 'invalid_value', 'Send the ticked people as a list.');
      const wanted = [...new Set(body.assignee_ids.map((v) => String(v || '')).filter(Boolean))];
      const { rows: members } = await pool().query(
        "SELECT id, full_name FROM staff_members WHERE business_id = $1 AND status IN ('active', 'invited')",
        [access.business.id],
      );
      const byId = new Map(members.map((m) => [m.id, m]));
      assigneeIds = wanted.map((id) => {
        const member = byId.get(id);
        if (!member) throw err(400, 'invalid_value', 'One of the ticked people is not on this team.');
        return member;
      });
    }
    const client = await pool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE custom_trainings SET title = $2, pass_percent = $3, written_mode = $4,
           material_text = COALESCE($5, material_text), updated_at = NOW()
          WHERE id = $1 AND business_id = $6`,
        [training.id, title, passPercent, writtenMode, materialText, access.business.id],
      );
      if (materialText) {
        await client.query(
          'DELETE FROM custom_training_files WHERE business_id = $1 AND training_id = $2',
          [access.business.id, training.id],
        );
      }
      if (questions) {
        await client.query(
          'DELETE FROM custom_training_questions WHERE business_id = $1 AND training_id = $2',
          [access.business.id, training.id],
        );
        for (const q of questions) {
          await client.query(
            `INSERT INTO custom_training_questions (id, business_id, training_id, kind, question, choices, correct_index, expected_answer, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [crypto.randomUUID(), access.business.id, training.id, q.kind, q.question, JSON.stringify(q.choices), q.correct_index, q.expected_answer, q.position],
          );
        }
      }
      if (assigneeIds) {
        await client.query(
          'DELETE FROM custom_training_assignments WHERE business_id = $1 AND training_id = $2',
          [access.business.id, training.id],
        );
        for (const member of assigneeIds) {
          await client.query(
            `INSERT INTO custom_training_assignments (id, business_id, training_id, person_key, person_name)
             VALUES ($1, $2, $3, $4, $5)`,
            [crypto.randomUUID(), access.business.id, training.id, member.id, member.full_name || ''],
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const fresh = await trainingOr404(access.business.id, training.id);
    return res.json(await ownerShape(fresh));
  }));

  router.delete(`${base}/:id`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const training = await trainingOr404(access.business.id, req.params.id);
    const client = await pool().connect();
    try {
      await client.query('BEGIN');
      for (const table of [
        'custom_training_attempts',
        'custom_training_assignments',
        'custom_training_questions',
        'custom_training_files',
      ]) {
        await client.query(`DELETE FROM ${table} WHERE business_id = $1 AND training_id = $2`, [access.business.id, training.id]);
      }
      await client.query('DELETE FROM custom_trainings WHERE id = $1 AND business_id = $2', [training.id, access.business.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return res.json({ ok: true });
  }));

  // ---- The material file (the policies file door, mirrored) ----------------------

  router.post(`${base}/:id/file`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const training = await trainingOr404(access.business.id, req.params.id);
    const parsed = parsePolicyFileDataUrl(req.body?.dataUrl);
    if (!parsed) throw err(400, 'policy_file_invalid', POLICY_FILE_INVALID_MESSAGE);
    await pool().query(
      `INSERT INTO custom_training_files (training_id, business_id, content_type, filename, size_bytes, data_base64)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (training_id) DO UPDATE SET
         content_type = EXCLUDED.content_type,
         filename = EXCLUDED.filename,
         size_bytes = EXCLUDED.size_bytes,
         data_base64 = EXCLUDED.data_base64,
         updated_at = NOW()`,
      [training.id, access.business.id, parsed.mime, cleanPolicyFilename(req.body?.filename), parsed.bytes.length, parsed.base64],
    );
    // Either or: uploading a file replaces the typed material.
    await pool().query(
      "UPDATE custom_trainings SET material_text = '', updated_at = NOW() WHERE id = $1 AND business_id = $2",
      [training.id, access.business.id],
    );
    const fresh = await trainingOr404(access.business.id, training.id);
    return res.status(201).json(await ownerShape(fresh));
  }));

  router.delete(`${base}/:id/file`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const training = await trainingOr404(access.business.id, req.params.id);
    await pool().query(
      'DELETE FROM custom_training_files WHERE business_id = $1 AND training_id = $2',
      [access.business.id, training.id],
    );
    const fresh = await trainingOr404(access.business.id, training.id);
    return res.json(await ownerShape(fresh));
  }));

  router.get(`${base}/:id/file`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const training = await trainingOr404(access.business.id, req.params.id);
    await requireAssigned(access, training.id);
    const { rows } = await pool().query(
      'SELECT content_type, filename, data_base64 FROM custom_training_files WHERE business_id = $1 AND training_id = $2 LIMIT 1',
      [access.business.id, training.id],
    );
    const file = rows[0];
    if (!file) throw err(404, 'policy_file_not_found', 'No file is saved for that training.');
    res.setHeader('Content-Type', file.content_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${cleanPolicyFilename(file.filename) || 'document'}"`,
    );
    return res.send(Buffer.from(file.data_base64, 'base64'));
  }));

  // ---- Taking it -------------------------------------------------------------------

  /** Instant multiple-choice check, the policy quiz's own rule:
   *  a wrong pick is flagged on the spot and retried. */
  router.post(`${base}/:id/check`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    const training = await trainingOr404(access.business.id, req.params.id);
    await requireAssigned(access, training.id);
    const { rows } = await pool().query(
      'SELECT * FROM custom_training_questions WHERE id = $1 AND business_id = $2 AND training_id = $3 LIMIT 1',
      [String(req.body?.question_id || ''), access.business.id, training.id],
    );
    const question = rows[0];
    if (!question || question.kind !== 'mc') throw err(404, 'not_found', 'That question is not here.');
    return res.json({ correct: Number(req.body?.choice_index) === question.correct_index });
  }));

  router.post(`${base}/:id/submit`, asyncHandler(async (req, res) => {
    const access = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const training = await trainingOr404(access.business.id, req.params.id);
    if (access.isOwner) throw err(400, 'owner_exempt', 'The owner does not take their own quiz.');
    await requireAssigned(access, training.id);
    const questions = await questionsFor(access.business.id, training.id);
    const scored = scoreCustomAttempt(questions, req.body?.answers, {
      writtenMode: training.written_mode,
      passPercent: training.pass_percent,
    });
    const status = scored.status === 'reading_only' ? 'passed' : scored.status;
    const id = crypto.randomUUID();
    await pool().query(
      `INSERT INTO custom_training_attempts (id, business_id, training_id, person_key, person_name, answers, total, correct, score_percent, status, needs_review)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id, access.business.id, training.id, access.staffRow.id, access.staffRow?.full_name || '',
        JSON.stringify(scored.filed), scored.total, scored.correct, scored.scorePercent,
        status, scored.needsReview,
      ],
    );
    return res.json({
      status,
      score_percent: scored.scorePercent,
      pass_percent: training.pass_percent,
      needs_review: scored.needsReview,
      reading_only: scored.status === 'reading_only',
    });
  }));

  // ---- The owner's review ------------------------------------------------------------

  router.post(`${base}/attempts/:id/review`, asyncHandler(async (req, res) => {
    const access = await ownerCtx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const { rows } = await pool().query(
      'SELECT * FROM custom_training_attempts WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.id, access.business.id],
    );
    const attempt = rows[0];
    if (!attempt) throw err(404, 'not_found', 'That attempt is not here.');
    const action = String(req.body?.action || '');
    const note = String(req.body?.note || '').trim().slice(0, 500);
    if (action === 'accept') {
      // In review mode the owner's mark IS the pass; an accept
      // anywhere else just clears the flag, the policy rule.
      const nextStatus = attempt.status === 'pending_review' ? 'passed' : attempt.status;
      await pool().query(
        'UPDATE custom_training_attempts SET status = $2, needs_review = FALSE, review_note = $3, updated_at = NOW() WHERE id = $1',
        [attempt.id, nextStatus, note],
      );
      return res.json({ ok: true, status: nextStatus, needs_review: false });
    }
    if (action === 'send_back') {
      await pool().query(
        "UPDATE custom_training_attempts SET status = 'sent_back', needs_review = FALSE, review_note = $2, updated_at = NOW() WHERE id = $1",
        [attempt.id, note],
      );
      const training = await trainingOr404(access.business.id, attempt.training_id).catch(() => null);
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
          detail: `Your training "${training?.title || 'from the owner'}" was sent back — please take it again.${note ? ` Note from the owner: ${note}` : ''}`,
          refId: attempt.id,
        });
      }
      return res.json({ ok: true, status: 'sent_back', needs_review: false });
    }
    throw err(400, 'invalid_value', 'Say accept or send_back.');
  }));

  return router;
}
