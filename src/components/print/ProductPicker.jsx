import { Check, Search } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';

export default function ProductPicker({ products, loading, search, onSearch, selectedIds, onToggle, onToggleAll }) {
  // The master box speaks only about the products CURRENTLY LISTED
  // (the search result — which is everything when no search runs):
  // checked when all listed are picked, indeterminate when some
  // are, and the count beside it says how many are picked so the
  // state is never a guess (owner ruling, Nov 14, 2026).
  const listedSelected = products.filter((p) => selectedIds.includes(p.id)).length;
  const allListedSelected = products.length > 0 && listedSelected === products.length;
  const masterState = allListedSelected ? true : listedSelected > 0 ? 'indeterminate' : false;
  const toggleMaster = () => onToggleAll?.(products, !allListedSelected);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t('print.searchPlaceholder')}
          className="pl-9"
        />
      </div>

      {!loading && products.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <Checkbox checked={masterState} onCheckedChange={toggleMaster} aria-label={t('products.selectAllAria')} />
            <button
              type="button"
              onClick={toggleMaster}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('products.selectAllCount', { count: products.length })}
            </button>
          </div>
          {listedSelected > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('products.selectedCount', { count: listedSelected })}
            </span>
          )}
        </div>
      )}

      <ul className="max-h-[340px] divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {loading && <li className="px-3 py-4 text-xs text-muted-foreground">{t('print.loadingCatalog')}</li>}

        {!loading && products.length === 0 && (
          <li className="px-3 py-4 text-xs text-muted-foreground">{t('print.noProductsMatch')}</li>
        )}

        {products.map((product) => {
          const active = selectedIds.includes(product.id);
          return (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => onToggle(product)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                  active ? 'bg-secondary' : 'hover:bg-muted'
                }`}
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                    active ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                  }`}
                >
                  {active && <Check className="h-3 w-3" />}
                </span>
                {product.photo_urls?.[0] && (
                  <img
                    src={product.photo_urls[0]}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded object-cover"
                  />
                )}
                <span className="min-w-0 flex-1 overflow-hidden">
                  <span className="block truncate text-sm">{product.name}</span>
                  <span className="numeric block truncate text-[11px] text-muted-foreground">
                    {[product.sku, product.isbn, product.upc].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}