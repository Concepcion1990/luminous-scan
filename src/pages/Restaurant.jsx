import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/client';
import {
  ArrowRightLeft,
  Ban,
  BookOpen,
  CalendarClock,
  Check,
  ChefHat,
  ClipboardList,
  FileText,
  NotebookPen,
  Plus,
  Scale,
  Thermometer,
  Trash2,
  TrendingUp,
  UtensilsCrossed,
  Wheat,
} from 'lucide-react';
import RecipeDialog from '@/components/restaurant/RecipeDialog';
import ProductKitchenDialog from '@/components/restaurant/ProductKitchenDialog';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import { scoped } from '@/lib/scoped';
import { formatMoney } from '@/lib/inventory';
import { listRecipes } from '@/lib/recipes';
import { t } from '@/lib/i18n';

/**
 * The restaurant corner's front door (release 359, Nov 23,
 * 2026): every dish and recipe in the business. Looking is
 * free for the whole team; building takes the owner's
 * restaurant.build tick (the owner always holds it), and the
 * money on each card — the dish's true cost and food-cost
 * percentage — rides the server-shaped row, so it exists on
 * this screen only for the owner and restaurant.money
 * holders. An active recipe linked to a product depletes its
 * ingredients whenever that product is sold; a draft never
 * does.
 */
export default function Restaurant() {
  const { activeId, record } = useBusiness();
  const { can: canStaff } = useStaffAccess();
  const [recipes, setRecipes] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const [kitchenProduct, setKitchenProduct] = useState(null);
  const [kitchenOpen, setKitchenOpen] = useState(false);

  const canBuild = canStaff('restaurant.build');

  // The operations doors (release 361): one card per door,
  // each behind the same restaurant gate as its page.
  const doors = [
    { to: '/restaurant/order-guide', icon: ClipboardList, title: t('nav.orderGuide'), body: t('restaurant.doorOrderGuide') },
    { to: '/restaurant/invoices', icon: FileText, title: t('nav.invoices'), body: t('restaurant.doorInvoices') },
    { to: '/restaurant/waste', icon: Trash2, title: t('nav.waste'), body: t('restaurant.doorWaste') },
    { to: '/restaurant/expiry', icon: CalendarClock, title: t('nav.expiry'), body: t('restaurant.doorExpiry') },
    { to: '/restaurant/allergens', icon: Wheat, title: t('nav.allergens'), body: t('restaurant.doorAllergens') },
    { to: '/restaurant/temp-logs', icon: Thermometer, title: t('nav.tempLogs'), body: t('restaurant.doorTempLogs') },
    { to: '/restaurant/86', icon: Ban, title: t('nav.eightySix'), body: t('restaurant.doorEightySix') },
    { to: '/restaurant/transfers', icon: ArrowRightLeft, title: t('nav.transfers'), body: t('restaurant.doorTransfers') },
    { to: '/restaurant/staff-meals', icon: UtensilsCrossed, title: t('nav.staffMeals'), body: t('restaurant.doorStaffMeals') },
    { to: '/restaurant/menu', icon: TrendingUp, title: t('nav.menu'), body: t('restaurant.doorMenu') },
    { to: '/restaurant/variance', icon: Scale, title: t('nav.variance'), body: t('restaurant.doorVariance') },
    { to: '/restaurant/prep', icon: NotebookPen, title: t('nav.prep'), body: t('restaurant.doorPrep') },
    { to: '/restaurant/ledger', icon: BookOpen, title: t('nav.ledger'), body: t('restaurant.doorLedger') },
  ];

  useEffect(() => {
    (async () => {
      const [recipeList, productPage, locPage] = await Promise.all([
        listRecipes(activeId || ''),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      ]);
      setRecipes(recipeList);
      setProducts(productPage.items ?? []);
      setLocations(locPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const productsById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const remove = async (recipe) => {
    if (!window.confirm(t('recipes.deleteConfirm', { name: recipe.name }))) return;
    await base44.entities.Recipe.delete(recipe.id);
    setFlash({ ok: true, text: t('recipes.deleted', { name: recipe.name }) });
    setReload((n) => n + 1);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('restaurant.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('restaurant.subtitle')}</p>
        </div>
        {canBuild ? (
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> {t('recipes.newButton')}
          </Button>
        ) : null}
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash.text}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : recipes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <ChefHat className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('restaurant.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('restaurant.emptyBody')}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((recipe) => {
            const dish = recipe.product_id ? productsById.get(recipe.product_id) : null;
            const showMoney = recipe.true_cost != null;
            return (
              <div key={recipe.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  {recipe.photo_url ? (
                    <img src={recipe.photo_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <ChefHat className="h-6 w-6 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <Link to={`/restaurant/recipes/${recipe.id}`} className="font-medium hover:underline">
                      {recipe.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {recipe.status === 'active' ? t('recipes.statusActive') : t('recipes.statusDraft')}
                      {recipe.location_name ? ` · ${recipe.location_name}` : ''}
                    </p>
                    {dish ? (
                      <p className="text-xs text-muted-foreground">
                        {t('recipes.cardDish', { name: dish.name })} · {formatMoney(dish.price || 0, record?.currency, 2)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('recipes.cardNoDish')}</p>
                    )}
                  </div>
                </div>
                {showMoney ? (
                  <p className="mt-3 text-sm">
                    {t('recipes.cardTrueCost', { cost: formatMoney(recipe.true_cost, record?.currency, 2) })}
                    {recipe.food_cost_pct != null ? (
                      <span className="text-muted-foreground">
                        {' '}· {t('recipes.cardFoodCost', { pct: recipe.food_cost_pct })}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <div className="mt-auto flex gap-2 pt-3">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/restaurant/recipes/${recipe.id}`}>{t('recipes.openButton')}</Link>
                  </Button>
                  {canBuild ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditing(recipe);
                          setDialogOpen(true);
                        }}
                      >
                        {t('recipes.editButton')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(recipe)}>
                        {t('recipes.deleteButton')}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold">{t('restaurant.doorsTitle')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {doors.map((door) => (
            <Link
              key={door.to}
              to={door.to}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:bg-muted/40"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <door.icon className="h-5 w-5 text-muted-foreground" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{door.title}</span>
                <span className="block text-xs text-muted-foreground">{door.body}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      {canBuild ? (
        <div className="space-y-3">
          <h2 className="text-base font-semibold">{t('restaurant.kitchenTitle')}</h2>
          <p className="max-w-xl text-sm text-muted-foreground">{t('restaurant.kitchenIntro')}</p>
          <div className="flex flex-wrap gap-2">
            {products.map((product) => (
              <Button
                key={product.id}
                variant="outline"
                size="sm"
                onClick={() => {
                  setKitchenProduct(product);
                  setKitchenOpen(true);
                }}
              >
                {product.name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <RecipeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        recipe={editing}
        recipes={recipes}
        products={products}
        locations={locations}
        onSaved={(text) => {
          setFlash({ ok: true, text });
          setReload((n) => n + 1);
        }}
      />
      <ProductKitchenDialog
        open={kitchenOpen}
        onOpenChange={setKitchenOpen}
        product={kitchenProduct}
        onSaved={(text) => {
          setFlash({ ok: true, text });
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}
