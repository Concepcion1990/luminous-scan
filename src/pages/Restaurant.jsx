import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/client';
import TodayCards from '@/components/restaurant/TodayCards';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { fetchChecklistToday } from '@/lib/checklists';
import { fetchReservationsToday } from '@/lib/reservations';
import { shelvesFor, summarizeToday, visibleDoors } from '@/lib/restaurantShelves';
import { t } from '@/lib/i18n';

/**
 * The Restaurant corner's front door (release 377, Nov 25,
 * 2026 — the build-it-all program's information architecture):
 * a Today page, not a menu. What needs attention this
 * morning — what's 86'd, which temperature units are still
 * to check, what's about to expire, what production already
 * ran — surfaces from the features' own rows, each card a
 * door straight to its feature. Below, the six shelves (plus
 * Locations, only for owners with 2+ businesses) hold every
 * feature, each ≤2 taps from here: shelf → feature, with the
 * doors also named on the shelf cards for a one-tap jump.
 *
 * Before 377 this route was the recipes list; recipes now
 * live at /restaurant/recipes, the Kitchen & Recipes shelf's
 * first door, content and behavior unchanged.
 */
export default function Restaurant() {
  const { activeId, businesses, record } = useBusiness();
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [eightySixPage, tempLogPage, batchPage, runPage, logPage, checklistToday, reservationsToday] = await Promise.all([
        base44.entities.EightySixItem.filter(scoped({}, activeId), { sort: '-created_date', limit: 300 }),
        base44.entities.TempLog.filter(scoped({}, activeId), { sort: '-created_date', limit: 300 }),
        base44.entities.StockBatch.filter(scoped({}, activeId), { limit: 500 }),
        base44.entities.BatchRun.filter(scoped({}, activeId), { sort: '-created_date', limit: 200 }),
        // The manager log book (release 378) is a general
        // feature; its latest entries ride the Today summary
        // like every other source here.
        base44.entities.LogBookEntry.filter(scoped({}, activeId), { sort: '-created_date', limit: 50 }),
        // Checklists (plan release 369) are a general feature
        // too; their day progress rides the Today summary the
        // same way — a failed read simply shows no card.
        fetchChecklistToday(activeId).catch(() => null),
        // Today's reservations (plan release 376) ride the
        // summary the same way — the book's own feed for the
        // reader's local day; a failed read shows no card.
        fetchReservationsToday(activeId, new Date().toLocaleDateString('en-CA')).catch(() => null),
      ]);
      setRows({
        eightySixItems: eightySixPage.items ?? [],
        tempLogs: tempLogPage.items ?? [],
        batches: batchPage.items ?? [],
        batchRuns: runPage.items ?? [],
        logEntries: logPage.items ?? [],
        checklistToday,
        reservationsToday: reservationsToday?.reservations ?? [],
      });
      setLoading(false);
    })();
  }, [activeId]);

  const summary = useMemo(() => (rows ? summarizeToday(rows) : null), [rows]);
  const shelves = shelvesFor(businesses.length);

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('restaurant.eyebrow')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('restaurant.today.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('restaurant.today.subtitle')}</p>
      </div>

      {loading || !summary ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : (
        <TodayCards summary={summary} />
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold">{t('restaurant.shelvesTitle')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shelves.map((shelf) => {
            const Icon = shelf.icon;
            return (
              <div key={shelf.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
                <Link to={shelf.route} className="flex items-center gap-3 hover:underline">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </span>
                  <span className="font-medium">{t(shelf.labelKey)}</span>
                </Link>
                {visibleDoors(shelf, record?.bar_counting_enabled === true).length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {visibleDoors(shelf, record?.bar_counting_enabled === true).map((door) => (
                      <Link
                        key={`${door.to}-${door.titleKey}`}
                        to={door.to}
                        className="rounded-full bg-muted px-2.5 py-1 text-xs hover:bg-muted/70"
                      >
                        {t(door.titleKey)}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
