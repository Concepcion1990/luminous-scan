/**
 * Time trails (release 357, Nov 23, 2026 — the owner's spec):
 * every record that moves through stages carries a trail of
 * stamps — DATE + TIME on every stamp, and WHO performed each
 * stage (a display name, never an email). The stamps themselves
 * are written by the server at the transition (server/entities.js);
 * this module only reads them back into stage lines.
 *
 * Actor reading, per stage: the payload's `trail_actors` map
 * carries the actor's CURRENT display name, resolved server-side
 * from the stored user id — a non-empty string is that name; an
 * EMPTY string means an actor was recorded but their account is
 * gone, and the line renders the neutral fallback (trail.actorGone)
 * instead of a stale name or a blank; null means no actor id was
 * recorded (a record born before the trail), and the line falls
 * back to the "…by" name stored at the time, where one exists.
 * The created stage has no stored name — the creator field is an
 * email audit key and is never rendered.
 *
 * Stamps render through the app's existing date/time helper
 * (formatPrintedAt — the documents' own parts, fed the reader's
 * locale). No new date format lives here: the "dates the local
 * way" build sweeps this rendering centrally with all the rest.
 */
import { formatPrintedAt } from '@/lib/docStyle';
import { getLocale, t } from '@/lib/i18n';
import { COUNT_STATUS } from '@/lib/counts';
import { ORDER_STATUS } from '@/lib/orders';
import { RETURN_STATUS } from '@/lib/returns';

export function formatTrailStamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = formatPrintedAt(date, getLocale());
  return `${parts.date} · ${parts.time}`;
}

function actorFor(record, key, storedBy) {
  const resolved = record.trail_actors?.[key];
  if (typeof resolved === 'string') {
    return resolved === '' ? t('trail.actorGone') : resolved;
  }
  return storedBy || '';
}

const stage = (key, label, at, actor) => ({ key, label, at, actor });
const withStamps = (stages) => stages.filter((s) => Boolean(s.at));

export function orderTrail(order) {
  if (!order) return [];
  return withStamps([
    stage('created', t('trail.created'), order.created_date, actorFor(order, 'created')),
    stage('packed', ORDER_STATUS.packed.label, order.packed_at, actorFor(order, 'packed', order.packed_by)),
    stage('shipped', ORDER_STATUS.shipped.label, order.shipped_at, actorFor(order, 'shipped', order.shipped_by)),
    stage('delivered', ORDER_STATUS.delivered.label, order.delivered_at, actorFor(order, 'delivered', order.delivered_by)),
    stage('cancelled', ORDER_STATUS.cancelled.label, order.cancelled_at, actorFor(order, 'cancelled', order.cancelled_by)),
  ]);
}

export function returnTrail(ret) {
  if (!ret) return [];
  return withStamps([
    stage('created', t('trail.logged'), ret.created_date, actorFor(ret, 'created')),
    stage('approved', RETURN_STATUS.approved.label, ret.approved_at, actorFor(ret, 'approved', ret.approved_by)),
    stage('completed', RETURN_STATUS.completed.label, ret.completed_at, actorFor(ret, 'completed', ret.completed_by)),
    stage('rejected', RETURN_STATUS.rejected.label, ret.rejected_at, actorFor(ret, 'rejected', ret.rejected_by)),
  ]);
}

export function countTrail(session) {
  if (!session) return [];
  return withStamps([
    stage('created', t('trail.created'), session.created_date, actorFor(session, 'created')),
    stage('saved', t('trail.saved'), session.saved_at, actorFor(session, 'saved', session.saved_by)),
    stage('review', t('trail.sentForReview'), session.review_at, actorFor(session, 'review', session.review_by)),
    stage('applied', COUNT_STATUS.applied.label, session.applied_at, actorFor(session, 'applied', session.applied_by)),
    stage('cancelled', COUNT_STATUS.cancelled.label, session.cancelled_at, actorFor(session, 'cancelled', session.cancelled_by)),
  ]);
}
