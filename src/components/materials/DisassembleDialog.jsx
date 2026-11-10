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
import { bundleOnHand, componentRows, disassembleBom } from '@/lib/bom';

export default function DisassembleDialog({ open, onOpenChange, bom, locations, levels, user, onDone }) {
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
  const onHand = bundleOnHand(bom, levels, locationId);
  const rows = componentRows(bom, levels, locationId, amount);
  const tooMany = amount > onHand;

  const takeApart = async () => {
    setBusy(true);
    setError('');
    try {
      const product = {
        id: bom.product_id,
        name: bom.product_name,
        sku: bom.sku,
        business_id: activeId || '',
      };
      const { reference, remaining } = await disassembleBom({
        bom,
        product,
        location,
        quantity: amount,
        user,
        businessId: activeId || '',
      });
      onOpenChange(false);
      onDone(
        `Took apart ${amount} × ${bom.product_name} at ${location.name} · ${reference}. Parts are back on the shelf; ${remaining} left.`
      );
    } catch (e) {
      setError(e.message || 'Could not take this apart.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Take apart {bom?.product_name}</DialogTitle>
          <DialogDescription>
            Each unit leaves the shelf and its parts come back at the quantities it was built with.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">Take apart at</Label>
            <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose a location</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">How many to take apart · {onHand} on hand here</Label>
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
              <span>Part coming back</span>
              <span>Returns</span>
            </div>
            <div className="divide-y divide-border">
              {rows.map((row) => (
                <div key={row.component_id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{row.component_name}</p>
                    <p className="numeric font-mono text-[10px] text-muted-foreground">{row.sku}</p>
                  </div>
                  <p className="numeric shrink-0 text-sm text-ok">+{row.need}</p>
                </div>
              ))}
              {!rows.length && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  This build list has no components yet.
                </p>
              )}
            </div>
          </div>

          {tooMany && (
            <p className="text-sm text-destructive">
              Only {onHand} × {bom?.product_name} at {location?.name || 'this location'}.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={takeApart} disabled={busy || tooMany || !rows.length || !location}>
            {busy ? 'Taking apart…' : `Take apart ${amount}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}