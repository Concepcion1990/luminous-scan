import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Loader2, Printer, Trash2, Upload } from 'lucide-react';
import { apiRequest } from '@/api/client';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  LABEL_MAX_BYTES,
  LABEL_TYPES,
  savedDate,
} from '@/components/print/CarrierLabelPanel';

/**
 * The order form's own door onto the carrier-label record
 * (Nov 18, 2026 — the owner's commission, made by hand during her
 * final Essentials retest).
 *
 * ONE label, TWO doors: this section and the Print Center's
 * "Your carrier label" panel read and write the very same record
 * (order_shipping_labels, migration 025). A label attached here
 * shows in the Print Center, and one attached there shows here —
 * view, replace and remove behave the same in both places, under
 * the same rules (PDF/PNG/JPG, under 25 MB, stored byte-exact,
 * behind the session and the business check).
 *
 * On an EXISTING order the doors act on the saved order at once,
 * exactly like the Print Center. On a NEW order there is no order
 * to attach to yet, so the chosen file is staged in the form —
 * previewed from the device, nothing written — and the dialog
 * calls uploadStaged(newOrderId) the moment the order is saved.
 * Either way the owner's ruling holds: the label SAVES ONTO THE
 * ORDER PERMANENTLY. Reopen the order later and it is still there;
 * the preview is never a temporary picture.
 */

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

function stagedType(file) {
  if (file.type) return file.type;
  const name = file.name || '';
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.png$/i.test(name)) return 'image/png';
  return 'image/jpeg';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Print ONLY this label (her print-scoping ruling): a PDF opens in
 * the browser's viewer, which prints it at its true 4×6 — the
 * Print Center's own way. An image prints from a dedicated window
 * holding nothing but the label at its true 4×6 page, so nothing
 * else from the form can reach the paper.
 */
function printLabelFile(url, type) {
  if (!url) return;
  if (type === 'application/pdf') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const popup = window.open('', '_blank');
  if (!popup) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  popup.document.write(
    [
      '<!doctype html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8">',
      `<title>${escapeHtml(t('orders.shippingLabel'))}</title>`,
      '<style>',
      '  @page { size: 102mm 152mm; margin: 0; }',
      '  html, body { margin: 0; padding: 0; }',
      '  img { display: block; width: 102mm; height: 152mm; object-fit: contain; }',
      '</style>',
      '</head>',
      '<body>',
      `  <img src="${url}" alt="" onload="setTimeout(function(){ window.print(); }, 50)">`,
      '</body>',
      '</html>',
    ].join('\n'),
  );
  popup.document.close();
  popup.focus();
}

const OrderLabelField = forwardRef(function OrderLabelField(
  { businessId, orderId, carrier },
  ref,
) {
  const inputRef = useRef(null);
  const [staged, setStaged] = useState(null);
  const [stageError, setStageError] = useState('');
  const [uploading, setUploading] = useState(false);
  const stagedUrlRef = useRef('');

  const clearStaged = () => {
    if (stagedUrlRef.current) URL.revokeObjectURL(stagedUrlRef.current);
    stagedUrlRef.current = '';
    setStaged(null);
    setStageError('');
  };

  useEffect(
    () => () => {
      if (stagedUrlRef.current) URL.revokeObjectURL(stagedUrlRef.current);
    },
    [],
  );

  // The dialog's save flow asks after the order exists: is a label
  // staged, and if so, attach it to the brand-new order — through
  // the very same route the Print Center posts to.
  useImperativeHandle(
    ref,
    () => ({
      hasStaged: () => Boolean(staged),
      clearStaged,
      uploadStaged: async (newOrderId) => {
        if (!staged || !businessId || !newOrderId) return false;
        setUploading(true);
        try {
          const dataUrl = await readAsDataUrl(staged.file);
          await apiRequest(
            `/api/businesses/${businessId}/orders/${newOrderId}/shipping-label`,
            { method: 'POST', body: { dataUrl, filename: staged.file.name || '' } },
          );
          clearStaged();
          return true;
        } catch {
          return false;
        } finally {
          setUploading(false);
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staged, businessId],
  );

  const stageFile = (file) => {
    // The same file rules the Print Center enforces, word for word.
    const typeOk =
      LABEL_TYPES.includes(file.type) || /\.(pdf|png|jpe?g)$/i.test(file.name || '');
    if (!typeOk) {
      setStageError(t('print.carrier.badType'));
      return;
    }
    if (file.size > LABEL_MAX_BYTES) {
      setStageError(t('print.carrier.tooLarge'));
      return;
    }
    setStageError('');
    if (stagedUrlRef.current) URL.revokeObjectURL(stagedUrlRef.current);
    const url = URL.createObjectURL(file);
    stagedUrlRef.current = url;
    setStaged({ file, url });
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (orderId) await carrier.upload(file);
    else stageFile(file);
  };

  const removeSaved = async () => {
    if (!window.confirm(t('print.carrier.removeConfirm'))) return;
    await carrier.remove();
  };

  const saved = !orderId ? null : carrier.meta;
  const showSaved = Boolean(saved?.exists);
  const preview = showSaved
    ? { url: carrier.objectUrl, type: saved.content_type }
    : staged
      ? { url: staged.url, type: stagedType(staged.file) }
      : null;
  const busy = Boolean(carrier.busy) || uploading;
  const error = orderId ? carrier.error : stageError;

  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <Label className="text-xs">{t('orders.shippingLabel')}</Label>

      {orderId && saved === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('orders.shippingLabel')}
        </p>
      ) : preview ? (
        <>
          <div className="rounded-md border border-border bg-white p-1">
            {preview.type === 'application/pdf' ? (
              <object
                data={preview.url}
                type="application/pdf"
                className="h-52 w-full"
                aria-label={t('orders.shippingLabel')}
              >
                <span className="px-2 py-4 text-xs text-muted-foreground">
                  {showSaved ? saved.filename || '' : staged.file.name || ''}
                </span>
              </object>
            ) : (
              <img
                src={preview.url}
                alt={t('orders.shippingLabel')}
                className="mx-auto max-h-52 w-auto max-w-full object-contain"
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {showSaved
              ? t('print.carrier.onFile', {
                  name: saved.filename || '—',
                  date: savedDate(saved.updated_at),
                })
              : staged.file.name || ''}
          </p>
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline"
              onClick={() => printLabelFile(preview.url, preview.type)}
              disabled={!preview.url}
            >
              <Printer className="h-3.5 w-3.5" /> {t('print.printButton')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {busy && (carrier.busy === 'upload' || uploading)
                ? t('print.carrier.uploading')
                : t('print.carrier.replace')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={showSaved ? removeSaved : clearStaged}
              disabled={busy}
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> {t('print.carrier.remove')}
            </Button>
          </div>
          {staged && !showSaved && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t('orders.labelStagedNote')}
            </p>
          )}
        </>
      ) : (
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            {busy ? t('print.carrier.uploading') : t('orders.uploadLabel')}
          </Button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
        className="hidden"
        onChange={onFile}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
});

export default OrderLabelField;
