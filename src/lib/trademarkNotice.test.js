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
//
// Nov 15, 2026 — her ruling: the block translates into all 52
// locales. The component now renders the notice.* locale keys; this
// file pins the English key values byte-identical to the frozen
// module. The footer's copyright line is the exception: it stays
// module-rendered verbatim in every locale (the exact footer line).

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
    'We actively monitor the market. Any attempt to scrape our platform, clone our proprietary workflows, or infringe upon our intellectual property will be met with immediate, aggressive legal action.',
  );
  assert.equal(notice.acquisitionHeading, 'TO ACQUISITION FIRMS & BROKERS:');
  assert.equal(
    notice.acquisitionBody,
    "Do not email me. Do not DM me. Do not pitch me a 'strategic exit.' You can throw thousands, millions, billions, or trillions at me — the answer is No. You will not buy this app just to jack up prices on my fellow merchants. Any acquisition cold-emails will be instantly marked as spam, and your domain will be permanently blocked from our platform. Save your breath.",
  );
});

test('footer text is the owner\'s exact words, verbatim', () => {
  // Nov 12, 2026: the © line was first removed whole (it was wholly a
  // copyright claim), then restored the same day on her word — minus
  // only the © symbol, and with her registered legal name, "The
  // Luminous Book Shop, LLC" (Book and Shop separate words).
  // Nov 15, 2026: the © is restored on her attorney's advice — she
  // plans to copyright the app within the next year. This supersedes
  // the Nov 12 removal of the symbol.
  assert.equal(
    footer.copyrightLine,
    '© 2026 The Luminous Book Shop, LLC. All rights reserved.',
  );
  assert.equal(
    footer.trademarkLine,
    'Unauthorized duplication, cloning, or scraping is strictly prohibited.',
  );
});

test('the © is restored; no other claim language returns (Nov 15, 2026)', () => {
  // Her decision Nov 12, 2026 was to launch without claiming a
  // trademark / copyright filing — no ®, ™ or © symbols, no
  // registration or protection claims. On Nov 15, 2026, on her
  // attorney's advice, she restored the © alone: she CAN keep it
  // because she plans to copyright the app within the next year.
  // The ® and ™ stay out, and no registration / protection wording
  // returns. This test supersedes the Nov 12 no-claim-language test
  // where the © is concerned.
  const rendered = [...Object.values(notice), ...Object.values(footer)].join('\n');
  assert.match(footer.copyrightLine, /^© 2026 /, 'the © leads the footer line');
  assert.doesNotMatch(rendered, /[®™]/);
  assert.doesNotMatch(rendered, /trademark/i);
  assert.doesNotMatch(rendered, /copyright/i);
  assert.doesNotMatch(rendered, /registered/i);
  // "All rights reserved" is NOT forbidden: on Nov 12, 2026 she
  // explicitly kept that phrase in the restored footer line, and on
  // Nov 15, 2026 the © came back in front of it.
  assert.doesNotMatch(rendered, /statutory damages/i);
  assert.ok(Object.isFrozen(notice), 'notice module must be frozen');
  assert.ok(Object.isFrozen(footer), 'footer module must be frozen');
});

test('TrademarkNotice renders the notice from the locale keys, never hardcoded copy', () => {
  // Nov 15, 2026 — her ruling: the not-for-sale block translates
  // into all 52 locales. The component renders the notice.* keys;
  // the module stays the frozen reference, and the English key
  // values below are pinned byte-identical to it, so her English
  // words cannot drift — translations are renderings, never edits.
  const component = read('src/components/TrademarkNotice.jsx');
  assert.match(component, /import \{ t, useLocale \} from '@\/lib\/i18n'/);
  assert.match(component, /<section/);
  assert.match(component, /aria-label=\{t\('notice\.ariaLabel'\)\}/);
  assert.equal(en['notice.ariaLabel'], 'Trademark and copyright notice');
  assert.match(component, /\{t\('notice\.heading'\)\}/);
  assert.match(component, /<blockquote/);
  assert.match(component, /\{t\('notice\.intro'\)\}/);
  assert.match(component, /<strong className="font-semibold text-foreground">\{t\('notice\.legalHeading'\)\}<\/strong>/);
  assert.match(component, /\{t\('notice\.legalBody'\)\}/);
  assert.match(component, /<strong className="font-semibold text-foreground">\{t\('notice\.acquisitionHeading'\)\}<\/strong>/);
  assert.match(component, /\{t\('notice\.acquisitionBody'\)\}/);
  assert.equal(en['notice.heading'], notice.heading);
  assert.equal(en['notice.intro'], notice.intro);
  assert.equal(en['notice.legalHeading'], notice.legalHeading);
  assert.equal(en['notice.legalBody'], notice.legalBody);
  assert.equal(en['notice.acquisitionHeading'], notice.acquisitionHeading);
  assert.equal(en['notice.acquisitionBody'], notice.acquisitionBody);
  // Single source of truth: the sentences live in the module and
  // the locale files, not in the component.
  assert.doesNotMatch(component, /price-gouged/);
  assert.doesNotMatch(component, /Corporate Vultures/);
  assert.doesNotMatch(component, /Save your breath/);
});

test('LegalFooter renders the footer from the module, small and centered', () => {
  const component = read('src/components/LegalFooter.jsx');
  assert.match(component, /import \{ LEGAL_FOOTER as footer \} from '@\/lib\/trademarkNotice'/);
  assert.match(component, /<footer/);
  assert.match(component, /\{footer\.copyrightLine\}/);
  // Nov 15, 2026: the anti-cloning line renders from its locale
  // key; the English key value is pinned to the module's line.
  // The copyright line stays module-rendered verbatim in every
  // locale — the exact footer line, entity name and all.
  assert.match(component, /\{t\('footer\.trademarkLine'\)\}/);
  assert.equal(en['footer.trademarkLine'], footer.trademarkLine);
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
  // Embed-aware since the lesson visuals (Nov 15, 2026): inside
  // a visual frame there is no tab bar to clear, so the footer
  // sits tight; everywhere else it keeps its tab-bar clearance.
  assert.match(layout, /<LegalFooter className=\{embedVisual \? "pb-4" : "pb-20 lg:pb-4"\} \/>/);
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

test('Welcome shows the notice at the foot of the front door (restored Nov 15, 2026)', () => {
  const screen = read('src/pages/Welcome.jsx');
  assert.match(screen, /import TrademarkNotice from '@\/components\/TrademarkNotice'/);
  assert.equal(screen.split('<TrademarkNotice />').length - 1, 1, 'Welcome must render the notice exactly once');
  // The notice closes the page: after the plan cards and the
  // sign-in line, inside <main> — the same statement a visitor
  // meets on Plans, in the same component and words.
  const cardsAt = screen.indexOf('WELCOME_OPTIONS.map');
  const signInAt = screen.indexOf("t('welcome.alreadyHaveAccount')");
  const noticeAt = screen.indexOf('<TrademarkNotice />');
  assert.ok(cardsAt > -1 && noticeAt > cardsAt, 'notice comes after the plan cards');
  assert.ok(signInAt > -1 && noticeAt > signInAt, 'notice comes after the sign-in line');
  assert.ok(noticeAt < screen.indexOf('</main>'), 'notice sits inside <main>');
  // Nov 15, 2026 — her ruling: the legal footer line (with the ©)
  // must be on the public front door too, before anyone registers
  // or subscribes — the same shared LegalFooter as everywhere else,
  // after the notice, closing the page inside <main>.
  assert.match(screen, /import LegalFooter from '@\/components\/LegalFooter'/);
  assert.equal(screen.split('<LegalFooter />').length - 1, 1, 'Welcome must render the footer exactly once');
  const footerAt = screen.indexOf('<LegalFooter />');
  assert.ok(footerAt > noticeAt, 'footer comes after the notice, at the foot of the front door');
  assert.ok(footerAt < screen.indexOf('</main>'), 'footer sits inside <main>');
});

test('About shows the notice after the founder story, before the footer (restored Nov 15, 2026)', () => {
  const screen = read('src/pages/About.jsx');
  assert.match(screen, /import TrademarkNotice from '@\/components\/TrademarkNotice'/);
  assert.equal(screen.split('<TrademarkNotice />').length - 1, 1, 'About must render the notice exactly once');
  const storyAt = screen.indexOf('FOUNDER_PARAGRAPH_KEYS.map');
  const noticeAt = screen.indexOf('<TrademarkNotice />');
  const footerAt = screen.indexOf('<LegalFooter />');
  assert.ok(storyAt > -1 && noticeAt > storyAt, 'notice comes after the founder story');
  assert.ok(footerAt > noticeAt, 'notice comes before the legal footer');
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
