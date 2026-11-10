import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lock, Printer, X } from 'lucide-react';
import { base44 } from '@/api/client';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { listProducts } from '@/lib/inventory';
import { isSupplierPrintTemplate } from '@/lib/plans';
import { scoped } from '@/lib/scoped';
import LabelCard, { TEMPLATES } from '@/components/print/LabelCard';
import CountSheet from '@/components/print/CountSheet';
import PickList from '@/components/print/PickList';
import OrderPicker from '@/components/print/OrderPicker';
import PurchaseOrderDoc from '@/components/print/PurchaseOrderDoc';
import CustomerDoc from '@/components/print/CustomerDoc';
import ReturnDoc from '@/components/print/ReturnDoc';
import CustomerOrderPicker from '@/components/print/CustomerOrderPicker';
import ReturnPicker from '@/components/print/ReturnPicker';
import ProductPicker from '@/components/print/ProductPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function PrintCenter() {
  const { profile, activeId } = useBusiness();
  // Supplier print styles are Business-only: the two options stay hidden
  // while the plan is still loading, so a Business account never briefly
  // loses them the way the limits did. Once Essentials is confirmed, they
  // show as visibly locked entries linking to /upgrade instead of staying
  // hidden — hiding them entirely gave Essentials no upsell path and left
  // the locked preview panel near-unreachable.
  const { isEssentials, isLoading: entitlementLoading } = useEntitlements();
  const showSupplierDocs = !isEssentials && !entitlementLoading;
  const visibleTemplates = TEMPLATES.filter(
    (entry) => showSupplierDocs || !isSupplierPrintTemplate(entry.key)
  );
  const lockedSupplierTemplates =
    isEssentials && !entitlementLoading
      ? TEMPLATES.filter((entry) => isSupplierPrintTemplate(entry.key))
      : [];
  const [template, setTemplate] = useState('price');
  const [copies, setCopies] = useState('1');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);
  const [orders, setOrders] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [customerOrders, setCustomerOrders] = useState([]);
  const [customerOrderId, setCustomerOrderId] = useState('');
  const [returnRecords, setReturnRecords] = useState([]);
  const [returnId, setReturnId] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const products = await listProducts({ search: debounced, limit: 100, businessId: activeId || '' });
      if (cancelled) return;
      setItems(products);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, activeId]);

  const needsOrder = template === 'po' || template === 'packing';
  const needsCustomerOrder = ['invoice', 'receipt', 'custpacking'].includes(template);
  const needsReturn = template === 'returndoc';

  // A supplier style picked on Business must not linger once the plan is
  // known to be Essentials (or while it is still loading).
  useEffect(() => {
    if (isEssentials && isSupplierPrintTemplate(template)) setTemplate('price');
  }, [isEssentials, template]);

  useEffect(() => {
    if (!needsOrder || !activeId || !showSupplierDocs) return;
    let cancelled = false;
    (async () => {
      const page = await base44.entities.PurchaseOrder.filter(scoped({}, activeId), {
        sort: '-created_date',
        limit: 50,
      });
      if (cancelled) return;
      setOrders(page.items ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [needsOrder, activeId, showSupplierDocs]);

  useEffect(() => {
    if ((!needsCustomerOrder && !needsReturn) || !activeId) return;
    let cancelled = false;
    (async () => {
      const [orderPage, returnPage] = await Promise.all([
        needsCustomerOrder
          ? base44.entities.Order.filter(scoped({}, activeId), { sort: '-created_date', limit: 50 })
          : Promise.resolve({ items: [] }),
        needsReturn
          ? base44.entities.Return.filter(scoped({}, activeId), { sort: '-created_date', limit: 50 })
          : Promise.resolve({ items: [] }),
      ]);
      if (cancelled) return;
      setCustomerOrders(orderPage.items ?? []);
      setReturnRecords(returnPage.items ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [needsCustomerOrder, needsReturn, activeId]);

  const selectedIds = selected.map((product) => product.id);

  const toggle = (product) => {
    setSelected((list) =>
      list.some((entry) => entry.id === product.id)
        ? list.filter((entry) => entry.id !== product.id)
        : [...list, product]
    );
  };

  const removeSelected = (id) => setSelected((list) => list.filter((entry) => entry.id !== id));

  const activeTemplate = TEMPLATES.find((entry) => entry.key === template);
  const isDocument = activeTemplate?.kind === 'document';
  const isOrder = activeTemplate?.kind === 'order';
  const isCustomerDoc = activeTemplate?.kind === 'customer';
  const isReturnDoc = activeTemplate?.kind === 'return';
  const pickedDoc = isOrder || isCustomerDoc || isReturnDoc;
  const Sheet = template === 'count' ? CountSheet : PickList;
  const order = orders.find((entry) => entry.id === orderId) || null;
  const customerOrder = customerOrders.find((entry) => entry.id === customerOrderId) || null;
  const returnRecord = returnRecords.find((entry) => entry.id === returnId) || null;

  const labels = useMemo(() => {
    const count = Math.min(Math.max(Number(copies) || 1, 1), 20);
    return selected.flatMap((product) => Array.from({ length: count }, () => product));
  }, [selected, copies]);

  // A supplier style must never preview or print on Essentials, even from a
  // stale selection: the style list hides it, and this blocks the document
  // and the Print button as well. Printing is client-side (window.print of
  // this preview) and there is no backend document endpoint, so the render
  // guard is the enforcement — the same shape as the export button.
  const supplierBlocked = isSupplierPrintTemplate(template) && !showSupplierDocs;

  const nothingPicked = isOrder
    ? !order
    : isCustomerDoc
      ? !customerOrder
      : isReturnDoc
        ? !returnRecord
        : isDocument
          ? selected.length === 0
          : labels.length === 0;

  const blank = supplierBlocked || nothingPicked;

  const summaryTitle = isOrder
    ? order
      ? `${order.number} · ${(order.lines || []).length} line${(order.lines || []).length === 1 ? '' : 's'}`
      : 'No purchase order chosen'
    : isCustomerDoc
      ? customerOrder
        ? `${customerOrder.number} · ${(customerOrder.lines || []).length} line${(customerOrder.lines || []).length === 1 ? '' : 's'}`
        : 'No customer order chosen'
      : isReturnDoc
        ? returnRecord
          ? `${returnRecord.number} · ${(returnRecord.lines || []).length} line${(returnRecord.lines || []).length === 1 ? '' : 's'}`
          : 'No return chosen'
        : isDocument
          ? `${selected.length} line${selected.length === 1 ? '' : 's'} on one sheet`
          : `${labels.length} label${labels.length === 1 ? '' : 's'}`;

  const summarySub = isOrder
    ? `${activeTemplate?.label} · ${order ? order.supplier_name : 'pick a purchase order'}`
    : isCustomerDoc
      ? `${activeTemplate?.label} · ${
          customerOrder ? customerOrder.customer_name || 'no customer name' : 'pick a customer order'
        }`
      : isReturnDoc
        ? `${activeTemplate?.label} · ${
            returnRecord
              ? returnRecord.customer_name || returnRecord.order_number || 'no customer'
              : 'pick a return'
          }`
        : `${activeTemplate?.label} · ${selected.length} product${
            selected.length === 1 ? '' : 's'
          } selected`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 no-print">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Print center</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Labels &amp; sheets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {showSupplierDocs
              ? 'Scannable labels, stock sheets, pick lists, purchase orders, customer invoices, receipts and return documents.'
              : 'Scannable labels, stock sheets, pick lists, customer invoices, receipts and return documents.'}
          </p>
        </div>
        <Button onClick={() => window.print()} disabled={blank}>
          <Printer className="mr-1.5 h-4 w-4" /> Print
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4 no-print">
          <div className="rounded-xl border border-border bg-card p-4">
            <Label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Print style
            </Label>
            <div className="mt-2 grid gap-1.5">
              {visibleTemplates.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setTemplate(entry.key)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    template === entry.key
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="block text-sm font-medium">{entry.label}</span>
                  <span
                    className={`block text-[11px] ${
                      template === entry.key ? 'text-primary-foreground/60' : 'text-muted-foreground'
                    }`}
                  >
                    {entry.hint}
                  </span>
                </button>
              ))}
              {lockedSupplierTemplates.map((entry) => (
                <Link
                  key={entry.key}
                  to="/upgrade"
                  className="rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {entry.label}
                    <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      Business
                    </span>
                  </span>
                  <span className="block text-[11px] text-muted-foreground">{entry.hint}</span>
                </Link>
              ))}
            </div>
          </div>

          {isOrder ? (
            <OrderPicker orders={orders} value={orderId} onChange={setOrderId} />
          ) : isCustomerDoc ? (
            <CustomerOrderPicker
              orders={customerOrders}
              value={customerOrderId}
              onChange={setCustomerOrderId}
            />
          ) : isReturnDoc ? (
            <ReturnPicker returns={returnRecords} value={returnId} onChange={setReturnId} />
          ) : (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <Label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Products
              </Label>
              {!isDocument && (
                <Input
                  type="number"
                  min="1"
                  max="20"
                  inputMode="numeric"
                  value={copies}
                  onChange={(event) => setCopies(event.target.value)}
                  className="h-8 w-16 text-center"
                  aria-label="Copies per product"
                />
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {isDocument ? 'All selected items print on one sheet' : 'Copies of each label'}
            </p>
            <div className="mt-3">
              <ProductPicker
                products={items}
                loading={loading}
                search={search}
                onSearch={setSearch}
                selectedIds={selectedIds}
                onToggle={toggle}
              />
            </div>
          </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card print:border-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 no-print">
            <div>
              <p className="text-sm font-medium">{summaryTitle}</p>
              <p className="text-[11px] text-muted-foreground">{summarySub}</p>
            </div>
            {!pickedDoc && selected.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                Clear selection
              </Button>
            )}
          </div>

          {!pickedDoc && selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2 no-print">
              {selected.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => removeSelected(product.id)}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px]"
                >
                  {product.sku}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}

          <div className="print-area overflow-x-auto bg-muted/30 p-4 print:overflow-visible">
            {supplierBlocked ? (
              <div className="px-4 py-16 text-center">
                <Lock className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">
                  {activeTemplate?.label} is a Business feature
                </p>
                <p className="mx-auto mt-1 max-w-[280px] text-xs text-muted-foreground">
                  Supplier documents go with the Business plan — suppliers, purchasing and
                  purchase orders. Everything you have now keeps working.
                </p>
                <Button asChild className="mt-4">
                  <Link to="/upgrade">
                    See what Business includes <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : blank ? (
              <div className="px-4 py-16 text-center">
                <Printer className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">Nothing to print yet</p>
                <p className="mx-auto mt-1 max-w-[280px] text-xs text-muted-foreground">
                  {isOrder
                    ? 'Pick a purchase order from the list to preview the document.'
                    : isCustomerDoc
                      ? 'Pick a customer order from the list to preview the document.'
                      : isReturnDoc
                        ? 'Pick a logged return from the list to preview the document.'
                        : 'Choose a style, then pick products from the list. The preview shows exactly what comes out of the printer.'}
                </p>
              </div>
            ) : isOrder ? (
              <PurchaseOrderDoc order={order} business={profile} mode={activeTemplate.mode} />
            ) : isCustomerDoc ? (
              <CustomerDoc order={customerOrder} business={profile} mode={activeTemplate.mode} />
            ) : isReturnDoc ? (
              <ReturnDoc ret={returnRecord} business={profile} />
            ) : isDocument ? (
              <Sheet products={selected} business={profile} />
            ) : (
              <div className="flex flex-wrap gap-3">
                {labels.map((product, index) => (
                  <LabelCard
                    key={`${product.id}-${index}`}
                    template={template}
                    product={product}
                    business={profile}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}