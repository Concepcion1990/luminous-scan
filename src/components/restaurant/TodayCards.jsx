import { Link } from 'react-router-dom';
import { Ban, CalendarClock, ClipboardCheck, NotebookPen, Thermometer } from 'lucide-react';
import { t } from '@/lib/i18n';

/**
 * The Today page's attention cards (release 377): one card
 * per thing that has something to say this morning, each a
 * door straight to its feature (one tap from home). A card
 * renders only when its section of the summary carries real
 * data — the summary is computed from the feature pages' own
 * rows by summarizeToday (src/lib/restaurantShelves.js), so
 * a card never claims a fact that is not there. When nothing
 * has anything to say, the page shows the all-clear line
 * instead of empty cards.
 *
 * Later releases slot their cards into this same row —
 * checklists status, the log book's latest, today's
 * reservations and events, yesterday's prime cost — by
 * extending the summary and adding a card here.
 */
function Card({ to, icon: Icon, title, children }) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:bg-muted/40"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        {children}
      </span>
    </Link>
  );
}

export default function TodayCards({ summary }) {
  const cards = [];

  if (summary.outNow.length) {
    cards.push(
      <Card key="out" to="/restaurant/86" icon={Ban} title={t('nav.eightySix')}>
        <span className="block text-xs text-muted-foreground">
          {summary.outNow.map((item) => item.product_name).filter(Boolean).join(' · ')}
        </span>
      </Card>,
    );
  }

  if (summary.temps.known) {
    cards.push(
      <Card key="temps" to="/restaurant/temp-logs" icon={Thermometer} title={t('nav.tempLogs')}>
        {summary.temps.dueUnits.length ? (
          <span className="block text-xs text-muted-foreground">
            {t('restaurant.today.tempsDue', { count: summary.temps.dueUnits.length })}
            {': '}
            {summary.temps.dueUnits.join(' · ')}
          </span>
        ) : (
          <span className="block text-xs text-muted-foreground">{t('restaurant.today.tempsDone')}</span>
        )}
        {summary.temps.outOfRangeToday.length ? (
          <span className="block text-xs font-medium text-destructive">
            {t('restaurant.today.outOfRange', { count: summary.temps.outOfRangeToday.length })}
          </span>
        ) : null}
      </Card>,
    );
  }

  if (summary.expiring.length) {
    cards.push(
      <Card key="expiry" to="/restaurant/expiry" icon={CalendarClock} title={t('nav.expiry')}>
        <span className="block text-xs text-muted-foreground">
          {t('ops.expiry.soonLine', { count: summary.expiring.length })}
        </span>
        <span className="block text-xs text-muted-foreground">
          {summary.expiring.map((batch) => batch.product_name).filter(Boolean).join(' · ')}
        </span>
      </Card>,
    );
  }

  if (summary.runsToday.length) {
    cards.push(
      <Card key="prep" to="/restaurant/prep" icon={NotebookPen} title={t('nav.prep')}>
        <span className="block text-xs text-muted-foreground">
          {t('restaurant.today.runsToday', { count: summary.runsToday.length })}
        </span>
        <span className="block text-xs text-muted-foreground">
          {summary.runsToday.map((run) => run.recipe_name).filter(Boolean).join(' · ')}
        </span>
      </Card>,
    );
  }

  // The log book's latest (release 378): whoever opens next
  // reads the last entry first — its opening words and who
  // wrote it. The book itself is a general feature; the card
  // is a door straight to it.
  if ((summary.logBook || []).length) {
    const latest = summary.logBook[0];
    cards.push(
      <Card key="logbook" to="/log-book" icon={NotebookPen} title={t('nav.logBook')}>
        <span className="block truncate text-xs text-muted-foreground">{latest.body}</span>
        {latest.author_name ? (
          <span className="block text-xs text-muted-foreground">{latest.author_name}</span>
        ) : null}
      </Card>,
    );
  }

  // Today's checklists (plan release 369): the general
  // feature's day progress — done of total, or the all-done
  // line — a door straight to the lists.
  if (summary.checklists?.total) {
    cards.push(
      <Card key="checklists" to="/checklists" icon={ClipboardCheck} title={t('nav.checklists')}>
        <span className="block text-xs text-muted-foreground">
          {summary.checklists.done === summary.checklists.total
            ? t('restaurant.today.checklistsAllDone')
            : t('restaurant.today.checklists', { done: summary.checklists.done, total: summary.checklists.total })}
        </span>
      </Card>,
    );
  }

  if (!cards.length) {
    return <p className="text-sm text-muted-foreground">{t('restaurant.today.allClear')}</p>;
  }
  return <div className="grid gap-3 sm:grid-cols-2">{cards}</div>;
}
