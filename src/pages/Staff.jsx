import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Loader2, Plus, ShieldAlert, ShieldCheck, UserPlus } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import { useAuth } from '@/lib/AuthContext';
import { scoped } from '@/lib/scoped';
import { PRESET_ROLES } from '@/lib/staff';
import { useToast } from '@/components/ui/use-toast';
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
        title: `This plan includes ${staffLimit} additional staff`,
        description: 'Free a seat or move to Business for unlimited staff.',
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
    if (!window.confirm(`Remove ${member.full_name} from the staff list? Their app account stays.`)) return;
    await base44.entities.StaffMember.delete(member.id);
    toast({ title: 'Staff member removed' });
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
        title: 'Custom roles are a Business feature',
        description: 'Essentials uses the five built-in roles. Move to Business to create your own.',
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
        title: 'Role still in use',
        description: `${inUse} staff member${inUse === 1 ? ' is' : 's are'} on ${role.name}. Move them to another role first.`,
        variant: 'destructive',
      });
      return;
    }
    if (!window.confirm(`Delete the ${role.name} role?`)) return;
    await base44.entities.StaffRole.delete(role.id);
    toast({ title: 'Role deleted' });
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
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Team</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Staff &amp; roles</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Who works in{' '}
            <span className="font-medium text-foreground">{profile?.name || 'this business'}</span>, what
            each person is allowed to do, and the roles you can put them on.
          </p>
          {/* The staff allowance in plain words, so the "5" on the Roles card
              below is never read as a staff limit: that 5 is the count of
              built-in roles, not seats. */}
          {!entitlementLoading && (
            <p className="mt-1 text-xs text-muted-foreground">
              {staffLimit == null
                ? 'Unlimited staff on the Business plan.'
                : `This plan includes ${staffLimit} additional staff.`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <LimitBadge label="Staff" used={seatsUsed} limit={staffLimit} />
          {canCreateRoles && (
            <Button variant="outline" onClick={openNewRole}>
              <Plus className="mr-1.5 h-4 w-4" /> New role
            </Button>
          )}
          <Button onClick={openAdd} disabled={!activeId}>
            <UserPlus className="mr-1.5 h-4 w-4" /> Add staff member
          </Button>
        </div>
      </div>

      {!activeId && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          Create a business first — staff belong to a business.
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading staff…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Staff</p>
              {/* Seats in use (active + invited), not staff records: a
                  suspended member still has a card below but holds no seat,
                  so this must agree with the LimitBadge (Finding 25). */}
              <p className="numeric mt-1 text-2xl font-semibold">{seatsUsed}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Active</p>
              <p className="numeric mt-1 text-2xl font-semibold">{activeCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Roles</p>
              <p className="numeric mt-1 text-2xl font-semibold">
                {PRESET_ROLES.length + roles.length}
              </p>
            </div>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Team</h2>
              <span className="numeric text-[11px] text-muted-foreground">{seatsUsed} people</span>
            </div>

            {members.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center">
                <p className="text-sm font-medium">No staff yet</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                  Add a person, give them a role and the permissions that go with it, and they are invited by
                  email to sign in to this business.
                </p>
                <Button className="mt-3" onClick={openAdd} disabled={!activeId}>
                  <UserPlus className="mr-1.5 h-4 w-4" /> Add the first staff member
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
              <h2 className="text-sm font-semibold">Roles</h2>
              <span className="numeric text-[11px] text-muted-foreground">
                {PRESET_ROLES.length + roles.length} roles
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
              <ShieldCheck className="h-3.5 w-3.5" /> How staff and roles work
            </p>
            <p className="mt-2">
              Every member has a role and their own permission list, so you can start from a role and change
              one thing without making a new role. Editing a role does not rewrite the members already on it —
              open a member to re-apply their role defaults.
            </p>
            <p className="mt-2">
              Custom roles are a Business feature: Essentials uses the five built-in roles (Owner, Manager,
              Stock clerk, Sales clerk, Viewer).
            </p>
            <p className="mt-2">
              Invitations are sent by email. A member can only sign in once they accept, and removing someone
              from this list does not delete their app account.
            </p>
            <p className="mt-2">
              A store is the location a person is assigned to. It is recorded on their card; what they can open
              is still decided by their role and permissions.
            </p>
            <p className="mt-2">
              Permissions decide what each person can open: menu items outside their role are hidden, and a
              blocked address shows a “not on your role” notice instead of the page. A change applies the
              next time that person loads the app; suspending a member locks them out entirely.
            </p>
            <p className="mt-2">
              Administrators can see and change all data, manage app users and roles, and are never limited
              by a staff role. Someone with no staff record — the owner of a new business — keeps full access.
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