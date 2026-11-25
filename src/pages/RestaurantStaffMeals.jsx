import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, Plus, UtensilsCrossed } from 'lucide-react';
import StaffMealDialog from '@/components/restaurant/StaffMealDialog';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { formatShortDate } from '@/lib/dates';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * Staff meals (release 361, Nov 23, 2026): the meals the
 * team ate, on the record. Each one takes its dish off the
 * shelf and depletes the dish's recipe, the same as a sale —
 * staff meals are a real cost of the day, and the accounting
 * export counts them. Anyone on the team can record a meal.
 */
export default function RestaurantStaffMeals() {
  const { activeId } = useBusiness();
  const [meals, setMeals] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    (async () => {
      const [mealPage, productPage, locPage] = await Promise.all([
        base44.entities.StaffMeal.filter(scoped({}, activeId), { sort: '-created_date', limit: 300 }),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      ]);
      setMeals(mealPage.items ?? []);
      setProducts(productPage.items ?? []);
      setLocations(locPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const totalMeals = meals.reduce((sum, meal) => sum + (Number(meal.quantity) || 0), 0);

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/staff-meals" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('staffMeals.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('staffMeals.subtitle')}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('staffMeals.newButton')}
        </Button>
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : meals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <UtensilsCrossed className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('staffMeals.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('staffMeals.emptyBody')}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('staffMeals.totalLine', { count: totalMeals })}</p>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-3 py-2 font-medium">{t('staffMeals.colDate')}</th>
                  <th className="px-3 py-2 font-medium">{t('staffMeals.colDish')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('staffMeals.colMeals')}</th>
                  <th className="px-3 py-2 font-medium">{t('staffMeals.colLocation')}</th>
                  <th className="px-3 py-2 font-medium">{t('staffMeals.colBy')}</th>
                </tr>
              </thead>
              <tbody>
                {meals.map((meal) => (
                  <tr key={meal.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">{meal.created_date ? formatShortDate(meal.created_date) : ''}</td>
                    <td className="px-3 py-2">
                      {meal.product_name}
                      {meal.note ? <span className="block text-xs text-muted-foreground">{meal.note}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right">{meal.quantity}</td>
                    <td className="px-3 py-2">{meal.location_name || '—'}</td>
                    <td className="px-3 py-2">{meal.user_name || meal.created_by || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <StaffMealDialog
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
