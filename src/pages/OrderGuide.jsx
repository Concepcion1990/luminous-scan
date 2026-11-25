import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, ClipboardList, Plus } from 'lucide-react';
import ParDialog from '@/components/restaurant/ParDialog';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import { scoped } from '@/lib/scoped';
import { formatMoney } from '@/lib/inventory';
import { listPars, guideRows } from '@/lib/recipes';
import { poNumber } from '@/lib/purchasing';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * Pars and the order guide (release 359, Nov 23, 2026). A par
 * says how much of an ingredient should be on hand; the guide
 * does the arithmetic the research calls the order guide —
 * par − on hand − on order, rounded UP to the supplier's
 * pack size, grouped per supplier — from the app's own stock
 * levels and purchase orders. Sending the guide writes one
 * DRAFT purchase order per supplier into the existing
 * Purchasing flow; nothing here is a second purchasing
 * system. Setting pars takes the owner's restaurant.pars
 * tick; reading the guide is free, and sending it follows
 * the purchasing permission the PO flow already uses.
 */
export default function OrderGuide() {
  const { activeId, record } = useBusiness();
  const { can: canStaff } = useStaffAccess();
  const [pars, setPars] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [levels, setLevels] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const canPars = canStaff('restaurant.pars');
  const canPurchase = canStaff('purchasing.manage');

  useEffect(() => {
    (async () => {
      const [parList, productPage, locPage, supplierPage, levelPage, poPage] = await Promise.all([
        listPars(activeId || ''),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
        base44.entities.Supplier.filter(scoped({}, activeId), { sort: 'name', limit: 200 }),
        base44.entities.StockLevel.filter(scoped({}, activeId), { limit: 2000 }),
        base44.entities.PurchaseOrder.filter(scoped({}, activeId), { limit: 200 }),
      ]);
      setPars(parList);
      setProducts(productPage.items ?? []);
      setLocations(locPage.items ?? []);
      setSuppliers(supplierPage.items ?? []);
      setLevels(levelPage.items ?? []);
      setPurchaseOrders(poPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const rows = useMemo(
    () =>
      guideRows({
        pars,
        levels,
        purchaseOrders,
        productsById: new Map(products.map((p) => [p.id, p])),
        suppliersById: new Map(suppliers.map((s) => [s.id, s])),
      }),
    [pars, levels, purchaseOrders, products, suppliers]
  );

  const groups = useMemo(() => {
    const bySupplier = new Map();
    for (const row of rows) {
      if (!(row.orderQty > 0)) continue;
      const key = row.supplierId || 'none';
      if (!bySupplier.has(key)) {
        bySupplier.set(key, { key, supplierId: row.supplierId, supplierName: row.supplierName, rows: [] });
      }
      bySupplier.get(key).rows.push(row);
    }
    return [...bySupplier.values()];
  }, [rows]);

  const remove = async (par) => {
    if (!window.confirm(t('pars.deleteConfirm', { name: par.product_name }))) return;
    await base44.entities.Par.delete(par.id);
    setFlash(t('pars.deleted', { name: par.product_name }));
    setReload((n) => n + 1);
  };

  const sendGroup = async (group) => {
    setError('');
    setSending(true);
    try {
      const number = poNumber();
      const lines = group.rows.map((row) => ({
        product_id: row.par.product_id,
        product_name: row.par.product_name,
        sku: row.par.sku || '',
        qty_ordered: row.orderQty,
        qty_received: 0,
        unit_cost: Number(row.product?.cost) || 0,
      }));
      const total = lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0);
      await base44.entities.PurchaseOrder.create({
        business_id: activeId,
        number,
        supplier_id: group.supplierId || '',
        supplier_name: group.supplierName || '',
        status: 'draft',
        lines,
        total,
        note: t('guide.poNote'),
      });
      setFlash(t('guide.sent', { number, name: group.supplierName || t('guide.noSupplier') }));
      setReload((n) => n + 1);
    } catch (e) {
      setError(e.message || t('guide.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/order-guide" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('guide.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('guide.subtitle')}</p>
        </div>
        {canPars ? (
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> {t('pars.newButton')}
          </Button>
        ) : null}
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}
      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : pars.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('guide.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('guide.emptyBody')}</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-3 py-2 font-medium">{t('guide.colProduct')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('guide.colPar')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('guide.colOnHand')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('guide.colOnOrder')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('guide.colOrder')}</th>
                  <th className="px-3 py-2 font-medium">{t('guide.colSupplier')}</th>
                  {canPars ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.par.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">
                      {row.par.product_name}
                      <span className="block text-xs text-muted-foreground">
                        {row.par.location_name || t('pars.locationAll')}
                        {row.pack > 1 ? ` · ${t('guide.packNote', { pack: row.pack })}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{row.parQty}</td>
                    <td className="px-3 py-2 text-right">{row.onHand}</td>
                    <td className="px-3 py-2 text-right">{row.onOrder}</td>
                    <td className="px-3 py-2 text-right font-medium">{row.orderQty > 0 ? row.orderQty : '—'}</td>
                    <td className="px-3 py-2">{row.supplierName || t('guide.noSupplier')}</td>
                    {canPars ? (
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(row.par);
                            setDialogOpen(true);
                          }}
                        >
                          {t('recipes.editButton')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(row.par)}>
                          {t('recipes.deleteButton')}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {groups.length ? (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">{t('guide.sendTitle')}</h2>
              {groups.map((group) => {
                const total = group.rows.reduce(
                  (sum, row) => sum + row.orderQty * (Number(row.product?.cost) || 0),
                  0
                );
                return (
                  <div key={group.key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
                    <div>
                      <p className="font-medium">{group.supplierName || t('guide.noSupplier')}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('guide.groupSummary', {
                          lines: group.rows.length,
                          total: formatMoney(total, record?.currency, 2),
                        })}
                      </p>
                    </div>
                    {canPurchase ? (
                      <Button size="sm" disabled={sending} onClick={() => sendGroup(group)}>
                        {t('guide.sendButton')}
                      </Button>
                    ) : (
                      <p className="max-w-xs text-xs text-muted-foreground">{t('guide.sendNeedsPurchasing')}</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('guide.nothingToOrder')}</p>
          )}
        </>
      )}

      <ParDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        par={editing}
        products={products}
        locations={locations}
        suppliers={suppliers}
        onSaved={(text) => {
          setFlash(text);
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}
