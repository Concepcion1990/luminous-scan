import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { BookOpen, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import { scoped } from '@/lib/scoped';
import { EXPORTS, exportDataset } from '@/lib/exportData';
import { formatMoney } from '@/lib/inventory';
import { listRecipes } from '@/lib/recipes';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * The accounting export (release 361, Nov 23, 2026): one
 * ledger for the period — purchases received, waste, staff
 * meals and recipe depletion — downloaded through the app's
 * export machinery as the restaurantLedger dataset. The
 * on-screen totals follow the same rule as everywhere: a
 * section's money shows only when the rows behind it carry
 * money for this viewer (the money tick), and the download
 * itself is built server-side under the same shaping.
 */
export default function RestaurantLedger() {
  const { activeId, record, profile } = useBusiness();
  const { can: canStaff } = useStaffAccess();
  const [orders, setOrders] = useState([]);
  const [waste, setWaste] = useState([]);
  const [meals, setMeals] = useState([]);
  const [movements, setMovements] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState('');

  const canMoney = canStaff('restaurant.money');
  const dataset = useMemo(() => EXPORTS.find((entry) => entry.id === 'restaurantLedger'), []);

  useEffect(() => {
    (async () => {
      const [poPage, wastePage, mealPage, movementPage, recipeList, productPage] = await Promise.all([
        base44.entities.PurchaseOrder.filter(scoped({}, activeId), { limit: 300 }),
        base44.entities.WasteEntry.filter(scoped({}, activeId), { limit: 1000 }),
        base44.entities.StaffMeal.filter(scoped({}, activeId), { limit: 1000 }),
        base44.entities.StockMovement.filter(scoped({}, activeId), { sort: '-created_date', limit: 2000 }),
        listRecipes(activeId || ''),
        base44.entities.Product.filter(scoped({}, activeId), { limit: 500 }),
      ]);
      setOrders(poPage.items ?? []);
      setWaste(wastePage.items ?? []);
      setMeals(mealPage.items ?? []);
      setMovements(movementPage.items ?? []);
      setRecipes(recipeList);
      setProducts(productPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId]);

  const inRange = (row) => {
    const day = String(row?.created_date || '').slice(0, 10);
    if (from && (!day || day < from)) return false;
    if (to && (!day || day > to)) return false;
    return true;
  };

  const totals = useMemo(() => {
    const purchases = orders
      .filter(inRange)
      .reduce(
        (sum, po) =>
          sum +
          (po.lines || []).reduce(
            (lineSum, line) =>
              lineSum + (Number(line.qty_received) > 0 ? Number(line.qty_received) * (Number(line.unit_cost) || 0) : 0),
            0
          ),
        0
      );
    const wasteRows = waste.filter(inRange);
    const wasteTotal = wasteRows.some((row) => row.total_cost != null)
      ? wasteRows.reduce((sum, row) => sum + (Number(row.total_cost) || 0), 0)
      : null;
    let mealsTotal = null;
    if (canMoney) {
      const recipeByProduct = new Map(recipes.filter((r) => r.product_id).map((r) => [r.product_id, r]));
      const productById = new Map(products.map((p) => [p.id, p]));
      mealsTotal = meals.filter(inRange).reduce((sum, meal) => {
        const recipe = recipeByProduct.get(meal.product_id);
        const unit = recipe?.true_cost != null ? Number(recipe.true_cost) : Number(productById.get(meal.product_id)?.cost) || 0;
        return sum + unit * (Number(meal.quantity) || 0);
      }, 0);
    }
    const depletion = movements
      .filter((movement) => movement.type === 'consume' && inRange(movement))
      .reduce((sum, movement) => sum + Math.abs(Number(movement.quantity) || 0) * (Number(movement.unit_cost) || 0), 0);
    return {
      purchases: canMoney ? purchases : null,
      waste: wasteTotal,
      meals: mealsTotal,
      depletion: canMoney ? depletion : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, waste, meals, movements, recipes, products, from, to, canMoney]);

  const download = async (format) => {
    if (!dataset) return;
    setBusy(format);
    setError('');
    try {
      const result = await exportDataset(
        dataset,
        { businessId: activeId, businessName: profile?.name || record?.name || '', profile },
        format
      );
      setFlash(t('ledger.downloaded', { count: result.count, filename: result.filename }));
    } catch (e) {
      setError(e.message || t('ledger.downloadFailed'));
    } finally {
      setBusy('');
    }
  };

  const sections = [
    { key: 'purchases', label: t('ledger.sectionPurchases'), total: totals.purchases },
    { key: 'waste', label: t('ledger.sectionWaste'), total: totals.waste },
    { key: 'meals', label: t('ledger.sectionMeals'), total: totals.meals },
    { key: 'depletion', label: t('ledger.sectionDepletion'), total: totals.depletion },
  ];

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/ledger" />
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('restaurant.eyebrow')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('ledger.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('ledger.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>{t('menu.fromLabel')}</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t('menu.toLabel')}</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button disabled={!dataset || busy} onClick={() => download('csv')}>
            <FileDown className="mr-1.5 h-4 w-4" /> {t('ledger.downloadCsv')}
          </Button>
          <Button variant="outline" disabled={!dataset || busy} onClick={() => download('xlsx')}>
            <FileDown className="mr-1.5 h-4 w-4" /> {t('ledger.downloadXlsx')}
          </Button>
        </div>
      </div>
      <p className="max-w-xl text-xs text-muted-foreground">{t('ledger.periodNote')}</p>

      {flash ? (
        <p className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">{flash}</p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sections.map((section) => (
            <div key={section.key} className="rounded-xl border border-border p-4">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" /> {section.label}
              </p>
              <p className="mt-1 text-xl font-semibold">
                {section.total != null ? formatMoney(section.total, record?.currency, 2) : '—'}
              </p>
              {section.total == null ? (
                <p className="text-xs text-muted-foreground">{t('ledger.moneyHidden')}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
