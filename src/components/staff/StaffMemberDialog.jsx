import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Loader2, TriangleAlert } from 'lucide-react';
import { allRoles, BUSINESS_ONLY_PERMISSIONS, isLocationsGrant, isMemberGrant, isProductsGrant, isReturnsGrant, isSettingsGrant, LOCATIONS_GRANTS, PRODUCTS_GRANTS, RETURNS_GRANTS, roleById, SETTINGS_GRANTS, STATUS_OPTIONS } from '@/lib/staff';
import { Checkbox } from '@/components/ui/checkbox';
import { createStaffMember } from '@/lib/entitlements';
import { fixStaffEmail } from '@/lib/recovery';
import { listPayProfiles, savePayProfile } from '@/lib/workforce';
import useStaffAccess from '@/hooks/useStaffAccess';
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
    // Owner-granted Settings sections (Nov 19, 2026): per-member
    // ticks, never part of any role — a new member starts with
    // none, so their Settings is personal only until the owner
    // ticks a section for them.
    settings_grants: [],
    // Owner-granted returns completion (Nov 19, 2026): its own
    // per-member tick, off by default for everyone — a new
    // member's returns wait for approval until the owner ticks
    // this for them.
    returns_grants: [],
    // Owner-granted product creation (Nov 19, 2026): its own
    // per-member tick, off by default for everyone — the New
    // product buttons do not appear for a member until the owner
    // ticks this for them (or their role carries products.edit).
    products_grants: [],
    // Owner-granted location creation (Nov 19, 2026): adding a
    // location is the owner's job — its own per-member tick, off
    // by default for everyone, managers included. The Add
    // location doors do not appear for a member until the owner
    // ticks this for them.
    locations_grants: [],
    status: 'invited',
    location_id: '',
    location_name: '',
    notes: '',
    // Personal contact details (owner ruling, Nov 19, 2026):
    // shown and saved only behind the hiring gate below.
    personal_address: '',
    personal_phone: '',
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
  const { member: myMember } = useStaffAccess();
  // The hiring gate (owner rulings, Nov 19, 2026): the pay-rate
  // section and the member's personal contact fields appear only
  // for the owner, or a manager trusted with hiring — a member
  // whose own stored permissions carry staff.manage. The server
  // enforces the same gate on both doors (the pay-profile write
  // and the staff-record contact fields).
  const canHire =
    isAdmin ||
    (Array.isArray(myMember?.permissions) && myMember.permissions.includes('staff.manage'));
  const [payForm, setPayForm] = useState({ pay_type: 'hourly', hourly_rate: '', annual_salary: '' });
  const [payTouched, setPayTouched] = useState(false);
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
            // The per-member grants (Settings sections + returns
            // completion + product creation + location creation)
            // ride the same stored array but are edited as their
            // own ticks below —
            // split them out so the permission picker (and its
            // All/None buttons) can never wipe a grant by accident.
            permissions: (Array.isArray(member.permissions) ? member.permissions : []).filter(
              (key) => !isMemberGrant(key)
            ),
            settings_grants: (Array.isArray(member.permissions) ? member.permissions : []).filter(
              (key) => isSettingsGrant(key)
            ),
            returns_grants: (Array.isArray(member.permissions) ? member.permissions : []).filter(
              (key) => isReturnsGrant(key)
            ),
            products_grants: (Array.isArray(member.permissions) ? member.permissions : []).filter(
              (key) => isProductsGrant(key)
            ),
            locations_grants: (Array.isArray(member.permissions) ? member.permissions : []).filter(
              (key) => isLocationsGrant(key)
            ),
            status: member.status || 'invited',
            location_id: member.location_id || '',
            location_name: member.location_name || '',
            notes: member.notes || '',
            personal_address: member.personal_address || '',
            personal_phone: member.personal_phone || '',
          }
        : emptyForm(customRoles, stripBusinessOnly)
    );
    setError('');
    setBusy(false);
    setPayForm({ pay_type: 'hourly', hourly_rate: '', annual_salary: '' });
    setPayTouched(false);
  }, [open, member, customRoles]);

  // Load the member's current pay rate from the SAME pay-profile
  // record the Payroll page edits (one source of truth): set in
  // either door, seen in both.
  useEffect(() => {
    if (!open || !canHire || !member?.id || !businessId) return;
    let cancelled = false;
    listPayProfiles(businessId)
      .then((data) => {
        if (cancelled) return;
        const row = (data?.profiles || []).find((entry) => entry.person?.id === member.id);
        if (row?.profile) {
          setPayForm({
            pay_type: row.profile.pay_type || 'hourly',
            hourly_rate: row.profile.hourly_rate ?? '',
            annual_salary: row.profile.annual_salary ?? '',
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, canHire, member?.id, businessId]);

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
        // The per-member grants rejoin here — they are ticks,
        // untouched by role picks and the plan strip alike.
        permissions: [
          ...stripBusinessOnly(form.permissions),
          ...(form.settings_grants || []),
          ...(form.returns_grants || []),
          ...(form.products_grants || []),
          ...(form.locations_grants || []),
        ],
        status: form.status,
        location_id: form.location_id || '',
        location_name: form.location_name || '',
        notes: form.notes.trim(),
        // Personal contact details ride the payload only behind
        // the hiring gate; without it the fields are never sent,
        // so an edit can never blank them (and the server strips
        // them from ungated reads anyway).
        ...(canHire
          ? {
              personal_address: (form.personal_address || '').trim(),
              personal_phone: (form.personal_phone || '').trim(),
            }
          : {}),
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

      let savedMemberId = member?.id || null;
      if (member) await base44.entities.StaffMember.update(member.id, payload);
      else {
        const created = await createStaffMember(businessId, payload);
        savedMemberId = created?.id || null;
      }

      // Pay rate (owner ruling, Nov 19, 2026): written to the
      // same pay-profile record the Payroll page edits. For an
      // existing member it saves when the section was touched;
      // for a new member only when a rate was actually entered.
      const payEntered =
        String(payForm.hourly_rate ?? '').trim() !== '' ||
        String(payForm.annual_salary ?? '').trim() !== '';
      if (canHire && savedMemberId && (payTouched || (!member && payEntered))) {
        try {
          await savePayProfile(businessId, savedMemberId, {
            pay_type: payForm.pay_type,
            hourly_rate: payForm.hourly_rate === '' ? 0 : payForm.hourly_rate,
            annual_salary: payForm.annual_salary === '' ? 0 : payForm.annual_salary,
          });
        } catch (payError) {
          toast({
            title: payError?.message || t('workforce.actionFailed'),
            variant: 'destructive',
          });
        }
      }

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

          {/* Owner-granted Settings sections (Nov 19, 2026): the
              member's own Settings is personal only unless the
              owner ticks a section here — ticked sections pop up
              in their Settings as working sections; unticked ones
              stay invisible. Subscription and billing are never
              on this list: owner-only, not grantable. */}
          <div className="space-y-1.5">
            <Label>{t('staffLib.area.settingsAccess')}</Label>
            <div className="rounded-lg border border-border p-2.5">
              <div className="grid gap-1.5">
                {SETTINGS_GRANTS.map((grant) => (
                  <label key={grant.key} className="flex items-start gap-2 text-xs leading-snug">
                    <Checkbox
                      checked={(form.settings_grants || []).includes(grant.key)}
                      onCheckedChange={(on) =>
                        setForm((c) => ({
                          ...c,
                          settings_grants: on
                            ? [...new Set([...(c.settings_grants || []), grant.key])]
                            : (c.settings_grants || []).filter((key) => key !== grant.key),
                        }))
                      }
                      className="mt-0.5"
                    />
                    <span>
                      {grant.label}
                      {grant.key === 'settings.editName' && (
                        <span className="block text-[11px] text-muted-foreground">
                          {t('staff.memberDialog.editNameHint')}
                        </span>
                      )}
                      {grant.key === 'settings.contactDetails' && (
                        <span className="block text-[11px] text-muted-foreground">
                          {t('staff.memberDialog.contactDetailsHint')}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('staff.memberDialog.settingsAccessHint')}
            </p>
          </div>

          {/* Owner-granted returns completion (Nov 19, 2026):
              anyone who can log a return can start one, but it
              waits for approval — unless the owner ticks this.
              The tick is offered for managers and staff alike and
              starts unticked for everyone. */}
          <div className="space-y-1.5">
            <Label>{t('staffLib.area.returnsAccess')}</Label>
            <div className="rounded-lg border border-border p-2.5">
              <div className="grid gap-1.5">
                {RETURNS_GRANTS.map((grant) => (
                  <label key={grant.key} className="flex items-start gap-2 text-xs leading-snug">
                    <Checkbox
                      checked={(form.returns_grants || []).includes(grant.key)}
                      onCheckedChange={(on) =>
                        setForm((c) => ({
                          ...c,
                          returns_grants: on
                            ? [...new Set([...(c.returns_grants || []), grant.key])]
                            : (c.returns_grants || []).filter((key) => key !== grant.key),
                        }))
                      }
                      className="mt-0.5"
                    />
                    <span>{grant.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('staff.memberDialog.returnsAccessHint')}
            </p>
          </div>

          {/* Owner-granted product creation (Nov 19, 2026 — no
              dangling doors): the New product buttons appear for
              this person only with this tick (or a role carrying
              products.edit) — unticked, the buttons do not appear
              at all. Offered for every role, off by default. */}
          <div className="space-y-1.5">
            <Label>{t('staffLib.area.productsAccess')}</Label>
            <div className="rounded-lg border border-border p-2.5">
              <div className="grid gap-1.5">
                {PRODUCTS_GRANTS.map((grant) => (
                  <label key={grant.key} className="flex items-start gap-2 text-xs leading-snug">
                    <Checkbox
                      checked={(form.products_grants || []).includes(grant.key)}
                      onCheckedChange={(on) =>
                        setForm((c) => ({
                          ...c,
                          products_grants: on
                            ? [...new Set([...(c.products_grants || []), grant.key])]
                            : (c.products_grants || []).filter((key) => key !== grant.key),
                        }))
                      }
                      className="mt-0.5"
                    />
                    <span>{grant.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('staff.memberDialog.productsAccessHint')}
            </p>
          </div>

          {/* Owner-granted location creation (Nov 19, 2026):
              adding a location is the owner's job — this tick is
              how the owner hands it to a chosen member, a manager
              included. Unticked, the Add location doors do not
              appear for this person at all. Offered for every
              role, off by default. */}
          <div className="space-y-1.5">
            <Label>{t('staffLib.area.locationsAccess')}</Label>
            <div className="rounded-lg border border-border p-2.5">
              <div className="grid gap-1.5">
                {LOCATIONS_GRANTS.map((grant) => (
                  <label key={grant.key} className="flex items-start gap-2 text-xs leading-snug">
                    <Checkbox
                      checked={(form.locations_grants || []).includes(grant.key)}
                      onCheckedChange={(on) =>
                        setForm((c) => ({
                          ...c,
                          locations_grants: on
                            ? [...new Set([...(c.locations_grants || []), grant.key])]
                            : (c.locations_grants || []).filter((key) => key !== grant.key),
                        }))
                      }
                      className="mt-0.5"
                    />
                    <span>{grant.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('staff.memberDialog.locationsAccessHint')}
            </p>
          </div>

          {canHire && (
            <>
              <div className="grid gap-1.5">
                <Label>{t('payroll.people.title')}</Label>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="staff-pay-type" className="text-xs text-muted-foreground">
                      {t('payroll.payType.hourly')} / {t('payroll.payType.salary')}
                    </Label>
                    <select
                      id="staff-pay-type"
                      className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={payForm.pay_type}
                      onChange={(event) => {
                        setPayForm((c) => ({ ...c, pay_type: event.target.value }));
                        setPayTouched(true);
                      }}
                    >
                      <option value="hourly">{t('payroll.payType.hourly')}</option>
                      <option value="salary">{t('payroll.payType.salary')}</option>
                    </select>
                  </div>
                  {payForm.pay_type === 'hourly' ? (
                    <div className="grid gap-1.5">
                      <Label htmlFor="staff-pay-hourly" className="text-xs text-muted-foreground">
                        {t('payroll.hourlyRate')}
                      </Label>
                      <Input
                        id="staff-pay-hourly"
                        type="number"
                        min="0"
                        step="0.01"
                        value={payForm.hourly_rate}
                        onChange={(event) => {
                          setPayForm((c) => ({ ...c, hourly_rate: event.target.value }));
                          setPayTouched(true);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="grid gap-1.5">
                      <Label htmlFor="staff-pay-salary" className="text-xs text-muted-foreground">
                        {t('payroll.annualSalary')}
                      </Label>
                      <Input
                        id="staff-pay-salary"
                        type="number"
                        min="0"
                        step="0.01"
                        value={payForm.annual_salary}
                        onChange={(event) => {
                          setPayForm((c) => ({ ...c, annual_salary: event.target.value }));
                          setPayTouched(true);
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="staff-personal-address">{t('staff.memberDialog.personalAddress')}</Label>
                <Textarea
                  id="staff-personal-address"
                  rows={2}
                  value={form.personal_address}
                  onChange={(event) => setForm((c) => ({ ...c, personal_address: event.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="staff-personal-phone">{t('staff.memberDialog.personalPhone')}</Label>
                <Input
                  id="staff-personal-phone"
                  value={form.personal_phone}
                  onChange={(event) => setForm((c) => ({ ...c, personal_phone: event.target.value }))}
                />
              </div>
            </>
          )}

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