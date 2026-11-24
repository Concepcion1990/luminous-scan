import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { Scale } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { varianceRows } from '@/lib/restaurantOps';
import { t } from '@/lib/i18n';

/**
 * Variance (release 361, Nov 23, 2026): per product, what
 * the recipes say should have left the shelf — the
 * theoretical column — beside staff meals, the waste log,
 * and everything else that went out. The unexplained column
 * is what is left: the gap to go and explain.
 */
export default function RestaurantVariance() {
  const { activeId } = useBusiness();
  const [movements, setMovements] = useState([]);
  const [waste, setWaste] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    (async () => {
      const [movementPage, wastePage] = await Promise.all([
        base44.entities.StockMovement.filter(scoped({}, activeId), { sort: '-created_date', limit: 2000 }),
        base44.entities.WasteEntry.filter(scoped({}, activeId), { sort: '-created_date', limit: 1000 }),
      ]);
      setMovements(movementPage.items ?? []);
      setWaste(wastePage.items ?? []);
      setLoading(false);
    })();
  }, [activeId]);

  const rows = useMemo(
    () => varianceRows(movements, waste, { from, to }),
    [movements, waste, from, to]
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('restaurant.eyebrow')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('variance.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('variance.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="space-y-1.5">
          <Label>{t('menu.fromLabel')}</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t('menu.toLabel')}</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <Scale className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('variance.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('variance.emptyBody')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-3 py-2 font-medium">{t('variance.colProduct')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('variance.colTheoretical')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('variance.colStaffMeals')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('variance.colWaste')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('variance.colOther')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('variance.colTotal')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('variance.colUnexplained')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product_id || row.name} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2 text-right">{row.theoretical}</td>
                  <td className="px-3 py-2 text-right">{row.staffMeal}</td>
                  <td className="px-3 py-2 text-right">{row.waste}</td>
                  <td className="px-3 py-2 text-right">{row.otherOut}</td>
                  <td className="px-3 py-2 text-right">{row.totalOut}</td>
                  <td className="px-3 py-2 text-right font-medium">{row.unexplained}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
