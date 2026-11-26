import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
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
import { todayIso } from '@/lib/purchasing';
import { creditStanding } from '@/lib/restaurantOps';
import { t } from '@/lib/i18n';

/**
 * One supplier credit memo (release 378, Nov 25, 2026): the
 * credit a supplier gives back against ONE invoice — a
 * damaged case, a short delivery, a price made right. The
 * supplier is never picked here: it comes from the invoice
 * itself (the server derives the snapshot the same way, and
 * its word is final). The standing line shows the invoice's
 * total, what applied memos have already covered, and what
 * is still owed; the dialog checks the amount against that
 * owed figure before saving, and the server holds the same
 * cap for real — a credit can never exceed its invoice.
 * Voiding a memo keeps it on the record but frees its room.
 */
export default function CreditMemoDialog({ open, onOpenChange, memo, invoices, memos, currency, onSaved }) {
  const { activeId } = useBusiness();
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [creditNumber, setCreditNumber] = useState('');
  const [creditDate, setCreditDate] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('applied');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setInvoiceId(memo?.invoice_id || '');
    setAmount(memo ? String(memo.amount ?? '') : '');
    setCreditNumber(memo?.credit_number || '');
    setCreditDate(memo?.credit_date || todayIso());
    setReason(memo?.reason || '');
    setNote(memo?.note || '');
    setStatus(memo?.status === 'void' ? 'void' : 'applied');
    setError('');
  }, [open, memo ]);

  const invoice = useMemo(
    () => (invoices || []).find((row) => row.id === invoiceId) || null,
    [invoices, invoiceId],
  );
  const standing = useMemo(
    () => (invoice ? creditStanding(invoice, memos || [], memo?.id || '') : null),
    [invoice, memos, memo],
  );

  const save = async () => {
    setError('');
    if (!invoice) {
      setError(t('ops.credits.needInvoice'));
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || !(value > 0)) {
      setError(t('ops.credits.needAmount'));
      return;
    }
    if (status === 'applied' && standing && Math.round(value * 100) > Math.round(standing.owed * 100)) {
      setError(t('ops.credits.exceedsError', { owed: formatMoney(standing.owed, currency, 2) }));
      return;
    }
    setSaving(true);
    try {
      const values = {
        invoice_id: invoice.id,
        credit_number: creditNumber.trim(),
        credit_date: creditDate || null,
        amount: value,
        reason: reason.trim(),
        note: note.trim(),
        status,
      };
      if (memo) await base44.entities.CreditMemo.update(memo.id, values);
      else await base44.entities.CreditMemo.create(withBusiness(values, activeId));
      onOpenChange(false);
      onSaved(t('ops.credits.saved'));
    } catch (e) {
      setError(e.message || t('ops.credits.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{memo ? t('ops.credits.editTitle') : t('ops.credits.newTitle')}</DialogTitle>
          <DialogDescription>{t('ops.credits.dialogIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('ops.credits.invoiceLabel')}</Label>
            <Select value={invoiceId} onValueChange={setInvoiceId}>
              <SelectTrigger>
                <SelectValue placeholder={t('ops.credits.invoicePick')} />
              </SelectTrigger>
              <SelectContent>
                {(invoices || []).map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {(row.supplier_name || '') +
                      (row.invoice_number ? ` · ${row.invoice_number}` : '') +
                      ` · ${formatMoney(row.total || 0, currency, 2)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {standing && (
              <p className="text-xs text-muted-foreground">
                {t('ops.credits.remainingLine', {
                  total: formatMoney(standing.total, currency, 2),
                  credited: formatMoney(standing.credited, currency, 2),
                  owed: formatMoney(standing.owed, currency, 2),
                })}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('ops.credits.amountLabel')}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.credits.dateLabel')}</Label>
              <Input type="date" value={creditDate} onChange={(event) => setCreditDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.credits.creditNumberLabel')}</Label>
              <Input value={creditNumber} onChange={(event) => setCreditNumber(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.invoices.statusLabel')}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="applied">{t('ops.credits.statusApplied')}</SelectItem>
                  <SelectItem value="void">{t('ops.credits.statusVoid')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('ops.credits.reasonLabel')}</Label>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('ops.invoices.noteLabel')}</Label>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('recipes.cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t('recipes.saving') : t('ops.credits.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
