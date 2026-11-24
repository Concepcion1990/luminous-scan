import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, Wheat } from 'lucide-react';
import ProductKitchenDialog from '@/components/restaurant/ProductKitchenDialog';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import { scoped } from '@/lib/scoped';
import { listRecipes } from '@/lib/recipes';
import { ALLERGENS, dishAllergens, parseAllergens } from '@/lib/restaurantOps';
import { parseUnitConversions } from '@/lib/recipes';
import { t } from '@/lib/i18n';

/**
 * The allergen matrix (release 361, Nov 23, 2026): every
 * dish down the side, the nine major allergens across the
 * top, a mark wherever a dish's ingredients carry one — so
 * a guest's question is answered from the record, not from
 * memory. Below, each product's own allergens, units and
 * shelf life, editable with the restaurant.build tick.
 */
export default function RestaurantAllergens() {
  const { activeId } = useBusiness();
  const { can: canStaff } = useStaffAccess();
  const [recipes, setRecipes] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);

  const canBuild = canStaff('restaurant.build');

  useEffect(() => {
    (async () => {
      const [recipeList, productPage] = await Promise.all([
        listRecipes(activeId || ''),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
      ]);
      setRecipes(recipeList);
      setProducts(productPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const dishRows = useMemo(
    () =>
      recipes.map((recipe) => ({ recipe, allergens: dishAllergens(recipes, products, recipe) })),
    [recipes, products]
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('restaurant.eyebrow')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('allergens.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('allergens.subtitle')}</p>
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : (
        <>
          {dishRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
              <Wheat className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{t('allergens.emptyTitle')}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('allergens.emptyBody')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="px-3 py-2 font-medium">{t('allergens.colDish')}</th>
                    {ALLERGENS.map((key) => (
                      <th key={key} className="px-2 py-2 text-center font-medium">{t(`allergens.${key}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dishRows.map(({ recipe, allergens }) => (
                    <tr key={recipe.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 font-medium">{recipe.name}</td>
                      {ALLERGENS.map((key) => (
                        <td key={key} className="px-2 py-2 text-center">
                          {allergens.includes(key) ? (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                              <Check className="h-3.5 w-3.5" />
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="space-y-2">
            <h2 className="text-base font-semibold">{t('allergens.productsTitle')}</h2>
            <p className="max-w-xl text-sm text-muted-foreground">{t('allergens.productsIntro')}</p>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="px-3 py-2 font-medium">{t('allergens.colProduct')}</th>
                    <th className="px-3 py-2 font-medium">{t('allergens.colAllergens')}</th>
                    <th className="px-3 py-2 font-medium">{t('allergens.colUnits')}</th>
                    <th className="px-3 py-2 font-medium">{t('allergens.colShelfLife')}</th>
                    {canBuild ? <th className="px-3 py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => {
                    const keys = parseAllergens(product);
                    const conversions = parseUnitConversions(product);
                    return (
                      <tr key={product.id} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2">{product.name}</td>
                        <td className="px-3 py-2">
                          {keys.length
                            ? keys.map((key) => t(`allergens.${key}`)).join(', ')
                            : <span className="text-muted-foreground">{t('allergens.none')}</span>}
                        </td>
                        <td className="px-3 py-2">
                          {product.unit || 'each'}
                          {conversions.length
                            ? <span className="text-muted-foreground"> · {conversions.map((c) => c.unit).join(', ')}</span>
                            : null}
                        </td>
                        <td className="px-3 py-2">
                          {product.shelf_life_days != null ? t('allergens.daysCount', { count: product.shelf_life_days }) : '—'}
                        </td>
                        {canBuild ? (
                          <td className="px-3 py-2 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditing(product);
                                setDialogOpen(true);
                              }}
                            >
                              {t('recipes.editButton')}
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <ProductKitchenDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editing}
        onSaved={(text) => {
          setFlash(text);
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}
