import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { base44 } from '@/api/client';
import { ArrowLeft, Printer } from 'lucide-react';
import RecipeDialog from '@/components/restaurant/RecipeDialog';
import RecipeDoc from '@/components/print/RecipeDoc';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import { scoped } from '@/lib/scoped';
import { formatMoney } from '@/lib/inventory';
import { listRecipes, recipeCostPerMake, recipeCostPerUnit, yieldQtyOf } from '@/lib/recipes';
import { resolveDocStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * One dish, whole (release 359, Nov 23, 2026): its photo,
 * what goes into it, what one make takes off the shelf, and
 * — for the owner and restaurant.money holders only — what
 * it truly costs beside what it sells for. The money figures
 * come off the server-shaped recipe row: for anyone else the
 * row carries no cost figures at all, and this page's own
 * math runs on product costs only when the row says money
 * may be shown. The print view is the dish card itself
 * (Document Style Studio family — preview is print).
 */
export default function RecipeDetail() {
  const { id } = useParams();
  const { activeId, record, profile } = useBusiness();
  const { can: canStaff } = useStaffAccess();
  const [recipe, setRecipe] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const [reload, setReload] = useState(0);

  const canBuild = canStaff('restaurant.build');

  useEffect(() => {
    (async () => {
      const [one, all, productPage, locPage, levelPage] = await Promise.all([
        base44.entities.Recipe.get(id).catch(() => null),
        listRecipes(activeId || ''),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
        base44.entities.StockLevel.filter(scoped({}, activeId), { limit: 2000 }),
      ]);
      setRecipe(one);
      setRecipes(all);
      setProducts(productPage.items ?? []);
      setLocations(locPage.items ?? []);
      setLevels(levelPage.items ?? []);
      setLoading(false);
    })();
  }, [id, activeId, reload]);

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const recipesById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);

  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);

  if (loading) return <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>;
  if (!recipe) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('recipes.notFound')}</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/restaurant"><ArrowLeft className="mr-1.5 h-4 w-4" /> {t('recipes.backToList')}</Link>
        </Button>
      </div>
    );
  }

  const showMoney = recipe.true_cost != null;
  const dish = recipe.product_id ? productsById.get(recipe.product_id) : null;
  const price = dish ? Number(dish.price) || 0 : null;
  const costPerMake = showMoney ? recipeCostPerMake(recipesById, productsById, recipe) : null;
  const trueCost = showMoney ? recipeCostPerUnit(recipesById, productsById, recipe) : null;

  const onHand = (productId) =>
    levels
      .filter((level) => level.product_id === productId)
      .reduce((sum, level) => sum + (Number(level.quantity) || 0), 0);

  // The printed rows: label, a plain detail (a sub-recipe's
  // own yield, an ingredient's yield), the quantity for one
  // make, and — money holders only — the line's cost.
  const rows = (recipe.lines || []).map((line) => {
    if (line.kind === 'recipe') {
      const sub = recipesById.get(line.recipe_id);
      const qty = Number(line.quantity) || 0;
      return {
        label: line.recipe_name || sub?.name || '',
        detail: sub ? t('recipes.detailSubYield', { qty: yieldQtyOf(sub) }) : '',
        qtyText: `${qty}`,
        costText:
          showMoney && sub
            ? formatMoney(qty * (recipeCostPerMake(recipesById, productsById, sub) / yieldQtyOf(sub)), record?.currency, 2)
            : null,
      };
    }
    const product = productsById.get(line.product_id);
    const qty = Number(line.quantity) || 0;
    const yieldPct = Number(line.yield_pct);
    return {
      label: line.product_name || product?.name || '',
      photo_url: product?.photo_urls?.[0] || '',
      detail: [
        line.unit || product?.unit || '',
        Number.isFinite(yieldPct) && yieldPct > 0 && yieldPct < 100
          ? t('recipes.detailYield', { pct: yieldPct })
          : '',
        t('recipes.detailOnHand', { qty: onHand(line.product_id) }),
      ]
        .filter(Boolean)
        .join(' · '),
      qtyText: `${qty} ${line.unit || product?.unit || ''}`.trim(),
      costText:
        showMoney && product
          ? formatMoney((qty * (Number(product.cost) || 0)) / (Number.isFinite(yieldPct) && yieldPct > 0 && yieldPct <= 100 ? yieldPct / 100 : 1), record?.currency, 2)
          : null,
    };
  });

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/recipes" />
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/restaurant"><ArrowLeft className="mr-1.5 h-4 w-4" /> {t('recipes.backToList')}</Link>
        </Button>
        <div className="flex gap-2">
          {canBuild ? (
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              {t('recipes.editButton')}
            </Button>
          ) : null}
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> {t('recipes.printButton')}
          </Button>
        </div>
      </div>

      {flash ? (
        <p className="no-print rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">{flash}</p>
      ) : null}

      <div className="no-print space-y-4">
        <div className="flex flex-wrap items-start gap-4">
          {recipe.photo_url ? (
            <img src={recipe.photo_url} alt="" className="h-28 w-28 rounded-xl object-cover" />
          ) : null}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">{recipe.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {recipe.status === 'active' ? t('recipes.statusActive') : t('recipes.statusDraft')}
              {recipe.location_name ? ` · ${recipe.location_name}` : ''}
              {' · '}
              {t('recipes.detailMakes', { qty: yieldQtyOf(recipe) })}
            </p>
            {dish ? (
              <p className="mt-1 text-sm">
                {t('recipes.cardDish', { name: dish.name })} · {formatMoney(price || 0, record?.currency, 2)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t('recipes.cardNoDish')}</p>
            )}
            {recipe.status === 'active' && dish ? (
              <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('recipes.depletesNote')}</p>
            ) : null}
            {recipe.status !== 'active' ? (
              <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('recipes.draftNote')}</p>
            ) : null}
          </div>
        </div>

        {recipe.description ? <p className="whitespace-pre-line text-sm">{recipe.description}</p> : null}

        {showMoney ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('recipes.priceCard')}</p>
              <p className="mt-1 text-xl font-semibold">{price != null ? formatMoney(price, record?.currency, 2) : '—'}</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('recipes.trueCostCard')}</p>
              <p className="mt-1 text-xl font-semibold">{formatMoney(trueCost || 0, record?.currency, 2)}</p>
              {recipe.food_cost_pct != null ? (
                <p className="text-xs text-muted-foreground">{t('recipes.foodCostCard', { pct: recipe.food_cost_pct })}</p>
              ) : null}
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('recipes.costPerMakeCard')}</p>
              <p className="mt-1 text-xl font-semibold">{formatMoney(costPerMake || 0, record?.currency, 2)}</p>
              {Number(recipe.q_factor_pct) > 0 ? (
                <p className="text-xs text-muted-foreground">{t('recipes.qCard', { pct: recipe.q_factor_pct })}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-3 py-2 font-medium">{t('recipes.colIngredient')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('recipes.colQuantity')}</th>
                {showMoney ? <th className="px-3 py-2 text-right font-medium">{t('recipes.colCost')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    {row.label}
                    {row.detail ? <span className="block text-xs text-muted-foreground">{row.detail}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right">{row.qtyText}</td>
                  {showMoney ? <td className="px-3 py-2 text-right">{row.costText || ''}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="print-area hidden print:block">
        <RecipeDoc
          recipe={recipe}
          business={record}
          docStyle={docStyle}
          rows={rows}
          costPerMake={costPerMake}
          trueCost={trueCost}
          price={price}
          foodCostPct={recipe.food_cost_pct ?? null}
          showMoney={showMoney}
        />
      </div>

      <RecipeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        recipe={recipe}
        recipes={recipes}
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
