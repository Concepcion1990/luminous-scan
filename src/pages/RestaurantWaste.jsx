import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, Plus, Trash2 } from 'lucide-react';
import WasteDialog from '@/components/restaurant/WasteDialog';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { formatMoney } from '@/lib/inventory';
import { formatShortDate } from '@/lib/dates';
import { t } from '@/lib/i18n';

/**
 * The waste log (release 361, Nov 23, 2026): everything the
 * kitchen threw away, with the reason. Anyone on the team
 * can log — the habit dies if it needs permission. The cost
 * column rides the server-shaped rows: unit cost and totals
 * exist only for the owner and restaurant.money holders, so
 * the column itself appears only when a row carries them.
 */
export default function RestaurantWaste() {
  const { activeId, record } = useBusiness();
  const [entries, setEntries] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    (async () => {
      const [entryPage, productPage, locPage] = await Promise.all([
        base44.entities.WasteEntry.filter(scoped({}, activeId), { sort: '-created_date', limit: 300 }),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      ]);
      setEntries(entryPage.items ?? []);
      setProducts(productPage.items ?? []);
      setLocations(locPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const showMoney = entries.some((entry) => entry.total_cost != null);
  const totalCost = showMoney
    ? entries.reduce((sum, entry) => sum + (Number(entry.total_cost) || 0), 0)
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('ops.waste.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('ops.waste.subtitle')}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('ops.waste.newButton')}
        </Button>
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <Trash2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('ops.waste.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('ops.waste.emptyBody')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-3 py-2 font-medium">{t('ops.waste.colDate')}</th>
                <th className="px-3 py-2 font-medium">{t('ops.waste.colProduct')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('ops.waste.colQuantity')}</th>
                <th className="px-3 py-2 font-medium">{t('ops.waste.colReason')}</th>
                <th className="px-3 py-2 font-medium">{t('ops.waste.colLocation')}</th>
                {showMoney ? <th className="px-3 py-2 text-right font-medium">{t('ops.waste.colCost')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">{entry.created_date ? formatShortDate(entry.created_date) : ''}</td>
                  <td className="px-3 py-2">
                    {entry.product_name}
                    {entry.note ? <span className="block text-xs text-muted-foreground">{entry.note}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right">{entry.quantity}</td>
                  <td className="px-3 py-2">{t(`ops.waste.reason.${entry.reason || 'other'}`)}</td>
                  <td className="px-3 py-2">{entry.location_name || '—'}</td>
                  {showMoney ? (
                    <td className="px-3 py-2 text-right">
                      {entry.total_cost != null ? formatMoney(entry.total_cost, record?.currency, 2) : '—'}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            {showMoney ? (
              <tfoot>
                <tr className="bg-muted/40">
                  <td className="px-3 py-2 font-medium" colSpan={5}>{t('ops.waste.totalLabel')}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatMoney(totalCost || 0, record?.currency, 2)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}

      <WasteDialog
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
