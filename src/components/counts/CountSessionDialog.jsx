import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
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
import { useBusiness } from '@/hooks/useBusiness';
import { withBusiness } from '@/lib/scoped';

export default function CountSessionDialog({ open, onOpenChange, products, locations, levels, onCreated }) {
  const { user, activeId } = useBusiness();
  const [locationId, setLocationId] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
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
    () => (locationId ? buildSheet({ products, levels, locationId, category }).length : 0),
    [products, levels, locationId, category]
  );

  const create = async () => {
    const location = locations.find((l) => l.id === locationId);
    if (!location) {
      setError('Choose the location you are counting.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const lines = buildSheet({ products, levels, locationId, category });
      await base44.entities.CountSession.create(
        withBusiness(
          {
            number: countNumber(),
            status: 'open',
            location_id: location.id,
            location_name: location.name,
            category,
            scope_note: category ? `${category} at ${location.name}` : `All stock at ${location.name}`,
            lines,
            notes,
            started_at: new Date().toISOString(),
            started_by: user?.full_name || user?.email || '',
          },
          activeId
        )
      );
      onOpenChange(false);
      onCreated?.(`Count session started at ${location.name}.`);
    } catch (e) {
      setError(e.message || 'Could not start the count.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a count</DialogTitle>
          <DialogDescription>
            The sheet snapshots what the system says is on hand. Counted numbers only reach stock after approval.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">Location</Label>
            <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose a location</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">Scope</Label>
            <Select
              value={category || 'all'}
              onValueChange={(v) => setCategory(v === 'all' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Only what is on hand here</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    Whole category: {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {preview} product{preview === 1 ? '' : 's'} will start on the sheet; scan to add anything else.
            </p>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">Notes</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Who is counting, which aisle…"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={saving}>
            {saving ? 'Starting…' : 'Start count'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}