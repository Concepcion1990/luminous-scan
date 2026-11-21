/**
 * Profile photos + the owner's display name (Nov 21, 2026) —
 * the client half of server/profilePhotoRoutes.js.
 *
 * The law the UI lives by: a photo shows only once the OWNER
 * has approved it. The summary endpoint answers with KEYS ONLY
 * (never bytes), so every avatar on screen is either an approved
 * photo served by the file route or the person's initials. A
 * waiting photo's bytes exist in exactly two places: the
 * owner's approval card and the sender's own Settings preview.
 */
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

export const profilePhotosBase = (businessId) =>
  `/api/businesses/${businessId}/profile-photos`;

/** The approved photo for a person key ('owner' or a staff id). */
export const profilePhotoFileUrl = (businessId, key) =>
  `${profilePhotosBase(businessId)}/${encodeURIComponent(key)}/file`;

/** A waiting photo, for the owner's approval card only. */
export const profilePhotoPendingUrl = (businessId, key) =>
  `${profilePhotosBase(businessId)}/${encodeURIComponent(key)}/pending-file`;

/** The signed-in person's own waiting photo (their preview). */
export const myPendingPhotoUrl = (businessId) =>
  `${profilePhotosBase(businessId)}/me/pending-file`;

export function useProfilePhotoSummary(businessId) {
  return useQuery({
    queryKey: ['profile-photos', businessId],
    queryFn: () => apiRequest(profilePhotosBase(businessId) + '/summary'),
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });
}

export function useMyProfilePhoto(businessId) {
  return useQuery({
    queryKey: ['profile-photos', businessId, 'me'],
    queryFn: () => apiRequest(profilePhotosBase(businessId) + '/me'),
    enabled: Boolean(businessId),
    staleTime: 15_000,
  });
}

export function usePendingProfilePhotos(businessId, enabled) {
  return useQuery({
    queryKey: ['profile-photos', businessId, 'pending'],
    queryFn: () => apiRequest(profilePhotosBase(businessId) + '/pending'),
    enabled: Boolean(businessId) && Boolean(enabled),
    staleTime: 15_000,
  });
}

/** Up to two initials from a display name, for the no-photo face. */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}
