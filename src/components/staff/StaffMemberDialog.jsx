import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Loader2, TriangleAlert } from 'lucide-react';
import { allRoles, BUSINESS_ONLY_PERMISSIONS, roleById, STATUS_OPTIONS } from '@/lib/staff';
import { createStaffMember } from '@/lib/entitlements';
import useEntitlements from '@/hooks/useEntitlements';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
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
import PermissionPicker from '@/components/staff/PermissionPicker';
import { orderedLocations } from '@/lib/locations';

const emptyForm = (customRoles, stripBusinessOnly = (permissions) => permissions) => {
  const role = roleById('preset-stock', customRoles);
  return {
    full_name: '',
    email: '',
    app_role: 'user',
    role_id: role?.id || '',
    role_name: role?.name || '',
    // The Stock clerk preset carries builds.manage, a Business-only key:
    // strip it on Essentials so a new member never starts out holding a
    // permission for a module the plan cannot open (Finding 7).
    permissions: role ? stripBusinessOnly([...role.permissions]) : [],
    status: 'invited',
    location_id: '',
    location_name: '',
    notes: '',
  };
};

/** Add a staff member, pick their role, tune their permissions, send the invite. */
export default function StaffMemberDialog({
  open,
  onOpenChange,
  member,
  businessId,
  customRoles = [],
  members = [],
  locations = [],
  isAdmin = false,
  onSaved,
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { isEssentials, isLoading: entitlementLoading } = useEntitlements();
  // Finding 7: an Essentials member's stored set must equal what the plan
  // offers — the preset roles all carry Business-only keys (Manager 17,
  // Stock clerk builds.manage). Strip them when a preset is applied and
  // again at save, so a direct entity update can never store them either.
  // The server strips the same keys on create (create-staff-member); this
  // is the client mirror, and it also covers edits, which go straight to
  // the entity. While the plan is still loading the strip stays off: a
  // Business member edited in that window must not lose permissions it
  // legitimately holds.
  const stripBusinessOnly = (permissions) =>
    !entitlementLoading && isEssentials
      ? (permissions || []).filter((key) => !BUSINESS_ONLY_PERMISSIONS.includes(key))
      : permissions || [];
  const [form, setForm] = useState(() => emptyForm(customRoles, stripBusinessOnly));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(
      member
        ? {
            full_name: member.full_name || '',
            email: member.email || '',
            app_role: member.app_role || 'user',
            role_id: member.role_id || '',
            role_name: member.role_name || '',
            permissions: Array.isArray(member.permissions) ? member.permissions : [],
            status: member.status || 'invited',
            location_id: member.location_id || '',
            location_name: member.location_name || '',
            notes: member.notes || '',
          }
        : emptyForm(customRoles, stripBusinessOnly)
    );
    setError('');
    setBusy(false);
  }, [open, member, customRoles]);

  const roles = allRoles(customRoles);
  const places = orderedLocations(locations);

  const chooseStore = (locationId) => {
    const chosen = places.find(({ location }) => location.id === locationId)?.location;
    setForm((current) => ({
      ...current,
      location_id: chosen?.id || '',
      location_name: chosen?.name || '',
    }));
  };

  const chooseRole = (roleId) => {
    const role = roleById(roleId, customRoles);
    setForm((current) => ({
      ...current,
      role_id: roleId,
      role_name: role?.name || '',
      permissions: role ? stripBusinessOnly([...role.permissions]) : current.permissions,
    }));
  };

  const save = async () => {
    const email = form.email.trim().toLowerCase();
    if (!form.full_name.trim() || !email) {
      setError('A name and an email are needed.');
      return;
    }
    if (!businessId) {
      setError('Create a business first.');
      return;
    }
    if (!isAdmin && email === String(user?.email || '').toLowerCase()) {
      setError('You cannot add or change your own staff record — ask an administrator.');
      return;
    }
    // One seat per email: a second record would make that person's permissions ambiguous.
    const clash = members.find(
      (other) => other.id !== member?.id && String(other.email || '').toLowerCase() === email
    );
    if (clash) {
      setError(`${clash.full_name} already has a staff record with ${email}. Edit that one instead.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = {
        business_id: businessId,
        full_name: form.full_name.trim(),
        email,
        app_role: form.app_role,
        role_id: form.role_id,
        role_name: form.role_name || 'Custom',
        // Filter at save as well as at preset-apply: the picker preserves
        // keys granted another way, so a legacy Business-only key on an
        // Essentials member would otherwise survive an edit untouched.
        permissions: stripBusinessOnly(form.permissions),
        status: form.status,
        location_id: form.location_id || '',
        location_name: form.location_name || '',
        notes: form.notes.trim(),
        invited_at: member?.invited_at || new Date().toISOString(),
      };

      if (member) await base44.entities.StaffMember.update(member.id, payload);
      else await createStaffMember(businessId, payload);

      if (!member && form.status === 'invited') {
        try {
          await base44.users.inviteUser(email, form.app_role);
          toast({
            title: 'Invitation sent',
            description: `${email} is invited as ${form.role_name || 'staff'}. Set their status to Active once they sign in so they can start working.`,
          });
        } catch (inviteError) {
          toast({
            title: 'Staff member saved',
            description:
              inviteError?.message ||
              'The invitation could not be sent. Invite them again once they have an account.',
            variant: 'destructive',
          });
        }
      } else {
        toast({ title: member ? 'Staff member updated' : 'Staff member added' });
      }

      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Could not save this staff member.');
    } finally {
      setBusy(false);
    }
  };

  // Compare permission SETS, not counts: swapping one permission for
  // another of equal count used to hide the note, and on Essentials the
  // plan strip shortens every preset (Manager 17 → 14), which would
  // otherwise flag every untouched Essentials member as changed.
  const rolePermissions = roleById(form.role_id, customRoles)?.permissions || [];
  const roleChanged =
    form.role_id &&
    (() => {
      const expected = new Set(stripBusinessOnly(rolePermissions));
      const actual = new Set(form.permissions);
      return (
        expected.size !== actual.size || [...expected].some((key) => !actual.has(key))
      );
    })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{member ? 'Edit staff member' : 'Add a staff member'}</DialogTitle>
          <DialogDescription>
            {member
              ? 'Change their role, permissions or access.'
              : 'Pick a role to start from, then adjust anything they should or should not reach.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="staff-name">Full name</Label>
              <Input
                id="staff-name"
                value={form.full_name}
                onChange={(event) => setForm((c) => ({ ...c, full_name: event.target.value }))}
                placeholder="Alex Rivera"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="staff-email">Email</Label>
              <Input
                id="staff-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))}
                placeholder="alex@example.com"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Store</Label>
            <Select
              value={form.location_id || 'all'}
              onValueChange={(value) => chooseStore(value === 'all' ? '' : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations — no single store</SelectItem>
                {places.map(({ location, depth }) => (
                  <SelectItem key={location.id} value={location.id}>
                    {'—'.repeat(depth)} {depth > 0 ? ' ' : ''}
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {locations.length
                ? 'Which store this person works from. It is shown on their staff card.'
                : 'No locations yet — add one on the Locations page to assign a store.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <Select value={form.role_id || undefined} onValueChange={chooseRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(value) => setForm((c) => ({ ...c, status: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Workspace access</Label>
            <Select
              value={form.app_role}
              onValueChange={(value) => setForm((c) => ({ ...c, app_role: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User — sees the app</SelectItem>
                {isAdmin && <SelectItem value="admin">Administrator — manages everything</SelectItem>}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {form.app_role === 'admin'
                ? 'Administrators can see and change all data and manage app users.'
                : 'Users work inside the app; only administrators can grant administrator access.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Permissions</Label>
            <PermissionPicker
              value={form.permissions}
              onChange={(permissions) => setForm((c) => ({ ...c, permissions }))}
            />
            {roleChanged && (
              <p className="text-[11px] text-muted-foreground">
                These permissions no longer match {form.role_name} — this member now has their own set.
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="staff-notes">Notes</Label>
            <Textarea
              id="staff-notes"
              rows={2}
              value={form.notes}
              onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
              placeholder="Works Saturdays, covers the front counter."
            />
          </div>

          {!member && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {form.status === 'invited'
                ? `Saving sends an invitation to ${form.email || 'this email'}. Their role, store and permissions are already set here, and their seat switches on once you set them to Active.`
                : `No invitation is sent for a member added as ${
                    form.status === 'suspended' ? 'Suspended' : 'Active'
                  } — they need an app account already. Choose Invited to email them.`}
            </p>
          )}

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
            ) : member ? (
              'Save changes'
            ) : (
              'Add staff member'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}