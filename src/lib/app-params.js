/**
 * Twin app parameters.
 *
 * Replaces the Base44 `app-params.js` (which read a Base44 app id and a
 * bearer token out of the URL / local storage). The twin has no Base44
 * app id and no bearer token: auth is a session cookie (T2), so `token`
 * is always null and AuthContext skips the token-based auth check.
 * Keeping the same `appParams` shape means the existing call sites
 * (`AuthContext`, `authMfa`) need no churn.
 */
export const appParams = {
  appId: 'luminous-stockhaven',
  token: null,
  functionsVersion: undefined,
  appBaseUrl: '',
};
