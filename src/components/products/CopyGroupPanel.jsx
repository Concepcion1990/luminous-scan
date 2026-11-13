import { useEffect, useState } from 'react';
import { CopyPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyLabel, loadCopyGroup } from '@/lib/copies';
import { t } from '@/lib/i18n';


/** Lists the other copies/variations of one title and offers to add another. */
export default function CopyGroupPanel({ product, businessId, totals, onAddCopy }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    loadCopyGroup({ businessId, product })
      .then((items) => !cancelled && setRows(items))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [businessId, product]);

  return (
    <div className="mt-3 rounded-md border border-border bg-card px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {rows?.length ? t('products.copiesTitleCount', { count: rows.length }) : t('products.copiesTitle')}
        </p>
        <Button variant="outline" size="sm" className="h-7" onClick={() => onAddCopy(product)}>
          <CopyPlus className="mr-1 h-3.5 w-3.5" /> {t('products.addCopy')}
        </Button>
      </div>

      {rows === null && <p className="mt-1.5 text-[11px] text-muted-foreground">{t('products.checkingCopies')}</p>}

      {rows?.length === 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {t('products.noCopies')}
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
              <span className="min-w-0">
                <span className="numeric block truncate">{row.sku}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {copyLabel(row) || t('products.noCondition')}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="numeric">{totals?.get(row.id) || 0}</span>
                <span className="numeric text-muted-foreground">{row.price || 0}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}