import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
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

const MODES = [
  { key: 'receive', label: 'Add stock', hint: 'Stock that arrived' },
  { key: 'sale', label: 'Remove stock', hint: 'Sold or used' },
  { key: 'count', label: 'Set exact count', hint: 'Counted on the shelf' },
];

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
      setError('Choose where this stock sits.');
      return;
    }
    if (mode === 'count' ? qty < 0 : qty < 1) {
      setError(mode === 'count' ? 'Enter the counted quantity.' : 'Enter how many.');
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
      setError(err?.message || 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">Adjust {product.name}</DialogTitle>
          <DialogDescription>
            {product.sku ? `SKU ${product.sku} · ` : ''}Every change is recorded in the movement ledger.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>What happened</Label>
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
            <Label>Location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a location" />
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
            <Label>{mode === 'count' ? 'Counted quantity' : 'Quantity'}</Label>
            <QuantityStepper value={quantity} onChange={setQuantity} allowZero={mode === 'count'} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="adjust-note">Note</Label>
            <Input
              id="adjust-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            <Check className="mr-1.5 h-4 w-4" />
            {busy ? 'Saving…' : 'Save change'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}