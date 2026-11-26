/**
 * Training, client side (Training phase).
 *
 * Thin wrappers over /api/businesses/:bid/training/* — the track
 * visibility, the assignment hierarchy and the warning rules are all
 * decided on the server; this file only carries the calls. The
 * lesson SHAPE (ids, tracks, modules, step counts) comes from
 * src/lib/trainingCatalog.js; the lesson TEXT comes from the locale
 * files through t(), like everything else.
 */
import { apiRequest } from '../api/client.js';
import { t } from './i18n.js';
import { lessonById } from './trainingCatalog.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId)}/training`;

export function getTrainingState(businessId) {
  return apiRequest(`${base(businessId)}/state`);
}

export function completeLesson(businessId, lessonId) {
  return apiRequest(`${base(businessId)}/lessons/${encodeURIComponent(lessonId)}/complete`, {
    method: 'POST',
    body: {},
  });
}

export function getTeamProgress(businessId) {
  return apiRequest(`${base(businessId)}/team`);
}

// ---- The per-lesson quiz + comments (Nov 20, 2026) -------------------------

export function getLessonQuiz(businessId, lessonId) {
  return apiRequest(`${base(businessId)}/lessons/${encodeURIComponent(lessonId)}/quiz`);
}

export function submitLessonQuiz(businessId, lessonId, answers) {
  return apiRequest(`${base(businessId)}/lessons/${encodeURIComponent(lessonId)}/quiz`, {
    method: 'POST',
    body: { answers },
  });
}

export function addLessonComment(businessId, lessonId, body) {
  return apiRequest(`${base(businessId)}/lessons/${encodeURIComponent(lessonId)}/comments`, {
    method: 'POST',
    body: { body },
  });
}

export function getTeamMemberResults(businessId, staffId) {
  return apiRequest(`${base(businessId)}/team/${encodeURIComponent(staffId)}/results`);
}

// ---- The owner's policy quiz (Nov 20, 2026) ---------------------------------

const policyBase = (businessId) => `/api/businesses/${encodeURIComponent(businessId)}/policy-quiz`;

export function getPolicyQuestions(businessId, kind) {
  return apiRequest(`${policyBase(businessId)}/questions/${encodeURIComponent(kind)}`);
}

export function savePolicyQuestions(businessId, kind, values) {
  return apiRequest(`${policyBase(businessId)}/questions/${encodeURIComponent(kind)}`, {
    method: 'PUT',
    body: values,
  });
}

export function getPolicyTraining(businessId, kind) {
  return apiRequest(`${policyBase(businessId)}/training/${encodeURIComponent(kind)}`);
}

export function checkPolicyAnswer(businessId, kind, questionId, choiceIndex) {
  return apiRequest(`${policyBase(businessId)}/training/${encodeURIComponent(kind)}/check`, {
    method: 'POST',
    body: { question_id: questionId, choice_index: choiceIndex },
  });
}

export function submitPolicyTraining(businessId, kind, answers) {
  return apiRequest(`${policyBase(businessId)}/training/${encodeURIComponent(kind)}/submit`, {
    method: 'POST',
    body: { answers },
  });
}

export function reviewPolicyAttempt(businessId, attemptId, values) {
  return apiRequest(`${policyBase(businessId)}/attempts/${encodeURIComponent(attemptId)}/review`, {
    method: 'POST',
    body: values,
  });
}

// ---- "Add your own training" (Nov 25, 2026) --------------------------------
// The owner's own trainings: written by the owner at the end of
// the Training page, tick-assigned, scored on the server. The
// owner reads the full shape (answer keys, ticks, results); a
// member reads only the trainings ticked for them, key-free.

const ownBase = (businessId) => `/api/businesses/${encodeURIComponent(businessId)}/own-training`;

export function getOwnTrainings(businessId) {
  return apiRequest(ownBase(businessId));
}

export function createOwnTraining(businessId) {
  return apiRequest(ownBase(businessId), { method: 'POST', body: {} });
}

export function saveOwnTraining(businessId, trainingId, values) {
  return apiRequest(`${ownBase(businessId)}/${encodeURIComponent(trainingId)}`, {
    method: 'PUT',
    body: values,
  });
}

export function deleteOwnTraining(businessId, trainingId) {
  return apiRequest(`${ownBase(businessId)}/${encodeURIComponent(trainingId)}`, { method: 'DELETE' });
}

export function uploadOwnTrainingFile(businessId, trainingId, values) {
  return apiRequest(`${ownBase(businessId)}/${encodeURIComponent(trainingId)}/file`, {
    method: 'POST',
    body: values,
  });
}

export function removeOwnTrainingFile(businessId, trainingId) {
  return apiRequest(`${ownBase(businessId)}/${encodeURIComponent(trainingId)}/file`, { method: 'DELETE' });
}

export function ownTrainingFileUrl(businessId, trainingId) {
  return `/api/businesses/${encodeURIComponent(businessId)}/own-training/${encodeURIComponent(trainingId)}/file`;
}

export function checkOwnTrainingAnswer(businessId, trainingId, questionId, choiceIndex) {
  return apiRequest(`${ownBase(businessId)}/${encodeURIComponent(trainingId)}/check`, {
    method: 'POST',
    body: { question_id: questionId, choice_index: choiceIndex },
  });
}

export function submitOwnTraining(businessId, trainingId, answers) {
  return apiRequest(`${ownBase(businessId)}/${encodeURIComponent(trainingId)}/submit`, {
    method: 'POST',
    body: { answers },
  });
}

export function reviewOwnTrainingAttempt(businessId, attemptId, values) {
  return apiRequest(`${ownBase(businessId)}/attempts/${encodeURIComponent(attemptId)}/review`, {
    method: 'POST',
    body: values,
  });
}

export function assignTraining(businessId, values) {
  return apiRequest(`${base(businessId)}/assignments`, { method: 'POST', body: values });
}

export function setAssignmentDeadline(businessId, assignmentId, values) {
  return apiRequest(`${base(businessId)}/assignments/${encodeURIComponent(assignmentId)}`, {
    method: 'PATCH',
    body: values,
  });
}

export function warnAssignment(businessId, assignmentId) {
  return apiRequest(`${base(businessId)}/assignments/${encodeURIComponent(assignmentId)}/warn`, {
    method: 'POST',
    body: {},
  });
}

export function lessonTitle(lesson) {
  return t(`training.lessons.${lesson.id}.title`);
}

export function lessonSteps(lesson) {
  const out = [];
  for (let i = 1; i <= lesson.steps; i += 1) {
    out.push(t(`training.lessons.${lesson.id}.step${i}`));
  }
  return out;
}

export function moduleLabel(module) {
  return t(`training.module.${module}`);
}

export function trackTitle(track) {
  return t(`training.track.${track}`);
}

export function trackHelp(track) {
  return t(`training.track.${track}Help`);
}

export { lessonById };
