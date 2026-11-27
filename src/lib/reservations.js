/**
 * Reservations book + walk-in waitlist — client doors
 * (Nov 26, 2026; plan release 376 with its two riders).
 *
 * Thin wrappers over server/reservationsRoutes.js.
 * Business-only (the restaurant plan gate sits server-
 * side too). Writes ride the host door server-side; the
 * book response carries `canHost` so the page only shows
 * the doors a person may actually use, and
 * `textAvailable` — whether the texting keyset exists —
 * so the page can say "not available yet" in plain words
 * instead of pretending a text went out.
 */
import { apiRequest } from '../api/client.js';

const book = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/reservations`;
const queue = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/waitlist`;

export function fetchReservationBook(businessId, from, to) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return apiRequest(`${book(businessId)}${query ? `?${query}` : ''}`);
}

export function fetchReservationsToday(businessId, date) {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return apiRequest(`${book(businessId)}/today${query}`);
}

export function createReservation(businessId, body) {
  return apiRequest(book(businessId), { method: 'POST', body });
}

export function updateReservation(businessId, reservationId, body) {
  return apiRequest(`${book(businessId)}/${encodeURIComponent(reservationId)}`, { method: 'PUT', body });
}

export function deleteReservation(businessId, reservationId) {
  return apiRequest(`${book(businessId)}/${encodeURIComponent(reservationId)}`, { method: 'DELETE' });
}

export function sendReservationsDigest(businessId, date) {
  return apiRequest(`${book(businessId)}/digest`, { method: 'POST', body: { date } });
}

export function fetchWaitlist(businessId) {
  return apiRequest(queue(businessId));
}

export function createWaitlistEntry(businessId, body) {
  return apiRequest(queue(businessId), { method: 'POST', body });
}

export function updateWaitlistEntry(businessId, entryId, body) {
  return apiRequest(`${queue(businessId)}/${encodeURIComponent(entryId)}`, { method: 'PUT', body });
}

export function notifyWaitlistReady(businessId, entryId) {
  return apiRequest(`${queue(businessId)}/${encodeURIComponent(entryId)}/ready`, { method: 'POST', body: {} });
}
