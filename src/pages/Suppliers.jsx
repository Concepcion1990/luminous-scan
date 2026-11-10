import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Link } from 'react-router-dom';
import { ClipboardList, Mail, Pencil, Phone, Plus } from 'lucide-react';
import SupplierFormDialog from '@/components/suppliers/SupplierFormDialog';
import PlanGate from '@/components/plan/PlanGate';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { scoped } from '@/lib/scoped';
import { Button } from '@/components/ui/button';

export default function Suppliers() {
  const { activeId } = useBusiness();
  // In-page mirror of the route-level PlanGate (App.jsx): the page is safe
  // on its own if it is ever rendered without the route gate. While the
  // entitlement is still loading the plan is unknown, so nothing is locked
  // yet — the same fail-open-while-loading shape PlanGate itself uses.
  const { can, isLoading: entitlementLoading } = useEntitlements();
  const [suppliers, setSuppliers] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [supPage, poPage] = await Promise.all([
        base44.entities.Supplier.filter(scoped({}, activeId), { sort: 'name', limit: 200 }),
        base44.entities.PurchaseOrder.filter(scoped({ status: { $in: ['ordered', 'partial'] } }, activeId), {
          limit: 200,
        }),
      ]);
      setSuppliers(supPage.items ?? []);
      setOpenOrders(poPage.items ?? []);
      setLoading(false);
    })();
  }, [reload, activeId]);

  if (!entitlementLoading && !can('suppliers')) return <PlanGate feature="suppliers" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Purchasing</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Suppliers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who you buy from, and what you still have on order.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/purchasing">
              <ClipboardList className="mr-1.5 h-4 w-4" /> Purchase orders
            </Link>
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> New supplier
          </Button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading suppliers…</p>}

      {!loading && suppliers.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-sm font-medium">No suppliers yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add the wholesaler or publisher you order from, then raise a purchase order.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {suppliers.map((supplier) => {
          const own = openOrders.filter((o) => o.supplier_id === supplier.id);
          return (
            <div key={supplier.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{supplier.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {supplier.contact_name || 'No contact set'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    setEditing(supplier);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {supplier.email && (
                  <p className="flex items-center gap-1.5 truncate">
                    <Mail className="h-3 w-3 shrink-0" /> {supplier.email}
                  </p>
                )}
                {supplier.phone && (
                  <p className="flex items-center gap-1.5 truncate">
                    <Phone className="h-3 w-3 shrink-0" /> {supplier.phone}
                  </p>
                )}
                {supplier.account_number && (
                  <p className="numeric text-[11px]">Acct {supplier.account_number}</p>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Open orders
                </span>
                <span className={`numeric text-sm font-semibold ${own.length ? 'text-warn' : ''}`}>
                  {own.length}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <SupplierFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        supplier={editing}
        onSaved={() => setReload((r) => r + 1)}
      />
    </div>
  );
}