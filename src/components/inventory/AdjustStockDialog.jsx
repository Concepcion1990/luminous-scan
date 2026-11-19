import { useEffect, useRef, useState } from 'react';
import { Check, ScanLine } from 'lucide-react';
import { t } from '@/lib/i18n';

import { findProductsByCode, recordAdjustment } from '@/lib/inventory';
import BarcodeScanner from '@/components/scan/BarcodeScanner';
import AddLocationInline from '@/components/locations/AddLocationInline';
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
  const [mode, setMode] = useState('receive');
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Scan-to-tally (owner ruling, Nov 16, 2026): in Receive, the
  // button beside the quantity stepper opens this sheet's own
  // scanner; every scan of THIS product adds +1 to the very same
  // quantity the arrows control. The tally only fills the number —
  // Save change remains the one confirm that writes the movement.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [tallyNote, setTallyNote] = useState(null);
  const quantityRef = useRef('1');
  const scanQueueRef = useRef(Promise.resolve());
  // The dialog opens on a default quantity of 1 that no scan has
  // claimed yet: the first scan stands for that 1 (the item in
  // hand), later scans add. Any hand touch of the stepper ends
  // the fresh state — from then on every scan adds one more.
  const tallyFreshRef = useRef(true);
  // The dialog keeps its own copy of the location list so the
  // inline "add a location" door (shown when the list is empty —
  // the dead end the owner hit) can add + preselect a location
  // without leaving the dialog.
  const [localLocations, setLocalLocations] = useState(locations);

  const MODES = [
    { key: 'receive', label: t('inventory.modeReceive'), hint: t('inventory.modeReceiveHint') },
    { key: 'sale', label: t('inventory.modeSale'), hint: t('inventory.modeSaleHint') },
    { key: 'count', label: t('inventory.modeCount'), hint: t('inventory.modeCountHint') },
  ];

  useEffect(() => {
    if (!open) return;
    setLocalLocations(locations);
    setMode('receive');
    setQuantity('1');
    quantityRef.current = '1';
    tallyFreshRef.current = true;
    setNote('');
    setError('');
    setBusy(false);
    setScannerOpen(false);
    setTallyNote(null);
    setLocationId(defaultLocationId || locations[0]?.id || '');
  }, [open, defaultLocationId, locations]);

  const changeQuantity = (value) => {
    quantityRef.current = value;
    setQuantity(value);
  };

  // Hand control of the stepper: the number is the user's own now.
  const changeQuantityByHand = (value) => {
    tallyFreshRef.current = false;
    changeQuantity(value);
  };

  const processTallyScan = async (code) => {
    try {
      const matches = await findProductsByCode(code, businessId);
      if (!matches.length) {
        setTallyNote({ ok: false, text: t('counts.noProductMatch', { code }) });
        return;
      }
      const match = matches[0];
      if (match.id !== product.id) {
        // This sheet is for one product only: a different product's
        // scan is named and adds nothing.
        setTallyNote({
          ok: false,
          text: t('scanTally.otherProduct', { name: match.name, product: product.name }),
        });
        return;
      }
      if ((product.status || 'active') === 'archived') {
        setTallyNote({ ok: false, text: t('inventoryLib.archivedFrozen', { name: product.name }) });
        return;
      }
      if (tallyFreshRef.current && (Number(quantityRef.current) || 0) === 1) {
        tallyFreshRef.current = false;
        setTallyNote({ ok: true, text: t('scanTally.scanned', { name: product.name, count: 1 }) });
        return;
      }
      tallyFreshRef.current = false;
      const next = (Number(quantityRef.current) || 0) + 1;
      changeQuantity(String(next));
      setTallyNote({ ok: true, text: t('scanTally.scanned', { name: product.name, count: next }) });
    } catch (e) {
      setTallyNote({ ok: false, text: e.message || t('counts.codeReadFailed') });
    }
  };

  const handleTallyDetect = (raw) => {
    const code = String(raw || '').trim();
    if (!code) return;
    // Serialize captures, exactly as on the count sheet: the
    // camera re-arms itself, and queued scans must land in order.
    scanQueueRef.current = scanQueueRef.current
      .then(() => processTallyScan(code))
      .catch(() => {});
  };

  if (!product) return null;

  const location = localLocations.find((place) => place.id === locationId) || null;

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
      await recordAdjustment({
        product,
        location,
        type: mode,
        quantity: qty,
        note: note.trim(),
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
            {localLocations.length === 0 ? (
              <AddLocationInline
                businessId={businessId}
                onCreated={(place) => {
                  setLocalLocations([place]);
                  setLocationId(place.id);
                  setError('');
                }}
              />
            ) : (
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('inventory.chooseLocationPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {localLocations.map((place) => (
                    <SelectItem key={place.id} value={place.id}>
                      {place.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-2">
            <Label>{mode === 'count' ? t('inventory.countedQuantity') : t('inventory.quantityLabel')}</Label>
            <QuantityStepper value={quantity} onChange={changeQuantityByHand} allowZero={mode === 'count'} />
            {mode === 'receive' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setTallyNote(null);
                  setScannerOpen(true);
                }}
              >
                <ScanLine className="mr-1.5 h-4 w-4" /> {t('scanTally.title')}
              </Button>
            )}
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

        {/* Tally scanner overlay: this sheet's own scanner, opened
            from beside the quantity stepper. It tallies into the
            quantity above and nothing else — Save change is still
            the only write. */}
        {scannerOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm space-y-3 rounded-xl bg-card p-4 shadow-lg">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <ScanLine className="h-4 w-4" /> {t('scanTally.title')}
              </p>
              <BarcodeScanner onDetect={handleTallyDetect} />
              <p className="text-sm text-muted-foreground">{t('scanTally.hint')}</p>
              {tallyNote && (
                <p
                  className={`flex items-start gap-1.5 text-sm ${
                    tallyNote.ok ? 'text-ok' : 'text-destructive'
                  }`}
                  role="status"
                >
                  {tallyNote.ok && <Check className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>{tallyNote.text}</span>
                </p>
              )}
              <Button type="button" className="w-full" onClick={() => setScannerOpen(false)}>
                {t('scanTally.done')}
              </Button>
            </div>
          </div>
        )}

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