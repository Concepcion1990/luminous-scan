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

// Call-in windows + time-entry corrections (the clock build,
// Nov 21, 2026). Every door is owner / ticked-manager only; the
// server decides, these only carry the calls.
export function listCallInWindows(businessId) {
  return apiRequest(`${base(businessId)}/call-in`);
}

export function openCallInWindow(businessId, staffId) {
  return apiRequest(`${base(businessId)}/call-in/${encodeURIComponent(staffId)}`, {
    method: 'POST',
    body: {},
  });
}

export function closeCallInWindow(businessId, staffId) {
  return apiRequest(`${base(businessId)}/call-in/${encodeURIComponent(staffId)}`, {
    method: 'DELETE',
  });
}

export function fixTimeEntry(businessId, entryId, values) {
  return apiRequest(`${base(businessId)}/entries/${encodeURIComponent(entryId)}`, {
    method: 'PATCH',
    body: values,
  });
}

// Staff documents (Nov 21, 2026): each member's paperwork file.
// Every door is owner / staff.documents-ticked-manager only; the
// server decides (server/staffDocumentRoutes.js), these only
// carry the calls. The routes live outside the workforce base —
// their own /staff-documents stem, like the policy files.
const documentsBase = (businessId) =>
  `/api/businesses/${encodeURIComponent(businessId)}/staff-documents`;

export function listDocumentMembers(businessId) {
  return apiRequest(`${documentsBase(businessId)}/members`);
}

export function listStaffDocuments(businessId, memberId) {
  return apiRequest(`${documentsBase(businessId)}/${encodeURIComponent(memberId)}`);
}

export function uploadStaffDocument(businessId, memberId, values) {
  return apiRequest(`${documentsBase(businessId)}/${encodeURIComponent(memberId)}`, {
    method: 'POST',
    body: values,
  });
}

export function removeStaffDocument(businessId, memberId, docId) {
  return apiRequest(
    `${documentsBase(businessId)}/${encodeURIComponent(memberId)}/${encodeURIComponent(docId)}`,
    { method: 'DELETE' },
  );
}

export function staffDocumentFileUrl(businessId, memberId, docId) {
  return `${documentsBase(businessId)}/${encodeURIComponent(memberId)}/${encodeURIComponent(docId)}/file`;
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

export function postVoiceMessage(businessId, threadId, dataUrl, durationMs) {
  return apiRequest(`${base(businessId)}/messages/threads/${encodeURIComponent(threadId)}/voice`, {
    method: 'POST',
    body: { dataUrl, duration_ms: durationMs },
  });
}

/** The private file route for one voice note's recording. The
 * browser's media element carries the session cookie itself
 * (same-origin); the server re-checks conversation access. */
export function voiceNoteFileUrl(businessId, threadId, messageId) {
  return `${base(businessId)}/messages/threads/${encodeURIComponent(threadId)}/voice/${encodeURIComponent(messageId)}/file`;
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

export function updateMyPayrollDetails(businessId, values) {
  return apiRequest(`${base(businessId)}/payroll/my-details`, { method: 'PUT', body: values });
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

export function sendBackDirectDeposit(businessId, staffId) {
  return apiRequest(`${base(businessId)}/dd/send-back`, { method: 'POST', body: { staff_member_id: staffId } });
}

// The owner's sealed-form read (owner only, server-enforced):
// the member's current details, their current signed form in
// full, and the masked history of the forms it replaced.
export function getDirectDepositForm(businessId, staffId) {
  return apiRequest(`${base(businessId)}/dd/details/${encodeURIComponent(staffId)}`);
}

// ---- Labels --------------------------------------------------------------

// The three signature styles a member can sign with (Nov 21,
// 2026): the typed name IS the signature, rendered in the chosen
// style on the sealed form exactly as the member saw it here.
export const SIGNATURE_STYLES = ['script', 'italic', 'simple'];

export function signatureFontFamily(style) {
  switch (style) {
    case 'script':
      return "'Brush Script MT', 'Segoe Script', 'Lucida Handwriting', cursive";
    case 'italic':
      return "Georgia, 'Times New Roman', serif";
    default:
      return 'inherit';
  }
}

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
