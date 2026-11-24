import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { CalendarClock, Check, Plus, Printer } from 'lucide-react';
import BatchStockDialog from '@/components/restaurant/BatchStockDialog';
import DateLabelDoc from '@/components/print/DateLabelDoc';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import { scoped } from '@/lib/scoped';
import { resolveDocStyle } from '@/lib/docStyle';
import { formatShortDate } from '@/lib/dates';
import { daysUntilExpiry, expiringSoon, fefoOrder } from '@/lib/restaurantOps';
import { t } from '@/lib/i18n';

/**
 * Expiry & FEFO (release 361, Nov 23, 2026): stock batches
 * in first-expired, first-out order, what is about to run
 * out of date called out at the top, and a date label for
 * every batch — tick the batches, print the labels. Adding
 * a batch rides the restaurant.build tick; the list itself
 * is free for the whole team to read.
 */
export default function RestaurantExpiry() {
  const { activeId, record, profile } = useBusiness();
  const { can: canStaff } = useStaffAccess();
  const [batches, setBatches] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const [selected, setSelected] = useState([]);
  const [printing, setPrinting] = useState(false);

  const canBuild = canStaff('restaurant.build');
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);

  useEffect(() => {
    (async () => {
      const [batchPage, productPage, locPage] = await Promise.all([
        base44.entities.StockBatch.filter(scoped({}, activeId), { limit: 500 }),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      ]);
      setBatches(batchPage.items ?? []);
      setProducts(productPage.items ?? []);
      setLocations(locPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const ordered = useMemo(() => fefoOrder(batches), [batches]);
  const soon = useMemo(() => expiringSoon(batches, 7), [batches]);
  const soonIds = useMemo(() => new Set(soon.map((batch) => batch.id)), [soon]);
  const printBatches = ordered.filter((batch) => selected.includes(batch.id));

  const toggle = (id) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const printLabels = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 50);
  };

  const remove = async (batch) => {
    if (!window.confirm(t('batch.deleteConfirm', { name: batch.product_name }))) return;
    await base44.entities.StockBatch.delete(batch.id);
    setFlash(t('batch.deleted', { name: batch.product_name }));
    setReload((n) => n + 1);
  };

  const dayNote = (batch) => {
    const days = daysUntilExpiry(batch);
    if (days == null) return '';
    if (days < 0) return t('ops.expiry.expiredDays', { count: Math.abs(days) });
    if (days === 0) return t('ops.expiry.expiresToday');
    return t('ops.expiry.daysLeft', { count: days });
  };

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('ops.expiry.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('ops.expiry.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!printBatches.length} onClick={printLabels}>
            <Printer className="mr-1.5 h-4 w-4" /> {t('ops.expiry.printLabels', { count: printBatches.length })}
          </Button>
          {canBuild ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> {t('batch.newButton')}
            </Button>
          ) : null}
        </div>
      </div>

      {flash && (
        <p className="no-print flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      <div className="no-print space-y-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
        ) : batches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{t('ops.expiry.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('ops.expiry.emptyBody')}</p>
          </div>
        ) : (
          <>
            {soon.length ? (
              <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
                {t('ops.expiry.soonLine', { count: soon.length })}
              </p>
            ) : null}
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="px-3 py-2" />
                    <th className="px-3 py-2 font-medium">{t('ops.expiry.colProduct')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.expiry.colLocation')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('ops.expiry.colQuantity')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.expiry.colReceived')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.expiry.colUseBy')}</th>
                    {canBuild ? <th className="px-3 py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((batch) => (
                    <tr key={batch.id} className={`border-b border-border/60 last:border-0 ${soonIds.has(batch.id) ? 'bg-warn/5' : ''}`}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selected.includes(batch.id)}
                          onChange={() => toggle(batch.id)}
                          aria-label={t('ops.expiry.selectLabel', { name: batch.product_name })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {batch.product_name}
                        {batch.note ? <span className="block text-xs text-muted-foreground">{batch.note}</span> : null}
                      </td>
                      <td className="px-3 py-2">{batch.location_name || '—'}</td>
                      <td className="px-3 py-2 text-right">{batch.quantity}</td>
                      <td className="px-3 py-2">{batch.created_date ? formatShortDate(batch.created_date) : ''}</td>
                      <td className="px-3 py-2">
                        {batch.expires_on ? formatShortDate(batch.expires_on) : '—'}
                        {dayNote(batch) ? <span className="block text-xs text-muted-foreground">{dayNote(batch)}</span> : null}
                      </td>
                      {canBuild ? (
                        <td className="px-3 py-2 text-right">
                          <Button variant="ghost" size="sm" onClick={() => remove(batch)}>
                            {t('recipes.deleteButton')}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {printing && printBatches.length ? (
        <div className="print-area hidden print:block">
          <DateLabelDoc batches={printBatches} business={record} docStyle={docStyle} />
        </div>
      ) : null}

      <BatchStockDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        products={products}
        locations={locations}
        onSaved={(text) => {
          setFlash(text);
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}
