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
