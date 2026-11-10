import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRADEMARK_NOTICE as notice, LEGAL_FOOTER as footer } from './trademarkNotice.js';
import { en } from './locales/en.js';

// The owner's trademark / copyright statement, dictated Nov 9, 2026.
// Rendered verbatim on Plans + Subscribe (the notice block) and as a
// small centered footer at the bottom of the pages. The text lives in
// src/lib/trademarkNotice.js — a single source of truth — and the
// components only lay it out, so the wording cannot drift between pages.

const read = (file) => readFileSync(file, 'utf8');

test('trademark notice text is the owner\'s exact words, verbatim', () => {
  assert.equal(notice.heading, '🛡️ Built for Retailers, Priceless to Corporate Vultures');
  assert.equal(
    notice.intro,
    'I built this app because I run 5 retail storefronts and was sick of being price-gouged by confusing, multi-hundred-dollar software. This app was built to protect independent artists, crafters, bookstore owners, and local shops.',
  );
  assert.equal(notice.legalHeading, 'LEGAL NOTICE TO COMPETITORS & IMITATORS:');
  assert.equal(
    notice.legalBody,
    'Luminous StockHaven™ and The Luminous Bookshop, LLC® are fully registered legal entities. All application user interfaces, backend structural workflows, original features, text, user role documentation, and digital assets are strictly protected under federal copyright law. We actively monitor the market. Any attempt to scrape our platform, clone our proprietary workflows, or infringe upon our intellectual property will be met with immediate, aggressive legal action and federal statutory damages.',
  );
  assert.equal(notice.acquisitionHeading, 'TO ACQUISITION FIRMS & BROKERS:');
  assert.equal(
    notice.acquisitionBody,
    "Do not email me. Do not DM me. Do not pitch me a 'strategic exit.' You can throw thousands, millions, billions, or trillions at me — the answer is No. You will not buy this app just to jack up prices on my fellow merchants. Any acquisition cold-emails will be instantly marked as spam, and your domain will be permanently blocked from our platform. Save your breath.",
  );
});

test('footer text is the owner\'s exact words, verbatim', () => {
  assert.equal(footer.copyrightLine, '© 2026 The Luminous Bookshop, LLC. All rights reserved.');
  assert.equal(
    footer.trademarkLine,
    'Luminous StockHaven™ and the Luminous StockHaven logo are trademarks of The Luminous Bookshop, LLC. All application interfaces, features, workflows, and proprietary text are protected under applicable copyright laws. Unauthorized duplication, cloning, or scraping is strictly prohibited.',
  );
});

test('the ® on The Luminous Bookshop, LLC stays exactly as she wrote it', () => {
  // Her decision Nov 9, 2026: keep the ® — no ™ swap. If anyone "fixes"
  // it, this test fails on purpose.
  assert.match(notice.legalBody, /The Luminous Bookshop, LLC®/);
  assert.doesNotMatch(notice.legalBody, /The Luminous Bookshop, LLC™/);
  assert.match(notice.legalBody, /Luminous StockHaven™/);
  assert.match(footer.trademarkLine, /Luminous StockHaven™/);
  assert.ok(Object.isFrozen(notice), 'notice module must be frozen');
  assert.ok(Object.isFrozen(footer), 'footer module must be frozen');
});

test('TrademarkNotice renders the notice from the module, never hardcoded copy', () => {
  const component = read('src/components/TrademarkNotice.jsx');
  assert.match(component, /import \{ TRADEMARK_NOTICE as notice \} from '@\/lib\/trademarkNotice'/);
  assert.match(component, /<section/);
  assert.match(component, /aria-label="Trademark and copyright notice"/);
  assert.match(component, /\{notice\.heading\}/);
  assert.match(component, /<blockquote/);
  assert.match(component, /\{notice\.intro\}/);
  assert.match(component, /<strong className="font-semibold text-foreground">\{notice\.legalHeading\}<\/strong>/);
  assert.match(component, /\{notice\.legalBody\}/);
  assert.match(component, /<strong className="font-semibold text-foreground">\{notice\.acquisitionHeading\}<\/strong>/);
  assert.match(component, /\{notice\.acquisitionBody\}/);
  // Single source of truth: the sentences live in the module, not here.
  assert.doesNotMatch(component, /price-gouged/);
  assert.doesNotMatch(component, /Corporate Vultures/);
  assert.doesNotMatch(component, /Save your breath/);
});

test('LegalFooter renders the footer from the module, small and centered', () => {
  const component = read('src/components/LegalFooter.jsx');
  assert.match(component, /import \{ LEGAL_FOOTER as footer \} from '@\/lib\/trademarkNotice'/);
  assert.match(component, /<footer/);
  assert.match(component, /\{footer\.copyrightLine\}/);
  assert.match(component, /\{footer\.trademarkLine\}/);
  assert.match(component, /text-center/);
  assert.match(component, /text-\[11px\]/);
  assert.match(component, /text-muted-foreground/);
  assert.doesNotMatch(component, /All rights reserved\./);
  assert.doesNotMatch(component, /strictly prohibited\./);
});

test('Plans shows the notice before the buttons and the footer at the bottom', () => {
  const screen = read('src/pages/Plans.jsx');
  assert.match(screen, /import TrademarkNotice from '@\/components\/TrademarkNotice'/);
  assert.match(screen, /import LegalFooter from '@\/components\/LegalFooter'/);
  assert.equal(screen.split('<TrademarkNotice />').length - 1, 1, 'Plans must render the notice exactly once');
  assert.equal(screen.split('<LegalFooter />').length - 1, 1, 'Plans must render the footer exactly once');
  // T6.3: the policy-review paragraph moved into en.js (plans.reviewBefore)
  // — the t() reference is the anchor, and the English value is asserted.
  assert.match(screen, /t\('plans\.reviewBefore'\)/);
  assert.equal(en['plans.reviewBefore'], 'Before subscribing, please review the');
  const reviewAt = screen.indexOf("t('plans.reviewBefore')");
  const noticeAt = screen.indexOf('<TrademarkNotice />');
  const buttonsAt = screen.indexOf('<div className="mt-6 flex flex-col gap-2 sm:flex-row">');
  const footerAt = screen.indexOf('<LegalFooter />');
  assert.ok(reviewAt > -1 && noticeAt > reviewAt, 'notice comes after the policy-review paragraph');
  assert.ok(noticeAt < buttonsAt, 'notice comes before the sign-in / back buttons');
  assert.ok(footerAt > buttonsAt, 'footer sits at the bottom, after the buttons');
  // Nothing else on Plans changed: the policy line still derives from the
  // modules and the Stripe-switching copy is untouched.
  assert.match(screen, /\{policyEffectiveLine\}/);
});

test('Subscribe shows the notice as the subscription process starts', () => {
  const screen = read('src/pages/Subscribe.jsx');
  assert.match(screen, /import TrademarkNotice from '@\/components\/TrademarkNotice'/);
  assert.match(screen, /import LegalFooter from '@\/components\/LegalFooter'/);
  assert.equal(screen.split('<TrademarkNotice />').length - 1, 1, 'Subscribe must render the notice exactly once');
  assert.equal(screen.split('<LegalFooter />').length - 1, 1, 'Subscribe must render the footer exactly once');
  // T6.3: the price line and the no-card line moved into en.js
  // (subscribe.pricePerMonth, subscribe.noCardStored) — the t() references
  // are the anchors, and the English values are asserted.
  assert.match(screen, /t\('subscribe\.pricePerMonth', \{ price: `\$\$\{plan\.price\.toFixed\(2\)\}` \}\)/);
  assert.equal(en['subscribe.pricePerMonth'], '{price} per month, plus any applicable taxes.');
  assert.match(screen, /t\('subscribe\.noCardStored'\)/);
  assert.equal(
    en['subscribe.noCardStored'],
    'No card details are stored by Luminous StockHaven. Payments are processed by Stripe.'
  );
  const priceAt = screen.indexOf("t('subscribe.pricePerMonth'");
  const noticeAt = screen.indexOf('<TrademarkNotice />');
  const accountAt = screen.indexOf('{!isAuthenticated ? (');
  const noCardAt = screen.indexOf("t('subscribe.noCardStored')");
  const footerAt = screen.indexOf('<LegalFooter />');
  assert.ok(priceAt > -1 && noticeAt > priceAt, 'notice comes after the plan price');
  assert.ok(noticeAt < accountAt, 'notice comes before the create-account / workspace step');
  assert.ok(footerAt > noCardAt, 'footer sits at the bottom of the page');
  // T4: the Stripe-switching notice is gone — Subscribe now offers
  // real Stripe checkout (create-checkout) with the trial decided by
  // the server before checkout.
  assert.doesNotMatch(screen, /PAYMENTS_SWITCHING_NOTICE/);
  assert.doesNotMatch(screen, /switching payments to Stripe/i);
  assert.match(screen, /create-checkout/);
  // T6.3: the trial button label moved into en.js (subscribe.startTrial).
  assert.match(screen, /t\('subscribe\.startTrial', \{ planName: plan\.name \}\)/);
  assert.equal(en['subscribe.startTrial'], 'Start 7-day free trial — {planName}');
});

test('shared Layout puts the footer at the bottom of every protected page', () => {
  const layout = read('src/components/Layout.jsx');
  assert.match(layout, /import LegalFooter from '@\/components\/LegalFooter'/);
  assert.equal(layout.split('<LegalFooter').length - 1, 1, 'Layout must render the footer exactly once');
  const mainAt = layout.indexOf('<main className="stockhaven-mobile-content');
  const footerAt = layout.indexOf('<LegalFooter');
  const mainEndAt = layout.indexOf('</main>');
  assert.ok(footerAt > mainAt && footerAt < mainEndAt, 'footer sits inside <main>, after the page content');
  // It clears the fixed mobile tab bar instead of hiding behind it.
  assert.match(layout, /<LegalFooter className="pb-20 lg:pb-4" \/>/);
});

test('ThankYou and the three policy pages carry the footer at the bottom', () => {
  for (const page of [
    'src/pages/ThankYou.jsx',
    'src/pages/TermsOfService.jsx',
    'src/pages/PrivacyPolicy.jsx',
    'src/pages/SubscriptionPolicy.jsx',
  ]) {
    const screen = read(page);
    assert.match(screen, /import LegalFooter from '@\/components\/LegalFooter'/, `${page} must import LegalFooter`);
    assert.equal(screen.split('<LegalFooter />').length - 1, 1, `${page} must render the footer exactly once`);
    assert.ok(
      screen.indexOf('<LegalFooter />') < screen.indexOf('</main>'),
      `${page} must render the footer inside <main>, at the bottom`,
    );
  }
  // ThankYou keeps its centered section; the footer sits below it.
  const thankYou = read('src/pages/ThankYou.jsx');
  assert.match(thankYou, /m-auto max-w-md space-y-4 py-10 text-center/);
  assert.ok(
    thankYou.indexOf('<LegalFooter />') > thankYou.indexOf('</section>'),
    'ThankYou footer comes after the centered section',
  );
});

test('no policy wording was touched by this change', () => {
  for (const module of [
    'src/lib/stockhavenTermsOfService.js',
    'src/lib/stockhavenSubscriptionPolicy.js',
    'src/lib/stockhavenPrivacyPolicy.js',
  ]) {
    const text = read(module);
    assert.doesNotMatch(text, /Corporate Vultures/, `${module} must carry no trademark-notice text`);
    assert.doesNotMatch(text, /Save your breath/, `${module} must carry no trademark-notice text`);
  }
});
