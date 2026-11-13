import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Loader2, Plus, ShieldAlert, ShieldCheck, UserPlus } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import { useAuth } from '@/lib/AuthContext';
import { scoped } from '@/lib/scoped';
import { PRESET_ROLES } from '@/lib/staff';
import { useToast } from '@/components/ui/use-toast';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import StaffMemberCard from '@/components/staff/StaffMemberCard';
import StaffMemberDialog from '@/components/staff/StaffMemberDialog';
import StaffRoleCard from '@/components/staff/StaffRoleCard';
import RoleDialog from '@/components/staff/RoleDialog';
import useEntitlements from '@/hooks/useEntitlements';
import { displayLimit } from '@/lib/plans';
import LimitBadge from '@/components/plan/LimitBadge';

export default function Staff() {
  const { profile, activeId } = useBusiness();
  const { user } = useAuth();
  const { limits, isLoading: entitlementLoading, isEssentials } = useEntitlements();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';

  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [memberOpen, setMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [editingRole, setEditingRole] = useState(null);

  // A seat is held by an active member or a pending invitation — never by the owner,
  // who has no staff record of their own. While the entitlement row is still
  // loading the cap is unknown (null), never the Essentials 3: a Business
  // login briefly showed "Staff 0 of 3" and could be blocked at the third
  // seat before its own plan had loaded. The server still enforces the real
  // limit when a member is actually added.
  const staffLimit = displayLimit(limits.staff, entitlementLoading);
  const seatsUsed = members.filter((m) => m.status === 'active' || m.status === 'invited').length;
  const seatsFull = staffLimit != null && seatsUsed >= staffLimit;

  const load = useCallback(async () => {
    if (!activeId) {
      setMembers([]);
      setRoles([]);
      setLocations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [memberPage, rolePage, locationPage] = await Promise.all([
        base44.entities.StaffMember.filter(scoped({}, activeId), { sort: 'full_name', limit: 200 }),
        base44.entities.StaffRole.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      ]);
      setMembers(memberPage.items ?? []);
      setRoles(rolePage.items ?? []);
      setLocations(locationPage.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    if (seatsFull) {
      toast({
        title: t('staff.planIncludes', { count: staffLimit }),
        description: t('staff.seatsFullDesc'),
        variant: 'destructive',
      });
      return;
    }
    setEditingMember(null);
    setMemberOpen(true);
  };

  const openEdit = (member) => {
    setEditingMember(member);
    setMemberOpen(true);
  };

  const removeMember = async (member) => {
    if (!window.confirm(t('staff.member.removeConfirm', { name: member.full_name }))) return;
    await base44.entities.StaffMember.delete(member.id);
    toast({ title: t('staff.member.removed') });
    load();
  };

  // Custom roles are a Business-only feature: Essentials uses the five
  // built-in roles and cannot create its own. While the entitlement is still
  // loading the plan is unknown, so the button stays hidden — never shown on
  // a plan that turns out to be Essentials. The server refuses the create
  // anyway; this only keeps the button off the wrong plan.
  const canCreateRoles = !entitlementLoading && !isEssentials;

  const openNewRole = () => {
    if (!canCreateRoles) {
      toast({
        title: t('staff.role.customFeatureTitle'),
        description: t('staff.role.customFeatureDesc'),
        variant: 'destructive',
      });
      return;
    }
    setEditingRole(null);
    setRoleOpen(true);
  };

  const openRole = (role) => {
    setEditingRole(role);
    setRoleOpen(true);
  };

  const deleteRole = async (role) => {
    const inUse = members.filter((member) => member.role_id === role.id).length;
    if (inUse > 0) {
      toast({
        title: t('staff.role.inUseTitle'),
        description:
          inUse === 1
            ? t('staff.role.inUseDescOne', { count: inUse, role: role.name })
            : t('staff.role.inUseDescMany', { count: inUse, role: role.name }),
        variant: 'destructive',
      });
      return;
    }
    if (!window.confirm(t('staff.role.deleteConfirm', { role: role.name }))) return;
    await base44.entities.StaffRole.delete(role.id);
    toast({ title: t('staff.role.deleted') });
    load();
  };

  const countOnRole = (roleId) => members.filter((member) => member.role_id === roleId).length;
  const activeCount = members.filter((member) => member.status === 'active').length;
  // The role/member cards filter their permission summaries to what the
  // plan may offer (Finding 7). While the entitlement is still loading the
  // plan is unknown: show the full counts rather than flash an Essentials
  // restriction onto a Business account.
  const cardPlanKey = entitlementLoading ? 'business' : isEssentials ? 'essentials' : 'business';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t('staff.eyebrow')}</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('staff.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('staff.subtitleStart')}{' '}
            <span className="font-medium text-foreground">{profile?.name || t('staff.thisBusiness')}</span>
            {t('staff.subtitleRest')}
          </p>
          {/* The staff allowance in plain words, so the "5" on the Roles card
              below is never read as a staff limit: that 5 is the count of
              built-in roles, not seats. */}
          {!entitlementLoading && (
            <p className="mt-1 text-xs text-muted-foreground">
              {staffLimit == null
                ? t('staff.planUnlimited')
                : t('staff.planIncludes', { count: staffLimit })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <LimitBadge label={t('staff.limitBadgeLabel')} used={seatsUsed} limit={staffLimit} />
          {canCreateRoles && (
            <Button variant="outline" onClick={openNewRole}>
              <Plus className="mr-1.5 h-4 w-4" /> {t('staff.newRole')}
            </Button>
          )}
          <Button onClick={openAdd} disabled={!activeId}>
            <UserPlus className="mr-1.5 h-4 w-4" /> {t('staff.addMember')}
          </Button>
        </div>
      </div>

      {!activeId && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          {t('staff.noBusiness')}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('staff.loading')}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{t('staff.statStaff')}</p>
              {/* Seats in use (active + invited), not staff records: a
                  suspended member still has a card below but holds no seat,
                  so this must agree with the LimitBadge (Finding 25). */}
              <p className="numeric mt-1 text-2xl font-semibold">{seatsUsed}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{t('staff.statActive')}</p>
              <p className="numeric mt-1 text-2xl font-semibold">{activeCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{t('staff.statRoles')}</p>
              <p className="numeric mt-1 text-2xl font-semibold">
                {PRESET_ROLES.length + roles.length}
              </p>
            </div>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('staff.teamHeading')}</h2>
              <span className="numeric text-[11px] text-muted-foreground">{t('staff.peopleCount', { count: seatsUsed })}</span>
            </div>

            {members.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center">
                <p className="text-sm font-medium">{t('staff.emptyTitle')}</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                  {t('staff.emptyBody')}
                </p>
                <Button className="mt-3" onClick={openAdd} disabled={!activeId}>
                  <UserPlus className="mr-1.5 h-4 w-4" /> {t('staff.addFirst')}
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {members.map((member) => (
                  <StaffMemberCard
                    key={member.id}
                    member={member}
                    locations={locations}
                    planKey={cardPlanKey}
                    onEdit={openEdit}
                    onRemove={removeMember}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('staff.rolesHeading')}</h2>
              <span className="numeric text-[11px] text-muted-foreground">
                {t('staff.rolesCount', { count: PRESET_ROLES.length + roles.length })}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {PRESET_ROLES.map((role) => (
                <StaffRoleCard
                  key={role.id}
                  role={role}
                  builtIn
                  planKey={cardPlanKey}
                  memberCount={countOnRole(role.id)}
                />
              ))}
              {roles.map((role) => (
                <StaffRoleCard
                  key={role.id}
                  role={role}
                  planKey={cardPlanKey}
                  memberCount={countOnRole(role.id)}
                  onEdit={openRole}
                  onDelete={deleteRole}
                />
              ))}
            </div>
          </section>

          <div className="rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground sm:p-5">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> {t('staff.howTitle')}
            </p>
            <p className="mt-2">
              {t('staff.how.p1')}
            </p>
            <p className="mt-2">
              {t('staff.how.p2')}
            </p>
            <p className="mt-2">
              {t('staff.how.p3')}
            </p>
            <p className="mt-2">
              {t('staff.how.p4')}
            </p>
            <p className="mt-2">
              {t('staff.how.p5')}
            </p>
            <p className="mt-2">
              {t('staff.how.p6')}
            </p>
          </div>
        </>
      )}

      <StaffMemberDialog
        open={memberOpen}
        onOpenChange={setMemberOpen}
        member={editingMember}
        businessId={activeId}
        customRoles={roles}
        members={members}
        locations={locations}
        isAdmin={isAdmin}
        onSaved={load}
      />

      <RoleDialog
        open={roleOpen}
        onOpenChange={setRoleOpen}
        role={editingRole}
        businessId={activeId}
        onSaved={load}
      />
    </div>
  );
}