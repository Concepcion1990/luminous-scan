import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
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
      setError('A business needs a name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await rename(business.id, name.trim());
      onRenamed?.(business.id, name.trim());
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Could not rename that business.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename business</DialogTitle>
          <DialogDescription>
            Your products, stock and documents stay exactly as they are — only the name changes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="rename-biz">Business name</Label>
          <Input
            id="rename-biz"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Harbor & Pine Books"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {busy ? 'Saving…' : 'Save name'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}