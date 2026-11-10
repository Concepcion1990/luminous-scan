import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Link } from 'react-router-dom';
import { Check, Plus, ShoppingBag } from 'lucide-react';
import OrderCard from '@/components/orders/OrderCard';
import OrderFormDialog from '@/components/orders/OrderFormDialog';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import useIsDesktop from '@/hooks/useIsDesktop';
import useModalHistory from '@/hooks/useModalHistory';
import {
  cancelOrder,
  deleteOrder,
  markDelivered,
  markPacked,
  releaseHolds,
  reserveOrder,
  shipOrder,
  statusQuery,
  STATUS_FILTERS,
} from '@/lib/orders';

export default function Orders() {
  const { user, profile, activeId } = useBusiness();
  const currency = profile?.currency || 'USD';
  const isDesktop = useIsDesktop();
  const { open: editOpen, onOpenChange: setEditOpen } = useModalHistory({
    modalId: 'order-form',
    routePath: '/orders',
    mobile: !isDesktop,
  });
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [levels, setLevels] = useState([]);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    (async () => {
      const [prodPage, locPage, levelPage] = await Promise.all([
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
        base44.entities.StockLevel.filter(scoped({}, activeId), { limit: 2000 }),
      ]);
      setProducts(prodPage.items ?? []);
      setLocations(locPage.items ?? []);
      setLevels(levelPage.items ?? []);
    })();
  }, [activeId, reload]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const status = statusQuery(filter);
      const query = status === 'all' ? {} : { status };
      const page = await base44.entities.Order.filter(scoped(query, activeId), {
        sort: '-created_date',
        limit: 200,
      });
      setOrders(page.items ?? []);
      setLoading(false);
    })();
  }, [filter, reload, activeId]);

  const run = async (order, key, fn) => {
    setBusyId(order.id);
    setFlash(null);
    try {
      const message = await fn();
      setFlash({ ok: true, text: message || `${order.number} updated.` });
      setReload((n) => n + 1);
    } catch (e) {
      setFlash({ ok: false, text: e.message || 'That did not work.' });
    } finally {
      setBusyId('');
    }
  };

  const action = (order, key) => {
    const shared = { order, products, user };
    if (key === 'reserve') return run(order, key, async () => {
      await reserveOrder({ ...shared, levels });
      return `${order.number}: stock held.`;
    });
    if (key === 'release') return run(order, key, async () => {
      await releaseHolds(shared);
      return `${order.number}: held stock released.`;
    });
    if (key === 'ship') return run(order, key, async () => {
      const result = await shipOrder(shared);
      return result.complete
        ? `${order.number}: shipped, stock deducted.`
        : `${order.number}: ${result.shippedNow} units shipped, the rest still open.`;
    });
    if (key === 'pack') return run(order, key, async () => {
      await markPacked(order);
      return `${order.number}: packed.`;
    });
    if (key === 'deliver') return run(order, key, async () => {
      await markDelivered(order);
      return `${order.number}: delivered.`;
    });
    if (key === 'cancel') return run(order, key, async () => {
      await cancelOrder(shared);
      return `${order.number}: cancelled.`;
    });
    if (key === 'delete') {
      if (!window.confirm(`Delete ${order.number}? Only an order with no stock history can go.`)) return null;
      return run(order, key, async () => {
        await deleteOrder(order);
        return `${order.number}: deleted.`;
      });
    }
    return null;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Orders</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Customer orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track orders from any channel. Held stock stays on the shelf; shipping deducts it once.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/returns">Returns</Link>
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setEditOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> New order
          </Button>
        </div>
      </div>

      {flash && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            flash.ok ? 'border-ok/30 bg-ok/8' : 'border-destructive/30 bg-destructive/8'
          }`}
        >
          {flash.ok && <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />}
          <span>{flash.text}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading orders…</p>}

      {!loading && !orders.length && (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <ShoppingBag className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No orders here yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add one by hand, or pick a different filter.
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            currency={currency}
            busy={busyId === order.id}
            onEdit={() => {
              setEditing(order);
              setEditOpen(true);
            }}
            onAction={(key) => action(order, key)}
          />
        ))}
      </div>

      <OrderFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        order={editing}
        products={products}
        locations={locations}
        currency={currency}
        onSaved={(text) => {
          setFlash({ ok: true, text });
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}