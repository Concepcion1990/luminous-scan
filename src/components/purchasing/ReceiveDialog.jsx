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
import { t } from '@/lib/i18n';

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
      setError(t('purchasing.chooseLocationError'));
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
      setError(err?.message || t('purchasing.receiveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('purchasing.receiveTitle', { number: order.number })}</DialogTitle>
          <DialogDescription>
            {t('purchasing.receiveDescription', { supplier: order.supplier_name })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t('purchasing.receivingLocation')}</Label>
            <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder={t('purchasing.chooseLocation')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('purchasing.chooseLocation')}</SelectItem>
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
                        {t('purchasing.lineDetail', {
                          sku: line.sku,
                          cost: money(line.unit_cost, currency),
                          due: outstanding,
                        })}
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
            <Label htmlFor="receive-note">{t('purchasing.noteOptional')}</Label>
            <Input
              id="receive-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('purchasing.notePlaceholder')}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('purchasing.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? t('purchasing.receiving') : t('purchasing.receiveIntoStock')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}