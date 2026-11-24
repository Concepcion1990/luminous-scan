import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { ArrowRightLeft, Check, Plus, Printer } from 'lucide-react';
import TransferDoc from '@/components/print/TransferDoc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBusiness } from '@/hooks/useBusiness';
import { useAuth } from '@/lib/AuthContext';
import { scoped } from '@/lib/scoped';
import { resolveDocStyle } from '@/lib/docStyle';
import { formatDateTime } from '@/lib/dates';
import { recordMovement } from '@/lib/inventory';
import { t } from '@/lib/i18n';

/**
 * Transfer documents (release 361, Nov 23, 2026): the
 * app's location transfers, gathered as documents. A
 * transfer settles at once — the transfer and transfer-in
 * movements are its two sides — and each document prints as
 * one Studio sheet that can travel with the goods. A new
 * transfer rides the same recordMovement pair every other
 * door uses; there is no second pending state for locations.
 */
export default function RestaurantTransfers() {
  const { activeId, record, profile } = useBusiness();
  const { user } = useAuth();
  const [movements, setMovements] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState('');
  const [printingDoc, setPrintingDoc] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);

  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);

  useEffect(() => {
    (async () => {
      const [movementPage, productPage, locPage] = await Promise.all([
        base44.entities.StockMovement.filter(scoped({}, activeId), { sort: '-created_date', limit: 1000 }),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      ]);
      setMovements(movementPage.items ?? []);
      setProducts(productPage.items ?? []);
      setLocations(locPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  // One document per transfer event: the out-side rows,
  // grouped by their shared reference when they carry one,
  // else by the minute and the two locations they join.
  // The destination rides the out row (stamped at the
  // movement funnel); a transfer written before that stamp
  // existed borrows it from its transfer_in sibling — the
  // in row's own shelf IS the destination.
  const docs = useMemo(() => {
    const inByReference = new Map();
    for (const movement of movements) {
      if (movement.type === 'transfer_in' && movement.reference && !inByReference.has(movement.reference)) {
        inByReference.set(movement.reference, movement);
      }
    }
    const byKey = new Map();
    for (const movement of movements) {
      if (movement.type !== 'transfer') continue;
      const key =
        movement.reference ||
        `${String(movement.created_date || '').slice(0, 16)}|${movement.location_id}|${movement.to_location_id || movement.to_location_name || ''}`;
      if (!byKey.has(key)) {
        const sibling = movement.reference ? inByReference.get(movement.reference) : null;
        byKey.set(key, {
          key,
          reference: movement.reference || '',
          fromName: movement.location_name || '',
          toName: movement.to_location_name || sibling?.location_name || '',
          date: movement.created_date,
          by: movement.user_name || '',
          lines: [],
        });
      }
      byKey.get(key).lines.push(movement);
    }
    return [...byKey.values()];
  }, [movements]);

  const printDoc = (doc) => {
    setPrintingDoc(doc);
    setTimeout(() => {
      window.print();
      setPrintingDoc(null);
    }, 50);
  };

  const saveTransfer = async () => {
    setError('');
    const product = products.find((p) => p.id === productId);
    const from = locations.find((l) => l.id === fromId);
    const to = locations.find((l) => l.id === toId);
    if (!product || !from || !to) {
      setError(t('ops.transfers.needAll'));
      return;
    }
    if (from.id === to.id) {
      setError(t('ops.transfers.needDifferent'));
      return;
    }
    if (!(Number(quantity) > 0)) {
      setError(t('ops.transfers.needQuantity'));
      return;
    }
    setSaving(true);
    try {
      await recordMovement({
        product,
        location: from,
        type: 'transfer',
        quantity: Number(quantity),
        toLocation: to,
        user,
        reference: `transfer-${Date.now()}`,
        businessId: activeId || '',
      });
      setDialogOpen(false);
      setFlash(t('ops.transfers.saved', { name: product.name, from: from.name, to: to.name }));
      setReload((n) => n + 1);
    } catch (e) {
      setError(e.message || t('ops.transfers.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('ops.transfers.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('ops.transfers.subtitle')}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('ops.transfers.newButton')}
        </Button>
      </div>

      {flash && (
        <p className="no-print flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      <div className="no-print space-y-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
        ) : docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <ArrowRightLeft className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{t('ops.transfers.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('ops.transfers.emptyBody')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {docs.map((doc) => (
              <div key={doc.key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
                <div>
                  <p className="font-medium">
                    {doc.fromName} → {doc.toName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {doc.date ? formatDateTime(doc.date) : ''}
                    {doc.by ? ` · ${doc.by}` : ''}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {doc.lines.map((line) => `${line.product_name} × ${line.quantity}`).join(' · ')}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => printDoc(doc)}>
                  <Printer className="mr-1.5 h-4 w-4" /> {t('ops.transfers.printButton')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {printingDoc ? (
        <div className="print-area hidden print:block">
          <TransferDoc doc={printingDoc} business={record} docStyle={docStyle} />
        </div>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('ops.transfers.newTitle')}</DialogTitle>
            <DialogDescription>{t('ops.transfers.dialogIntro')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('ops.transfers.productLabel')}</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder={t('ops.transfers.productPick')} /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('ops.transfers.fromLabel')}</Label>
                <Select value={fromId} onValueChange={setFromId}>
                  <SelectTrigger><SelectValue placeholder={t('ops.transfers.locationPick')} /></SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('ops.transfers.toLabel')}</Label>
                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger><SelectValue placeholder={t('ops.transfers.locationPick')} /></SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('ops.transfers.quantityLabel')}</Label>
                <Input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
            </div>
            {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('recipes.cancel')}</Button>
            <Button onClick={saveTransfer} disabled={saving}>{saving ? t('recipes.saving') : t('ops.transfers.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
