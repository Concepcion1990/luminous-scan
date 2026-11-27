import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { fetchChecklistToday } from '@/lib/checklists';
import { t } from '@/lib/i18n';

/**
 * Today's checklists on the business home (plan release
 * 369, Nov 26, 2026): the day's progress at a glance — how
 * many of today's checklist items are done — one tap from
 * the full lists. The card renders only when the business
 * actually has checklists running today: no placeholder
 * ever claims a fact that is not there (the Restaurant
 * Today cards' rule, carried to the general home).
 */
export default function ChecklistsTodayCard({ businessId }) {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!businessId) return undefined;
    fetchChecklistToday(businessId)
      .then((view) => {
        if (alive) setSummary(view?.summary ?? null);
      })
      .catch(() => {
        if (alive) setSummary(null);
      });
    return () => {
      alive = false;
    };
  }, [businessId]);

  if (!summary || !summary.total) return null;
  return (
    <Link
      to="/checklists"
      className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:bg-muted/40"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <ClipboardList className="h-5 w-5 text-muted-foreground" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{t('checklists.todayTitle')}</span>
        <span className="block text-xs text-muted-foreground">
          {summary.done === summary.total
            ? t('checklists.allDone')
            : t('checklists.progress', { done: summary.done, total: summary.total })}
        </span>
      </span>
    </Link>
  );
}
