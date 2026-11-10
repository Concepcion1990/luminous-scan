import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBusiness } from '@/hooks/useBusiness';
import { loadEntitlement, resolveEntitlement } from '@/lib/entitlements';

/** The active business's plan, allowances and gated modules. */
export default function useEntitlements() {
  const { activeId, user } = useBusiness();

  const query = useQuery({
    queryKey: ['entitlement', activeId],
    queryFn: () => loadEntitlement(activeId),
    enabled: Boolean(activeId),
    staleTime: 60_000,
  });

  const resolved = useMemo(() => resolveEntitlement(query.data, user), [query.data, user]);

  return {
    ...resolved,
    activeId,
    isLoading: Boolean(activeId) && query.isLoading,
    refetch: query.refetch,
  };
}