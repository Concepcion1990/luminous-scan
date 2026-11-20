/**
 * Search-engine surface (Nov 19, 2026) — the prerendered public
 * pages and their JSON-LD, generated at build time from the SAME
 * modules the app renders from, so the copy a crawler reads can
 * never drift from the copy a customer reads:
 *
 *   - plan names, prices and feature lines come from
 *     src/lib/plans.js (PLANS / TRIAL_DAYS / formatPrice);
 *   - the social links come from src/lib/socialLinks.js;
 *   - the page bodies themselves are the real React pages,
 *     server-rendered by src/entry-server.jsx.
 *
 * The title and description below are the shell's approved search
 * text (index.html) — one wording everywhere, shell and static
 * pages alike (tests/t22/seoFiles.test.js pins both sides).
 *
 * The Mobile plan is NOT in the schema: it is not sellable yet
 * (MOBILE_PLAN.available === false), and the schema must never
 * advertise what cannot be bought.
 */
import { PLANS, TRIAL_DAYS, formatPrice } from './plans.js';
import { SOCIAL_LINKS } from './socialLinks.js';

export const SEO_SITE_URL = 'https://luminousstockhaven.com';
export const SEO_TITLE = 'Luminous StockHaven — Inventory for independent businesses';
export const SEO_DESCRIPTION = 'Simple inventory that respects small businesses: barcode and QR scanning, stock, staff scheduling, payroll support and training — all in one app, in 52 languages. One honest price, no extra fees. 7-day free trial.';

/**
 * The public routes that get a prerendered file, and where the
 * file lands in dist/. Flat `<route>.html` files (not directories)
 * so express.static's `extensions: ['html']` resolves /plans to
 * dist/plans.html without a trailing-slash redirect. The app
 * flows (/login, /register, /subscribe) are deliberately NOT
 * prerendered: they are forms whose content is per-visitor state,
 * not marketing copy — they keep the plain shell + SPA fallback.
 */
export const SEO_ROUTES = Object.freeze([
  Object.freeze({ path: '/', outputFile: 'index.html', jsonLd: true }),
  Object.freeze({ path: '/welcome', outputFile: 'welcome.html', jsonLd: true }),
  Object.freeze({ path: '/plans', outputFile: 'plans.html', jsonLd: true }),
  Object.freeze({ path: '/about', outputFile: 'about.html', jsonLd: false }),
  Object.freeze({ path: '/terms-of-service', outputFile: 'terms-of-service.html', jsonLd: false }),
  Object.freeze({ path: '/subscription-policy', outputFile: 'subscription-policy.html', jsonLd: false }),
  Object.freeze({ path: '/privacy-policy', outputFile: 'privacy-policy.html', jsonLd: false }),
]);

export function seoCanonicalUrl(routePath) {
  return routePath === '/' ? `${SEO_SITE_URL}/` : `${SEO_SITE_URL}${routePath}`;
}

/** The two sellable website plans, in the order the app shows them. */
export function seoWebsitePlans() {
  return [PLANS.essentials, PLANS.business];
}

/**
 * The schema feature list: every Essentials line, then Business'
 * own extras (its first line is "Everything in Essentials", a
 * pointer at the Essentials list rather than a feature, so it is
 * not repeated as one). Read live from plans.js — a wording or
 * scope change there lands in the schema on the next build.
 */
export function seoFeatureList() {
  const business = PLANS.business.includes;
  return [...new Set([...PLANS.essentials.includes, ...business.slice(1)])];
}

export function buildSeoJsonLd(routePath = '/plans') {
  const organization = {
    '@type': 'Organization',
    '@id': `${SEO_SITE_URL}/#organization`,
    name: 'The Luminous Book Shop, LLC',
    url: `${SEO_SITE_URL}/`,
    sameAs: SOCIAL_LINKS.map((link) => link.url),
  };
  const offerCatalog = {
    '@type': 'OfferCatalog',
    name: 'Luminous StockHaven subscription plans',
    url: seoCanonicalUrl('/plans'),
    itemListElement: seoWebsitePlans().map((plan, index) => ({
      '@type': 'Offer',
      position: index + 1,
      name: `Luminous StockHaven ${plan.name}`,
      url: `${SEO_SITE_URL}/subscribe?plan=${plan.key}`,
      priceCurrency: 'USD',
      price: plan.price.toFixed(2),
      availability: 'https://schema.org/InStock',
      // The trial stated plainly, as a description — never as a
      // fake $0 price or a second hidden offer.
      description: `${formatPrice(plan.price)} per month after a ${TRIAL_DAYS}-day free trial.`,
      itemOffered: {
        '@type': 'Service',
        name: `Luminous StockHaven ${plan.name}`,
        description: plan.blurb,
        provider: { '@id': `${SEO_SITE_URL}/#organization` },
      },
    })),
  };
  const application = {
    '@type': 'SoftwareApplication',
    '@id': `${SEO_SITE_URL}/#software`,
    name: 'Luminous StockHaven',
    url: seoCanonicalUrl(routePath),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: SEO_DESCRIPTION,
    featureList: seoFeatureList(),
    offers: offerCatalog,
    publisher: { '@id': `${SEO_SITE_URL}/#organization` },
  };
  return { '@context': 'https://schema.org', '@graph': [application, organization] };
}

/** JSON-LD as it may sit inside a <script> tag (no literal `</`). */
export function serializeSeoJsonLd(routePath) {
  return JSON.stringify(buildSeoJsonLd(routePath)).replaceAll('<', '\\u003c');
}

/**
 * Assemble one prerendered document from the built shell template:
 * the shell's head (title/meta/OG stay the approved wording), the
 * route's canonical URL, the JSON-LD on the marketing pages, and
 * the server-rendered page inside #root. The client bundle then
 * boots over it exactly as it boots over the empty shell today.
 */
export function buildPrerenderedHtml({ template, route, bodyHtml }) {
  const canonical = seoCanonicalUrl(route.path);
  let html = template;
  const ogUrl = '<meta property="og:url" content="https://luminousstockhaven.com/" />';
  if (!html.includes(ogUrl)) throw new Error('shell template is missing its og:url meta');
  html = html.replace(
    ogUrl,
    `<meta property="og:url" content="${canonical}" />\n    <link rel="canonical" href="${canonical}" />`,
  );
  if (route.jsonLd) {
    const script = `<script type="application/ld+json">${serializeSeoJsonLd(route.path)}</script>`;
    if (!html.includes('</head>')) throw new Error('shell template is missing </head>');
    html = html.replace('</head>', `    ${script}\n  </head>`);
  }
  const emptyRoot = '<div id="root"></div>';
  if (!html.includes(emptyRoot)) throw new Error('shell template is missing its empty #root');
  html = html.replace(emptyRoot, `<div id="root">${bodyHtml}</div>`);
  return html;
}
