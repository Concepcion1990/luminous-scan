import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Loader2, TriangleAlert } from 'lucide-react';
import { allRoles, BUSINESS_ONLY_PERMISSIONS, roleById, STATUS_OPTIONS } from '@/lib/staff';
import { createStaffMember } from '@/lib/entitlements';
import { fixStaffEmail } from '@/lib/recovery';
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
import { t } from '@/lib/i18n';
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
      setError(t('staff.memberDialog.nameEmailError'));
      return;
    }
    if (!businessId) {
      setError(t('staff.memberDialog.noBusinessError'));
      return;
    }
    if (!isAdmin && email === String(user?.email || '').toLowerCase()) {
      setError(t('staff.memberDialog.ownRecordError'));
      return;
    }
    // One seat per email: a second record would make that person's permissions ambiguous.
    const clash = members.find(
      (other) => other.id !== member?.id && String(other.email || '').toLowerCase() === email
    );
    if (clash) {
      setError(t('staff.memberDialog.emailClash', { name: clash.full_name, email }));
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

      // Recovery kit (T7): an email CHANGE on an existing member goes
      // through the owner's email fix — it carries the member's
      // account, their rows at other businesses and their trial
      // history atomically (the server refuses email changes on the
      // plain update). Unchanged emails skip straight to the update.
      if (member && email !== String(member.email || '').toLowerCase()) {
        await fixStaffEmail(businessId, member.id, email);
      }

      if (member) await base44.entities.StaffMember.update(member.id, payload);
      else await createStaffMember(businessId, payload);

      if (!member && form.status === 'invited') {
        try {
          await base44.users.inviteUser(email, form.app_role);
          toast({
            title: t('staff.memberDialog.inviteSent'),
            description: t('staff.memberDialog.inviteSentDesc', {
              email,
              role: form.role_name || t('staff.member.roleFallback'),
            }),
          });
        } catch (inviteError) {
          toast({
            title: t('staff.memberDialog.saved'),
            description:
              inviteError?.message ||
              t('staff.memberDialog.inviteFailedDesc'),
            variant: 'destructive',
          });
        }
      } else {
        toast({ title: member ? t('staff.memberDialog.updated') : t('staff.memberDialog.added') });
      }

      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || t('staff.memberDialog.saveError'));
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
          <DialogTitle>{member ? t('staff.memberDialog.editTitle') : t('staff.memberDialog.addTitle')}</DialogTitle>
          <DialogDescription>
            {member
              ? t('staff.memberDialog.editDescription')
              : t('staff.memberDialog.addDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="staff-name">{t('staff.memberDialog.nameLabel')}</Label>
              <Input
                id="staff-name"
                value={form.full_name}
                onChange={(event) => setForm((c) => ({ ...c, full_name: event.target.value }))}
                placeholder={t('staff.memberDialog.namePlaceholder')}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="staff-email">{t('staff.memberDialog.emailLabel')}</Label>
              <Input
                id="staff-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))}
                placeholder={t('staff.memberDialog.emailPlaceholder')}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>{t('staff.memberDialog.storeLabel')}</Label>
            <Select
              value={form.location_id || 'all'}
              onValueChange={(value) => chooseStore(value === 'all' ? '' : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('staff.memberDialog.allLocationsPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('staff.memberDialog.allLocations')}</SelectItem>
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
                ? t('staff.memberDialog.storeHint')
                : t('staff.memberDialog.noLocationsHint')}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t('staff.memberDialog.roleLabel')}</Label>
              <Select value={form.role_id || undefined} onValueChange={chooseRole}>
                <SelectTrigger>
                  <SelectValue placeholder={t('staff.memberDialog.rolePlaceholder')} />
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
              <Label>{t('staff.memberDialog.statusLabel')}</Label>
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
            <Label>{t('staff.memberDialog.accessLabel')}</Label>
            <Select
              value={form.app_role}
              onValueChange={(value) => setForm((c) => ({ ...c, app_role: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">{t('staff.memberDialog.userOption')}</SelectItem>
                {isAdmin && <SelectItem value="admin">{t('staff.memberDialog.adminOption')}</SelectItem>}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {form.app_role === 'admin'
                ? t('staff.memberDialog.adminHint')
                : t('staff.memberDialog.userHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>{t('staff.memberDialog.permissionsLabel')}</Label>
            <PermissionPicker
              value={form.permissions}
              onChange={(permissions) => setForm((c) => ({ ...c, permissions }))}
            />
            {roleChanged && (
              <p className="text-[11px] text-muted-foreground">
                {t('staff.memberDialog.roleChanged', { role: form.role_name })}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="staff-notes">{t('staff.memberDialog.notesLabel')}</Label>
            <Textarea
              id="staff-notes"
              rows={2}
              value={form.notes}
              onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
              placeholder={t('staff.memberDialog.notesPlaceholder')}
            />
          </div>

          {!member && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {form.status === 'invited'
                ? t('staff.memberDialog.inviteNoteInvited', { email: form.email || t('staff.memberDialog.thisEmail') })
                : t('staff.memberDialog.inviteNoteOther', {
                    status:
                      form.status === 'suspended'
                        ? t('staff.memberDialog.statusSuspended')
                        : t('staff.memberDialog.statusActive'),
                  })}
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
            {t('staff.memberDialog.cancel')}
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t('staff.memberDialog.saving')}
              </>
            ) : member ? (
              t('staff.memberDialog.saveChanges')
            ) : (
              t('staff.memberDialog.addButton')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}