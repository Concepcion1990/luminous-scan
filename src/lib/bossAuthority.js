/**
 * Boss authority — ONE definition, used at every boss-gate in the app.
 *
 * The owner's doctrine (Nov 14, 2026): "From now on, admin is actually
 * owner. Everywhere on the app." The legacy 'admin' badge and the
 * business owner are the SAME authority, and every door that was ever
 * keyed to the badge must treat them as one.
 *
 * A user is the boss of a business when EITHER half holds:
 *  (a) they carry the legacy 'admin' badge (user.role === 'admin') —
 *      the Base44-era word. No screen in the twin assigns it (the
 *      server's publicUser carries no role at all), but the half is
 *      load-bearing: any surface that still presents it keeps working
 *      exactly as it did, and the publisher's complimentary access is
 *      never narrowed by this definition.
 *  (b) they are the business's OWNER — business.owner_id === user.id,
 *      or created_by_id === user.id (the client's long-standing owner
 *      pattern, see hooks/useStaffAccess: the business row names its
 *      creator, and at creation the two ids are the same person; no
 *      ownership-transfer flow exists that could split them).
 *
 * The server twin of this definition already exists and needs no
 * badge: server/authz resolveAccess() keys owner authority to
 * businesses.owner_id, and server/subscriptionAccess isPublisherUser()
 * keys the publisher's complimentary access to her login / her
 * grandfathered business. No server file checks a role badge — the
 * sweep that introduced this module verified that (grep: zero hits).
 *
 * This definition NEVER widens staff or manager access: a member who
 * is not the owner and carries no badge fails it, whatever their
 * workforce role or permission set says. Permission-gated doors keep
 * their own permission checks; this is only for boss-gates.
 */
export function isBoss(user, businessRecord) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.id || !businessRecord) return false;
  return (
    businessRecord.owner_id === user.id ||
    businessRecord.created_by_id === user.id
  );
}
