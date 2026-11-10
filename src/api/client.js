/**
 * Luminous Stockhaven twin — API client (T3: auth + businesses + core shop live).
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
 * Google sign-in is NOT available on the twin (owner's decision,
 * Nov 9 — email + password only; see twin-t2-report.md). `loginWith-
 * Provider` and the authMfa Google helpers reject with that message.
 *
 * The export is still named `base44` so the ported call sites do not
 * churn; the name is a call-site alias only — no Base44 SDK, no Base44
 * service, no token.
 */

const notImplemented = (area) =>
  new Error(`${area} is not yet implemented (T2/T3) — the twin skeleton serves public pages only.`);

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || data.detail || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function entityClient(name) {
  // Real in T3: the twin's generic entity API (server/entities.js)
  // speaks the same filter/get/create/update/delete/count/bulk
  // shapes the ported pages used against Base44. Filters use the
  // Base44 language ($or/$and/$in/$ne/$regex/$exists) and are
  // evaluated server-side; every write is plan- and permission-
  // checked there, never trusted from the browser.
  const base = `/api/entities/${name}`;
  const encode = (id) => encodeURIComponent(id);
  return {
    filter: (query = {}, options = {}) =>
      request(`${base}/query`, { method: 'POST', body: { filter: query, ...options } }),
    list: (options = {}) =>
      request(`${base}/query`, { method: 'POST', body: { filter: {}, ...options } }),
    get: (id) => request(`${base}/${encode(id)}`),
    create: (values) => request(base, { method: 'POST', body: values }),
    update: (id, patch) => request(`${base}/${encode(id)}`, { method: 'PATCH', body: patch }),
    delete: (id) => request(`${base}/${encode(id)}`, { method: 'DELETE' }),
    count: async (query = {}) => {
      const data = await request(`${base}/count`, { method: 'POST', body: { filter: query } });
      return data.count;
    },
    bulkCreate: (rows) => request(`${base}/bulk`, { method: 'POST', body: rows }),
    bulkUpdate: (rows) => request(`${base}/bulk`, { method: 'PATCH', body: rows }),
    updateMany: (filter, patch) =>
      request(`${base}/update-many`, { method: 'POST', body: { filter, patch } }),
    deleteMany: (filter) =>
      request(`${base}/delete-many`, { method: 'POST', body: { filter } }),
  };
}

// T2: the Business entity is real — the workspace loader
// (src/lib/business.js loadWorkspace) lists the caller's businesses,
// and Settings renames via update (T6, still fail-closed).
function businessEntityClient() {
  const listBusinesses = () => request('/api/businesses');
  return {
    filter: () => listBusinesses(),
    list: () => listBusinesses(),
    get: async (id) => {
      const page = await listBusinesses();
      const found = (page.items ?? []).find((b) => b.id === id);
      if (!found) {
        const error = new Error('Business not found');
        error.status = 404;
        throw error;
      }
      return found;
    },
    create: () => Promise.reject(notImplemented('entities.Business.create')),
    update: () => Promise.reject(notImplemented('entities.Business.update')),
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
  'Bom',
  'Business',
  'Category',
  'CountSession',
  'Entitlement',
  'Listing',
  'Location',
  'Order',
  'Product',
  'PurchaseOrder',
  'Return',
  'StaffMember',
  'StaffRole',
  'StockLevel',
  'StockMovement',
  'Supplier',
];

export const base44 = {
  entities: Object.fromEntries(
    ENTITY_NAMES.map((name) => [name, name === 'Business' ? businessEntityClient() : entityClient(name)]),
  ),

  auth: {
    // Real endpoints (T2): the server answers with the signed-in user
    // or 401 while signed out.
    me: () => request('/api/auth/me'),
    register: ({ email, password }) =>
      request('/api/auth/register', { method: 'POST', body: { email, password } }),
    verifyOtp: ({ email, otpCode }) =>
      request('/api/auth/verify', { method: 'POST', body: { email, otpCode } }),
    resendOtp: (email) =>
      request('/api/auth/resend-otp', { method: 'POST', body: { email } }),
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
        new Error('Google sign-in is not available — please log in with your email and password.'),
      ),
    // Cookie sessions: there is no bearer token to store. Kept as a
    // no-op so the ported Register verify path keeps working.
    setToken: () => {},
    // Revokes the server-side session, then navigates when the caller
    // passes a URL (AuthContext passes the current URL).
    logout: async (redirectUrl) => {
      try {
        await request('/api/auth/logout', { method: 'POST' });
      } finally {
        if (redirectUrl) window.location.assign(redirectUrl);
      }
    },
    redirectToLogin: (returnTo) => {
      const url = `/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
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
      if (!businessId) throw new Error('Choose a business first.');
      return request(`/api/businesses/${businessId}/staff/invite`, {
        method: 'POST',
        body: { email },
      });
    },
  },

  integrations: {
    Core: {
      UploadPublicFile: () => Promise.reject(notImplemented('integrations.Core.UploadPublicFile')),
    },
  },

  app: {
    // T1: the twin has no public settings yet. Resolving an empty object
    // lets AuthContext finish its check and the public pages render.
    getPublicSettings: async () => ({}),
  },
};

export default base44;
