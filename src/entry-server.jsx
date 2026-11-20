/**
 * Build-time server renderer for the public pages (Nov 19, 2026).
 *
 * scripts/prerender-public.mjs imports the SSR bundle built from
 * this entry and calls renderRoute() once per SEO_ROUTES path;
 * the returned HTML is baked into dist/<route>.html so a crawler
 * that runs no JavaScript reads the real page — features, prices,
 * founder story, legal text — while a browser boots the client
 * bundle over it and reaches the app exactly as before.
 *
 * Only the public pages render here. The providers match the
 * client's (auth + query) minus the theme provider, whose
 * matchMedia probe has no server meaning; no effect runs under
 * renderToString, so nothing here can fetch, navigate or write.
 * The root path renders Welcome: a signed-out visitor at "/" is
 * landed there by the app, and a signed-in one is taken on to
 * their Overview by the client once it boots.
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/AuthContext';
import { SEO_ROUTES } from '@/lib/seo';
import Welcome from '@/pages/Welcome';
import Plans from '@/pages/Plans';
import About from '@/pages/About';
import TermsOfService from '@/pages/TermsOfService';
import SubscriptionPolicy from '@/pages/SubscriptionPolicy';
import PrivacyPolicy from '@/pages/PrivacyPolicy';

const ROUTES = {
  '/': Welcome,
  '/welcome': Welcome,
  '/plans': Plans,
  '/about': About,
  '/terms-of-service': TermsOfService,
  '/subscription-policy': SubscriptionPolicy,
  '/privacy-policy': PrivacyPolicy,
};

export function renderRoute(route) {
  const Page = ROUTES[route];
  if (!Page) throw new Error(`No prerender route for ${route}`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <StaticRouter location={route === '/' ? '/welcome' : route}>
          <Page />
        </StaticRouter>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

export const PRERENDER_ROUTES = Object.freeze(SEO_ROUTES.map((route) => route.path));
