import { useEffect, useMemo, useState } from 'react';
import { base44, apiRequest } from '@/api/client';
import { Check, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GuestMenuDoc from '@/components/print/GuestMenuDoc';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import { scoped } from '@/lib/scoped';
import { formatMoney } from '@/lib/inventory';
import { listRecipes } from '@/lib/recipes';
import { buildGuestMenuItems, cleanPublishedIds } from '@/lib/kitchenMenu';
import { resolveDocStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * The guest-facing menu page — the owner's side (plan release
 * 371, Nov 26, 2026; Q-fire 6): the owner ticks the dishes
 * guests may see; prices ride the dishes' own records and
 * allergen flags ride the 361 matrix, never a second typing.
 * Saving writes the publication (migration 060) under its
 * share slug; the public page at /menu/:slug shows ONLY the
 * ticked dishes, shaped guest-safe by the server, and needs
 * no account. The preview below is the Studio document —
 * PREVIEW = PRINT. Ordering (plan 399) will stand on this
 * page later; it is deliberately not built here.
 */
export default function RestaurantGuestMenu() {
  const { activeId, record, profile } = useBusiness();
  const { can: canStaff } = useStaffAccess();
  const [recipes, setRecipes] = useState([]);
  const [products, setProducts] = useState([]);
  const [picked, setPicked] = useState([]);
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState(null);

  const canBuild = canStaff('restaurant.build');
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);

  useEffect(() => {
    (async () => {
      const [recipeList, productPage, publication] = await Promise.all([
        listRecipes(activeId || ''),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        activeId ? apiRequest(`/businesses/${activeId}/guest-menu`).catch(() => null) : null,
      ]);
      setRecipes(recipeList);
      setProducts(productPage.items ?? []);
      if (publication) {
        setPicked(cleanPublishedIds(publication.recipeIds));
        setSlug(publication.slug || '');
      }
      setLoading(false);
    })();
  }, [activeId]);

  const items = useMemo(() => buildGuestMenuItems(recipes, products, picked), [recipes, products, picked]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const shareLink = slug ? `${window.location.origin}/menu/${slug}` : '';

  const toggle = (id) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const save = async () => {
    setError(null);
    try {
      const saved = await apiRequest(`/businesses/${activeId}/guest-menu`, {
        method: 'PUT',
        body: { recipeIds: picked },
      });
      setPicked(cleanPublishedIds(saved.recipeIds));
      setSlug(saved.slug || '');
      setFlash(t('guestMenu.saved'));
    } catch {
      setError(t('guestMenu.saveFailed'));
    }
  };

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/guest-menu" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t('restaurant.eyebrow')}</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('guestMenu.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('guestMenu.subtitle')}</p>
        </div>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" /> {t('guestMenu.printButton')}
        </Button>
      </div>

      {flash && (
        <p className="no-print flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}
      {error && <p className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : (
        <>
          <div className="no-print space-y-2">
            <h2 className="text-base font-semibold">{t('guestMenu.chooseTitle')}</h2>
            <p className="max-w-xl text-sm text-muted-foreground">{t('guestMenu.chooseIntro')}</p>
            <div className="divide-y divide-border rounded-xl border border-border">
              {recipes.map((recipe) => {
                const dish = recipe.product_id ? productsById.get(recipe.product_id) : null;
                const on = picked.includes(recipe.id);
                return (
                  <label key={recipe.id} className="flex cursor-pointer items-center gap-3 px-4 py-3">
                    <input type="checkbox" checked={on} disabled={!canBuild} onChange={() => toggle(recipe.id)} className="h-4 w-4" />
                    <span className="flex-1 font-medium">{recipe.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {dish && Number(dish.price) > 0 ? formatMoney(Number(dish.price), record?.currency, 2) : t('guestMenu.noPrice')}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-sm text-muted-foreground">{t('guestMenu.publishedCount', { count: picked.length })}</p>
            {canBuild ? (
              <Button onClick={save}>{t('guestMenu.save')}</Button>
            ) : null}
          </div>

          <div className="no-print space-y-1.5">
            <h2 className="text-base font-semibold">{t('guestMenu.linkTitle')}</h2>
            {shareLink && picked.length ? (
              <>
                <p className="break-all rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm">{shareLink}</p>
                <p className="text-sm text-muted-foreground">{t('guestMenu.linkHint')}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('guestMenu.notPublished')}</p>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="no-print text-base font-semibold">{t('guestMenu.previewTitle')}</h2>
            {items.length ? (
              <GuestMenuDoc items={items} business={record} docStyle={docStyle} />
            ) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                <p className="text-sm font-medium">{t('guestMenu.emptyTitle')}</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('guestMenu.emptyBody')}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
