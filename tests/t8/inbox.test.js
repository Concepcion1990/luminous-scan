/**
 * Workforce inbox follow-up — the notification fan-out (time-off,
 * tasks, pay stubs, schedules) and the 1:1 messaging privacy rules.
 *
 * Notifications are records in the recipient's inbox (the cross-store
 * pattern): every assertion reads the real inboxes over HTTP.
 * Messaging privacy is the owner's rule, tested hard: only the two
 * participants can read or post in a thread; the owner may READ
 * every thread in their own business (oversight) but posts only in
 * threads they are part of — and an oversight read never marks
 * anything read for the participants.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

const WF = (bid) => `/api/businesses/${bid}/workforce`;
const MSG = (bid) => `${WF(bid)}/messages`;

// ---- Fixtures -------------------------------------------------------------

/** Insert a trusted active staff row (created by the owner), then register its user. */
async function addTeamMember(business, ownerId, email, { manager = false, name } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, '[]', 'active', $7)`,
    [
      id,
      business.id,
      name || (manager ? 'Manny Manager' : 'Sam Staff'),
      email,
      manager ? 'preset-manager' : 'preset-sales',
      manager ? 'Manager' : 'Sales clerk',
      ownerId,
    ],
  );
  const account = await registerVerifiedUser(email);
  return { staffId: id, email, cookie: account.cookie, user: account.user };
}

async function inbox(cookie, bid) {
  const res = await req(`${WF(bid)}/notifications`, { cookie });
  assert.equal(res.status, 200);
  return res.json.notifications;
}
function hasEvent(notifications, event, pattern) {
  return notifications.some((n) => n.event === event && (!pattern || pattern.test(n.detail)));
}

// ---- Part A: notification fan-out ------------------------------------------

test('time-off submitted: a staff request rings the owner AND every manager, nobody else', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('inbox-off1@example.com');
  const manager = await addTeamMember(business, owner.id, 'inbox-off1-mgr@example.com', { manager: true });
  const manager2 = await addTeamMember(business, owner.id, 'inbox-off1-mgr2@example.com', {
    manager: true,
    name: 'Marta Manager',
  });
  const staff = await addTeamMember(business, owner.id, 'inbox-off1-staff@example.com');
  const bystander = await addTeamMember(business, owner.id, 'inbox-off1-other@example.com', { name: 'Ollie Other' });

  const submitted = await req(`${WF(business.id)}/time-off`, {
    method: 'POST',
    body: { start_date: '2026-12-24', end_date: '2026-12-26', reason: 'Family' },
    cookie: staff.cookie,
  });
  assert.equal(submitted.status, 201);

  const ownerInbox = await inbox(ownerCookie, business.id);
  assert.ok(hasEvent(ownerInbox, 'time_off_requested', /Sam Staff.*2026-12-24.*2026-12-26/));
  assert.ok(hasEvent(await inbox(manager.cookie, business.id), 'time_off_requested'));
  assert.ok(hasEvent(await inbox(manager2.cookie, business.id), 'time_off_requested'));
  assert.ok(!hasEvent(await inbox(staff.cookie, business.id), 'time_off_requested'), 'the requester is not notified');
  assert.ok(!hasEvent(await inbox(bystander.cookie, business.id), 'time_off_requested'), 'other staff are not notified');
});

test('time-off submitted: a manager\u2019s request rings the owner only', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('inbox-off2@example.com');
  const manager = await addTeamMember(business, owner.id, 'inbox-off2-mgr@example.com', { manager: true });
  const manager2 = await addTeamMember(business, owner.id, 'inbox-off2-mgr2@example.com', {
    manager: true,
    name: 'Marta Manager',
  });
  const staff = await addTeamMember(business, owner.id, 'inbox-off2-staff@example.com');

  const submitted = await req(`${WF(business.id)}/time-off`, {
    method: 'POST',
    body: { start_date: '2027-01-05', end_date: '2027-01-06', reason: 'Rest' },
    cookie: manager.cookie,
  });
  assert.equal(submitted.status, 201);

  assert.ok(hasEvent(await inbox(ownerCookie, business.id), 'time_off_requested', /Manny Manager/));
  assert.ok(!hasEvent(await inbox(manager2.cookie, business.id), 'time_off_requested'), 'other managers are not notified');
  assert.ok(!hasEvent(await inbox(staff.cookie, business.id), 'time_off_requested'));
  assert.ok(!hasEvent(await inbox(manager.cookie, business.id), 'time_off_requested'));
});

test('time-off decided: the requester is notified with the status and the reason', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('inbox-off3@example.com');
  const manager = await addTeamMember(business, owner.id, 'inbox-off3-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'inbox-off3-staff@example.com');

  const staffReq = await req(`${WF(business.id)}/time-off`, {
    method: 'POST',
    body: { start_date: '2026-12-24', end_date: '2026-12-26', reason: 'Family' },
    cookie: staff.cookie,
  });
  const declined = await req(`${WF(business.id)}/time-off/${staffReq.json.request.id}`, {
    method: 'PATCH',
    body: { status: 'declined', decision_reason: 'We are short that week.' },
    cookie: manager.cookie,
  });
  assert.equal(declined.status, 200);
  const staffInbox = await inbox(staff.cookie, business.id);
  assert.ok(hasEvent(staffInbox, 'time_off_decided', /declined/));
  assert.ok(hasEvent(staffInbox, 'time_off_decided', /We are short that week\./));

  const mgrReq = await req(`${WF(business.id)}/time-off`, {
    method: 'POST',
    body: { start_date: '2027-02-01', end_date: '2027-02-02', reason: 'Rest' },
    cookie: manager.cookie,
  });
  const approved = await req(`${WF(business.id)}/time-off/${mgrReq.json.request.id}`, {
    method: 'PATCH',
    body: { status: 'approved', decision_reason: 'Enjoy!' },
    cookie: ownerCookie,
  });
  assert.equal(approved.status, 200);
  const mgrInbox = await inbox(manager.cookie, business.id);
  assert.ok(hasEvent(mgrInbox, 'time_off_decided', /approved/));
  assert.ok(hasEvent(mgrInbox, 'time_off_decided', /Enjoy!/));
});

test('tasks: assignment rings the assignee; finishing rings the assigner only', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('inbox-tasks@example.com');
  const manager = await addTeamMember(business, owner.id, 'inbox-tasks-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'inbox-tasks-staff@example.com');

  const created = await req(`${WF(business.id)}/tasks`, {
    method: 'POST',
    body: { staff_member_id: staff.staffId, title: 'Face the book wall', due_date: '2026-11-20' },
    cookie: manager.cookie,
  });
  assert.equal(created.status, 201);
  assert.ok(hasEvent(await inbox(staff.cookie, business.id), 'task_assigned', /Face the book wall/));
  assert.ok(!hasEvent(await inbox(ownerCookie, business.id), 'task_assigned'));

  const done = await req(`${WF(business.id)}/tasks/${created.json.task.id}`, {
    method: 'PATCH',
    body: { status: 'done' },
    cookie: staff.cookie,
  });
  assert.equal(done.status, 200);
  assert.ok(hasEvent(await inbox(manager.cookie, business.id), 'task_done', /Face the book wall/));
  assert.ok(!hasEvent(await inbox(ownerCookie, business.id), 'task_done'), 'only the assigner is rung');

  // The owner's own assignment rings the owner when it is finished.
  const ownerTask = await req(`${WF(business.id)}/tasks`, {
    method: 'POST',
    body: { staff_member_id: staff.staffId, title: 'Count the register drawer' },
    cookie: ownerCookie,
  });
  assert.equal(ownerTask.status, 201);
  await req(`${WF(business.id)}/tasks/${ownerTask.json.task.id}`, {
    method: 'PATCH',
    body: { status: 'done' },
    cookie: staff.cookie,
  });
  assert.ok(hasEvent(await inbox(ownerCookie, business.id), 'task_done', /Count the register drawer/));
});

test('stub pushed: the recipient is notified, and only once it is pushed', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('inbox-stub@example.com');
  const manager = await addTeamMember(business, owner.id, 'inbox-stub-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'inbox-stub-staff@example.com');

  await req(`${WF(business.id)}/payroll/config`, {
    method: 'PUT',
    body: { federal_pct: 0, state_pct: 0, social_security_pct: 0, medicare_pct: 0, custom_deductions: [] },
    cookie: ownerCookie,
  });
  await req(`${WF(business.id)}/payroll/profiles/${staff.staffId}`, {
    method: 'PUT',
    body: { pay_type: 'hourly', hourly_rate: 15 },
    cookie: ownerCookie,
  });
  const run = await req(`${WF(business.id)}/payroll/runs`, {
    method: 'POST',
    body: { period_start: '2026-01-04', period_end: '2026-01-17', adjustments: {} },
    cookie: ownerCookie,
  });
  assert.equal(run.status, 201);
  const stub = run.json.stubs.find((s) => s.staff_member_id === staff.staffId);
  assert.ok(stub);
  assert.ok(!hasEvent(await inbox(staff.cookie, business.id), 'stub_pushed'), 'an unpushed stub is silent');

  const pushed = await req(`${WF(business.id)}/payroll/stubs/${stub.id}/push`, {
    method: 'POST',
    body: {},
    cookie: manager.cookie,
  });
  assert.equal(pushed.status, 200);
  assert.ok(hasEvent(await inbox(staff.cookie, business.id), 'stub_pushed', /2026-01-04.*2026-01-17/));
});

test('schedule set: the person scheduled is notified', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('inbox-sched@example.com');
  const manager = await addTeamMember(business, owner.id, 'inbox-sched-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'inbox-sched-staff@example.com');
  const staff2 = await addTeamMember(business, owner.id, 'inbox-sched-staff2@example.com', { name: 'Sue Staff' });

  const byOwner = await req(`${WF(business.id)}/schedules/${staff.staffId}`, {
    method: 'PUT',
    body: { shifts: [{ weekday: 1, start_time: '09:00', end_time: '17:00' }] },
    cookie: ownerCookie,
  });
  assert.equal(byOwner.status, 200);
  assert.ok(hasEvent(await inbox(staff.cookie, business.id), 'schedule_set', /Owner/));
  assert.ok(!hasEvent(await inbox(staff2.cookie, business.id), 'schedule_set'));

  const byManager = await req(`${WF(business.id)}/schedules/${staff2.staffId}`, {
    method: 'PUT',
    body: { shifts: [{ weekday: 2, start_time: '10:00', end_time: '18:00' }] },
    cookie: manager.cookie,
  });
  assert.equal(byManager.status, 200);
  assert.ok(hasEvent(await inbox(staff2.cookie, business.id), 'schedule_set', /Manny Manager/));
});

// ---- Part B: messaging -------------------------------------------------------

test('messaging: start, post, bell, unread counts and mark-read', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('inbox-msg@example.com');
  const staff = await addTeamMember(business, owner.id, 'inbox-msg-staff@example.com');

  const created = await req(`${MSG(business.id)}/threads`, {
    method: 'POST',
    body: { staff_member_id: staff.staffId },
    cookie: ownerCookie,
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.created, true);
  const threadId = created.json.thread.id;
  assert.equal(created.json.thread.other.full_name ?? created.json.thread.other.name, 'Sam Staff');

  // Get-or-create from the other side finds the SAME thread.
  const again = await req(`${MSG(business.id)}/threads`, {
    method: 'POST',
    body: { with_owner: true },
    cookie: staff.cookie,
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.created, false);
  assert.equal(again.json.thread.id, threadId);
  assert.equal(again.json.thread.other.name, 'Owner');

  // You cannot message yourself; an empty message is refused.
  const self = await req(`${MSG(business.id)}/threads`, {
    method: 'POST',
    body: { with_owner: true },
    cookie: ownerCookie,
  });
  assert.equal(self.status, 400);
  const empty = await req(`${MSG(business.id)}/threads/${threadId}/messages`, {
    method: 'POST',
    body: { body: '   ' },
    cookie: staff.cookie,
  });
  assert.equal(empty.status, 400);

  // Staff posts: the owner's unread count and bell both move.
  const posted = await req(`${MSG(business.id)}/threads/${threadId}/messages`, {
    method: 'POST',
    body: { body: 'The new bookmarks are on the counter.' },
    cookie: staff.cookie,
  });
  assert.equal(posted.status, 201);
  assert.equal(posted.json.message.mine, true);

  const ownerUnread = await req(`${MSG(business.id)}/unread`, { cookie: ownerCookie });
  assert.equal(ownerUnread.json.unread, 1);
  assert.ok(hasEvent(await inbox(ownerCookie, business.id), 'message', /Sam Staff/));
  const staffUnread = await req(`${MSG(business.id)}/unread`, { cookie: staff.cookie });
  assert.equal(staffUnread.json.unread, 0, 'your own message is never unread for you');

  const ownerList = await req(`${MSG(business.id)}/threads`, { cookie: ownerCookie });
  const ownerThread = ownerList.json.threads.find((t) => t.id === threadId);
  assert.equal(ownerThread.unread, 1);
  assert.equal(ownerThread.last_message.body, 'The new bookmarks are on the counter.');
  assert.equal(ownerList.json.unread_total, 1);

  // Reading the thread shows both directions; mark-read clears the count.
  const view = await req(`${MSG(business.id)}/threads/${threadId}`, { cookie: ownerCookie });
  assert.equal(view.status, 200);
  assert.equal(view.json.messages.length, 1);
  assert.equal(view.json.messages[0].mine, false);
  const read = await req(`${MSG(business.id)}/threads/${threadId}/read`, {
    method: 'PATCH',
    body: {},
    cookie: ownerCookie,
  });
  assert.equal(read.status, 200);
  assert.equal(read.json.unread, 0);
  const afterRead = await req(`${MSG(business.id)}/unread`, { cookie: ownerCookie });
  assert.equal(afterRead.json.unread, 0);

  // The reply direction works and reads back in order.
  await req(`${MSG(business.id)}/threads/${threadId}/messages`, {
    method: 'POST',
    body: { body: 'Thank you!' },
    cookie: ownerCookie,
  });
  const staffView = await req(`${MSG(business.id)}/threads/${threadId}`, { cookie: staff.cookie });
  assert.equal(staffView.json.messages.length, 2);
  assert.equal(staffView.json.messages[0].mine, true);
  assert.equal(staffView.json.messages[1].mine, false);
  assert.equal(staffView.json.messages[1].body, 'Thank you!');
});

test('messaging privacy: non-participants get 403 everywhere; the owner reads but cannot post', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('inbox-priv@example.com');
  const manager = await addTeamMember(business, owner.id, 'inbox-priv-mgr@example.com', { manager: true });
  const staffA = await addTeamMember(business, owner.id, 'inbox-priv-a@example.com', { name: 'Ana Staff' });
  const staffB = await addTeamMember(business, owner.id, 'inbox-priv-b@example.com', { name: 'Ben Staff' });

  // Ana starts a conversation with the manager; Ben is not in it.
  const created = await req(`${MSG(business.id)}/threads`, {
    method: 'POST',
    body: { staff_member_id: manager.staffId },
    cookie: staffA.cookie,
  });
  assert.equal(created.status, 201);
  const threadId = created.json.thread.id;
  await req(`${MSG(business.id)}/threads/${threadId}/messages`, {
    method: 'POST',
    body: { body: 'Can I swap my Saturday shift?' },
    cookie: staffA.cookie,
  });

  // Ben: cannot read, cannot post, cannot mark read, cannot even see it listed.
  const benRead = await req(`${MSG(business.id)}/threads/${threadId}`, { cookie: staffB.cookie });
  assert.equal(benRead.status, 403);
  const benPost = await req(`${MSG(business.id)}/threads/${threadId}/messages`, {
    method: 'POST',
    body: { body: 'sneaking in' },
    cookie: staffB.cookie,
  });
  assert.equal(benPost.status, 403);
  const benMark = await req(`${MSG(business.id)}/threads/${threadId}/read`, {
    method: 'PATCH',
    body: {},
    cookie: staffB.cookie,
  });
  assert.equal(benMark.status, 403);
  const benList = await req(`${MSG(business.id)}/threads`, { cookie: staffB.cookie });
  assert.ok(!benList.json.threads.some((t) => t.id === threadId), 'the thread is invisible to non-participants');

  // The manager is a participant: unread 1 before the owner looks in.
  const mgrUnreadBefore = await req(`${MSG(business.id)}/unread`, { cookie: manager.cookie });
  assert.equal(mgrUnreadBefore.json.unread, 1);

  // Owner oversight: lists it, reads it — flagged as oversight, not theirs.
  const ownerList = await req(`${MSG(business.id)}/threads`, { cookie: ownerCookie });
  const oversight = ownerList.json.threads.find((t) => t.id === threadId);
  assert.ok(oversight, 'the owner sees every thread in their business');
  assert.equal(oversight.oversight, true);
  assert.equal(oversight.can_post, false);
  const ownerRead = await req(`${MSG(business.id)}/threads/${threadId}`, { cookie: ownerCookie });
  assert.equal(ownerRead.status, 200);
  assert.equal(ownerRead.json.messages.length, 1);
  assert.equal(ownerRead.json.messages[0].body, 'Can I swap my Saturday shift?');

  // …but the owner cannot post in it, and cannot mark it read.
  const ownerPost = await req(`${MSG(business.id)}/threads/${threadId}/messages`, {
    method: 'POST',
    body: { body: 'jumping in' },
    cookie: ownerCookie,
  });
  assert.equal(ownerPost.status, 403);
  const ownerMark = await req(`${MSG(business.id)}/threads/${threadId}/read`, {
    method: 'PATCH',
    body: {},
    cookie: ownerCookie,
  });
  assert.equal(ownerMark.status, 403);

  // The oversight look-in changed nothing for the participants.
  const mgrUnreadAfter = await req(`${MSG(business.id)}/unread`, { cookie: manager.cookie });
  assert.equal(mgrUnreadAfter.json.unread, 1, 'an owner read never marks a participant\u2019s messages read');
  const mgrView = await req(`${MSG(business.id)}/threads/${threadId}`, { cookie: manager.cookie });
  assert.equal(mgrView.json.messages.length, 1, 'no message was added by the blocked posts');
});
