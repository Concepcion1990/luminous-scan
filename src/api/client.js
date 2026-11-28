/**
 * Luminous StockHaven twin — API client (T3: auth + businesses + core shop live).
 *
 * Replaces Base44's `src/api/base44Client.js`. Fetch-based, same call
 * shapes where possible, session-cookie auth shape: requests send
 * `credentials: 'same-origin'` and the server reads the session cookie.
 *
 * Auth (register / verify / login / logout / password reset), the
 * Business entity, the shop entities (products, stock, staff, orders,
 * suppliers, alerts, ...) and the create-* functions are real in T3.
 * The billing APIs are real in T4 (Stripe checkout, reconcile,
 * cancel, plan changes, status, readiness, publisher gate).
 *
 * T6.1 CSRF: every mutating call fetches a fresh token at send time
 * (src/lib/csrf.js) and sends it as X-CSRF-Token. The pre-auth
 * endpoints (register / verify / login / password reset) carry no
 * session yet and are exempt server-side, so they skip the fetch.
 *
 * Google sign-in is NOT available on the twin (owner's decision,
 * Nov 9 — email + password only; see twin-t2-report.md). `loginWith-
 * Provider` and the authMfa Google helpers reject with that message.
 *
 * The export is still named `base44` so the ported call sites do not
 * churn; the name is a call-site alias only — no Base44 SDK, no Base44
 * service, no token.
 */

import { csrfHeadersFor } from '../lib/csrf.js';
import { loginBounceTarget } from '../lib/authReturnTo.js';
import { bumpData } from '../lib/dataFreshness.js';
import { isEmbedVisual } from '../lib/embedMode.js';
import { prepareImageForUpload } from '../lib/imagePrep.js';
import { t, getLocale } from '../lib/i18n.js';
import { apiErrorMessage } from '../lib/apiErrors.js';

const notImplemented = (area) =>
  new Error(`${area} is not yet implemented (T2/T3) — the twin skeleton serves public pages only.`);

async function request(path, { method = 'GET', body, timeoutMs } = {}) {
  const csrfHeaders = await csrfHeadersFor(path, method);
  // Reads may carry a timeout (entity queries pass one): a single
  // stalled request on a phone network must fail — so the caller's
  // retry can proceed — instead of hanging the whole screen
  // (Nov 14, 2026: an Overview load sat ~15s on one stuck request,
  // then painted the previous snapshot as if it were current).
  // Writes pass no timeout: a confirmed user action on a slow
  // uplink must never be cut off mid-send by the client.
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // The banner text resolves through the API-error map
    // (src/lib/apiErrors.js): the server's stable code + English
    // message become the reader's language whenever the words are
    // known; the English message itself is the final fallback —
    // never a raw code, never a blank.
    const error = new Error(apiErrorMessage(data, response.status));
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

/** Entity reads fail fast (see request's timeout note above). */
const READ_TIMEOUT_MS = 15_000;

function entityClient(name) {
  // Real in T3: the twin's generic entity API (server/entities.js)
  // speaks the same filter/get/create/update/delete/count/bulk
  // shapes the ported pages used against Base44. Filters use the
  // Base44 language ($or/$and/$in/$ne/$regex/$exists) and are
  // evaluated server-side; every write is plan- and permission-
  // checked there, never trusted from the browser.
  const base = `/api/entities/${name}`;
  const encode = (id) => encodeURIComponent(id);
  // Data freshness (Nov 14, 2026): every inventory write through
  // this factory bumps the shared freshness bus, so kept-alive
  // screens (Products, Overview) refetch when they become visible
  // instead of showing the world from before the change. See
  // src/lib/dataFreshness.js and src/hooks/useDataFresh.js.
  const announce = (promise) =>
    INVENTORY_ENTITIES.has(name)
      ? promise.then((result) => {
          bumpData('inventory');
          return result;
        })
      : promise;
  return {
    filter: (query = {}, options = {}) =>
      request(`${base}/query`, { method: 'POST', body: { filter: query, ...options }, timeoutMs: READ_TIMEOUT_MS }),
    list: (options = {}) =>
      request(`${base}/query`, { method: 'POST', body: { filter: {}, ...options }, timeoutMs: READ_TIMEOUT_MS }),
    get: (id) => request(`${base}/${encode(id)}`, { timeoutMs: READ_TIMEOUT_MS }),
    create: (values) => announce(request(base, { method: 'POST', body: values })),
    update: (id, patch) => announce(request(`${base}/${encode(id)}`, { method: 'PATCH', body: patch })),
    delete: (id) => announce(request(`${base}/${encode(id)}`, { method: 'DELETE' })),
    count: async (query = {}) => {
      const data = await request(`${base}/count`, { method: 'POST', body: { filter: query }, timeoutMs: READ_TIMEOUT_MS });
      return data.count;
    },
    bulkCreate: (rows) => announce(request(`${base}/bulk`, { method: 'POST', body: rows })),
    bulkUpdate: (rows) => announce(request(`${base}/bulk`, { method: 'PATCH', body: rows })),
    updateMany: (filter, patch) =>
      announce(request(`${base}/update-many`, { method: 'POST', body: { filter, patch } })),
    deleteMany: (filter) =>
      announce(request(`${base}/delete-many`, { method: 'POST', body: { filter } })),
  };
}

// Category and Location ride the same bus (Nov 14, 2026):
// categories, tags and location names are inventory truth too —
// a rename anywhere must show on Products facets, the form's
// suggestions, the Categories & tags counts, the Movements
// location filter and every picker without a refresh. Tags also
// live on products, whose writes already announce.
const INVENTORY_ENTITIES = new Set(['Product', 'StockLevel', 'StockMovement', 'Category', 'Location', 'ImportEvent']);

// T2: the Business entity is real — the workspace loader
// (src/lib/business.js loadWorkspace) lists the caller's businesses,
// and Settings saves via update (T6: PATCH /api/businesses/:id,
// owner-only, allowlisted fields — see server/authRoutes.js).
function businessEntityClient() {
  const listBusinesses = () => request('/api/businesses');
  return {
    filter: () => listBusinesses(),
    list: () => listBusinesses(),
    get: async (id) => {
      const page = await listBusinesses();
      const found = (page.items ?? []).find((b) => b.id === id);
      if (!found) {
        const error = new Error(t('apiLib.businessNotFound'));
        error.status = 404;
        throw error;
      }
      return found;
    },
    create: () => Promise.reject(notImplemented('entities.Business.create')),
    update: (id, patch) => request(`/api/businesses/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
    delete: () => Promise.reject(notImplemented('entities.Business.delete')),
    count: async () => {
      const page = await listBusinesses();
      return page.total ?? (page.items ?? []).length;
    },
    bulkCreate: () => Promise.reject(notImplemented('entities.Business.bulkCreate')),
    bulkUpdate: () => Promise.reject(notImplemented('entities.Business.bulkUpdate')),
  };
}

const ENTITY_NAMES = [
  'AlertRule',
  'BatchRun',
  'Bom',
  'Business',
  'Category',
  'CountSession',
  'CreditMemo',
  'EightySixItem',
  'Entitlement',
  'ImportEvent',
  'Listing',
  'Location',
  'LogBookEntry',
  'Order',
  'Par',
  'Product',
  'PurchaseOrder',
  'Recipe',
  'Return',
  'StaffMeal',
  'StaffMember',
  'StaffRole',
  'StockBatch',
  'StockLevel',
  'StockMovement',
  'Supplier',
  'SupplierInvoice',
  'TempLog',
  'SafetyLog',
  'PestVisit',
  'CalibrationLog',
  'VendorPriceAlert',
  'WasteEntry',
];

/**
 * T5: plain JSON / file calls to the twin's own API (same session
 * cookie as `request`). Used by the business flows (PO receive,
 * builds), the server-export rewire and the print PDFs — none of
 * these go through `base44.functions.invoke`.
 */
export async function apiRequest(path, { method = 'GET', body } = {}) {
  return request(path, { method, body });
}

export async function apiDownload(path) {
  const response = await fetch(path, { method: 'GET', credentials: 'same-origin' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(apiErrorMessage(data, response.status, 'apiLib.downloadFailed'));
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return {
    blob: await response.blob(),
    filename:
      response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'download',
    truncated: response.headers.get('X-Export-Truncated') === '1',
    rows: Number(response.headers.get('X-Export-Rows') || 0) || null,
  };
}

export const base44 = {  entities: Object.fromEntries(
    ENTITY_NAMES.map((name) => [name, name === 'Business' ? businessEntityClient() : entityClient(name)]),
  ),

  auth: {
    // Real endpoints (T2): the server answers with the signed-in user
    // or 401 while signed out.
    me: () => request('/api/auth/me'),
    // The reader's current language rides along so the verification
    // email itself arrives in their language (leftovers sweep).
    register: ({ email, password, language, inviteToken, inviteClaim }) =>
      request('/api/auth/register', { method: 'POST', body: { email, password, language: language || getLocale(), inviteToken: inviteToken || undefined, inviteClaim: inviteClaim || undefined } }),
    // Single-use invite links (Nov 22, 2026): the Register page
    // opens the tokened link once on landing; the server claims
    // it for this browser session or refuses it (410) with the
    // kind message the page shows in the reader's language.
    openInviteLink: ({ token, claim }) =>
      request('/api/auth/invite/open', { method: 'POST', body: { token, claim: claim || undefined } }),
    verifyOtp: ({ email, otpCode }) =>
      request('/api/auth/verify', { method: 'POST', body: { email, otpCode } }),
    resendOtp: (email) =>
      request('/api/auth/resend-otp', { method: 'POST', body: { email, language: getLocale() } }),
    resetPasswordRequest: (email) =>
      request('/api/auth/forgot-password', { method: 'POST', body: { email } }),
    resetPassword: ({ resetToken, newPassword }) =>
      request('/api/auth/reset-password', { method: 'POST', body: { resetToken, newPassword } }),
    updateMe: (patch) =>
      request('/api/auth/me', { method: 'PATCH', body: patch }),
    // No Google sign-in on the twin (owner's decision, Nov 9 — email +
    // password only). Rejects plainly instead of redirecting anywhere.
    loginWithProvider: () =>
      Promise.reject(
        new Error(t('apiLib.googleSignInUnavailable')),
      ),
    // Cookie sessions: there is no bearer token to store. Kept as a
    // no-op so the ported Register verify path keeps working.
    setToken: () => {},
    // Revokes the server-side session, then navigates when the caller
    // passes a URL (AuthContext passes the current URL).
    logout: async (redirectUrl) => {
      // One session, one door out (owner ruling, Nov 15, 2026): a
      // lesson visual's wide view is this same app in a frame, on
      // this same session. Logging out inside the frame ends the
      // session for the WHOLE app — the parent is told first, so it
      // can tear the wide view down and walk out the same door,
      // instead of sitting signed-in over the frame's login page.
      // Every logout passes through here (AuthContext delegates;
      // the paused-access screen calls this directly), so every
      // plan and every role is covered. The message goes before
      // the request: the navigation below may tear the frame down.
      if (isEmbedVisual() && typeof window !== 'undefined' && window.parent !== window) {
        try {
          window.parent.postMessage({ type: 'sh:session-ended' }, window.location.origin);
        } catch {
          /* a parent that cannot hear cannot be left behind either */
        }
      }
      try {
        await request('/api/auth/logout', { method: 'POST' });
      } finally {
        if (redirectUrl) window.location.assign(redirectUrl);
      }
    },
    // The carried returnTo is sanitized here as well as at the caller:
    // whatever a caller hands in — even a full href with a nested
    // returnTo — the bounce that leaves this function is a single hop
    // to /login with one singly-encoded relative path, or plain /login
    // when there is nothing safe to resume. (2026-11-12 loop fix.)
    redirectToLogin: (returnTo) => {
      const target = loginBounceTarget(returnTo, window.location.origin);
      const url = target === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(target)}`;
      window.location.assign(url);
    },
  },

  functions: {
    // T2: createBusiness is real. T3: the shop functions are real too —
    // create-products / create-staff-member / create-role /
    // create-location run through the server routes that enforce the
    // plan caps. T4: the billing functions are real — Stripe checkout,
    // reconcile, cancel, plan changes, status, readiness, and the
    // publisher gate all run through /api/billing/*.
    invoke: async (name, payload) => {
      if (name === 'createBusiness') {
        const business = await request('/api/businesses', { method: 'POST', body: payload });
        return { data: { business } };
      }
      if (name === 'create-products') {
        const data = await request(`/api/businesses/${payload.business_id}/products`, {
          method: 'POST',
          body: payload,
        });
        // A creation is an inventory change like any other, but
        // this function path bypasses the entity factory's central
        // announcement — so announce here, for every caller
        // (Nov 14, 2026: a product created from the Scan flow with
        // no opening movement was invisible to the Overview,
        // Products and My inventory until a manual refresh).
        bumpData('inventory');
        return { data };
      }
      if (name === 'create-staff-member') {
        const data = await request(`/api/businesses/${payload.business_id}/staff`, {
          method: 'POST',
          body: payload,
        });
        return { data };
      }
      if (name === 'create-role') {
        const data = await request(`/api/businesses/${payload.business_id}/roles`, {
          method: 'POST',
          body: payload,
        });
        return { data };
      }
      if (name === 'create-location') {
        const data = await request(`/api/businesses/${payload.business_id}/locations`, {
          method: 'POST',
          body: payload,
        });
        // Same announcement as create-products: locations are
        // inventory truth on the same bus.
        bumpData('inventory');
        return { data };
      }
      if (name === 'create-checkout') {
        const data = await request('/api/billing/checkout', {
          method: 'POST',
          body: { plan: payload.plan, business_id: payload.business_id },
        });
        return { data };
      }
      if (name === 'reconcile-subscription-access') {
        const data = await request('/api/billing/reconcile', {
          method: 'POST',
          body: { business_id: payload.business_id, session_id: payload.session_id },
        });
        return { data };
      }
      if (name === 'cancel-subscription') {
        const data = await request('/api/billing/cancel', {
          method: 'POST',
          body: { business_id: payload.business_id },
        });
        return { data };
      }
      if (name === 'get-subscription-status') {
        const data = await request(`/api/billing/status?business_id=${encodeURIComponent(payload.business_id)}`);
        return { data };
      }
      if (name === 'get-publisher-access') {
        const data = await request('/api/billing/publisher-access');
        return { data };
      }
      if (name === 'inspect-essentials-checkout-readiness') {
        const data = await request('/api/billing/readiness');
        return { data };
      }
      if (name === 'preview-plan-change') {
        const data = await request('/api/billing/plan-change/preview', {
          method: 'POST',
          body: { target_plan: payload.target_plan, business_id: payload.business_id },
        });
        return { data };
      }
      if (name === 'request-plan-upgrade' || name === 'change-subscription-plan') {
        const data = await request('/api/billing/plan-change', {
          method: 'POST',
          body: { target_plan: payload.target_plan, business_id: payload.business_id },
        });
        return { data };
      }
      if (name === 'update-payment-method') {
        const data = await request('/api/billing/payment-update', {
          method: 'POST',
          body: { business_id: payload.business_id },
        });
        return { data };
      }
      if (name === 'request-account-deletion') {
        // Settings → Delete account (Deletion-request phase,
        // Nov 14, 2026): the twin's account-level endpoint. A
        // request for review — it stores the request and deletes
        // nothing; status reads only the caller's own request.
        if (payload?.action === 'status') {
          const data = await request('/api/account/deletion-request');
          return { data };
        }
        const data = await request('/api/account/deletion-request', {
          method: 'POST',
          body: { confirmation: payload?.confirmation },
        });
        return { data };
      }
      if (name === 'check-trial-eligibility') {
        const data = await request(`/api/billing/trial-eligibility?business_id=${encodeURIComponent(payload.business_id)}`);
        return { data };
      }
      return Promise.reject(notImplemented(`functions.${name}`));
    },
  },

  users: {
    // Staff invite: the StaffMember row is the invite. The server
    // sends the invite email when a mailer is configured; the member
    // activates by signing in with that email. The active business
    // comes from the signed-in user's record (same source the
    // workspace loader uses).
    inviteUser: async (email) => {
      const me = await request('/api/auth/me');
      const businessId = me?.active_business_id;
      if (!businessId) throw new Error(t('apiLib.chooseBusinessFirst'));
      return request(`/api/businesses/${businessId}/staff/invite`, {
        method: 'POST',
        body: { email },
      });
    },
  },

  integrations: {
    Core: {
      // Product photos (Nov 14, 2026): real at last — this was the
      // twin's one dead stub, and the product form's upload silently
      // failed on it. Reads the file as a data URL (the store-logo
      // upload's pattern) and posts it to the active business's
      // photo endpoint; the server stores the bytes in Postgres and
      // returns the public URL the form saves into photo_urls.
      UploadPublicFile: async ({ file }) => {
        const me = await request('/api/auth/me');
        const businessId = me?.active_business_id;
        if (!businessId) throw new Error(t('apiLib.chooseBusinessFirst'));
        // The app sizes the photo FOR the customer (owner's rule:
        // nobody is ever told to shrink a picture themselves) —
        // downscaled + re-encoded before it ever leaves the device.
        const prepared = await prepareImageForUpload(file);
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error(t('productForm.uploadFailed')));
          reader.readAsDataURL(prepared);
        });
        const { url } = await request(`/api/businesses/${businessId}/product-photos`, {
          method: 'POST',
          body: { dataUrl },
        });
        return { file_url: url };
      },
    },
  },

  app: {
    // T1: the twin has no public settings yet. Resolving an empty object
    // lets AuthContext finish its check and the public pages render.
    getPublicSettings: async () => ({}),
  },
};

export default base44;
