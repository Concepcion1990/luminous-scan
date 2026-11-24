import { apiRequest } from '../api/client.js';

// Supplier invoice files (release 361, Nov 23, 2026): the
// paper copy on an invoice. Every door sits behind the
// session + the restaurant gate on the server
// (server/restaurantFileRoutes.js); these only carry the
// calls. Her universal ruling: file uploads cap at 25 MB,
// both plans — the dialog pre-checks against the same
// constant so an oversize file gets the plain message here
// instead of a long upload and a refusal.
export const INVOICE_FILE_MAX_BYTES = 25 * 1024 * 1024;

const fileBase = (businessId, invoiceId) =>
  `/api/businesses/${encodeURIComponent(businessId)}/restaurant/invoices/${encodeURIComponent(invoiceId)}/file`;

export function getInvoiceFileMeta(businessId, invoiceId) {
  return apiRequest(fileBase(businessId, invoiceId));
}

export function uploadInvoiceFile(businessId, invoiceId, values) {
  return apiRequest(fileBase(businessId, invoiceId), { method: 'POST', body: values });
}

export function removeInvoiceFile(businessId, invoiceId) {
  return apiRequest(fileBase(businessId, invoiceId), { method: 'DELETE' });
}

export function invoiceFileBytesUrl(businessId, invoiceId) {
  return `${fileBase(businessId, invoiceId)}/bytes`;
}
