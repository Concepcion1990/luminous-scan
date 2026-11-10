/**
 * Luminous Stockhaven twin — API client (T1 skeleton).
 *
 * Replaces Base44's `src/api/base44Client.js`. Fetch-based, same call
 * shapes where possible, session-cookie auth shape: requests send
 * `credentials: 'same-origin'` and the server reads the session cookie.
 *
 * Auth itself is T2 and the entity/billing APIs are T2/T3/T4, so
 * everything not yet built FAILS CLOSED here: a rejected promise with a
 * clear "not yet implemented (T2/T3)" message — never fake data, never
 * a fake success. The only call that resolves in T1 is
 * `app.getPublicSettings()` (there are no public settings yet, so it
 * resolves an empty object and the public pages render) and `auth.me()`,
 * which asks the server (`GET /api/auth/me`, 401 while signed out).
 *
 * The export is still named `base44` so the ported call sites do not
 * churn; the name is a call-site alias only — no Base44 SDK, no Base44
 * service, no token. It will be renamed `api` when the T2 auth work
 * lands.
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
    const error = new Error(data.error || data.detail || `Request failed (${response.status})`);
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
  entities: Object.fromEntries(ENTITY_NAMES.map((name) => [name, entityClient(name)])),

  auth: {
    // Real endpoint (T1): the server answers 401 while no session exists.
    me: () => request('/api/auth/me'),
    register: () => Promise.reject(notImplemented('auth.register')),
    verifyOtp: () => Promise.reject(notImplemented('auth.verifyOtp')),
    resendOtp: () => Promise.reject(notImplemented('auth.resendOtp')),
    resetPasswordRequest: () => Promise.reject(notImplemented('auth.resetPasswordRequest')),
    resetPassword: () => Promise.reject(notImplemented('auth.resetPassword')),
    updateMe: () => Promise.reject(notImplemented('auth.updateMe')),
    loginWithProvider: () => Promise.reject(notImplemented('auth.loginWithProvider')),
    setToken: () => {
      throw notImplemented('auth.setToken');
    },
    // No session exists in T1, so there is nothing to clear. Navigating
    // (when the caller passes a URL) is the only honest behaviour here;
    // real session revocation lands with auth in T2.
    logout: (redirectUrl) => {
      if (redirectUrl) window.location.assign(redirectUrl);
    },
    redirectToLogin: (returnTo) => {
      const url = `/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
      window.location.assign(url);
    },
  },

  functions: {
    invoke: (name) => Promise.reject(notImplemented(`functions.${name}`)),
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
