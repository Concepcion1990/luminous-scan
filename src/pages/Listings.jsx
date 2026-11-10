import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, Plus, Store } from 'lucide-react';
import ListingFormDialog from '@/components/listings/ListingFormDialog';
import ListingRow from '@/components/listings/ListingRow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { t } from '@/lib/i18n';
import { productTruncationNotice } from '@/lib/inventory';
import { listListings, LISTING_CHANNELS, LISTING_FILTERS } from '@/lib/listings';

export default function Listings() {
  const { activeId, profile } = useBusiness();
  const [listings, setListings] = useState([]);
  const [products, setProducts] = useState([]);
  const [productTotal, setProductTotal] = useState(0);
  const [status, setStatus] = useState('all');
  const [channel, setChannel] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    (async () => {
      const [page, total] = await Promise.all([
        base44.entities.Product.filter(scoped({}, activeId), {
          sort: 'name',
          limit: 500,
        }),
        base44.entities.Product.count(scoped({}, activeId)),
      ]);
      setProducts(page.items ?? []);
      setProductTotal(total);
    })();
  }, [activeId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      const rows = await listListings({ status, channel, search, businessId: activeId || '' });
      // A slower earlier search must not overwrite the newer results.
      if (!alive) return;
      setListings(rows);
      setLoading(false);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [status, channel, search, activeId, reload]);

  const remove = async (listing) => {
    if (!window.confirm(t('listings.deleteConfirm', { name: listing.product_name }))) return;
    await base44.entities.Listing.delete(listing.id);
    setFlash({ ok: true, text: t('listings.deleted', { name: listing.product_name }) });
    setReload((n) => n + 1);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('listings.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('listings.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('listings.subtitle')}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> {t('listings.newListing')}
        </Button>
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash.text}
        </p>
      )}

      {productTruncationNotice(products.length, productTotal) && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          {productTruncationNotice(products.length, productTotal)}{t('listings.truncationSuffix')}
        </p>
      )}

      <div className="space-y-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('listings.searchPlaceholder')}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {LISTING_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatus(f.key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  status === f.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="w-[170px] bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('listings.allChannels')}</SelectItem>
              {Object.entries(LISTING_CHANNELS).map(([key, meta]) => (
                <SelectItem key={key} value={key}>
                  {meta.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('listings.loading')}</p>}

        {!loading && !listings.length && (
          <div className="px-4 py-14 text-center">
            <Store className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">{t('listings.emptyTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('listings.emptyHint')}
            </p>
          </div>
        )}

        <div className="divide-y divide-border">
          {!loading &&
            listings.map((listing) => (
              <ListingRow
                key={listing.id}
                listing={listing}
                currency={profile?.currency || 'USD'}
                onEdit={() => {
                  setEditing(listing);
                  setDialogOpen(true);
                }}
                onDelete={() => remove(listing)}
              />
            ))}
        </div>
      </div>

      <ListingFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        listing={editing}
        products={products}
        onSaved={(text) => {
          setFlash({ ok: true, text });
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}