import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { t } from '@/lib/i18n';

import { useAuth } from '@/lib/AuthContext';
import { recordMovement } from '@/lib/inventory';
import QuantityStepper from '@/components/inventory/QuantityStepper';
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

/**
 * One product, one place, one movement: the fast way to correct what is on the
 * shelf from the inventory screen. Every change is written to the ledger.
 */
export default function AdjustStockDialog({
  open,
  onOpenChange,
  product,
  locations = [],
  businessId = '',
  defaultLocationId = '',
  onDone,
}) {
  const { user } = useAuth();
  const [mode, setMode] = useState('receive');
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const MODES = [
    { key: 'receive', label: t('inventory.modeReceive'), hint: t('inventory.modeReceiveHint') },
    { key: 'sale', label: t('inventory.modeSale'), hint: t('inventory.modeSaleHint') },
    { key: 'count', label: t('inventory.modeCount'), hint: t('inventory.modeCountHint') },
  ];

  useEffect(() => {
    if (!open) return;
    setMode('receive');
    setQuantity('1');
    setNote('');
    setError('');
    setBusy(false);
    setLocationId(defaultLocationId || locations[0]?.id || '');
  }, [open, defaultLocationId, locations]);

  if (!product) return null;

  const location = locations.find((place) => place.id === locationId) || null;

  const save = async () => {
    const qty = Number(quantity) || 0;
    if (!location) {
      setError(t('inventory.chooseLocation'));
      return;
    }
    if (mode === 'count' ? qty < 0 : qty < 1) {
      setError(mode === 'count' ? t('inventory.enterCounted') : t('inventory.enterQuantity'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await recordMovement({
        product,
        location,
        type: mode,
        quantity: qty,
        note: note.trim(),
        user,
        businessId,
      });
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      setError(err?.message || t('inventory.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">{t('inventory.adjustTitle', { name: product.name })}</DialogTitle>
          <DialogDescription>
            {product.sku ? t('inventory.adjustSku', { sku: product.sku }) : ''}{t('inventory.adjustDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t('inventory.whatHappened')}</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {MODES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setMode(option.key)}
                  className={`rounded-lg border px-2 py-2 text-left text-[11px] leading-tight transition-colors ${
                    mode === option.key
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card hover:bg-secondary'
                  }`}
                >
                  <span className="block font-medium">{option.label}</span>
                  <span className={mode === option.key ? 'text-primary-foreground/70' : 'text-muted-foreground'}>
                    {option.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t('inventory.locationLabel')}</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger>
                <SelectValue placeholder={t('inventory.chooseLocationPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {locations.map((place) => (
                  <SelectItem key={place.id} value={place.id}>
                    {place.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>{mode === 'count' ? t('inventory.countedQuantity') : t('inventory.quantityLabel')}</Label>
            <QuantityStepper value={quantity} onChange={setQuantity} allowZero={mode === 'count'} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="adjust-note">{t('inventory.noteLabel')}</Label>
            <Input
              id="adjust-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('inventory.notePlaceholder')}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('inventory.cancel')}
          </Button>
          <Button onClick={save} disabled={busy}>
            <Check className="mr-1.5 h-4 w-4" />
            {busy ? t('inventory.saving') : t('inventory.saveChange')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}