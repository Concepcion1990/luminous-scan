import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ABOUT_FOUNDER as about } from './aboutFounder.js';

// The "Luminous StockHaven About" page — About the Founder, dictated
// Nov 9, 2026. The text lives in src/lib/aboutFounder.js — a single
// source of truth — and the page only lays it out, so the wording cannot
// drift. The page is public, like the policy pages.

const read = (file) => readFileSync(file, 'utf8');

test('about page title is the owner\'s exact page name, capital H and all', () => {
  // Her exact page name: "Luminous StockHaven About". Do not "correct"
  // the capital H — the app name reads "Luminous StockHaven" everywhere.
  assert.equal(about.pageTitle, 'Luminous StockHaven About');
  assert.equal(about.sectionHeading, '📖 About the Founder');
  assert.ok(Object.isFrozen(about), 'about module must be frozen');
  assert.ok(Object.isFrozen(about.paragraphs), 'paragraphs must be frozen');
});

test('founder text is the owner\'s exact words, verbatim', () => {
  assert.equal(about.paragraphs.length, 4, 'four paragraphs, as she wrote them');
  assert.equal(
    about.paragraphs[0],
    "Hey there, I'm Concepcion, the founder of Luminous StockHaven.",
  );
  assert.equal(
    about.paragraphs[1],
    "I don't come from a big tech background, and I don't sit in a corporate office. I'm a small retail owner just like you. I manage five e-commerce storefronts, specializing in books and handmade bookish accessories.\nLike many independent retailers, I hit a breaking point trying to manage multi-location inventory, track publisher ISBNs alongside my own handmade SKUs, and handle supplier orders using clunky spreadsheets. When I looked for an app to help, I tried six different options. Every single one was either completely incomplete, incredibly confusing, or predatory—charging hundreds of dollars a month for basic tools.",
  );
  assert.equal(
    about.paragraphs[2],
    'Frustrated with an industry that gouges independent creators, I decided to build my own solution. I built Luminous StockHaven out of necessity to run my own businesses cleanly, efficiently, and with total peace of mind.',
  );
  assert.equal(
    about.paragraphs[3],
    'I decided to open this platform to the public at an honest, affordable price because every small business owner deserves tools that actually work without risking their bottom line. We are independently owned, fiercely protective of our community, and built by a retailer, for retailers.',
  );
});

test('About page renders the founder text from the module, never hardcoded copy', () => {
  const page = read('src/pages/About.jsx');
  assert.match(page, /import \{ ABOUT_FOUNDER as about \} from '@\/lib\/aboutFounder'/);
  assert.match(page, /import LegalFooter from '@\/components\/LegalFooter'/);
  assert.match(page, /\{about\.pageTitle\}/);
  assert.match(page, /\{about\.sectionHeading\}/);
  assert.match(page, /about\.paragraphs\.map\(\(paragraph, index\) =>/);
  assert.match(page, /<LegalFooter \/>/);
  assert.ok(
    page.indexOf('<LegalFooter />') < page.indexOf('</main>'),
    'About must render the footer inside <main>, at the bottom',
  );
  // Single source of truth: the sentences live in the module, not here.
  // (The page title string appears only in the file's own doc comment,
  // never as rendered copy — the <h1> reads {about.pageTitle}.)
  assert.doesNotMatch(page, /Hey there, I'm Concepcion/);
  assert.doesNotMatch(page, /predatory—charging/);
  assert.doesNotMatch(page, /built by a retailer, for retailers/);
});

test('/about is a public route, like the policy pages', () => {
  const app = read('src/App.jsx');
  assert.match(app, /import About from '@\/pages\/About'/);
  assert.match(app, /<Route path="\/about" element=\{<About \/>} \/>/);
  assert.match(app, /pathname === '\/about'/, '/about must be in openToEveryone');
  // The route sits with the other public routes, outside ProtectedRoute.
  const aboutAt = app.indexOf('<Route path="/about"');
  const protectedAt = app.indexOf('<Route element={<ProtectedRoute');
  assert.ok(aboutAt > -1 && aboutAt < protectedAt, '/about must sit above ProtectedRoute');
  const plansAt = app.indexOf('<Route path="/plans"');
  const subscribeAt = app.indexOf('<Route path="/subscribe"');
  assert.ok(aboutAt > plansAt && aboutAt > subscribeAt, '/about sits with the public routes');
});

test('LegalFooter links to /about, small and subtle', () => {
  const footer = read('src/components/LegalFooter.jsx');
  assert.match(footer, /import \{ Link \} from 'react-router-dom'/);
  assert.match(footer, /<Link to="\/about"/);
  assert.match(footer, /About Luminous StockHaven/);
  assert.match(footer, /text-\[11px\]/, 'footer stays small');
  assert.match(footer, /text-center/, 'footer stays centered');
  // The legal text itself is untouched.
  assert.match(footer, /\{footer\.copyrightLine\}/);
  assert.match(footer, /\{footer\.trademarkLine\}/);
});

test('Plans links to /about near the trademark notice', () => {
  const screen = read('src/pages/Plans.jsx');
  assert.match(screen, /<Link to="\/about" className="font-medium text-primary underline underline-offset-4">/);
  assert.match(screen, /About Luminous StockHaven/);
  const noticeAt = screen.indexOf('<TrademarkNotice />');
  const aboutAt = screen.indexOf('<Link to="/about"');
  const buttonsAt = screen.indexOf('<div className="mt-6 flex flex-col gap-2 sm:flex-row">');
  assert.ok(noticeAt > -1 && aboutAt > noticeAt, 'About link comes after the notice');
  assert.ok(aboutAt < buttonsAt, 'About link comes before the sign-in / back buttons');
});

test('Register shows the trademark notice below the form, with an About link', () => {
  const screen = read('src/pages/Register.jsx');
  assert.match(screen, /import TrademarkNotice from ["']@\/components\/TrademarkNotice["']/);
  assert.match(screen, /<TrademarkNotice \/>/);
  assert.match(screen, /<Link to="\/about" className="font-medium text-primary underline underline-offset-4">/);
  assert.match(screen, /About Luminous StockHaven/);
  // The notice rides the new AuthLayout `below` slot — under the card,
  // never inside the form — and only on the create-account branch, not
  // the OTP branch (the OTP screen is a second step, not a fresh start).
  const formReturnAt = screen.indexOf('title="Create your account"');
  const noticeAt = screen.indexOf('<TrademarkNotice />');
  const otpAt = screen.indexOf('title="Verify your email"');
  assert.ok(formReturnAt > -1 && noticeAt > formReturnAt, 'notice sits on the create-account branch');
  // The OTP screen is a second step, not a fresh start: its AuthLayout
  // (between the OTP title and the create-account title) carries no
  // notice and no `below` slot at all.
  const otpSection = screen.slice(otpAt, formReturnAt);
  assert.doesNotMatch(otpSection, /below/);
  assert.doesNotMatch(otpSection, /TrademarkNotice/);
  const layout = read('src/components/AuthLayout.jsx');
  assert.match(layout, /below/);
  assert.match(layout, /\{below && <div className="mt-6 pb-10">\{below\}<\/div>\}/);
  // The form itself is untouched: same fields, same submit, same OTP flow.
  assert.match(screen, /<form onSubmit=\{handleSubmit\} className="space-y-4">/);
  assert.match(screen, /PASSWORD_HINT/);
});

test('no policy or trademark wording was touched by this change', () => {
  for (const module of [
    'src/lib/stockhavenTermsOfService.js',
    'src/lib/stockhavenSubscriptionPolicy.js',
    'src/lib/stockhavenPrivacyPolicy.js',
    'src/lib/trademarkNotice.js',
  ]) {
    const text = read(module);
    assert.doesNotMatch(text, /About the Founder/, `${module} must carry no about-page text`);
    assert.doesNotMatch(text, /built by a retailer, for retailers/, `${module} must carry no about-page text`);
  }
  // The trademark notice still says exactly what she wrote.
  const notice = read('src/lib/trademarkNotice.js');
  assert.match(notice, /Built for Retailers, Priceless to Corporate Vultures/);
  assert.match(notice, /The Luminous Bookshop, LLC®/);
});
