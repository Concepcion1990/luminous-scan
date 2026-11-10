import { Check, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export default function ProductPicker({ products, loading, search, onSearch, selectedIds, onToggle }) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Name, SKU, ISBN or UPC"
          className="pl-9"
        />
      </div>

      <ul className="max-h-[340px] divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {loading && <li className="px-3 py-4 text-xs text-muted-foreground">Loading catalog…</li>}

        {!loading && products.length === 0 && (
          <li className="px-3 py-4 text-xs text-muted-foreground">No products match that search.</li>
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
                <span className="min-w-0">
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