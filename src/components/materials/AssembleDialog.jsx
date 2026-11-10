import { useEffect, useState } from 'react';
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
import { assembleBom, availabilityAt, componentRows } from '@/lib/bom';
import { t } from '@/lib/i18n';

export default function AssembleDialog({ open, onOpenChange, bom, locations, levels, user, onDone }) {
  const { activeId } = useBusiness();
  const [locationId, setLocationId] = useState('');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLocationId(locations[0]?.id || '');
    setQty('1');
    setError('');
  }, [open, locations]);

  const location = locations.find((l) => l.id === locationId);
  const amount = Math.max(1, Math.floor(Number(qty) || 0));
  const available = availabilityAt(bom, levels, locationId);
  const rows = componentRows(bom, levels, locationId, amount);
  const short = rows.some((row) => row.short > 0);

  const build = async () => {
    setBusy(true);
    setError('');
    try {
      const product = {
        id: bom.product_id,
        name: bom.product_name,
        sku: bom.sku,
        business_id: activeId || '',
      };
      const { reference, next } = await assembleBom({
        bom,
        product,
        location,
        quantity: amount,
        user,
        businessId: activeId || '',
      });
      onOpenChange(false);
      onDone(
        t('materials.built', {
          amount,
          name: bom.product_name,
          location: location.name,
          reference,
          next,
        })
      );
    } catch (e) {
      setError(e.message || t('materials.buildFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('materials.buildTitle', { name: bom?.product_name })}</DialogTitle>
          <DialogDescription>{t('materials.buildDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">{t('materials.buildAt')}</Label>
            <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder={t('materials.chooseLocation')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('materials.chooseLocation')}</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{t('materials.howMany', { available })}</Label>
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="numeric w-24"
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between bg-muted/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <span>{t('materials.component')}</span>
              <span>{t('materials.needOnHand')}</span>
            </div>
            <div className="divide-y divide-border">
              {rows.map((row) => (
                <div key={row.component_id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{row.component_name}</p>
                    <p className="numeric font-mono text-[10px] text-muted-foreground">{row.sku}</p>
                  </div>
                  <p className={`numeric shrink-0 text-sm ${row.short ? 'text-destructive' : ''}`}>
                    {row.need} · {row.have}
                  </p>
                </div>
              ))}
              {!rows.length && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  {t('materials.noComponents')}
                </p>
              )}
            </div>
          </div>

          {short && (
            <p className="text-sm text-destructive">
              {t('materials.shortParts', { location: location?.name || t('materials.thisLocation') })}
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('materials.cancel')}
          </Button>
          <Button onClick={build} disabled={busy || short || !rows.length || !location}>
            {busy ? t('materials.building') : t('materials.buildButton', { amount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}