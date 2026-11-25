import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { TrendingUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { formatMoney } from '@/lib/inventory';
import { listRecipes } from '@/lib/recipes';
import { menuEngineering } from '@/lib/restaurantOps';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * Menu engineering (release 361, Nov 23, 2026): every dish
 * placed by how much it sold and how much it earned over
 * the period — stars, plowhorses, puzzles and dogs. Margin
 * rides the recipes' server-shaped true cost, so the money
 * columns and the quadrants exist only for the owner and
 * restaurant.money holders; units and revenue show for
 * everyone.
 */
export default function RestaurantMenu() {
  const { activeId, record } = useBusiness();
  const [recipes, setRecipes] = useState([]);
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    (async () => {
      const [recipeList, productPage, movementPage] = await Promise.all([
        listRecipes(activeId || ''),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.StockMovement.filter(scoped({}, activeId), { sort: '-created_date', limit: 2000 }),
      ]);
      setRecipes(recipeList);
      setProducts(productPage.items ?? []);
      setMovements(movementPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId]);

  const rows = useMemo(
    () => menuEngineering(recipes, products, movements, { from, to }),
    [recipes, products, movements, from, to]
  );
  const showMoney = rows.some((row) => row.marginPerUnit != null);

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/menu" />
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('restaurant.eyebrow')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('menu.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('menu.subtitle')}</p>
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
          <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('menu.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('menu.emptyBody')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-3 py-2 font-medium">{t('menu.colDish')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('menu.colUnits')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('menu.colRevenue')}</th>
                {showMoney ? (
                  <>
                    <th className="px-3 py-2 text-right font-medium">{t('menu.colMargin')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('menu.colTotalMargin')}</th>
                    <th className="px-3 py-2 font-medium">{t('menu.colQuadrant')}</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.recipe.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2 text-right">{row.units}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(row.revenue, record?.currency, 2)}</td>
                  {showMoney ? (
                    <>
                      <td className="px-3 py-2 text-right">
                        {row.marginPerUnit != null ? formatMoney(row.marginPerUnit, record?.currency, 2) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.totalMargin != null ? formatMoney(row.totalMargin, record?.currency, 2) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {row.quadrant ? t(`menu.quadrant.${row.quadrant}`) : '—'}
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!showMoney && rows.length ? (
        <p className="text-sm text-muted-foreground">{t('menu.moneyHidden')}</p>
      ) : null}
    </div>
  );
}
