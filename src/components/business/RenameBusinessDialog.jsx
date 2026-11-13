import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
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

/** Renames one business. The name is what the sidebar, labels and documents show. */
export default function RenameBusinessDialog({ open, onOpenChange, business, onRenamed }) {
  const { rename } = useBusiness();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(business?.name || '');
    setError('');
  }, [open, business]);

  const save = async () => {
    if (!business?.id) return;
    if (!name.trim()) {
      setError(t('settings.rename.nameError'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await rename(business.id, name.trim());
      onRenamed?.(business.id, name.trim());
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || t('settings.rename.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings.rename.title')}</DialogTitle>
          <DialogDescription>
            {t('settings.rename.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="rename-biz">{t('settings.rename.nameLabel')}</Label>
          <Input
            id="rename-biz"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder={t('settings.rename.namePlaceholder')}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('settings.rename.cancel')}
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {busy ? t('settings.rename.saving') : t('settings.rename.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}