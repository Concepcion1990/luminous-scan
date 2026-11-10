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
      setError('A supplier name is required.');
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
      setError(err?.message || 'Could not save this supplier.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{supplier ? 'Edit supplier' : 'New supplier'}</DialogTitle>
          <DialogDescription>
            Suppliers appear on purchase orders, and what you pay them sets each product's cost.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="supplier-name">Supplier name</Label>
            <Input id="supplier-name" value={form.name} onChange={set('name')} placeholder="Ingram Content Group" />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contact">Contact</Label>
            <Input id="contact" value={form.contact_name} onChange={set('contact_name')} placeholder="Dana Ruiz" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={set('email')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={set('phone')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="account">Account number</Label>
              <Input id="account" value={form.account_number} onChange={set('account_number')} className="font-mono" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lead">Lead time (days)</Label>
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
            <Label htmlFor="address">Address</Label>
            <Textarea id="address" value={form.address} onChange={set('address')} rows={2} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="website">Website</Label>
            <Input id="website" value={form.website} onChange={set('website')} placeholder="supplier.com" />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="supplier-notes">Notes</Label>
            <Textarea id="supplier-notes" value={form.notes} onChange={set('notes')} rows={2} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : supplier ? 'Save changes' : 'Add supplier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}