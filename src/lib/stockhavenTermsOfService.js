/**
 * Luminous Stockhaven website Terms of Service.
 * Effective November 9, 2026. Website subscription billing is through
 * Stripe. Payments are being switched to Stripe — subscriptions will be
 * back soon. You can cancel your
 * subscription yourself in the app using the Cancel Subscription button
 * in Settings or on the Upgrade page; cancellation and refund requests
 * can also be handled through the official customer support contact.
 *
 * Direct Luminous Stockhaven website subscriptions only. This does not replace
 * storefront merchandise returns, app-store billing terms or a Privacy Policy.
 */
export const STOCKHAVEN_TERMS_OF_SERVICE = Object.freeze({
  id: 'stockhaven-website-terms-of-service',
  version: '2026-11-09-v5',
  status: 'effective',
  effectiveDate: 'November 9, 2026',
  lastReviewed: 'November 9, 2026',
  owner: 'The Luminous Book Shop, LLC',
  application: 'Luminous Stockhaven',
  tagline: 'A home for everything your business carries.',
  title: 'Terms of Service & Conditions',
  scope: 'These terms govern use of Luminous Stockhaven and website subscriptions purchased directly from The Luminous Book Shop, LLC. They do not override physical-product return policies for our bookstore or transactions made through eBay, Shopify, Amazon, Walmart, TikTok Shop, Google Play, or the Apple App Store. Those services may have their own applicable terms.',
  launchNotice: 'Effective November 8, 2026. Website subscriptions are billed through Stripe. Payments are being switched to Stripe — subscriptions will be back soon. Cancellation and refund requests are handled through the official customer support contact shown in the application and at checkout; you can also cancel your subscription yourself in the app using the Cancel Subscription button in Settings or on the Upgrade page.',
  sections: Object.freeze([
    {
      id: 'acceptance', title: '1. Acceptance of terms',
      paragraphs: [
        'Luminous Stockhaven is an inventory management application developed and operated by The Luminous Book Shop, LLC.',
        'By creating an account, using the application or purchasing a paid website subscription, you agree to the applicable Terms of Service, Subscription, Cancellation & Refund Policy and Privacy Policy as published.',
        'Luminous Stockhaven supplies inventory management software. It does not itself sell, store or ship your physical merchandise.',
      ],
    },
    {
      id: 'services', title: '2. Description of services',
      paragraphs: [
        'Depending on your plan and released functionality, the application may provide product and location inventory management, universal barcode and QR scanning, stock receiving and movement tracking, purchase orders, supplier records, reports, spreadsheet imports and exports, staff permissions, labels and print documents, product variations, materials, bundles and production tracking.',
        'Listing-channel records may track merchandise advertised elsewhere; they do not represent a live sales-channel integration unless one is specifically enabled and disclosed.',
        'Features shown as planned, in development or unavailable are not guaranteed to be usable until officially released.',
      ],
    },
    {
      id: 'accounts', title: '3. Accounts and customer responsibilities',
      paragraphs: [
        'Customers must provide accurate registration information and safeguard their account credentials. Business owners are responsible for authorized staff activity within their workspaces.',
        'You agree not to use the application for unlawful activity, unauthorized access, fraudulent records or interference with other customers. You must have the right to upload the content and business data you provide.',
      ],
    },
    {
      id: 'plans', title: '4. Website plans and billing',
      paragraphs: [
        'Essentials is $14.99 USD per month and includes one business workspace, one top-level operating site, up to 50 active products and three additional staff accounts.',
        'Business is $29.99 USD per month and includes up to five business workspaces and five top-level operating sites TOTAL under one owner account, with unlimited active products and additional staff accounts, subject to disclosed technical and acceptable-use safeguards.',
        'Applicable taxes may be added as required and must be shown before customers authorize payment. Website plans automatically renew monthly unless canceled before the next billing date. The exact price, billing schedule and taxes will be disclosed during checkout.',
        'Future mobile-only, Shopify or app-store subscriptions may have separate entitlements and billing rules. Website plans are intended to include the mobile companion without a second mobile subscription charge when that companion becomes available.',
      ],
    },
    {
      id: 'trials', title: '5. Seven-day free trial',
      paragraphs: [
        'Eligible new website customers may receive ONE seven-day introductory free trial when the offer is available. Eligibility and the actual trial end and first payment date must be disclosed when the offer is made.',
        'Cancel before the displayed trial deadline to avoid the first subscription charge. Creating more business workspaces, upgrading or switching website plans, canceling, resubscribing or returning to the application does not restart or extend the initial trial.',
        'A customer moving from an eligible mobile trial to a website plan must not receive duplicate overlapping charges or an automatically restarted trial; those transitions remain subject to the final, verified billing implementation.',
      ],
    },
    {
      id: 'cancellation', title: '6. Canceling a subscription',
      paragraphs: [
        'You may request cancellation of your direct website subscription at any time using the Cancel Subscription button in Settings or on the Upgrade page, or through the official support channel disclosed at checkout and in the application.',
        'Once confirmed by the payment provider, cancellation stops future automatic renewals. A pending cancellation request does not necessarily reverse a charge already being processed.',
        'When you cancel an already-paid subscription without receiving a refund, access to the paid features continues ONLY through the provider-confirmed end of the subscription period you have already paid for. Cancellation never provides an additional free month.',
        'After your paid period ends, you have 15 days to view your products only — you can see SKUs, ISBNs, and everything you need to move elsewhere, but you cannot make changes, use the scanner, import, or export. After those 15 days, your account and all its information are permanently deleted and cannot be recovered. Resubscribing starts fresh.',
      ],
    },
    {
      id: 'refunds', title: '7. Initial-payment refunds and billing errors',
      paragraphs: [
        'If you cancel within THREE DAYS (72 hours) after the FIRST successful paid Luminous Stockhaven website subscription charge on your account, you may request a refund of that initial payment. For an eligible trial, the 72-hour clock begins with the first successful paid charge AFTER the trial, not with trial registration.',
        'The introductory three-day refund opportunity is available only once. It never restarts on monthly renewals, Essentials-to-Business upgrades, cancellation and reactivation, resubscription or a return to the service.',
        'After that window, ordinary voluntary cancellations are nonrefundable and unused days are not ordinarily refunded in part. Customers canceling without refunds retain paid feature access through the confirmed already-paid billing period.',
        'A confirmed refund of the first payment may cause paid-feature access to end. We will correct confirmed accidental duplicate charges and billing errors and honor any rights, refunds or other remedies required by applicable law. Nothing here limits statutory customer rights.',
        'To request an eligible initial-payment refund, cancel within the 72-hour window and contact the official Luminous Stockhaven support channel published with the checkout flow. The original successful payment and cancellation time must be verified before a refund decision.',
      ],
    },
    {
      id: 'plan-changes', title: '8. Plan upgrades and changes',
      paragraphs: [
        'When upgrades are enabled, customers may request an Essentials-to-Business upgrade under the SAME existing account and subscription rather than creating a second paid contract.',
        'Your existing business identity, inventory, staff, history and trial records are preserved. A plan change never begins a second seven-day trial.',
        'Before authorization, the new recurring price, any prorated amount, applicable taxes and the effective billing date must be disclosed. No payment or plan change occurs merely by viewing plan information.',
      ],
    },
    {
      id: 'business-data', title: '9. Business data and accuracy',
      paragraphs: [
        'Customers retain ownership of the inventory, business records, original photographs and other content they submit. You authorize Luminous Stockhaven to process this information as necessary to provide the application, subject to the published Privacy Policy.',
        'Customers are responsible for verifying stock quantities, imports, financial estimates, inventory reports and data exports. The software cannot guarantee correctness of customer-entered information or information supplied by outside sources.',
        'We recommend keeping independent business records and appropriate backups. Exports, backup restoration and other features are provided only to the extent actually available in the released product.',
      ],
    },
    {
      id: 'access-retention', title: '10. Payment failures, access and retention',
      paragraphs: [
        'Unsuccessful recurring payments may result in notice, an opportunity to update payment information, and restrictions on paid features subject to any disclosed grace period and applicable law.',
        'We will not treat an unverified payment as proof that a subscription has renewed. Cancellation or payment failure does not itself authorize the immediate deletion of your business data. After the 15-day grace period ends, your account and all its information are permanently deleted and cannot be recovered. See section 6 for the full grace-period terms.',
        'Account recovery, requests for deletion and data retention will be governed by the final published privacy and account-retention procedures.',
      ],
    },
    {
      id: 'ip', title: '11. Intellectual property and acceptable use',
      paragraphs: [
        'The Luminous Stockhaven name, software, original branding and interface materials are owned by The Luminous Book Shop, LLC or applicable licensors. Customer-provided business content remains the customer’s content.',
        'The subscription grants permission to access and use the software under these terms, not ownership or resale rights. Do not reproduce, redistribute, misuse or attempt to access another customer’s private information, except as permitted by law or written authorization.',
      ],
    },
    {
      id: 'availability', title: '12. Availability and third-party services',
      paragraphs: [
        'The application may experience maintenance, technical interruptions or service limitations, including those caused by infrastructure and authorized service providers.',
        'Luminous Stockhaven does not guarantee uninterrupted or error-free operation. Nothing in these terms excludes duties or legal remedies that may not lawfully be excluded.',
      ],
    },
    {
      id: 'privacy', title: '13. Privacy and security',
      paragraphs: [
        'The Privacy Policy will describe how personal information is collected, used, retained and shared. Payment processing is performed by Stripe, the authorized payment provider for website subscriptions.',
        'Do not submit card numbers, bank credentials or passwords in ordinary customer-support messages. Customers are responsible for safeguarding their sign-in information.',
      ],
    },
    {
      id: 'updates', title: '14. Updates to the terms',
      paragraphs: [
        'The Luminous Book Shop, LLC may revise these terms as the software, services or legal requirements change. Material changes to recurring payment terms will be disclosed as required by applicable law.',
        'A revision does not waive nonwaivable consumer rights.',
      ],
    },
    {
      id: 'support', title: '15. Support and contact',
      paragraphs: [
        'For questions about Luminous Stockhaven, account access, cancellation, refunds, subscriptions or technical support, use the official customer-support channel that will be published within the application and at checkout.',
        'Luminous Stockhaven is operated by The Luminous Book Shop, LLC. Website subscription billing is through Stripe; use the official customer-support channel published within the application and at checkout.',
      ],
    },
  ]),
});
