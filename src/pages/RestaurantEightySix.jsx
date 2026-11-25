import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Ban, Check, Plus } from 'lucide-react';
import EightySixDialog from '@/components/restaurant/EightySixDialog';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { formatDateTime } from '@/lib/dates';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * The 86 board (release 361, Nov 23, 2026): what is out,
 * right now, where — and, below, what came back. Anyone on
 * the team can post an item or clear one; the board records
 * who cleared it and when.
 */
export default function RestaurantEightySix() {
  const { activeId } = useBusiness();
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    (async () => {
      const [itemPage, productPage, locPage] = await Promise.all([
        base44.entities.EightySixItem.filter(scoped({}, activeId), { sort: '-created_date', limit: 300 }),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      ]);
      setItems(itemPage.items ?? []);
      setProducts(productPage.items ?? []);
      setLocations(locPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const active = items.filter((item) => item.active !== false);
  const cleared = items.filter((item) => item.active === false);

  const clear = async (item) => {
    await base44.entities.EightySixItem.update(item.id, { active: false });
    setFlash(t('ops.eightySix.cleared', { name: item.product_name }));
    setReload((n) => n + 1);
  };

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/86" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('ops.eightySix.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('ops.eightySix.subtitle')}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('ops.eightySix.newButton')}
        </Button>
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : active.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <Ban className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('ops.eightySix.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('ops.eightySix.emptyBody')}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((item) => (
            <div key={item.id} className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <p className="font-medium">{item.product_name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.location_name || t('ops.eightySix.locationAll')}
                {item.created_date ? ` · ${formatDateTime(item.created_date)}` : ''}
              </p>
              {item.note ? <p className="mt-1 text-sm text-muted-foreground">{item.note}</p> : null}
              <Button variant="outline" size="sm" className="mt-3" onClick={() => clear(item)}>
                {t('ops.eightySix.clearButton')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {cleared.length ? (
        <div className="space-y-2">
          <h2 className="text-base font-semibold">{t('ops.eightySix.clearedTitle')}</h2>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <tbody>
                {cleared.map((item) => (
                  <tr key={item.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">{item.product_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.location_name || t('ops.eightySix.locationAll')}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {item.cleared_at ? formatDateTime(item.cleared_at) : ''}
                      {item.cleared_by ? ` · ${item.cleared_by}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <EightySixDialog
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
