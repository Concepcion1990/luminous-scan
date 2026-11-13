import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/client';
import { useBusiness } from '@/hooks/useBusiness';
import { useAuth } from '@/lib/AuthContext';

/**
 * What the signed-in person may open in the active business.
 *
 * Full access belongs to the business's creator and to workspace administrators —
 * never to anyone who merely has a login. A missing staff record is a closed door,
 * not an open one. A login that has no business yet stays open so onboarding and
 * business creation still work; row-level security keeps every other business out.
 */
export default function useStaffAccess() {
  const { activeId, record, isLoading: workspaceLoading } = useBusiness();
  const { user } = useAuth();
  const email = String(user?.email || '').toLowerCase();
  const isAdmin = user?.role === 'admin';
  const isOwner = Boolean(record?.id && user?.id && record.created_by_id === user.id);
  const needsSeat = Boolean(activeId) && !isAdmin && !isOwner;

  const { data, isLoading } = useQuery({
    queryKey: ['staff-access', activeId, email],
    enabled: needsSeat && Boolean(email),
    staleTime: 60_000,
    queryFn: async () => {
      const page = await base44.entities.StaffMember.filter(
        { business_id: activeId },
        { limit: 200 }
      );
      return (
        (page.items || []).find(
          (member) => String(member.email || '').toLowerCase() === email
        ) || null
      );
    },
  });

  const member = needsSeat ? data || null : null;
  const permissions = new Set(
    Array.isArray(member?.permissions) ? member.permissions : []
  );

  // No active business: this is onboarding, not someone else's workspace.
  const onboarding = !activeId;
  const unrestricted = isAdmin || isOwner || onboarding;
  const status = member?.status || null;
  const suspended = status === 'suspended';
  const pending = status === 'invited';
  const seatGranted = unrestricted || status === 'active';
  const blocked = !seatGranted && !pending;
  const blockedReason = suspended ? 'suspended' : pending ? 'pending' : blocked ? 'no-seat' : null;
  const loading = workspaceLoading || (needsSeat && isLoading);

  return {
    loading,
    member,
    unrestricted,
    suspended,
    pending,
    blocked,
    blockedReason,
    can: (key) => {
      if (!key) return true;
      // Until access resolves, the page gate below keeps everything closed.
      if (loading) return true;
      if (!seatGranted) return false;
      if (unrestricted) return true;
      return permissions.has(key);
    },
  };
}