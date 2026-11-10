/**
 * Luminous Stockhaven twin — API client (T2: auth + businesses live).
 *
 * Replaces Base44's `src/api/base44Client.js`. Fetch-based, same call
 * shapes where possible, session-cookie auth shape: requests send
 * `credentials: 'same-origin'` and the server reads the session cookie.
 *
 * Auth (register / verify / login / logout / password reset) and the
 * Business entity list + createBusiness function are real in T2. The
 * entity/billing APIs that belong to T3/T4 still FAIL CLOSED here: a
 * rejected promise with a clear "not yet implemented" message — never
 * fake data, never a fake success.
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
  const fail = () => Promise.reject(notImplemented(`entities.${name}`));
  return {
    filter: fail,
    list: fail,
    get: fail,
    create: fail,
    update: fail,
    delete: fail,
    count: fail,
    bulkCreate: fail,
    bulkUpdate: fail,
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
    // T2: only createBusiness is real. Everything else still rejects.
    invoke: async (name, payload) => {
      if (name === 'createBusiness') {
        const business = await request('/api/businesses', { method: 'POST', body: payload });
        return { data: { business } };
      }
      return Promise.reject(notImplemented(`functions.${name}`));
    },
  },

  users: {
    inviteUser: () => Promise.reject(notImplemented('users.inviteUser')),
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
