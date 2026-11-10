import { useQuery, useQueryClient } from '@tanstack/react-query';
import { effectivePlanKey, loadEntitlements, trialLabel } from '@/lib/entitlements';
import { businessLimitForPlan } from '@/lib/plans';
import {
  createBusiness,
  loadWorkspace,
  renameBusiness,
  resolveBusiness,
  switchBusiness,
} from '@/lib/business';

/**
 * The owner's business workspaces, the one in use, and switching between them.
 * Switching refetches, so every screen reloads scoped to the new business.
 */
export function useBusiness() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['workspace'],
    queryFn: loadWorkspace,
    staleTime: 30_000,
  });

  // Oldest first, whatever order the server returned: the login's allowance comes
  // from the first workspace it ever created, never from the one currently in use.
  const businesses = [...(query.data?.businesses ?? [])].sort((a, b) =>
    String(a.created_date || '').localeCompare(String(b.created_date || ''))
  );
  const activeId = query.data?.activeId ?? null;
  const record = businesses.find((b) => b.id === activeId) ?? null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['workspace'] });

  // Every business's plan row, read here rather than through useEntitlements, which
  // depends on this hook. The login's allowance comes from the oldest workspace's plan.
  const ids = businesses.map((business) => business.id);
  const plansQuery = useQuery({
    queryKey: ['entitlements', ids],
    queryFn: () => loadEntitlements(ids),
    enabled: Boolean(ids.length),
    staleTime: 60_000,
  });
  const plans = plansQuery.data ?? [];
  const oldestPlan = plans.find((row) => row.business_id === businesses[0]?.id) ?? null;
  const user = query.data?.user ?? null;
  // The plan rows arrive after the workspaces do. Until they have been read
  // (or the read has failed), the allowance is unknown — never the Essentials
  // default, or a Business login briefly shows "1 OF 1" with the Essentials
  // sentence. A login with no businesses has nothing to read, so its rows
  // count as known. `isFetched` settles on success or error; a failed read
  // is unknown too, not a silent Essentials fallback.
  const plansKnown = ids.length === 0 || plansQuery.isFetched;
  const plansFailed = plansQuery.isError;
  const limit = businessLimitForPlan(
    effectivePlanKey(oldestPlan, user),
    plansKnown && !plansFailed,
  );

  /** The trial note for one business, or null when it is not trialing. */
  const trialLabelFor = (businessId) =>
    trialLabel(plans.find((row) => row.business_id === businessId));

  const switchTo = async (businessId) => {
    if (!businessId || businessId === activeId) return;
    await switchBusiness(businessId);
    await refresh();
  };

  const create = async (values) => {
    const business = await createBusiness(values);
    await switchBusiness(business.id);
    await refresh();
    return business;
  };

  const rename = async (businessId, name) => {
    await renameBusiness(businessId, name);
    await refresh();
  };

  return {
    user,
    businesses,
    activeId,
    record,
    profile: resolveBusiness(record),
    // Unknown allowance means "cannot create yet", never "Essentials says no".
    canCreate: limit != null && businesses.length < limit,
    limit,
    // The plan rows are a separate, slower read than the workspaces: screens
    // that print the allowance must wait for these instead of printing the
    // Essentials default. The server still enforces the real limit on create.
    plansLoading: !plansKnown,
    plansError: plansFailed,
    refetchPlans: plansQuery.refetch,
    trialLabelFor,
    isLoading: query.isLoading,
    switchTo,
    create,
    rename,
    refresh,
  };
}