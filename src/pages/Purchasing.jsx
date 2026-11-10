import { useEffect, useState } from 'react';
import { base44, apiRequest } from '@/api/client';
import { Link } from 'react-router-dom';
import { Check, ClipboardList, Pencil, Plus } from 'lucide-react';
import PurchaseOrderDialog from '@/components/purchasing/PurchaseOrderDialog';
import ReceiveDialog from '@/components/purchasing/ReceiveDialog';
import PlanGate from '@/components/plan/PlanGate';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { scoped } from '@/lib/scoped';
import { money, PO_STATUS, poProgress, statusQuery } from '@/lib/purchasing';

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'ordered', label: 'On order' },
  { key: 'partial', label: 'Partly received' },
  { key: 'received', label: 'Received' },
  { key: 'draft', label: 'Drafts' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

const PILL = {
  info: 'bg-secondary text-foreground',
  warn: 'bg-warn/15 text-warn',
  ok: 'bg-ok/12 text-ok',
  muted: 'bg-muted text-muted-foreground',
};

export default function Purchasing() {
  const { profile, activeId } = useBusiness();
  // In-page mirror of the route-level PlanGate (App.jsx): the page is safe
  // on its own if it is ever rendered without the route gate. While the
  // entitlement is still loading the plan is unknown, so nothing is locked
  // yet — the same fail-open-while-loading shape PlanGate itself uses.
  const { can, isLoading: entitlementLoading } = useEntitlements();
  const currency = profile?.currency || 'USD';
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [receiving, setReceiving] = useState(null);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  // A draft becomes "on order" only when it has actually gone to
  // the supplier — the server moves it, never a direct status edit.
  const placeOrder = async (order) => {
    setError('');
    try {
      const { order: placed } = await apiRequest(
        `/api/businesses/${activeId}/purchase-orders/${order.id}/order`,
        { method: 'POST' },
      );
      setReload((r) => r + 1);
      setFlash(`${placed.number} is on order now.`);
    } catch (err) {
      setError(err?.message || 'Could not place this order.');
    }
  };

  useEffect(() => {
    (async () => {
      const [supPage, prodPage, locPage] = await Promise.all([
        base44.entities.Supplier.filter(scoped({}, activeId), { sort: 'name', limit: 200 }),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      ]);
      setSuppliers(supPage.items ?? []);
      setProducts(prodPage.items ?? []);
      setLocations(locPage.items ?? []);
    })();
  }, [activeId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const status = statusQuery(filter);
      const query = status === 'all' ? {} : { status };
      const page = await base44.entities.PurchaseOrder.filter(scoped(query, activeId), {
        sort: '-created_date',
        limit: 200,
      });
      setOrders(page.items ?? []);
      setLoading(false);
    })();
  }, [filter, reload, activeId]);

  if (!entitlementLoading && !can('purchasing')) return <PlanGate feature="purchasing" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Purchasing</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Purchase orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Order from a supplier, then receive what arrives — stock and cost land on the product.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/suppliers">Suppliers</Link>
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

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {flash && (
        <div className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/8 p-3 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
          <span>{flash}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
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

      {loading && <p className="text-sm text-muted-foreground">Loading purchase orders…</p>}

      {!loading && suppliers.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <p className="text-sm font-medium">Add a supplier first</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Every purchase order is placed with a supplier.
          </p>
          <Button className="mt-3" asChild>
            <Link to="/suppliers">Open suppliers</Link>
          </Button>
        </div>
      )}

      {!loading && suppliers.length > 0 && orders.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <ClipboardList className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No orders here</p>
          <p className="mt-1 text-xs text-muted-foreground">Raise an order to start tracking what is coming.</p>
        </div>
      )}

      <div className="grid gap-3">
        {orders.map((order) => {
          const meta = PO_STATUS[order.status] || PO_STATUS.ordered;
          const progress = poProgress(order);
          const canReceive = ['ordered', 'partial'].includes(order.status);
          return (
            <div key={order.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="numeric text-sm font-semibold">{order.number}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
                        PILL[meta.tone]
                      }`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {order.supplier_name}
                    {order.location_name ? ` → ${order.location_name}` : ''}
                    {order.status === 'received' && order.received_date
                      ? ` · received ${order.received_date}`
                      : order.expected_date
                      ? ` · expected ${order.expected_date}`
                      : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="numeric text-sm font-semibold">{money(order.total, currency)}</p>
                  <p className="numeric font-mono text-[10px] text-muted-foreground">
                    {progress.received}/{progress.ordered} received
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-1 border-t border-border pt-2.5">
                {(order.lines || []).slice(0, 4).map((line, index) => (
                  <div key={index} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate">{line.product_name}</span>
                    <span className="numeric shrink-0 text-muted-foreground">
                      {line.qty_received || 0}/{line.qty_ordered} · {money(line.unit_cost, currency)}
                    </span>
                  </div>
                ))}
                {(order.lines || []).length > 4 && (
                  <p className="text-[11px] text-muted-foreground">
                    +{(order.lines || []).length - 4} more lines
                  </p>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {order.status === 'draft' && (
                  <Button size="sm" onClick={() => placeOrder(order)}>
                    Place order
                  </Button>
                )}
                {canReceive && (
                  <Button size="sm" onClick={() => setReceiving(order)}>
                    Receive
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(order);
                    setEditOpen(true);
                  }}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                </Button>
                {order.received_by && (
                  <span className="self-center text-[11px] text-muted-foreground">
                    Received by {order.received_by}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <PurchaseOrderDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        order={editing}
        suppliers={suppliers}
        products={products}
        locations={locations}
        currency={currency}
        onSaved={(saved) => {
          setReload((r) => r + 1);
          setFlash(`${editing ? 'Updated' : 'Created'} ${saved.number}.`);
        }}
      />

      <ReceiveDialog
        open={Boolean(receiving)}
        onOpenChange={(open) => !open && setReceiving(null)}
        order={receiving}
        products={products}
        locations={locations}
        currency={currency}
        onReceived={(result) => {
          setReload((r) => r + 1);
          setFlash(
            `Received ${result.receivedNow} unit${result.receivedNow === 1 ? '' : 's'} on ${
              receiving?.number
            } — ${result.status === 'received' ? 'order complete' : 'partly received'}.`
          );
        }}
      />
    </div>
  );
}