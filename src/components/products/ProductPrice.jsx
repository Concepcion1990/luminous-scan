import { formatMoney } from '@/lib/inventory';
import { priceInfo } from '@/lib/pricing';
import { t } from '@/lib/i18n';

/**
 * A product's price as the customer sees it (migration 018): the
 * EFFECTIVE price — clearance or in-window rollback — with the
 * retained regular price shown alongside ("on the side", in the
 * owner's words) struck through, plus the sale badge. A rollback
 * that has not started yet says when it starts; the regular price
 * rules until then, and again on its own after the end date.
 */
export default function ProductPrice({ product, currency, digits = 2 }) {
  const info = priceInfo(product);
  const hasPrice =
    (product?.price !== null && product?.price !== undefined && product?.price !== '') ||
    info.mode !== 'regular';
  if (!hasPrice) return <>—</>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span className="font-semibold">{formatMoney(info.effective, currency, digits)}</span>
      {info.onSale && (
        <>
          <span className="text-xs font-normal text-muted-foreground line-through">
            {formatMoney(info.regular, currency, digits)}
          </span>
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
            {info.mode === 'clearance' ? t('pricing.clearanceBadge') : t('pricing.rollbackBadge')}
          </span>
        </>
      )}
      {info.mode === 'rollback' && !info.active && info.start && (
        <span className="text-[10px] font-normal text-muted-foreground">
          {t('pricing.rollbackStarts', {
            date: new Date(`${info.start}T12:00:00`).toLocaleDateString(),
          })}
        </span>
      )}
    </span>
  );
}
