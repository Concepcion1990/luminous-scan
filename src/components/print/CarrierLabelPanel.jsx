import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Loader2, Printer, Trash2, Upload } from 'lucide-react';
import { apiDownload, apiRequest } from '@/api/client';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export const LABEL_MAX_BYTES = 2 * 1024 * 1024;
export const LABEL_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

/**
 * Carrier shipping-label records (Nov 14, 2026).
 *
 * The owner buys postage from the carrier — this app never sells
 * postage and never names a postage price, so the carrier's price
 * is always the true one. What lives here is the carrier's label
 * FILE, kept on the order for good as the business's record: on
 * hand just in case something happens. The hook owns the record
 * (metadata + a private object URL for the bytes, fetched through
 * the authenticated route — never a public link); the panel owns
 * the doors: upload, view, print, replace, remove.
 */
export function useCarrierLabel(businessId, orderId) {
  const [meta, setMeta] = useState(null);
  const [objectUrl, setObjectUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const urlRef = useRef('');

  const setUrl = (next) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next;
    setObjectUrl(next);
  };

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const base = businessId && orderId
    ? `/api/businesses/${businessId}/orders/${orderId}/shipping-label`
    : '';

  const loadFile = useCallback(async (path) => {
    const { blob } = await apiDownload(`${path}/file`);
    setUrl(URL.createObjectURL(blob));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setError('');
    setUrl('');
    if (!base) return undefined;
    (async () => {
      try {
        const next = await apiRequest(base);
        if (cancelled) return;
        setMeta(next);
        if (next?.exists) {
          try {
            await loadFile(base);
          } catch {
            if (!cancelled) setError(t('print.carrier.failed'));
          }
        }
      } catch {
        if (!cancelled) setMeta({ exists: false });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const upload = async (file) => {
    if (!file || !base || busy) return false;
    const typeOk =
      LABEL_TYPES.includes(file.type) || /\.(pdf|png|jpe?g)$/i.test(file.name || '');
    if (!typeOk) {
      setError(t('print.carrier.badType'));
      return false;
    }
    if (file.size > LABEL_MAX_BYTES) {
      setError(t('print.carrier.tooLarge'));
      return false;
    }
    setBusy('upload');
    setError('');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read_failed'));
        reader.readAsDataURL(file);
      });
      const next = await apiRequest(base, {
        method: 'POST',
        body: { dataUrl, filename: file.name || '' },
      });
      setMeta(next);
      await loadFile(base);
      return true;
    } catch {
      setError(t('print.carrier.failed'));
      return false;
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!base || busy) return;
    setBusy('remove');
    setError('');
    try {
      await apiRequest(base, { method: 'DELETE' });
      setMeta({ exists: false });
      setUrl('');
    } catch {
      setError(t('print.carrier.failed'));
    } finally {
      setBusy('');
    }
  };

  return { meta, objectUrl, busy, error, upload, remove };
}

export function savedDate(value) {
  if (!value) return '';
  const stamp = new Date(value);
  return Number.isNaN(stamp.getTime())
    ? ''
    : stamp.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function CarrierLabelPanel({ orderId, carrier, mode, onModeChange }) {
  const { meta, objectUrl, busy, error, upload, remove } = carrier;
  const inputRef = useRef(null);
  const isPdf = meta?.content_type === 'application/pdf';
  // The Upload door is on screen from the start (owner's phone,
  // Nov 15, 2026): before an order is picked it answers a tap
  // with the plain guidance instead of not existing — a door
  // that appears only after another step reads as missing.
  const [needOrder, setNeedOrder] = useState(false);
  useEffect(() => {
    if (orderId) setNeedOrder(false);
  }, [orderId]);

  const pickFile = () => inputRef.current?.click();

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (await upload(file)) onModeChange('uploaded');
  };

  const printUploaded = () => {
    if (isPdf) {
      // A PDF carries its own true 4×6 page — the browser's viewer
      // prints it at exactly that size.
      if (objectUrl) window.open(objectUrl, '_blank', 'noopener');
    } else {
      window.print();
    }
  };

  const removeWithConfirm = async () => {
    if (!window.confirm(t('print.carrier.removeConfirm'))) return;
    await remove();
    onModeChange('app');
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('print.carrier.title')}
      </Label>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {t('print.carrier.desc')}
      </p>

      {!orderId ? (
        <>
          <p className="mt-3 text-xs text-muted-foreground">{t('print.carrier.pickOrderFirst')}</p>
          <Button size="sm" className="mt-2" onClick={() => setNeedOrder(true)}>
            <Upload className="mr-1.5 h-4 w-4" /> {t('print.carrier.upload')}
          </Button>
          {needOrder && (
            <p className="mt-2 text-xs font-medium text-foreground">{t('print.carrier.pickFirstTap')}</p>
          )}
        </>
      ) : meta === null ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('print.carrier.title')}
        </p>
      ) : meta.exists ? (
        <>
          <p className="mt-3 text-xs">
            {t('print.carrier.onFile', {
              name: meta.filename || '—',
              date: savedDate(meta.updated_at),
            })}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5" role="group" aria-label={t('print.carrier.title')}>
            <button
              type="button"
              onClick={() => onModeChange('app')}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                mode === 'app' ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'
              }`}
            >
              {t('print.carrier.modeApp')}
            </button>
            <button
              type="button"
              onClick={() => onModeChange('uploaded')}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                mode === 'uploaded' ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'
              }`}
            >
              {t('print.carrier.modeUploaded')}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => objectUrl && window.open(objectUrl, '_blank', 'noopener')} disabled={!objectUrl}>
              <Eye className="mr-1.5 h-4 w-4" /> {t('print.carrier.view')}
            </Button>
            <Button size="sm" onClick={printUploaded} disabled={!objectUrl}>
              <Printer className="mr-1.5 h-4 w-4" /> {t('print.carrier.printUploaded')}
            </Button>
            <Button size="sm" variant="outline" onClick={pickFile} disabled={Boolean(busy)}>
              <Upload className="mr-1.5 h-4 w-4" />
              {busy === 'upload' ? t('print.carrier.uploading') : t('print.carrier.replace')}
            </Button>
            <Button size="sm" variant="ghost" onClick={removeWithConfirm} disabled={Boolean(busy)}>
              <Trash2 className="mr-1.5 h-4 w-4" /> {t('print.carrier.remove')}
            </Button>
          </div>
          {isPdf && mode === 'uploaded' && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t('print.carrier.pdfHint')}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-3 text-xs text-muted-foreground">{t('print.carrier.none')}</p>
          <Button size="sm" className="mt-2" onClick={pickFile} disabled={Boolean(busy)}>
            <Upload className="mr-1.5 h-4 w-4" />
            {busy === 'upload' ? t('print.carrier.uploading') : t('print.carrier.upload')}
          </Button>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
        className="hidden"
        onChange={onFile}
      />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
