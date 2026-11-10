import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money, poNumber, poTotals, todayIso } from '@/lib/purchasing';
import { scoped } from '@/lib/scoped';

const keyOf = (item) => `${item.product.id}:${item.level.location_id}`;

/** Enough to reach twice the reorder point, so a reorder does not repeat next week. */
function suggestedQty(item) {
  const target = (Number(item.reorder) || 0) * 2;
  return Math.max(target - (Number(item.quantity) || 0), 1);
}

function dateFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days || 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export default function ReorderPanel({ items, currency, businessId }) {
  const [suppliers, setSuppliers] = useState([]);
  const [qty, setQty] = useState({});
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    base44.entities.Supplier
      .filter(scoped({}, businessId), { sort: 'name', limit: 200 })
      .then((page) => setSuppliers(page.items ?? []));
  }, [businessId]);

  useEffect(() => {
    const nextQty = {};
    const nextPicked = {};
    items.forEach((item) => {
      nextQty[keyOf(item)] = String(suggestedQty(item));
      nextPicked[keyOf(item)] = true;
    });
    setQty(nextQty);
    setPicked(nextPicked);
  }, [items]);

  const groups = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      const id = item.product.supplier_id || 'none';
      if (!map.has(id)) {
        map.set(id, { id, supplier: suppliers.find((s) => s.id === id) || null, items: [] });
      }
      map.get(id).items.push(item);
    });
    const list = [...map.values()];
    return list.sort((a, b) => {
      if (a.id === 'none') return 1;
      if (b.id === 'none') return -1;
      return (a.supplier?.name || '').localeCompare(b.supplier?.name || '');
    });
  }, [items, suppliers]);

  const createOrder = async (group) => {
    const chosen = group.items.filter((item) => picked[keyOf(item)] && Number(qty[keyOf(item)]) > 0);
    if (!chosen.length) {
      setError('Pick at least one product and a quantity.');
      return;
    }
    // A missing cost is not a cost of zero: a recorded $0 is real and is
    // kept, but a product with no cost at all stops the order so no $0
    // line is ever written silently.
    const missingCost = chosen.filter(
      (item) => typeof item.product.cost !== 'number' || !Number.isFinite(item.product.cost)
    );
    if (missingCost.length) {
      setError(
        `Add a cost to ${missingCost.map((item) => item.product.name).join(', ')} before creating this order — a missing cost is not $0.`
      );
      return;
    }
    setBusy(group.id);
    setError('');
    setFlash(null);

    const lines = [];
    chosen.forEach((item) => {
      const amount = Number(qty[keyOf(item)]) || 0;
      const existing = lines.find((line) => line.product_id === item.product.id);
      if (existing) {
        existing.qty_ordered += amount;
        return;
      }
      lines.push({
        product_id: item.product.id,
        product_name: item.product.name,
        sku: item.product.sku || '',
        qty_ordered: amount,
        qty_received: 0,
        unit_cost: Number(item.product.cost) || 0,
      });
    });

    const totals = poTotals({ lines });
    const locationIds = new Set(chosen.map((item) => item.location?.id).filter(Boolean));
    const location = locationIds.size === 1 ? chosen[0].location : null;

    try {
      const order = await base44.entities.PurchaseOrder.create({
        business_id: businessId || '',
        number: poNumber(),
        supplier_id: group.supplier.id,
        supplier_name: group.supplier.name,
        status: 'draft',
        order_date: todayIso(),
        expected_date: group.supplier.lead_time_days ? dateFromNow(group.supplier.lead_time_days) : '',
        location_id: location?.id || '',
        location_name: location?.name || '',
        lines,
        subtotal: totals.subtotal,
        shipping: 0,
        tax: 0,
        total: totals.total,
        note: 'Created from low-stock suggestions',
      });
      setPicked((current) => {
        const next = { ...current };
        chosen.forEach((item) => {
          next[keyOf(item)] = false;
        });
        return next;
      });
      setFlash({
        number: order.number,
        count: lines.length,
        supplier: group.supplier.name,
        total: totals.total,
      });
    } catch (err) {
      setError(err?.message || 'Could not create that purchase order.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold">Reorder suggestions</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Low stock becomes a draft purchase order in one tap, at each product's cost. Nothing is
            ordered until you review and place the draft in Purchasing.
          </p>
        </div>
        <Link
          to="/purchasing"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Purchase orders <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {flash && (
        <div className="flex items-start gap-2 border-b border-border bg-ok/8 px-4 py-2.5 text-sm sm:px-5">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
          <span>
            {flash.number} draft created for {flash.supplier} — {flash.count} line
            {flash.count === 1 ? '' : 's'}, {money(flash.total, currency)}.{' '}
            <Link to="/purchasing" className="font-medium underline underline-offset-2">
              Open
            </Link>
          </span>
        </div>
      )}

      {error && <p className="border-b border-border px-4 py-2.5 text-sm text-destructive sm:px-5">{error}</p>}

      {items.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">
          Nothing is below its reorder point. Suggestions show up here when stock runs low.
        </p>
      )}

      {groups.map((group) => {
        const active = group.items.filter((item) => picked[keyOf(item)] && Number(qty[keyOf(item)]) > 0);
        return (
          <div key={group.id} className="border-b border-border last:border-0">
            <div className="flex items-center justify-between gap-3 bg-secondary/60 px-4 py-2 sm:px-5">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold uppercase tracking-wide">
                  {group.supplier?.name || 'No supplier set'}
                </p>
                {group.supplier?.lead_time_days > 0 && (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {group.supplier.lead_time_days}d lead time
                  </p>
                )}
              </div>
              {group.supplier ? (
                <Button
                  size="sm"
                  onClick={() => createOrder(group)}
                  disabled={busy === group.id || active.length === 0}
                >
                  <ShoppingCart className="mr-1.5 h-3.5 w-3.5" />
                  {busy === group.id ? 'Creating…' : `Create draft PO (${active.length})`}
                </Button>
              ) : (
                <Link
                  to="/products"
                  className="shrink-0 text-[11px] font-medium underline underline-offset-2 text-muted-foreground"
                >
                  Set a supplier on the product
                </Link>
              )}
            </div>

            <div className="divide-y divide-border">
              {group.items.map((item) => {
                const key = keyOf(item);
                const on = Boolean(picked[key]);
                return (
                  <div key={key} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setPicked((p) => ({ ...p, [key]: e.target.checked }))}
                      className="h-4 w-4 shrink-0 accent-primary"
                      aria-label={`Include ${item.product.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm ${on ? 'font-medium' : 'text-muted-foreground'}`}>
                        {item.product.name}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {item.product.sku} · {item.location?.name} · {item.quantity} on hand / min{' '}
                        {item.reorder}
                      </p>
                    </div>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      value={qty[key] ?? ''}
                      onChange={(e) => setQty((q) => ({ ...q, [key]: e.target.value }))}
                      className="numeric w-14 shrink-0 rounded-md border border-input bg-transparent px-2 py-1 text-right text-sm"
                      aria-label={`Quantity for ${item.product.name}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}