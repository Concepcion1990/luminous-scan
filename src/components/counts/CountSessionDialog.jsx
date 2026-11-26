import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import AddLocationInline from '@/components/locations/AddLocationInline';
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
import { buildSheet, countNumber } from '@/lib/counts';
import { t } from '@/lib/i18n';

import { useBusiness } from '@/hooks/useBusiness';
import { withBusiness } from '@/lib/scoped';

export default function CountSessionDialog({ open, onOpenChange, products, locations, levels, onCreated }) {
  const { user, activeId } = useBusiness();
  const [locationId, setLocationId] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Own copy of the list so the inline add-a-location door (the
  // empty-picker safety net) can add + preselect in place.
  const [localLocations, setLocalLocations] = useState(locations);

  useEffect(() => {
    if (!open) return;
    setLocalLocations(locations);
    setLocationId(locations[0]?.id || '');
    setCategory('');
    setNotes('');
    setError('');
  }, [open, locations]);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products]
  );

  const preview = useMemo(
    () => (locationId ? buildSheet({ products, levels, locations: localLocations, locationId, category }).length : 0),
    [products, levels, localLocations, locationId, category]
  );

  const create = async () => {
    const location = localLocations.find((l) => l.id === locationId);
    if (!location) {
      setError(t('counts.chooseLocation'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const lines = buildSheet({ products, levels, locations: localLocations, locationId, category });
      await base44.entities.CountSession.create(
        withBusiness(
          {
            number: countNumber(),
            status: 'open',
            location_id: location.id,
            location_name: location.name,
            category,
            scope_note: category ? t('counts.scopeNoteCategory', { category, location: location.name }) : t('counts.scopeNoteAll', { location: location.name }),
            lines,
            notes,
            started_at: new Date().toISOString(),
            // Attribution is a name, never an email (owner's
            // rider, Nov 21, 2026) — and the server stamps the
            // starter's display name itself regardless.
            started_by: user?.full_name || '',
          },
          activeId
        )
      );
      onOpenChange(false);
      onCreated?.(t('counts.startedMessage', { location: location.name }));
    } catch (e) {
      setError(e.message || t('counts.startFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('counts.startTitle')}</DialogTitle>
          <DialogDescription>
            {t('counts.startDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">{t('counts.locationLabel')}</Label>
            {localLocations.length === 0 ? (
              <AddLocationInline
                businessId={activeId}
                onCreated={(place) => {
                  setLocalLocations([place]);
                  setLocationId(place.id);
                  setError('');
                }}
              />
            ) : (
              <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('counts.chooseLocationOption')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('counts.chooseLocationOption')}</SelectItem>
                  {localLocations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{t('counts.scopeLabel')}</Label>
            <Select
              value={category || 'all'}
              onValueChange={(v) => setCategory(v === 'all' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('counts.scopeOnHand')}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t('counts.scopeCategory', { category: c })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {t('counts.previewLine', { count: preview, plural: preview === 1 ? '' : 's' })}
            </p>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{t('counts.notesLabel')}</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('counts.notesPlaceholder')}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('counts.cancel')}
          </Button>
          <Button onClick={create} disabled={saving}>
            {saving ? t('counts.starting') : t('counts.startButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}