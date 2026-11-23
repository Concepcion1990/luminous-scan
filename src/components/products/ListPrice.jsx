import { formatMoney } from '@/lib/inventory';
import { listPrice } from '@/lib/pricing';

/**
 * A product's price printed beside its count on a list row
 * (release 348): the compact companion to the Products price
 * column — no badges, no struck-through regular, just the price
 * itself in the business's own currency, exact to the cent. A
 * product with no price set renders NOTHING (never an invented
 * $0.00), so callers can drop this straight into a row's count
 * cell without reserving space for it.
 */
export default function ListPrice({ product, currency, className = '' }) {
  const value = listPrice(product);
  if (value === null) return null;
  return <span className={`numeric ${className}`}>{formatMoney(value, currency, 2)}</span>;
}
