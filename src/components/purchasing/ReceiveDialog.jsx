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
import { money, openQty, receiveOrder } from '@/lib/purchasing';

export default function ReceiveDialog({ open, onOpenChange, order, products, locations, currency, onReceived }) {
  const [qty, setQty] = useState({});
  const [locationId, setLocationId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!open || !order) return;
    setError('');
    setNote('');
    setBusy(false);
    setLocationId(order.location_id || locations[0]?.id || '');
    const next = {};
    (order.lines || []).forEach((line, index) => {
      next[index] = String(openQty(line));
    });
    setQty(next);
    base44.auth.me().then(setUser).catch(() => setUser(null));
  }, [open, order, locations]);

  if (!order) return null;

  const submit = async () => {
    const location = locations.find((l) => l.id === locationId);
    if (!location) {
      setError('Choose where the stock is going.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const receipts = (order.lines || []).map((_, index) => Number(qty[index]) || 0);
      const result = await receiveOrder({ order, receipts, products, location, user, note });
      onReceived?.(result);
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Could not receive this order.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Receive {order.number}</DialogTitle>
          <DialogDescription>
            {order.supplier_name} · stock is added at the location you pick, with this order's cost.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Receiving location</Label>
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

          <div className="space-y-2">
            {(order.lines || []).map((line, index) => {
              const outstanding = openQty(line);
              return (
                <div key={index} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.product_name}</p>
                      <p className="numeric font-mono text-[10px] text-muted-foreground">
                        {line.sku} · {money(line.unit_cost, currency)} each · {outstanding} still due
                      </p>
                    </div>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max={outstanding}
                      value={qty[index] ?? ''}
                      onChange={(e) => setQty((q) => ({ ...q, [index]: e.target.value }))}
                      className="w-[72px] shrink-0 text-right"
                      disabled={!outstanding}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="receive-note">Note (optional)</Label>
            <Input
              id="receive-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Invoice number, damaged carton, short shipment"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Receiving…' : 'Receive into stock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}