import { useState } from 'react';
import { base44 } from '@/api/client';
import { withBusiness } from '@/lib/scoped';
import { t } from '@/lib/i18n';
import useStaffAccess from '@/hooks/useStaffAccess';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The way out of an empty location picker (Nov 14, 2026): when a
 * business has no locations, a picker that only scolds "choose
 * where this stock sits" is a dead end. This inline form creates
 * the location right where the customer is stuck — name, tap,
 * created and selected — without leaving the dialog. (Since the
 * same publish, a business also starts with its Main location
 * already present, so this is the safety net for a business whose
 * locations were all removed.)
 */
export default function AddLocationInline({ businessId, onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // No dangling doors (owner ruling, Nov 19, 2026): creating a
  // location is locations.manage work on the server, so the inline
  // form renders only for a person holding it — in every picker
  // that embeds it. (A business starts with its store location
  // already present, so an empty picker is a safety-net case, not
  // the everyday path.)
  const { can } = useStaffAccess();
  if (!can('locations.manage')) return null;

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('locations.nameRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await base44.entities.Location.create(
        withBusiness({ name: trimmed, kind: 'store' }, businessId),
      );
      setName('');
      onCreated?.(created);
    } catch (err) {
      setError(err?.message || t('locations.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2 rounded-lg border border-dashed border-border p-3">
      <p className="text-xs text-muted-foreground">{t('locations.inlineAddHint')}</p>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('locations.nameLabel')}
          aria-label={t('locations.nameLabel')}
        />
        <Button type="button" onClick={add} disabled={busy} className="shrink-0">
          {t('locations.inlineAddButton')}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
