/**
 * Publisher-only visibility: diagnostics Concepcion keeps for her own
 * working view must never render for customers.
 *
 * Every customer is the owner of their own workspace, so workspace
 * ownership alone cannot tell her apart from a customer. The publisher
 * is identified two ways, and either one is enough:
 * - the app-owner login (cperezcarrillo.1990@gmail.com), or
 * - the publisher's own grandfathered business, viewed by its creator.
 *
 * Failing closed on purpose: an unknown login or a business that is not
 * the publisher's own simply hides the diagnostic. Nothing here grants
 * access, changes billing, or touches a subscription.
 */
export const PUBLISHER_OWNER_EMAIL = 'cperezcarrillo.1990@gmail.com';
export const PUBLISHER_BUSINESS_ID = '6aeaec9b141cfe26e5a411be';

export function isPublisherOwner(user, businessRecord) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (email && email === PUBLISHER_OWNER_EMAIL) return true;
  if (!user?.id || !businessRecord?.id) return false;
  return (
    businessRecord.id === PUBLISHER_BUSINESS_ID &&
    businessRecord.created_by_id === user.id
  );
}
