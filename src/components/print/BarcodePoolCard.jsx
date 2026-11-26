import { useEffect, useState } from 'react';
import { Barcode, Bluetooth, Download, Printer, Usb } from 'lucide-react';
import { t } from '@/lib/i18n';
import { fetchPoolSummary, mintPoolCodes, poolCodeLabel } from '@/lib/barcodePool';
import {
  bluetoothAvailable,
  BLUETOOTH_UNAVAILABLE_COPY,
  printLabelsViaBluetooth,
} from '@/lib/bluetoothPrint';
import { usbAvailable, USB_UNAVAILABLE_COPY, printLabelsViaUsb } from '@/lib/usbPrint';
import { downloadLabelsPdf } from '@/lib/labelsPdf';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The barcode pool door (the owner's spec, Nov 25, 2026):
 * "Generate barcodes" in the Print section, on BOTH plans.
 *
 * The owner says how many codes they need — NO LIMIT — and the
 * app mints that many unique house codes into this business's
 * pool. The codes are in the pool either way; the moment they
 * are minted the owner is asked what to do with them: print
 * them now as labels through the existing label machinery (the
 * batch takes over the page's preview and the direct-printer
 * doors below), or save them as a PDF to print later. A saved
 * PDF is built from the very codes just minted, so it matches
 * the pool exactly.
 *
 * Owner-only: the card renders only for the boss (PrintCenter
 * gates it), and the server refuses a non-owner mint outright.
 */
export default function BarcodePoolCard({ businessId, businessName, batch, onBatch, onPrintNow }) {
  const [count, setCount] = useState('');
  const [busy, setBusy] = useState(false);
  const [directBusy, setDirectBusy] = useState('');
  const [status, setStatus] = useState('');
  const [waiting, setWaiting] = useState(null);
  const [canBluetooth] = useState(() => bluetoothAvailable());
  const [canUsb] = useState(() => usbAvailable());

  useEffect(() => {
    setWaiting(null);
    if (!businessId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const summary = await fetchPoolSummary(businessId);
        if (!cancelled) setWaiting(summary.waiting ?? 0);
      } catch {
        if (!cancelled) setWaiting(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const labels = (batch || []).map((code) => poolCodeLabel(code, businessName));

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await mintPoolCodes(businessId, Number(count));
      onBatch(result.codes || []);
      setWaiting(result.waiting ?? null);
      setStatus(t('print.pool.minted', { count: (result.codes || []).length, s: (result.codes || []).length === 1 ? '' : 's' }));
      setCount('');
    } catch (error) {
      setStatus(error?.message || t('print.pool.failed'));
    } finally {
      setBusy(false);
    }
  };

  const savePdf = () => {
    if (!labels.length) return;
    try {
      downloadLabelsPdf(labels, {
        businessName,
        filename: `${businessName || 'business'}-barcodes.pdf`,
      });
      setStatus(t('print.labelsPdfDownloaded'));
    } catch {
      setStatus(t('print.pdfFailed'));
    }
  };

  const printDirect = async (kind) => {
    if (!labels.length || directBusy) return;
    setDirectBusy(kind);
    setStatus('');
    try {
      const result =
        kind === 'bluetooth'
          ? await printLabelsViaBluetooth(labels, {})
          : await printLabelsViaUsb(labels, {});
      setStatus(t('print.sentToPrinter', { bytes: result.bytes, deviceName: result.deviceName }));
    } catch (error) {
      setStatus(error?.message || t('print.printFailed'));
    } finally {
      setDirectBusy('');
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('print.pool.title')}
      </Label>
      <p className="mt-1 text-[11px] text-muted-foreground">{t('print.pool.intro')}</p>
      {waiting !== null && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t('print.pool.waiting', { count: waiting, s: waiting === 1 ? '' : 's' })}
        </p>
      )}
      <div className="mt-3 space-y-1.5">
        <Label htmlFor="pool-count">{t('print.pool.countLabel')}</Label>
        <div className="flex gap-2">
          <Input
            id="pool-count"
            type="number"
            min="1"
            inputMode="numeric"
            value={count}
            onChange={(event) => setCount(event.target.value)}
            className="h-9"
          />
          <Button onClick={generate} disabled={busy || !(Number(count) >= 1)}>
            <Barcode className="mr-1.5 h-4 w-4" />
            {busy ? t('print.pool.generating') : t('print.pool.generate')}
          </Button>
        </div>
      </div>

      {batch && batch.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onPrintNow()}>
              <Printer className="mr-1.5 h-4 w-4" /> {t('print.pool.printNow')}
            </Button>
            <Button size="sm" variant="outline" onClick={savePdf}>
              <Download className="mr-1.5 h-4 w-4" /> {t('print.pool.savePdf')}
            </Button>
            {canBluetooth ? (
              <Button size="sm" variant="outline" onClick={() => printDirect('bluetooth')} disabled={Boolean(directBusy)}>
                <Bluetooth className="mr-1.5 h-4 w-4" />
                {directBusy === 'bluetooth' ? t('print.sending') : t('print.bluetooth')}
              </Button>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted-foreground">{BLUETOOTH_UNAVAILABLE_COPY}</p>
            )}
            {canUsb ? (
              <Button size="sm" variant="outline" onClick={() => printDirect('usb')} disabled={Boolean(directBusy)}>
                <Usb className="mr-1.5 h-4 w-4" />
                {directBusy === 'usb' ? t('print.sending') : t('print.usb')}
              </Button>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted-foreground">{USB_UNAVAILABLE_COPY}</p>
            )}
          </div>
        </div>
      )}
      {status && <p className="mt-2 text-[11px] text-muted-foreground">{status}</p>}
    </div>
  );
}
