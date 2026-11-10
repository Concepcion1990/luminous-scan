import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { createRole } from '@/lib/entitlements';
import { Loader2, TriangleAlert } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
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
import PermissionPicker from '@/components/staff/PermissionPicker';

/** Create or edit one of the business's own roles. */
export default function RoleDialog({ open, onOpenChange, role, businessId, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: '', description: '', permissions: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({
      name: role?.name || '',
      description: role?.description || '',
      permissions: Array.isArray(role?.permissions) ? [...role.permissions] : [],
    });
    setError('');
    setBusy(false);
  }, [open, role]);

  const save = async () => {
    if (!form.name.trim()) {
      setError('Give the role a name.');
      return;
    }
    if (!businessId) {
      setError('Create a business first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = {
        business_id: businessId,
        name: form.name.trim(),
        description: form.description.trim(),
        permissions: form.permissions,
      };
      // Creating a role goes through the server: custom roles are Business-only,
      // and the StaffRole row rules alone would let any creator create one.
      // Editing an existing role stays a direct update (editing is not creating).
      if (role) await base44.entities.StaffRole.update(role.id, payload);
      else await createRole(businessId, payload);
      toast({ title: role ? 'Role updated' : 'Role created' });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Could not save this role.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{role ? 'Edit role' : 'New role'}</DialogTitle>
          <DialogDescription>
            A role is a named set of permissions. Staff members can start from it and keep their own tweaks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="role-name">Role name</Label>
            <Input
              id="role-name"
              value={form.name}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
              placeholder="Weekend lead"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="role-description">What it is for</Label>
            <Input
              id="role-description"
              value={form.description}
              onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
              placeholder="Covers the floor on Saturdays, no buying."
            />
          </div>

          <div className="space-y-1.5">
            <Label>Permissions</Label>
            <PermissionPicker
              value={form.permissions}
              onChange={(permissions) => setForm((c) => ({ ...c, permissions }))}
            />
          </div>

          {error && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : role ? (
              'Save role'
            ) : (
              'Create role'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}