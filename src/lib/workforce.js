/**
 * Workforce + payroll, client side (Workforce phase).
 *
 * Thin wrappers over /api/businesses/:bid/workforce/* — every rule
 * (hierarchy, clock windows, stub pushing, bank-detail visibility)
 * is decided on the server; this file only carries calls and the
 * label helpers the two pages share.
 *
 * (Node-testable shape: the API client is imported by relative
 * path, not the `@/` alias — same note as src/lib/crossStore.js.)
 */
import { apiRequest } from '../api/client.js';
import { t } from './i18n.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId)}/workforce`;

export function getWorkforceContext(businessId) {
  return apiRequest(`${base(businessId)}/context`);
}

export function listPeople(businessId) {
  return apiRequest(`${base(businessId)}/people`);
}

export function getWorkforceSettings(businessId) {
  return apiRequest(`${base(businessId)}/settings`);
}

export function updateWorkforceSettings(businessId, patch) {
  return apiRequest(`${base(businessId)}/settings`, { method: 'PATCH', body: patch });
}

export function listSchedules(businessId) {
  return apiRequest(`${base(businessId)}/schedules`);
}

export function saveSchedule(businessId, staffId, shifts) {
  return apiRequest(`${base(businessId)}/schedules/${encodeURIComponent(staffId)}`, {
    method: 'PUT',
    body: { shifts },
  });
}

export function getClockStatus(businessId) {
  return apiRequest(`${base(businessId)}/clock/status`);
}

export function clockIn(businessId) {
  return apiRequest(`${base(businessId)}/clock/in`, { method: 'POST', body: {} });
}

export function clockOut(businessId, note) {
  return apiRequest(`${base(businessId)}/clock/out`, { method: 'POST', body: { note: note || '' } });
}

export function breakOut(businessId, breakType) {
  return apiRequest(`${base(businessId)}/clock/break-out`, { method: 'POST', body: { break_type: breakType } });
}

export function breakIn(businessId) {
  return apiRequest(`${base(businessId)}/clock/break-in`, { method: 'POST', body: {} });
}

export function listEntries(businessId) {
  return apiRequest(`${base(businessId)}/entries`);
}

export function listNotifications(businessId) {
  return apiRequest(`${base(businessId)}/notifications`);
}

export function markNotificationRead(businessId, id) {
  return apiRequest(`${base(businessId)}/notifications/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { is_read: true },
  });
}

export function listTimeOff(businessId) {
  return apiRequest(`${base(businessId)}/time-off`);
}

export function requestTimeOff(businessId, values) {
  return apiRequest(`${base(businessId)}/time-off`, { method: 'POST', body: values });
}

export function decideTimeOff(businessId, id, status, decisionReason) {
  return apiRequest(`${base(businessId)}/time-off/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { status, decision_reason: decisionReason || '' },
  });
}

export function listTasks(businessId) {
  return apiRequest(`${base(businessId)}/tasks`);
}

export function createTask(businessId, values) {
  return apiRequest(`${base(businessId)}/tasks`, { method: 'POST', body: values });
}

export function setTaskStatus(businessId, id, status) {
  return apiRequest(`${base(businessId)}/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { status },
  });
}

// ---- Messages (Workforce inbox follow-up) --------------------------------
// One-to-one conversations inside the same inbox as the notifications.
// Privacy lives on the server: a person sees only their own threads;
// the owner additionally reads every thread in their business
// (oversight) but posts only in their own.

export function listMessageThreads(businessId) {
  return apiRequest(`${base(businessId)}/messages/threads`);
}

export function startMessageThread(businessId, target) {
  return apiRequest(`${base(businessId)}/messages/threads`, { method: 'POST', body: target });
}

export function getMessageThread(businessId, threadId) {
  return apiRequest(`${base(businessId)}/messages/threads/${encodeURIComponent(threadId)}`);
}

export function postMessage(businessId, threadId, body) {
  return apiRequest(`${base(businessId)}/messages/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    body: { body },
  });
}

export function markThreadRead(businessId, threadId) {
  return apiRequest(`${base(businessId)}/messages/threads/${encodeURIComponent(threadId)}/read`, {
    method: 'PATCH',
    body: {},
  });
}

export function getMessageUnread(businessId) {
  return apiRequest(`${base(businessId)}/messages/unread`);
}

// ---- Payroll -----------------------------------------------------------

export function getPayrollContext(businessId) {
  return apiRequest(`${base(businessId)}/payroll/context`);
}

export function getPayrollConfig(businessId) {
  return apiRequest(`${base(businessId)}/payroll/config`);
}

export function savePayrollConfig(businessId, config) {
  return apiRequest(`${base(businessId)}/payroll/config`, { method: 'PUT', body: config });
}

export function listPayProfiles(businessId) {
  return apiRequest(`${base(businessId)}/payroll/profiles`);
}

export function savePayProfile(businessId, staffId, values) {
  return apiRequest(`${base(businessId)}/payroll/profiles/${encodeURIComponent(staffId)}`, {
    method: 'PUT',
    body: values,
  });
}

export function previewPayroll(businessId, start, end) {
  return apiRequest(
    `${base(businessId)}/payroll/preview?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  );
}

export function runPayroll(businessId, values) {
  return apiRequest(`${base(businessId)}/payroll/runs`, { method: 'POST', body: values });
}

export function listPayrollRuns(businessId) {
  return apiRequest(`${base(businessId)}/payroll/runs`);
}

export function getPayrollRun(businessId, runId) {
  return apiRequest(`${base(businessId)}/payroll/runs/${encodeURIComponent(runId)}`);
}

export function listMyStubs(businessId) {
  return apiRequest(`${base(businessId)}/payroll/my-stubs`);
}

export function pushStub(businessId, stubId) {
  return apiRequest(`${base(businessId)}/payroll/stubs/${encodeURIComponent(stubId)}/push`, {
    method: 'POST',
    body: {},
  });
}

export function listCashUps(businessId) {
  return apiRequest(`${base(businessId)}/cash-ups`);
}

export function createCashUp(businessId, values) {
  return apiRequest(`${base(businessId)}/cash-ups`, { method: 'POST', body: values });
}

export function getDirectDeposit(businessId) {
  return apiRequest(`${base(businessId)}/dd`);
}

export function inviteDirectDeposit(businessId, staffId) {
  return apiRequest(`${base(businessId)}/dd/invite`, { method: 'POST', body: { staff_member_id: staffId } });
}

export function submitDirectDeposit(businessId, values) {
  return apiRequest(`${base(businessId)}/dd/submit`, { method: 'POST', body: values });
}

// ---- Labels --------------------------------------------------------------

export function timeOffStatusLabel(status) {
  switch (status) {
    case 'approved':
      return t('workforce.status.approved');
    case 'declined':
      return t('workforce.status.declined');
    default:
      return t('workforce.status.pending');
  }
}

export function breakTypeLabel(breakType) {
  switch (breakType) {
    case 'lunch30':
      return t('workforce.lunch30');
    case 'lunch60':
      return t('workforce.lunch60');
    default:
      return t('workforce.break15');
  }
}

export function weekdayLabel(weekday) {
  return t(`workforce.day.${weekday}`);
}

export function formatMoneyPlain(value) {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}
