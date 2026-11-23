import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
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
import { withBusiness } from '@/lib/scoped';
import { t } from '@/lib/i18n';

/**
 * One par level (release 359, Nov 23, 2026): how much of an
 * ingredient should be on hand — for the whole business, or
 * for one of its own locations. The pack size is how the
 * supplier sells it; the order guide rounds a shortfall UP to
 * whole packs. The supplier is optional — the guide falls
 * back to the product's own supplier.
 */
export default function ParDialog({ open, onOpenChange, par, products, locations, suppliers, onSaved }) {
  const { activeId } = useBusiness();
  const [productId, setProductId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [parQty, setParQty] = useState(0);
  const [packSize, setPackSize] = useState(1);
  const [supplierId, setSupplierId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setProductId(par?.product_id || '');
    setLocationId(par?.location_id || '');
    setParQty(par?.par_qty ?? 0);
    setPackSize(par?.pack_size ?? 1);
    setSupplierId(par?.supplier_id || '');
    setError('');
  }, [open, par]);

  const save = async () => {
    setError('');
    const product = products.find((p) => p.id === productId);
    if (!product) {
      setError(t('pars.needProduct'));
      return;
    }
    if (!(Number(parQty) >= 0)) {
      setError(t('pars.needPar'));
      return;
    }
    if (!(Number(packSize) > 0)) {
      setError(t('pars.needPack'));
      return;
    }
    const zone = locations.find((l) => l.id === locationId);
    const supplier = suppliers.find((s) => s.id === supplierId);
    setSaving(true);
    try {
      const values = withBusiness(
        {
          product_id: product.id,
          product_name: product.name,
          sku: product.sku || '',
          location_id: zone?.id || '',
          location_name: zone?.name || '',
          par_qty: Number(parQty),
          pack_size: Number(packSize),
          supplier_id: supplier?.id || '',
          supplier_name: supplier?.name || '',
        },
        activeId
      );
      if (par) await base44.entities.Par.update(par.id, values);
      else await base44.entities.Par.create(values);
      onOpenChange(false);
      onSaved(t('pars.saved', { name: product.name }));
    } catch (e) {
      setError(e.message || t('pars.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{par ? t('pars.editTitle') : t('pars.newTitle')}</DialogTitle>
          <DialogDescription>{t('pars.dialogIntro')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('pars.productLabel')}</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder={t('pars.productPick')} /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('pars.locationLabel')}</Label>
              <Select value={locationId || 'all'} onValueChange={(v) => setLocationId(v === 'all' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('pars.locationAll')}</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('pars.supplierLabel')}</Label>
              <Select value={supplierId || 'product'} onValueChange={(v) => setSupplierId(v === 'product' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">{t('pars.supplierFromProduct')}</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('pars.parLabel')}</Label>
              <Input type="number" min="0" step="any" value={parQty} onChange={(e) => setParQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('pars.packLabel')}</Label>
              <Input type="number" min="0" step="any" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
            </div>
          </div>
          {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('recipes.cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('recipes.saving') : t('recipes.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
