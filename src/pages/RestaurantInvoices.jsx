import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, FileText, Plus } from 'lucide-react';
import InvoiceDialog from '@/components/restaurant/InvoiceDialog';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import { scoped } from '@/lib/scoped';
import { formatMoney } from '@/lib/inventory';
import { formatShortDate } from '@/lib/dates';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * Supplier invoices (release 361, Nov 23, 2026): what each
 * supplier billed, checked three ways against its purchase
 * order — ordered, received, invoiced — by the server-shaped
 * match on each row. When a billed price moves off a
 * product's current cost, a price alert opens below;
 * accepting one puts the new cost on the product. Entering
 * and answering rides the restaurant.build tick.
 */
export default function RestaurantInvoices() {
  const { activeId, record } = useBusiness();
  const { can: canStaff } = useStaffAccess();
  const [invoices, setInvoices] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);

  const canBuild = canStaff('restaurant.build');

  useEffect(() => {
    (async () => {
      const [invoicePage, alertPage, productPage, supplierPage, poPage] = await Promise.all([
        base44.entities.SupplierInvoice.filter(scoped({}, activeId), { sort: '-created_date', limit: 200 }),
        base44.entities.VendorPriceAlert.filter(scoped({}, activeId), { sort: '-created_date', limit: 200 }),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Supplier.filter(scoped({}, activeId), { sort: 'name', limit: 200 }),
        base44.entities.PurchaseOrder.filter(scoped({}, activeId), { limit: 200 }),
      ]);
      setInvoices(invoicePage.items ?? []);
      setAlerts(alertPage.items ?? []);
      setProducts(productPage.items ?? []);
      setSuppliers(supplierPage.items ?? []);
      setPurchaseOrders(poPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const openAlerts = alerts.filter((alert) => alert.status === 'open');

  const answerAlert = async (alert, status) => {
    await base44.entities.VendorPriceAlert.update(alert.id, { status });
    setFlash(
      status === 'accepted'
        ? t('ops.invoices.alertAccepted', { name: alert.product_name })
        : t('ops.invoices.alertDismissed', { name: alert.product_name })
    );
    setReload((n) => n + 1);
  };

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/invoices" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('ops.invoices.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('ops.invoices.subtitle')}</p>
        </div>
        {canBuild ? (
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> {t('ops.invoices.newButton')}
          </Button>
        ) : null}
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : (
        <>
          {openAlerts.length ? (
            <div className="space-y-2">
              <h2 className="text-base font-semibold">{t('ops.invoices.alertsTitle')}</h2>
              {openAlerts.map((alert) => (
                <div key={alert.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/5 p-4">
                  <div>
                    <p className="font-medium">{alert.product_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('ops.invoices.alertLine', {
                        supplier: alert.supplier_name || '',
                        oldCost: formatMoney(alert.old_cost || 0, record?.currency, 2),
                        newCost: formatMoney(alert.new_cost || 0, record?.currency, 2),
                      })}
                    </p>
                  </div>
                  {canBuild ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => answerAlert(alert, 'accepted')}>
                        {t('ops.invoices.alertAccept')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => answerAlert(alert, 'dismissed')}>
                        {t('ops.invoices.alertDismiss')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {invoices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{t('ops.invoices.emptyTitle')}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('ops.invoices.emptyBody')}</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="px-3 py-2 font-medium">{t('ops.invoices.colSupplier')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.invoices.colNumber')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.invoices.colDate')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('ops.invoices.colTotal')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.invoices.colMatch')}</th>
                    <th className="px-3 py-2 font-medium">{t('ops.invoices.colStatus')}</th>
                    {canBuild ? <th className="px-3 py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        {invoice.supplier_name}
                        {invoice.po_number ? (
                          <span className="block text-xs text-muted-foreground">
                            {t('ops.invoices.poPrefix', { number: invoice.po_number })}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{invoice.invoice_number || '—'}</td>
                      <td className="px-3 py-2">{invoice.invoice_date ? formatShortDate(invoice.invoice_date) : ''}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(invoice.total || 0, record?.currency, 2)}</td>
                      <td className="px-3 py-2">
                        {invoice.match == null ? (
                          <span className="text-muted-foreground">{t('ops.invoices.matchNone')}</span>
                        ) : invoice.match.status === 'match' ? (
                          <span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">{t('ops.invoices.matchOk')}</span>
                        ) : (
                          <span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn">{t('ops.invoices.matchReview')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {invoice.status === 'accepted' ? t('ops.invoices.statusAccepted') : t('ops.invoices.statusDraft')}
                      </td>
                      {canBuild ? (
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(invoice);
                              setDialogOpen(true);
                            }}
                          >
                            {t('recipes.editButton')}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <InvoiceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        invoice={editing}
        products={products}
        suppliers={suppliers}
        purchaseOrders={purchaseOrders}
        onSaved={(text) => {
          setFlash(text);
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}
