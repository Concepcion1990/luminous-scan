import { useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, Plus, Trash2 } from 'lucide-react';
import { base44 } from '@/api/client';
import {
  INVOICE_FILE_MAX_BYTES,
  getInvoiceFileMeta,
  invoiceFileBytesUrl,
  removeInvoiceFile,
  uploadInvoiceFile,
} from '@/lib/invoiceFiles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { withBusiness } from '@/lib/scoped';
import { formatMoney } from '@/lib/inventory';
import { matchInvoice } from '@/lib/restaurantOps';
import { t } from '@/lib/i18n';

const EMPTY_LINE = { product_id: '', quantity: 1, unit_cost: 0 };

/**
 * A supplier invoice (release 361, Nov 23, 2026): what the
 * supplier actually billed, line by line, optionally against
 * one of the business's purchase orders. Picking a PO shows
 * the three-way match right here — ordered, received and
 * invoiced side by side — before anything is saved; the
 * server shapes the same match onto the saved invoice. When
 * a line's price differs from the product's current cost,
 * the server opens a price alert for it. Rides the
 * restaurant.build tick.
 */
export default function InvoiceDialog({ open, onOpenChange, invoice, products, suppliers, purchaseOrders, onSaved }) {
  const { activeId, record } = useBusiness();
  const [supplierId, setSupplierId] = useState('');
  const [poId, setPoId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [status, setStatus] = useState('draft');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The paper copy (release 361): one attached file per
  // invoice, born at her universal 25 MB upload cap.
  const fileRef = useRef(null);
  const [pickedFile, setPickedFile] = useState(null);
  const [existingFile, setExistingFile] = useState(null);
  const [fileRemoved, setFileRemoved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPickedFile(null);
    setExistingFile(null);
    setFileRemoved(false);
    if (invoice?.id && activeId) {
      getInvoiceFileMeta(activeId, invoice.id)
        .then((res) => setExistingFile(res?.file || null))
        .catch(() => setExistingFile(null));
    }
  }, [open, invoice, activeId]);

  const pickFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > INVOICE_FILE_MAX_BYTES) {
      setError(t('ops.invoices.fileTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPickedFile({ name: file.name, dataUrl: String(reader.result || '') });
      setFileRemoved(false);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (!open) return;
    setSupplierId(invoice?.supplier_id || '');
    setPoId(invoice?.purchase_order_id || '');
    setInvoiceNumber(invoice?.invoice_number || '');
    setInvoiceDate(invoice?.invoice_date || '');
    setStatus(invoice?.status === 'accepted' ? 'accepted' : 'draft');
    setNote(invoice?.note || '');
    setLines(
      invoice?.lines?.length
        ? invoice.lines.map((line) => ({
            product_id: line.product_id || '',
            quantity: line.quantity ?? 1,
            unit_cost: line.unit_cost ?? 0,
          }))
        : [{ ...EMPTY_LINE }]
    );
    setError('');
  }, [open, invoice]);

  const purchaseOrder = useMemo(
    () => (purchaseOrders || []).find((po) => po.id === poId) || null,
    [purchaseOrders, poId]
  );

  const cleanLines = useMemo(
    () =>
      lines
        .filter((line) => line.product_id)
        .map((line) => {
          const product = products.find((p) => p.id === line.product_id);
          return {
            product_id: line.product_id,
            product_name: product?.name || '',
            quantity: Number(line.quantity) || 0,
            unit_cost: Number(line.unit_cost) || 0,
          };
        }),
    [lines, products]
  );

  const total = cleanLines.reduce((sum, line) => sum + line.quantity * line.unit_cost, 0);

  const preview = useMemo(
    () =>
      purchaseOrder
        ? matchInvoice({ lines: cleanLines }, purchaseOrder)
        : null,
    [purchaseOrder, cleanLines]
  );

  const setLine = (index, patch) =>
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async () => {
    setError('');
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) {
      setError(t('ops.invoices.needSupplier'));
      return;
    }
    if (!cleanLines.length || cleanLines.some((line) => !(line.quantity > 0))) {
      setError(t('ops.invoices.needLines'));
      return;
    }
    setSaving(true);
    try {
      const values = withBusiness(
        {
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          purchase_order_id: purchaseOrder?.id || '',
          po_number: purchaseOrder?.number || '',
          invoice_number: invoiceNumber.trim(),
          invoice_date: invoiceDate || null,
          lines: cleanLines,
          total,
          status,
          note: note.trim(),
        },
        activeId
      );
      let savedId = invoice?.id || '';
      if (invoice) await base44.entities.SupplierInvoice.update(invoice.id, values);
      else {
        const created = await base44.entities.SupplierInvoice.create(values);
        savedId = created?.id || '';
      }
      // The paper copy rides after the invoice itself: a
      // picked file uploads (or replaces), a marked removal
      // takes the old one off. A file failure keeps the
      // dialog open with the server's own words — the
      // invoice is saved either way and says so on retry.
      if (savedId && pickedFile) {
        await uploadInvoiceFile(activeId, savedId, {
          filename: pickedFile.name,
          dataUrl: pickedFile.dataUrl,
        });
      } else if (savedId && fileRemoved && existingFile) {
        await removeInvoiceFile(activeId, savedId);
      }
      onOpenChange(false);
      onSaved(t('ops.invoices.saved', { name: supplier.name }));
    } catch (e) {
      setError(e.message || t('ops.invoices.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{invoice ? t('ops.invoices.editTitle') : t('ops.invoices.newTitle')}</DialogTitle>
          <DialogDescription>{t('ops.invoices.dialogIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('ops.invoices.supplierLabel')}</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder={t('ops.invoices.supplierPick')} /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.invoices.poLabel')}</Label>
              <Select value={poId || 'none'} onValueChange={(v) => setPoId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('ops.invoices.poNone')}</SelectItem>
                  {(purchaseOrders || [])
                    .filter((po) => !supplierId || po.supplier_id === supplierId)
                    .map((po) => (
                      <SelectItem key={po.id} value={po.id}>
                        {po.number} · {po.supplier_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.invoices.numberLabel')}</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.invoices.dateLabel')}</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.invoices.statusLabel')}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">{t('ops.invoices.statusDraft')}</SelectItem>
                  <SelectItem value="accepted">{t('ops.invoices.statusAccepted')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>{t('ops.invoices.linesLabel')}</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((rows) => [...rows, { ...EMPTY_LINE }])}>
                <Plus className="mr-1.5 h-4 w-4" /> {t('ops.invoices.addLine')}
              </Button>
            </div>
            {lines.map((line, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <Select value={line.product_id} onValueChange={(v) => setLine(index, { product_id: v })}>
                    <SelectTrigger><SelectValue placeholder={t('ops.invoices.linePick')} /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-24">
                  <Label className="text-[11px]">{t('ops.invoices.lineQty')}</Label>
                  <Input type="number" min="0" step="any" value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} />
                </div>
                <div className="w-28">
                  <Label className="text-[11px]">{t('ops.invoices.lineCost')}</Label>
                  <Input type="number" min="0" step="any" value={line.unit_cost} onChange={(e) => setLine(index, { unit_cost: e.target.value })} />
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <p className="text-sm">
              {t('ops.invoices.totalLabel')}: <span className="font-medium">{formatMoney(total, record?.currency, 2)}</span>
            </p>
          </div>

          {preview ? (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <p className="font-medium">
                {preview.status === 'match' ? t('ops.invoices.matchOk') : t('ops.invoices.matchReview')}
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {preview.lines.map((line, index) => (
                  <li key={index}>
                    {line.product_name || line.product_id}: {t(`ops.invoices.flag.${line.flag}`)}
                    {line.ordered != null
                      ? ` · ${t('ops.invoices.matchDetail', { ordered: line.ordered, received: line.received, invoiced: line.invoiced })}`
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>{t('ops.invoices.noteLabel')}</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>

          <div className="space-y-1.5">
            <Label>{t('ops.invoices.attachFile')}</Label>
            <p className="text-xs text-muted-foreground">{t('ops.invoices.fileHint')}</p>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={pickFile}
            />
            {pickedFile ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{pickedFile.name}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPickedFile(null)}>
                  {t('ops.invoices.removeFile')}
                </Button>
              </div>
            ) : existingFile && !fileRemoved ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span>
                  {t('ops.invoices.attachedLabel')}: {existingFile.filename}
                </span>
                <a
                  className="font-medium underline underline-offset-2"
                  href={invoiceFileBytesUrl(activeId, invoice.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('ops.invoices.viewFile')}
                </a>
                <Button type="button" variant="ghost" size="sm" onClick={() => setFileRemoved(true)}>
                  {t('ops.invoices.removeFile')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  {t('ops.invoices.attachFile')}
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Paperclip className="mr-1.5 h-4 w-4" /> {t('ops.invoices.attachFile')}
              </Button>
            )}
          </div>
          {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('recipes.cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('recipes.saving') : t('ops.invoices.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
