import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/client';
import { ArrowLeft, ChefHat, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { listRecipes, yieldQtyOf } from '@/lib/recipes';
import { normalizeBatchCount, recipeSteps, scaledLines } from '@/lib/kitchenMenu';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * The kitchen recipe display (plan release 371, Nov 26, 2026;
 * Gap 12): a big, readable station view of ONE recipe — its
 * photo, its steps, and its amounts, which rescale by batch
 * count in one tap. The cook picks how many batches; every
 * amount follows (src/lib/kitchenMenu.js scaledLines). No
 * money ever shows here — a station screen is for cooking.
 * Lives on the Kitchen & Recipes shelf, Business-only like
 * the whole corner.
 */
export default function RestaurantKitchenDisplay() {
  const { activeId } = useBusiness();
  const [recipes, setRecipes] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [batches, setBatches] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [recipeList, productPage] = await Promise.all([
        listRecipes(activeId || ''),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
      ]);
      setRecipes(recipeList);
      setProducts(productPage.items ?? []);
      if (recipeList.length) setSelectedId((cur) => cur || recipeList[0].id);
      setLoading(false);
    })();
  }, [activeId]);

  const recipe = useMemo(() => recipes.find((r) => r.id === selectedId) || null, [recipes, selectedId]);
  const recipesById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const count = normalizeBatchCount(batches);
  const rows = useMemo(
    () => (recipe ? scaledLines(recipe, recipesById, productsById, count) : []),
    [recipe, recipesById, productsById, count],
  );
  const steps = useMemo(() => (recipe ? recipeSteps(recipe) : []), [recipe]);

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/kitchen-display" />
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t('restaurant.eyebrow')}</p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('kitchen.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('kitchen.subtitle')}</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : recipes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <ChefHat className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('kitchen.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('kitchen.emptyBody')}</p>
        </div>
      ) : (
        <>
          <div className="no-print flex flex-wrap gap-2">
            {recipes.map((r) => (
              <Button
                key={r.id}
                variant={r.id === selectedId ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setSelectedId(r.id); setBatches(1); }}
              >
                {r.name}
              </Button>
            ))}
          </div>

          {recipe ? (
            <div className="rounded-2xl border border-border bg-card p-5 sm:p-8">
              <div className="flex flex-wrap items-start gap-5">
                {recipe.photo_url ? (
                  <img src={recipe.photo_url} alt="" className="h-36 w-36 rounded-2xl object-cover sm:h-48 sm:w-48" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <h2 className="text-3xl font-bold sm:text-4xl">{recipe.name}</h2>
                  <p className="mt-2 text-lg text-muted-foreground">{t('kitchen.makesLabel', { qty: yieldQtyOf(recipe) * count })}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <span className="text-base font-medium">{t('kitchen.batchesLabel')}</span>
                    <Button variant="outline" size="icon" aria-label="-" onClick={() => setBatches(Math.max(1, count - 1))}>
                      <Minus className="h-5 w-5" />
                    </Button>
                    <span className="min-w-10 text-center text-3xl font-bold">{count}</span>
                    <Button variant="outline" size="icon" aria-label="+" onClick={() => setBatches(Math.min(99, count + 1))}>
                      <Plus className="h-5 w-5" />
                    </Button>
                    {[1, 2, 3, 4].map((n) => (
                      <Button key={n} variant={count === n ? 'default' : 'ghost'} size="sm" onClick={() => setBatches(n)}>
                        ×{n}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{t('kitchen.amountsFor', { count })}</p>
                </div>
              </div>

              <h3 className="mt-8 text-xl font-semibold">{t('kitchen.ingredientsTitle')}</h3>
              <ul className="mt-3 divide-y divide-border">
                {rows.map((row, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-4 py-3">
                    <span className="text-xl sm:text-2xl">{row.label}</span>
                    <span className="text-xl font-semibold sm:text-2xl">{row.qtyText}</span>
                  </li>
                ))}
              </ul>

              <h3 className="mt-8 text-xl font-semibold">{t('kitchen.stepsTitle')}</h3>
              {steps.length ? (
                <ol className="mt-3 list-decimal space-y-3 pl-6">
                  {steps.map((step, i) => (
                    <li key={i} className="text-lg leading-relaxed sm:text-xl">{step}</li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-base text-muted-foreground">{t('kitchen.noSteps')}</p>
              )}
            </div>
          ) : null}

          <Button asChild variant="ghost" size="sm">
            <Link to="/restaurant/recipes"><ArrowLeft className="mr-1.5 h-4 w-4" /> {t('kitchen.backButton')}</Link>
          </Button>
        </>
      )}
    </div>
  );
}
