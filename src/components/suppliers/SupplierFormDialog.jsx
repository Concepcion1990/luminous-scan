import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { useBusiness } from '@/hooks/useBusiness';
import { withBusiness } from '@/lib/scoped';
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
import { t } from '@/lib/i18n';

const empty = {
  name: '',
  contact_name: '',
  email: '',
  phone: '',
  account_number: '',
  lead_time_days: '',
  address: '',
  website: '',
  notes: '',
};

export default function SupplierFormDialog({ open, onOpenChange, supplier, onSaved }) {
  const { activeId } = useBusiness();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (supplier) {
      setForm({
        name: supplier.name || '',
        contact_name: supplier.contact_name || '',
        email: supplier.email || '',
        phone: supplier.phone || '',
        account_number: supplier.account_number || '',
        lead_time_days: supplier.lead_time_days ?? '',
        address: supplier.address || '',
        website: supplier.website || '',
        notes: supplier.notes || '',
      });
    } else {
      setForm(empty);
    }
  }, [open, supplier]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) {
      setError(t('suppliers.nameRequired'));
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      name: form.name.trim(),
      contact_name: form.contact_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      account_number: form.account_number.trim(),
      lead_time_days: Number(form.lead_time_days) || 0,
      address: form.address.trim(),
      website: form.website.trim(),
      notes: form.notes.trim(),
      active: true,
    };
    try {
      const saved = supplier
        ? await base44.entities.Supplier.update(supplier.id, payload)
        : await base44.entities.Supplier.create(withBusiness(payload, activeId));
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || t('suppliers.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{supplier ? t('suppliers.editTitle') : t('suppliers.newTitle')}</DialogTitle>
          <DialogDescription>{t('suppliers.formDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="supplier-name">{t('suppliers.supplierName')}</Label>
            <Input id="supplier-name" value={form.name} onChange={set('name')} placeholder={t('suppliers.supplierNamePlaceholder')} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contact">{t('suppliers.contact')}</Label>
            <Input id="contact" value={form.contact_name} onChange={set('contact_name')} placeholder={t('suppliers.contactPlaceholder')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="email">{t('suppliers.email')}</Label>
              <Input id="email" type="email" value={form.email} onChange={set('email')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">{t('suppliers.phone')}</Label>
              <Input id="phone" value={form.phone} onChange={set('phone')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="account">{t('suppliers.accountNumberLabel')}</Label>
              <Input id="account" value={form.account_number} onChange={set('account_number')} className="font-mono" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lead">{t('suppliers.leadTime')}</Label>
              <Input
                id="lead"
                type="number"
                inputMode="numeric"
                value={form.lead_time_days}
                onChange={set('lead_time_days')}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="address">{t('suppliers.address')}</Label>
            <Textarea id="address" value={form.address} onChange={set('address')} rows={2} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="website">{t('suppliers.website')}</Label>
            <Input id="website" value={form.website} onChange={set('website')} placeholder={t('suppliers.websitePlaceholder')} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="supplier-notes">{t('suppliers.notes')}</Label>
            <Textarea id="supplier-notes" value={form.notes} onChange={set('notes')} rows={2} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('suppliers.cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t('suppliers.saving') : supplier ? t('suppliers.saveChanges') : t('suppliers.addSupplier')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}