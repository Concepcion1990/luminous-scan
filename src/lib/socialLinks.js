/**
 * The Luminous Book Shop on social media — the owner's four business
 * pages, in her own links (given Nov 16, 2026 for the About page).
 *
 * The About page renders one row per entry: platform name, handle, a
 * tappable link, and a QR code beside it that encodes exactly `url`.
 * The QR artwork lives in src/assets/social/<id>-qr.svg and is
 * generated from these URLs by scripts/generate-social-qrs.mjs —
 * never edit an SVG by hand; change the URL here and re-run the
 * script. tests/t35/about-social-qr.test.js decodes every committed
 * SVG with a real QR reader and pins it to the URL below.
 *
 * Platform names and handles are proper nouns — they render as-is in
 * every locale, so this section needs no translation keys.
 */
export const SOCIAL_LINKS = Object.freeze([
  Object.freeze({
    id: 'instagram',
    platform: 'Instagram',
    handle: '@the_luminous_book_shop',
    url: 'https://www.instagram.com/the_luminous_book_shop',
  }),
  Object.freeze({
    id: 'facebook',
    platform: 'Facebook',
    handle: 'The Luminous Book Shop',
    url: 'https://www.facebook.com/share/1C1DuJkVst/',
  }),
  Object.freeze({
    id: 'threads',
    platform: 'Threads',
    handle: '@the_luminous_book_shop',
    url: 'https://www.threads.com/@the_luminous_book_shop',
  }),
  Object.freeze({
    id: 'tiktok',
    platform: 'TikTok',
    handle: '@the.luminous.book',
    url: 'https://www.tiktok.com/@the.luminous.book',
  }),
]);
